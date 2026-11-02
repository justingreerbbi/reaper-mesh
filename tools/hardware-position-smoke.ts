/** Two-board fixed-position test. Uses synthetic (0,0)/(−90,180), never owner geolocation. */
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { openBoard } from './hardware-port.ts';
import type { Config } from '../packages/client-core/sync.ts';
const [python, heltec, tbeam] = process.argv.slice(2);
if (!python || !heltec || !tbeam || heltec === tbeam) throw new Error('usage: node tools/hardware-position-smoke.ts PYTHON HELTEC_PORT TBEAM_PORT');
const boards: Awaited<ReturnType<typeof openBoard>>[] = [], originals: Config[] = [];
const reports: { source: string; coordinates: boolean; replies: number }[] = [];
async function waitFor(predicate: () => boolean, timeout = 18000) {
  const until = performance.now() + timeout;
  while (!predicate()) {
    if (performance.now() >= until || boards.some(b => b.connection.sync.state === 'disconnected' || !!b.connection.discovery.error)) throw new Error('position timeout/disconnect: ' + boards.map(b => b.connection.error ?? b.connection.discovery.error ?? b.connection.discovery.last?.state).join(', '));
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}
async function save(index: number, config: Config) {
  const b = boards[index], id = b.adapter.configure(config);
  await waitFor(() => b.connection.commands.status(id).outcome !== 'pending'); assert.equal(b.connection.commands.status(id).outcome, 'committed');
  await waitFor(() => b.connection.sync.state === 'ready' && b.connection.radioInfo?.revision === b.connection.sync.revision);
  assert.deepEqual(b.connection.sync.config?.position, config.position);
}
async function discover(index: number, located: boolean) {
  const source = boards[index], target = boards[1 - index];
  const peerID = 'node-' + target.connection.device!.replace(/^(?:heltec-|node-)/, '').padStart(16, '0');
  source.adapter.discover();
  await waitFor(() => source.connection.discovery.last?.state !== 'collecting');
  assert.equal(source.connection.discovery.last?.state, 'complete'); assert.equal(source.connection.discovery.last.replies, 1);
  await waitFor(() => source.connection.discovery.nodes.some(node => node.node === peerID && !!node.position === located));
  const row = source.connection.discovery.nodes.find(node => node.node === peerID)!;
  if (located) {
    assert.equal(row.position?.source, 1); assert.equal(row.position.latitude, target.connection.sync.config!.position!.latitude);
    assert.equal(row.position.longitude, target.connection.sync.config!.position!.longitude); assert.equal(row.position.ageMs, 0);
  }
  reports.push({ source: source.connection.device!, coordinates: located, replies: 1 });
  console.log('Physical fixed-position discovery:', reports.at(-1));
}
try {
  for (const port of [heltec, tbeam]) {
    const board = await openBoard(python, port); boards.push(board); const i = boards.length - 1;
    assert.equal(board.connection.supportsPosition, true); originals[i] = board.connection.sync.config!;
    assert.equal(originals[i].region, 'US');
    await save(i, { ...originals[i], radio: { ...originals[i].radio!, mode: 'mesh', power: 2 }, discovery: { beacon: false, respond: true, interval: 300 },
      position: { share: true, source: 1, latitude: i ? 0 : 900000000, longitude: i ? 3600000000 : 1800000000 } });
    assert.equal(board.connection.radioInfo?.reason, 'ready');
  }
  // Reopen the serial adapter: verifies persistence with a fresh link/boot without replaying saves.
  for (let i = 0; i < boards.length; ++i) {
    const expected = boards[i].connection.sync.config!; await boards[i].adapter.disconnect(); boards[i] = await openBoard(python, i ? tbeam : heltec);
    assert.deepEqual(boards[i].connection.sync.config?.position, expected.position);
  }
  const started = performance.now();
  await discover(0, true); await discover(1, true);
  for (let i = 0; i < boards.length; ++i) { const config = boards[i].connection.sync.config!; await save(i, { ...config, position: { ...config.position!, share: false } }); }
  await waitFor(() => performance.now() - started >= 31000, 33000);
  await discover(0, false); await discover(1, false);
  await writeFile('build/tbeam-v12/position-smoke.json', JSON.stringify({ time: new Date().toISOString(), syntheticCoordinates: true, persistenceReopen: true, reports }, null, 2) + '\n');
} finally {
  for (let i = originals.length - 1; i >= 0; --i) {
    try { if (boards[i].connection.sync.state === 'ready') await save(i, originals[i]); else throw new Error('disconnected'); }
    catch (error) { process.exitCode = 1; console.error('Verify position/radio restoration on', boards[i].connection.device, error); }
  }
  for (const board of boards) await board.adapter.disconnect();
}
