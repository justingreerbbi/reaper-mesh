import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Connection } from '../../packages/agent-core/connection.ts';
import { encodeFrame } from '../../packages/protocol/framing.ts';
import { encodeMessage, type Message } from '../../packages/protocol/messages.ts';
import { deviceCapabilities } from './capabilities.ts';
function ready(connection = new Connection('owner'), boot = 'boot-A', link = 'link-A') {
  const generation = connection.open(link, 0); connection.drain();
  const deliver = (message: Message) => connection.receive(generation, encodeFrame(encodeMessage(message)), 0);
  deliver({ type: 'welcome', link, boot, device: 'node-A', minVersion: 1, maxVersion: 1, ...deviceCapabilities, features: 15, messageVersion: 1, maxMessageBytes: 1024, messageCapacity: 8 }); connection.drain();
  deliver({ type: 'snapshot', link, boot, request: connection.sync.snapshotRequest, sequence: 0, revision: 0, region: 'US', label: 'node' });
  return { connection, deliver };
}
const clone = (value: unknown) => JSON.parse(JSON.stringify(value));
test('mutations checkpoint identity, counters and immutable bodies before any wire dispatch', () => {
  const { connection } = ready(); let state: ReturnType<Connection['exportJournal']> | undefined;
  connection.persistence(snapshot => { assert.deepEqual(connection.drain(), []); state = clone(snapshot); });
  connection.configure({ region: 'US', label: 'saved first' }, 0);
  assert.equal(state!.commands.counter, 1); assert.equal(state!.commands.entries[0].outcome, 'pending'); assert.equal(connection.drain().length, 1);
  connection.sendMessage('hello', 'broadcast', 0, 0);
  assert.equal(state!.messages.counter, 1); assert.equal(state!.messages.entries[0].text, 'hello'); assert.equal(connection.drain().length, 1);
});
test('reload restores unfinished work as unknown and reuses neither request counters nor mutations', () => {
  const first = ready(); const config = first.connection.configure({ region: 'US', label: 'lost reply' }, 0); first.connection.drain();
  const message = first.connection.sendMessage('message lost reply', 'broadcast', 0, 0); first.connection.drain();
  const restored = Connection.fromJournal(clone(first.connection.exportJournal()));
  assert.equal(restored.commands.incarnation, 'owner'); assert.equal(restored.commands.status(config).outcome, 'unknown');
  assert.equal(restored.messaging.history[0].state, 'unknown');
  ready(restored, 'boot-A', 'link-B'); assert.deepEqual(restored.drain(), []);
  assert.equal(restored.recover(config, 0), true); assert.equal(restored.recoverMessage(message, 0), true);
  assert.equal(restored.drain().length, 2);
  assert.equal(restored.configure({ region: 'US', label: 'intentional new write' }, 0), 'owner:2');
});
test('reload on a new boot retains ambiguity and does not query or resend old work', () => {
  const first = ready(); const config = first.connection.configure({ region: 'US', label: 'old boot' }, 0); first.connection.drain();
  const message = first.connection.sendMessage('old boot message', 'broadcast', 0, 0); first.connection.drain();
  const restored = Connection.fromJournal(clone(first.connection.exportJournal())); ready(restored, 'boot-B', 'link-B');
  assert.equal(restored.recover(config, 0), false); assert.equal(restored.recoverMessage(message, 0), false); assert.deepEqual(restored.drain(), []);
});
test('storage failure before dispatch closes the link and leaves no mutation bytes to replay', () => {
  const { connection } = ready(); let failed = false;
  connection.persistence(() => { if (failed) throw new Error('quota'); }); failed = true;
  assert.throws(() => connection.sendMessage('must not dispatch', 'broadcast', 0, 0), /Recovery storage/);
  assert.deepEqual(connection.drain(), []); assert.equal(connection.sync.state, 'disconnected');
  assert.equal(connection.messaging.history[0].state, 'unknown'); assert.match(connection.writeBlockReason!, /quota/);
  failed = false; assert.equal(connection.retryRecoveryStorage(), true);
});
test('corrupt, oversized, cross-owner and counter-regressing recovery records fail closed', () => {
  const { connection } = ready(); connection.configure({ region: 'US', label: 'saved' }, 0); connection.drain();
  const base = clone(connection.exportJournal());
  for (const mutate of [
    (state: any) => { state.version = 2; },
    (state: any) => { state.commands.counter = 0; },
    (state: any) => { state.incarnation = 'other'; },
    (state: any) => { state.commandDevices = []; },
    (state: any) => { state.messages.entries = new Array(33).fill({}); },
    (state: any) => { state.commands.entries[0].command.config.label = '\u0000'; },
  ]) { const changed = clone(base); mutate(changed); assert.throws(() => Connection.fromJournal(changed)); }
});

test('discovery checkpoints before dispatch and reload offers only same-device/boot queries', () => {
  const { connection } = ready();
  const capabilities = connection.capabilities!;
  connection.capabilities = Object.freeze({ ...capabilities, features: capabilities.features | 128, discoveryVersion: 1, nodeCapacity: 32 });
  let journal: unknown; connection.persistence(state => { assert.deepEqual(connection.drain(), []); journal = clone(state); });
  assert.equal(connection.discover(0), 'owner:1'); assert.equal(connection.drain().length, 1);
  const restored = Connection.fromJournal(journal); assert.equal(restored.discovery.last?.state, 'unknown');
  ready(restored, 'boot-A', 'link-B'); restored.capabilities = connection.capabilities; assert.equal(restored.recoverDiscovery(0), true);
  const restoredNewBoot = Connection.fromJournal(journal); ready(restoredNewBoot, 'boot-B', 'link-C'); restoredNewBoot.capabilities = connection.capabilities; assert.equal(restoredNewBoot.recoverDiscovery(0), false); assert.deepEqual(restoredNewBoot.drain(), []);
});
