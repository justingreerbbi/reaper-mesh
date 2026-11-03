import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Connection } from '../../packages/agent-core/connection.ts';
import { encodeFrame } from '../../packages/protocol/framing.ts';
import { encodeMessage, decodeMessage, type Message } from '../../packages/protocol/messages.ts';
import { ConfigDevice } from './config-device.ts';
import { deviceCapabilities } from './capabilities.ts';

function ready(metadata: Partial<typeof deviceCapabilities> = deviceCapabilities) {
  const connection = new Connection('agent-A');
  const session = connection.open('link-A', 0);
  connection.drain();
  const send = (message: Message) =>
    connection.receive(session, encodeFrame(encodeMessage(message)), 0);
  send({
    type: 'welcome',
    link: 'link-A',
    device: 'device-A',
    boot: 'boot-A',
    minVersion: 1,
    maxVersion: 1,
    ...metadata,
  });
  connection.drain();
  send({
    type: 'snapshot',
    link: 'link-A',
    boot: 'boot-A',
    request: connection.sync.snapshotRequest,
    sequence: 0,
    revision: 0,
    region: 'US',
    label: 'initial',
  });
  return connection;
}
const config = { region: 'US', label: 'changed' };

test('legacy peers remain readable but mutations require complete capabilities', () => {
  for (const metadata of [{}, { features: 7 }]) {
    const connection = ready(metadata);
    assert.equal(connection.sync.state, 'ready');
    assert.equal(connection.sync.config?.label, 'initial');
    assert.throws(() => connection.configure(config, 0), /metadata is incomplete/);
    assert.deepEqual(connection.drain(), []);
  }
});

test('advertised write/query/sequence-suppression guarantees gate mutation', () => {
  for (const features of [0, 1, 2, 3, 5, 6]) {
    const connection = ready({ ...deviceCapabilities, features });
    assert.throws(() => connection.configure(config, 0), /lacks safe/);
  }
  // Unknown feature bits do not disable the known compatible behavior.
  assert.equal(
    ready({ ...deviceCapabilities, features: 7 | 128 }).configure(config, 0),
    'agent-A:1',
  );
});

test('unknown config schema and unusable resource limits block writes', () => {
  for (const changed of [
    { configSchema: 2 },
    { maxPayload: 511 },
    { receiptCapacity: 0 },
    { ownerCapacity: 0 },
    { maxLabelBytes: 0 },
    { maxLabelBytes: 65 },
    { regions: 0 },
  ]) {
    const connection = ready({ ...deviceCapabilities, ...changed });
    assert.throws(() => connection.configure(config, 0));
    assert.equal(connection.sync.state, 'ready');
  }
});

test('owner exhaustion is visible and never triggers an automatic reset', () => {
  const connection = ready({ ...deviceCapabilities, ownerAdmitted: 0 });
  assert.match(connection.writeBlockReason!, /owner capacity exhausted/);
  assert.throws(() => connection.configure(config, 0), /owner capacity exhausted/);
  assert.deepEqual(connection.drain(), []);
  assert.equal(connection.sync.state, 'ready');
});

test('region and UTF-8 byte limits are enforced before retaining a command', () => {
  const connection = ready({ ...deviceCapabilities, maxLabelBytes: 4 });
  assert.throws(() => connection.configure({ region: 'EU', label: 'test' }, 0), /region/);
  assert.throws(() => connection.configure({ region: 'US', label: '📻x' }, 0), /label/);
  assert.equal(connection.configure({ region: 'US', label: '📻' }, 0), 'agent-A:1');
});

test('capabilities are immutable and cleared when a connection closes', () => {
  const connection = ready();
  assert.ok(Object.isFrozen(connection.capabilities));
  connection.close();
  assert.equal(connection.capabilities, undefined);
  assert.match(connection.writeBlockReason!, /incomplete/);
});

test('optional handshake fields round-trip and legacy required fields remain sufficient', () => {
  const welcome: Message = {
    type: 'welcome',
    link: 'A',
    device: 'D',
    boot: 'B',
    minVersion: 1,
    maxVersion: 1,
  };
  for (const message of [welcome, { ...welcome, ...deviceCapabilities }]) {
    assert.deepEqual(decodeMessage(encodeMessage(message)), message);
  }
});

test('owner admission is idempotent, bounded, and does not consume command sequence one', () => {
  const device = new ConfigDevice(2, 1);
  assert.equal(device.admit('agent-A'), true);
  assert.equal(device.admit('agent-A'), true);
  assert.equal(device.admit('agent-B'), false);
  assert.equal(
    device.apply({ id: 'agent-A:1', boot: device.boot, expectedRevision: 0, config }).outcome,
    'committed',
  );
});
