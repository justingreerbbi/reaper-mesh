/**
 * Three-board relay acceptance on one desk. Boards on one desk all hear each other, so the two end
 * boards run the relay test build (REAPER_RELAY_TEST=1 bash tools/build-firmware.sh BOARD), which
 * ignores every frame that still has all its hops: frames straight from their sender. The middle
 * board runs normal firmware, so a frame reaches an end board only if the middle board forwarded it.
 *
 * First, with relaying off on the middle board, nothing may get through; that proves the ends
 * really can't hear each other. Then, with relaying on, direct messages must be acknowledged both
 * ways and Public broadcasts must arrive, each exactly once. Every board must already be in the
 * same Open network; this never changes networks. Radio settings are restored afterwards.
 *
 * This is the relay logic over real radios, not a range test: the ends are still close together.
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { openBoard } from './hardware-port.ts';
import type { Config } from '../packages/agent-core/sync.ts';

const [python, endAPort, relayPort, endCPort] = process.argv.slice(2);
if (
  !python ||
  !endAPort ||
  !relayPort ||
  !endCPort ||
  new Set([endAPort, relayPort, endCPort]).size < 3
)
  throw new Error(
    'usage: node tools/hardware-relay-smoke.ts PYTHON END_A_PORT RELAY_PORT END_C_PORT',
  );

type Board = Awaited<ReturnType<typeof openBoard>>;
/** 0.6 s of airtime at the budget's 1% a second, plus margin. */
const BUDGET_REFILL_MS = 70000;
const opened: Board[] = [];
const originals = new Map<Board, Config>();
const results: Record<string, unknown>[] = [];
const note = (result: Record<string, unknown>) => {
  results.push(result);
  console.log(result);
};

