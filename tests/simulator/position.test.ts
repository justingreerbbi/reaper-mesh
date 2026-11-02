import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coordinate, degrees, readPosition, validPosition } from '../../packages/protocol/position-config.ts';
import { Connection } from '../../packages/agent-core/connection.ts';
import { Discovery } from '../../packages/agent-core/discovery.ts';
import { deviceCapabilities } from './capabilities.ts';
import { encodeMessage } from '../../packages/protocol/messages.ts';
import { encodeFrame } from '../../packages/protocol/framing.ts';
test('fixed coordinates preserve zero and exact boundaries without floating point on the wire', () => {
  assert.equal(coordinate('0', 90), 900000000); assert.equal(coordinate('0', 180), 1800000000);
  assert.equal(coordinate('-90', 90), 0); assert.equal(coordinate('180', 180), 3600000000);
  assert.equal(degrees(coordinate('-12.3456789', 90), 90), '-12.3456789');
  for (const value of ['', ' ', 'NaN', 'Infinity', '90.0000001', '1e1', '1.12345678']) assert.throws(() => coordinate(value, 90));
  assert.equal(validPosition({ share: false, source: 1, latitude: 1800000001, longitude: 0 }), false);
  assert.throws(() => readPosition({ shareLocation: 1 }));
  assert.equal(readPosition({}), undefined);
});
test('location writes require the advertised version, discovery metadata and feature bit together', () => {
  const position = { share: true, source: 1 as const, latitude: 900000000, longitude: 1800000000 };
  for (const capability of [{}, { locationVersion: 1 }, { locationVersion: 2, discoveryVersion: 1, nodeCapacity: 32, features: 391 }, { locationVersion: 1, discoveryVersion: 1, nodeCapacity: 32, features: 135 }]) {
    const agent = new Connection('owner'), session = agent.open('link', 0); agent.drain();
    agent.receive(session, encodeFrame(encodeMessage({ type: 'welcome', link: 'link', device: 'device', boot: 'boot', minVersion: 1, maxVersion: 1, ...deviceCapabilities, ...capability })), 0); agent.drain();
    agent.receive(session, encodeFrame(encodeMessage({ type: 'snapshot', link: 'link', boot: 'boot', request: 1, sequence: 0, revision: 0, region: 'US', label: '' })), 0);
    assert.throws(() => agent.configure({ region: 'US', label: '', position }, 0), /position/);
  }
});
test('node snapshots reject partial/invalid location and cannot overwrite a position with stale pages', () => {
  const agent = new Discovery('owner'), context = { device: 'device', boot: 'boot', session: 1 };
  const head = agent.tick(0, context)[0]; if (head.type !== 'nodeQuery') throw Error();
  agent.receive(1, { type: 'nodeReply', link: 'link', boot: 'boot', request: head.request, generation: 1, cursor: 0, total: 1, state: 'head' }, 0);
  const row = agent.tick(1, context)[0]; if (row.type !== 'nodeQuery') throw Error();
  const item = { type: 'nodeReply' as const, link: 'link', boot: 'boot', request: row.request, generation: 1, cursor: 0, total: 1, state: 'item', node: 'node-0000000000000002', peerBoot: '02000000000000000000000000000000', peerSequence: 1, name: 'fixed', ageMs: 1000 };
  agent.receive(1, { ...item, positionSource: 1 }, 1); assert.equal(agent.nodes.length, 0);
  agent.receive(1, { ...item, positionSource: 1, latitude: 1800000001, longitude: 0, positionAgeMs: 0 }, 1); assert.equal(agent.nodes.length, 0);
  agent.receive(1, { ...item, positionSource: 1, latitude: 900000000, longitude: 1800000000, positionAgeMs: 0 }, 2);
  assert.equal(agent.nodes[0].position?.latitude, 900000000);
  agent.receive(1, item, 3); assert.equal(agent.nodes[0].position?.latitude, 900000000);
  agent.tick(4); agent.receive(1, item, 5); assert.equal(agent.nodes[0].position?.latitude, 900000000);
});
test('a future location version remains readable for base configuration without overwriting its policy', () => {
  const agent = new Connection('owner'), session = agent.open('link', 0); agent.drain();
  agent.receive(session, encodeFrame(encodeMessage({ type: 'welcome', link: 'link', device: 'device', boot: 'boot', minVersion: 1, maxVersion: 1, ...deviceCapabilities, features: 391, discoveryVersion: 1, nodeCapacity: 32, locationVersion: 2 })), 0); agent.drain();
  agent.receive(session, encodeFrame(encodeMessage({ type: 'snapshot', link: 'link', boot: 'boot', request: 1, sequence: 0, revision: 0, region: 'US', label: '', shareLocation: 1, positionSource: 2, latitude: 900000000, longitude: 1800000000 })), 0);
  assert.equal(agent.sync.state, 'ready'); assert.equal(agent.supportsPosition, false); assert.equal(agent.sync.config?.position, undefined);
  agent.configure({ ...agent.sync.config!, label: 'base edit' }, 1);
  assert.equal(agent.commands.history.at(-1)?.command.config.position, undefined);
});
