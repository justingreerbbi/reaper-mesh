/**
 * Two-board transmit power check: every level, and boost on a board that has it, delivers in both
 * directions; the setting survives a reset; a board without boost refuses it. Requires confirmed
 * US antennas on both boards. Restores each board's original power. This shows the radio accepts
 * each setting and still delivers. It does not measure output power.
 */
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import type { Config } from '../packages/agent-core/sync.ts';
import { TX_LEVELS, type TxLevel } from '../packages/protocol/radio-config.ts';
import { openBoard } from './hardware-port.ts';

const [python, heltecPort, tbeamPort] = process.argv.slice(2);
if (!python || !heltecPort || !tbeamPort || heltecPort === tbeamPort)
  throw new Error('usage: node tools/hardware-power-smoke.ts PYTHON HELTEC_PORT TBEAM_PORT');
type Board = Awaited<ReturnType<typeof openBoard>>;
const opened: Board[] = [];
const originals: Config[] = [];
const results: Record<string, unknown>[] = [];
let reopening: Board | undefined; // Deliberately closed, so its state is not a failure.
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
function note(result: Record<string, unknown>) {
  results.push(result);
  console.log(JSON.stringify(result));
}
async function waitFor(test: () => boolean, what: string, timeout = 65000) {
  const until = performance.now() + timeout;
  while (!test()) {
    if (
      performance.now() > until ||
      opened.some(board => board !== reopening && board.connection.sync.state === 'disconnected')
    )
      throw new Error(
        `${what} timed out/disconnected: ` +
          opened
            .map(board => board.connection.error ?? board.connection.radioInfo?.reason)
            .join(', '),
      );
    await sleep(25);
  }
}
async function save(board: Board, level: TxLevel, boost: boolean) {
  const config = board.connection.sync.config!;
  const id = board.adapter.configure({
    ...config,
    radio: { ...config.radio!, level, boost },
  });
  await waitFor(() => board.connection.commands.status(id).outcome !== 'pending', 'save', 10000);
  assert.equal(board.connection.commands.status(id).outcome, 'committed');
  await waitFor(() => board.connection.sync.state === 'ready', 'resync', 10000);
  await waitFor(() => board.connection.radioInfo?.reason === 'ready', 'radio', 10000);
}
async function open(port: string) {
  const board = await openBoard(python, port);
  try {
    await waitFor(() => board.connection.radioInfo?.reason === 'ready', 'radio', 10000);
  } catch (error) {
    await board.adapter.disconnect();
    throw error;
  }
  return board;
}
async function direct(sender: Board, receiver: Board, label: string) {
  const text = `Reaper ${label} ${crypto.randomUUID()}`;
  const id = sender.adapter.sendMessage(text, receiver.connection.device!, 0);
  const done = () => sender.connection.messaging.history.find(item => item.id === id);
  await waitFor(
    () => ['acknowledged', 'failed', 'rejected', 'unknown'].includes(done()?.state ?? ''),
    'send',
  );
  assert.equal(done()!.state, 'acknowledged', `${label}: ${done()!.reason}`);
  await waitFor(
    () => receiver.connection.inbox.history.some(item => item.messageId === done()!.messageId),
    'inbox',
  );
  assert.equal(
    receiver.connection.inbox.history.find(item => item.messageId === done()!.messageId)!.text,
    text,
  );
}
try {
  opened.push(await open(heltecPort), await open(tbeamPort));
  for (const [index, board] of opened.entries()) {
    assert.match(board.connection.capabilities?.firmware ?? '', /-reaper-mesh-v0\.[456]\./);
    assert.equal(board.connection.supportsTxLevels, true);
    originals[index] = board.connection.sync.config!;
    assert.equal(originals[index].radio?.mode, 'mesh');
  }
  const [heltec, tbeam] = opened;
  assert.equal(heltec.connection.supportsTxBoost, false);
  assert.equal(tbeam.connection.supportsTxBoost, true);
  note({
    check: 'upgraded settings',
    heltec: originals[0].radio!.level,
    tbeam: originals[1].radio!.level,
    boost: [originals[0].radio!.boost, originals[1].radio!.boost],
  });

  const pair = async (label: string) => {
    await direct(heltec, tbeam, `${label} from Heltec`);
    await direct(tbeam, heltec, `${label} from T-Beam`);
    note({ check: label, outcome: 'acknowledged+inbox both ways' });
  };
  for (const level of TX_LEVELS) {
    await save(heltec, level, false);
    await save(tbeam, level, false);
    await pair(level);
  }
  for (const level of TX_LEVELS) {
    await save(tbeam, level, true);
    await pair(`${level} with T-Beam boost`);
  }

  // The agent refuses boost on a board without it; session tests cover the device's own refusal.
  const plain = heltec.connection.sync.config!;
  assert.throws(
    () => heltec.adapter.configure({ ...plain, radio: { ...plain.radio!, boost: true } }),
    /no transmit boost/,
  );
  note({ check: 'Heltec refuses boost', outcome: 'refused' });

  // The setting survives a reset: opening the port reboots the board and reloads record 7.
  await save(heltec, 'low', false);
  await save(tbeam, 'high', true);
  for (const [index, port] of [heltecPort, tbeamPort].entries()) {
    const before = opened[index].connection.sync.boot;
    reopening = opened[index];
    await reopening.adapter.disconnect();
    opened[index] = await open(port);
    reopening = undefined;
    assert.notEqual(opened[index].connection.sync.boot, before);
  }
  assert.equal(opened[0].connection.sync.config!.radio!.level, 'low');
  assert.equal(opened[1].connection.sync.config!.radio!.level, 'high');
  assert.equal(opened[1].connection.sync.config!.radio!.boost, true);
  await direct(opened[1], opened[0], 'after reset');
  note({ check: 'levels survive reset', heltec: 'low', tbeam: 'high with boost' });
  await writeFile(
    'build/power-smoke.json',
    JSON.stringify({ time: new Date().toISOString(), results, measuredOutput: false }, null, 2) +
      '\n',
  );
} finally {
  // Only the power changed, so put back exactly that.
  for (const [index, board] of opened.entries()) {
    try {
      if (originals[index] && board.connection.sync.state === 'ready')
        await save(board, originals[index].radio!.level, originals[index].radio!.boost);
    } catch (error) {
      process.exitCode = 1;
      console.error('Verify the original power was restored:', error);
    }
  }
  for (const board of opened) await board.adapter.disconnect();
}