async function waitFor(
  test: () => boolean,
  label: string,
  timeout = 65000,
  boards: Board[] = opened,
) {
  const until = performance.now() + timeout;
  while (!test()) {
    const lost = boards.find(board => board.connection.sync.state === 'disconnected');
    if (lost) throw new Error(`${label}: ${name(lost)} disconnected (${lost.connection.error})`);
    if (performance.now() > until) throw new Error(`${label}: timed out`);
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}
/** Waits the whole time and reports whether `test` ever became true. */
async function happens(test: () => boolean, timeout: number) {
  const until = performance.now() + timeout;
  while (performance.now() < until) {
    if (test()) return true;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  return test();
}
async function save(board: Board, config: Config) {
  const id = board.adapter.configure(config);
  const only = [board];
  await waitFor(
    () => board.connection.commands.status(id).outcome !== 'pending',
    'save',
    10000,
    only,
  );
  assert.equal(board.connection.commands.status(id).outcome, 'committed');
  await waitFor(() => board.connection.sync.state === 'ready', 'resync', 10000, only);
  await waitFor(() => board.connection.radioInfo?.reason === 'ready', 'radio ready', 10000, only);
}
/** Each board's link and radio counters, printed when a check fails. */
function diagnose() {
  for (const board of opened) {
    const c = board.connection;
    console.error(
      `${name(board)}: sync ${c.sync.state}${c.error ? ` (${c.error})` : ''}, radio ${c.radioInfo?.reason ?? c.radioError}, ` +
        `transmitted ${c.radioInfo?.transmitted}, received ${c.radioInfo?.received}, ` +
        `sends [${c.messaging.history.map(item => item.state).join(', ')}], inbox ${c.inbox.history.length}`,
    );
  }
}
async function setRelay(board: Board, relay: boolean) {
  const config = board.connection.sync.config!;
  await save(board, { ...config, radio: { ...config.radio!, mode: 'mesh', level: 'low', relay } });
}
const firmware = (board: Board) => board.connection.capabilities?.firmware ?? '';
const name = (board: Board) => `${board.connection.device} (${firmware(board)})`;
const terminal = ['acknowledged', 'failed', 'rejected', 'unknown'];
const status = (board: Board, id: string) =>
  board.connection.messaging.history.find(item => item.id === id);
const received = (board: Board, test: (item: { text?: string; messageId?: string }) => boolean) =>
  board.connection.inbox.history.filter(test).length;

try {
  for (const port of [endAPort, relayPort, endCPort]) opened.push(await openBoard(python, port));
  const [a, relay, c] = opened;
  assert.match(firmware(a), /-relay-test$/, 'end A must run the relay test build');
  assert.match(firmware(c), /-relay-test$/, 'end C must run the relay test build');
  assert.doesNotMatch(firmware(relay), /-relay-test$/, 'the relay must run normal firmware');
  assert.equal(new Set(opened.map(board => board.connection.device)).size, 3);
  for (const board of opened) {
    await waitFor(() => !!board.connection.network, 'network status', 10000);
    assert.equal(
      board.connection.network?.networkMode,
      1,
      `${name(board)} must be in Open mode; run tools/hardware-network.ts PORT open first`,
    );
    const config = board.connection.sync.config!;
    assert.equal(config.region, 'US');
    assert.ok(config.radio);
    originals.set(board, config);
  }
  console.log(`End A: ${name(a)}\nRelay: ${name(relay)}\nEnd C: ${name(c)}`);
  await setRelay(a, false);
  await setRelay(c, false);

  // 1. Relay off: the ends must not reach each other at all.
  await setRelay(relay, false);
  const blocked = `Reaper relay control ${crypto.randomUUID()}`;
  const blockedId = a.adapter.sendMessage(blocked, c.connection.device!, 0);
  await waitFor(() => terminal.includes(status(a, blockedId)?.state ?? ''), 'blocked direct');
  assert.notEqual(status(a, blockedId)?.state, 'acknowledged', 'A reached C with relaying off');
  assert.equal(
    received(c, item => item.text === blocked),
    0,
    'C heard A with relaying off',
  );
  const quiet = `Reaper relay control broadcast ${crypto.randomUUID()}`;
  const quietId = a.adapter.sendMessage(quiet, 'broadcast', 0);
  assert.equal(
    await happens(() => received(c, item => item.text === quiet) > 0, 15000),
    false,
    'C heard a broadcast from A with relaying off',
  );
  // The relay hears A directly, which proves A was transmitting all along.
  await waitFor(() => received(relay, item => item.text === quiet) > 0, 'relay heard A', 10000);
  assert.equal(
    received(relay, item => item.text === quiet),
    1,
    'the relay hears A once',
  );
  assert.equal(status(a, quietId)?.state, 'transmitted');
  note({
    check: 'relay off: ends isolated',
    direct: status(a, blockedId)?.state,
    broadcast: 'not heard',
  });

  // 2. Relay on: direct messages both ways, one radio frame and full size (several frames),
  // acknowledged through the relay. Every case runs, so one failure doesn't hide the others.
  await setRelay(relay, true);
  const failures: string[] = [];
  for (const bytes of [60, 1024])
    for (const [sender, receiver] of [
      [a, c],
      [c, a],
    ]) {
      if (bytes > 160) {
        // The airtime budget refills at 1% a second after a one-second burst, and the relay pays
        // for every fragment it forwards. A full message is about 0.6 s of airtime, so let every
        // board's budget refill first, as the field plan says.
        console.log(`Waiting ${BUDGET_REFILL_MS / 1000} s for airtime budgets to refill...`);
        await happens(() => false, BUDGET_REFILL_MS);
      }
      const text = `Reaper relay ${crypto.randomUUID()}: `.padEnd(bytes, 'x');
      const relayedBefore = relay.connection.radioInfo?.transmitted ?? 0;
      const id = sender.adapter.sendMessage(text, receiver.connection.device!, 0);
      await waitFor(() => terminal.includes(status(sender, id)?.state ?? ''), 'relayed direct');
      const sent = status(sender, id)!;
      const arrived = await happens(
        () => received(receiver, item => item.messageId === sent.messageId) > 0,
        sent.state === 'acknowledged' ? 10000 : 3000,
      );
      // Give a duplicate time to show up before counting.
      if (arrived) await happens(() => false, 3000);
      const copies = receiver.connection.inbox.history.filter(
        item => item.messageId === sent.messageId,
      );
      const ok = sent.state === 'acknowledged' && copies.length === 1 && copies[0].text === text;
      if (!ok)
        failures.push(
          `${bytes}-byte direct ${sender.connection.device} -> ${receiver.connection.device}`,
        );
      note({
        check: 'relayed direct message',
        from: sender.connection.device,
        to: receiver.connection.device,
        bytes,
        sender: sent.state,
        reason: sent.reason,
        copies: copies.length,
        exact: copies[0]?.text === text,
        relayTransmitted: (relay.connection.radioInfo?.transmitted ?? 0) - relayedBefore,
        outcome: ok ? 'pass' : 'FAIL',
      });
    }

  // 3. Relay on: Public broadcasts from each end reach the other end exactly once.
  for (const [sender, receiver] of [
    [a, c],
    [c, a],
  ]) {
    const text = `Reaper relay broadcast ${crypto.randomUUID()} from ${sender.connection.device}`;
    sender.adapter.sendMessage(text, 'broadcast', 0);
    await happens(() => received(receiver, item => item.text === text) > 0, 20000);
    await happens(() => false, 3000);
    const copies = received(receiver, item => item.text === text);
    const atRelay = received(relay, item => item.text === text);
    const ok = copies === 1 && atRelay === 1;
    if (!ok)
      failures.push(`broadcast ${sender.connection.device} -> ${receiver.connection.device}`);
    note({
      check: 'relayed Public broadcast',
      from: sender.connection.device,
      to: receiver.connection.device,
      copies,
      atRelay,
      outcome: ok ? 'pass' : 'FAIL',
    });
  }

  await mkdir('build', { recursive: true });
  await writeFile(
    'build/relay-smoke.json',
    JSON.stringify(
      {
        time: new Date().toISOString(),
        endA: name(a),
        relay: name(relay),
        endC: name(c),
        passed: failures.length === 0,
        results,
        note: 'Desk test: the ends ignore direct frames by build. Not a range test.',
      },
      null,
      2,
    ) + '\n',
  );
  if (failures.length) {
    process.exitCode = 1;
    console.error(`Relay test failed (${failures.length}): ${failures.join('; ')}`);
    diagnose();
  } else console.log('Three-board relay test passed.');
  console.log('Results in build/relay-smoke.json');
} catch (error) {
  diagnose();
  throw error;
} finally {
  for (const [board, config] of originals) {
    try {
      if (board.connection.sync.state === 'ready') await save(board, config);
    } catch (error) {
      process.exitCode = 1;
      console.error(`Restore the radio settings on ${name(board)} by hand:`, error);
    }
  }
  for (const board of opened) await board.adapter.disconnect();
}
