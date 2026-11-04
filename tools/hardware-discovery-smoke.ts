/** Explicit two-board discovery qualification; original settings restored in finally. */
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { openBoard } from './hardware-port.ts';
import type { Config } from '../packages/agent-core/sync.ts';
const [python, heltec, tbeam] = process.argv.slice(2);
if (!python || !heltec || !tbeam || heltec === tbeam)
  throw new Error('usage: node tools/hardware-discovery-smoke.ts PYTHON HELTEC_PORT TBEAM_PORT');
const boards: Awaited<ReturnType<typeof openBoard>>[] = [],
  originals: Config[] = [];
const attempts: { source: string; replies: number; disabled: boolean }[] = [];
async function waitFor(condition: () => boolean, timeout = 18000) {
  const until = performance.now() + timeout;
  while (!condition()) {
    if (performance.now() > until || boards.some(b => b.connection.sync.state === 'disconnected'))
      throw new Error(
        'discovery timeout/disconnect: ' +
          boards
            .map(
              b =>
                b.connection.error ??
                b.connection.discovery.error ??
                b.connection.discovery.last?.state,
            )
            .join(', '),
      );
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}
async function save(index: number, config: Config) {
  const b = boards[index],
    id = b.adapter.configure(config);
  await waitFor(() => b.connection.commands.status(id).outcome !== 'pending');
  assert.equal(b.connection.commands.status(id).outcome, 'committed');
  await waitFor(
    () =>
      b.connection.sync.state === 'ready' &&
      !!b.connection.radioInfo &&
      b.connection.radioInfo.revision === b.connection.sync.revision,
  );
}
async function discover(index: number, replies: number, disabled: boolean) {
  const b = boards[index];
  b.adapter.discover();
  await waitFor(() => !['collecting'].includes(b.connection.discovery.last?.state ?? 'collecting'));
  assert.equal(b.connection.discovery.last?.state, 'complete');
  assert.equal(b.connection.discovery.last.replies, replies);
  attempts.push({ source: b.connection.device!, replies, disabled });
  console.log('Physical discovery:', attempts.at(-1));
}
try {
  boards.push(await openBoard(python, heltec));
  boards.push(await openBoard(python, tbeam));
  for (const [i, b] of boards.entries()) {
    assert.equal(b.connection.capabilities?.discoveryVersion, 1);
    originals[i] = b.connection.sync.config!;
    assert.equal(originals[i].region, 'US');
    await save(i, {
      ...originals[i],
      radio: { ...originals[i].radio!, mode: 'mesh', level: 'low' },
      discovery: { beacon: false, respond: false, interval: 300 },
    });
    assert.equal(b.connection.radioInfo?.reason, 'ready');
  }
  if (process.argv.includes('--beacon-only')) {
    await waitFor(() => boards.every(b => !!b.connection.radioInfo));
    const receiver = boards[0].connection,
      sender = boards[1].connection;
    const peerID = 'node-' + sender.device!.replace(/^(?:heltec-|node-)/, '').padStart(16, '0');
    const before = receiver.discovery.nodes.find(node => node.node === peerID);
    const receiverTx = receiver.radioInfo!.transmitted,
      senderTx = sender.radioInfo!.transmitted;
    await save(1, {
      ...sender.sync.config!,
      discovery: { beacon: true, respond: false, interval: 60 },
    });
    await waitFor(
      () =>
        receiver.discovery.nodes.some(
          node =>
            node.node === peerID &&
            node.name === sender.sync.config!.label &&
            (!before ||
              node.peerBoot !== before.peerBoot ||
              node.peerSequence > before.peerSequence),
        ),
      72000,
    );
    await waitFor(() => (sender.radioInfo?.transmitted ?? 0) >= senderTx + 1);
    assert.equal(
      receiver.radioInfo?.transmitted,
      receiverTx,
      'beacon must not elicit a discovery reply or message ACK',
    );
    console.log(
      'Physical periodic beacon: received configured T-Beam name without a discovery request or response storm',
    );
    await writeFile(
      'build/tbeam-v12/beacon-smoke.json',
      JSON.stringify(
        {
          time: new Date().toISOString(),
          beaconNameVerified: true,
          responseTx: 0,
          interval: 60,
          locationTransmitted: false,
        },
        null,
        2,
      ) + '\n',
    );
  } else {
    const first = performance.now();
    await discover(0, 0, true);
    for (const [i, b] of boards.entries())
      await save(i, {
        ...b.connection.sync.config!,
        discovery: { beacon: false, respond: true, interval: 300 },
      });
    await discover(1, 1, false);
    await waitFor(() => performance.now() - first >= 31000, 33000);
    await discover(0, 1, false);
    for (const [i, b] of boards.entries()) {
      const other = boards[1 - i];
      const numeric = other.connection.device!.replace(/^(?:heltec-|node-)/, '').padStart(16, '0');
      await waitFor(() =>
        b.connection.discovery.nodes.some(
          node =>
            node.node === `node-${numeric}` && node.name === other.connection.sync.config!.label,
        ),
      );
    }
    await writeFile(
      'build/tbeam-v12/discovery-smoke.json',
      JSON.stringify(
        {
          time: new Date().toISOString(),
          attempts,
          nodeNamesVerified: true,
          locationTransmitted: false,
        },
        null,
        2,
      ) + '\n',
    );
  }
} finally {
  for (let i = originals.length - 1; i >= 0; --i) {
    try {
      if (boards[i].connection.sync.state === 'ready') await save(i, originals[i]);
      else throw new Error('disconnected');
    } catch (error) {
      process.exitCode = 1;
      console.error('Verify discovery/radio restoration on', boards[i].connection.device, error);
    }
  }
  for (const b of boards) await b.adapter.disconnect();
}
