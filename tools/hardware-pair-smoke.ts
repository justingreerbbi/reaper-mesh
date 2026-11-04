/** Explicit two-port/two-board RF acceptance. Requires confirmed US antennas on both. */
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { openBoard } from './hardware-port.ts';
import type { Config } from '../packages/agent-core/sync.ts';
const [python, heltecPort, tbeamPort] = process.argv.slice(2);
if (!python || !heltecPort || !tbeamPort || heltecPort === tbeamPort)
  throw new Error('usage: node tools/hardware-pair-smoke.ts PYTHON HELTEC_PORT TBEAM_PORT');
const opened: Awaited<ReturnType<typeof openBoard>>[] = [];
const originals: Config[] = [],
  changed: number[] = [];
const results: { source: string; destination: string; bytes: number; outcome: string }[] = [];
async function waitFor(test: () => boolean, timeout = 65000) {
  const until = performance.now() + timeout;
  while (!test()) {
    if (
      performance.now() > until ||
      opened.some(board => board.connection.sync.state === 'disconnected')
    )
      throw new Error(
        'two-board qualification timed out/disconnected: ' +
          opened
            .map(board => board.connection.error ?? board.connection.radioInfo?.reason)
            .join(', '),
      );
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}
async function save(index: number, config: Config) {
  const board = opened[index];
  const id = board.adapter.configure(config);
  await waitFor(() => board.connection.commands.status(id).outcome !== 'pending', 10000);
  assert.equal(board.connection.commands.status(id).outcome, 'committed');
  await waitFor(() => board.connection.sync.state === 'ready', 10000);
}
try {
  opened.push(await openBoard(python, heltecPort));
  opened.push(await openBoard(python, tbeamPort));
  assert.match(opened[0].connection.device!, /^heltec-/);
  assert.match(opened[1].connection.capabilities?.firmware ?? '', /^tbeam-reaper-mesh-v/);
  assert.notEqual(opened[0].connection.device, opened[1].connection.device);
  for (const [index, board] of opened.entries()) {
    const original = board.connection.sync.config!;
    originals[index] = original;
    assert.equal(original.region, 'US');
    assert.ok(original.radio);
    if (original.radio.mode !== 'mesh' || original.radio.level !== 'low') {
      changed.push(index);
      await save(index, { ...original, radio: { ...original.radio, mode: 'mesh', level: 'low' } });
    }
    await waitFor(() => board.connection.radioInfo?.reason === 'ready', 10000);
    assert.equal(board.connection.radioInfo?.probe, 1);
  }
  for (const source of [0, 1]) {
    const sender = opened[source],
      receiver = opened[1 - source];
    const text =
      `Reaper two-board ${crypto.randomUUID()} from ${sender.connection.device}: `.padEnd(
        1024,
        'x',
      );
    const id = sender.adapter.sendMessage(text, receiver.connection.device!, 0);
    await waitFor(() =>
      ['acknowledged', 'failed', 'rejected', 'unknown'].includes(
        sender.connection.messaging.history.find(item => item.id === id)?.state ?? '',
      ),
    );
    const status = sender.connection.messaging.history.find(item => item.id === id)!;
    assert.equal(status.state, 'acknowledged', status.reason);
    assert.notEqual(status.reason, 'local-delivery');
    await waitFor(() =>
      receiver.connection.inbox.history.some(item => item.messageId === status.messageId),
    );
    const matches = receiver.connection.inbox.history.filter(
      item => item.messageId === status.messageId,
    );
    assert.equal(matches.length, 1);
    assert.equal(matches[0].text, text);
    const numeric = (id: string) => BigInt('0x' + id.replace(/^(?:node-|heltec-)/, ''));
    assert.equal(numeric(matches[0].origin), numeric(sender.connection.device!));
    results.push({
      source: sender.connection.device!,
      destination: receiver.connection.device!,
      bytes: 1024,
      outcome: 'destination-acknowledged-and-inbox-verified',
    });
    console.log(
      'Physical two-board 1024-byte delivery, destination ACK and exact inbox body passed:',
      results.at(-1),
    );
  }
  await writeFile(
    'build/tbeam-v12/pair-smoke.json',
    JSON.stringify({ time: new Date().toISOString(), results, relayQualified: false }, null, 2) +
      '\n',
  );
} finally {
  for (const index of changed.reverse()) {
    try {
      if (opened[index].connection.sync.state === 'ready') await save(index, originals[index]);
    } catch (error) {
      process.exitCode = 1;
      console.error('Verify original radio policy restoration:', error);
    }
  }
  for (const board of opened) await board.adapter.disconnect();
}
