import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Discovery } from '../../packages/client-core/discovery.ts';
const context = { device: 'node-A', boot: 'boot-A', session: 1 };
test('discovery sends one mutation and only queries afterward, with a fixed observation deadline', () => {
  const client = new Discovery('owner'); client.tick(0, context);
  assert.deepEqual(client.start(context, 0), { type: 'discover', boot: 'boot-A', id: 'owner:1', action: 1 });
  for (let now = 2000; now <= 32000; now += 2000) {
    const packets = client.tick(now, context);
    assert.ok(packets.every(packet => packet.type !== 'discover' || packet.action === 0));
  }
  assert.equal(client.last?.state, 'unknown');
  const restored = new Discovery('owner'); restored.restoreState(JSON.parse(JSON.stringify(client.exportState())));
  restored.tick(0, { ...context, session: 2 }); assert.equal(restored.start({ ...context, session: 2 }, 0).id, 'owner:2');
});
test('discovery recovery is device/boot bound and restored work is never resent', () => {
  const client = new Discovery('owner'); client.tick(0, context); client.start(context, 0);
  const restored = new Discovery('owner'); restored.restoreState(JSON.parse(JSON.stringify(client.exportState())));
  assert.equal(restored.last?.state, 'unknown');
  assert.equal(restored.recover({ ...context, boot: 'boot-B' }, 0), undefined);
  assert.throws(() => restored.recover({ ...context, device: 'other' }, 0), /another device/);
  assert.equal(restored.recover(context, 0)?.action, 0);
});
test('node snapshots commit atomically, restart on generation change, and reject stale request/session rows', () => {
  const client = new Discovery('owner');
  const first = client.tick(0, context)[0]; assert.equal(first.type, 'nodeQuery'); if (first.type !== 'nodeQuery') throw new Error();
  client.receive(1, { type: 'nodeReply', link: 'l', boot: 'boot-A', request: first.request, generation: 1, cursor: 0, total: 1, state: 'head' }, 0);
  const row = client.tick(1, context)[0]; if (row.type !== 'nodeQuery') throw new Error();
  const item = { type: 'nodeReply' as const, link: 'l', boot: 'boot-A', request: row.request, generation: 1, cursor: 0, total: 1, state: 'item', node: 'node-0000000000000002', peerBoot: 'peer-A', peerSequence: 1, name: 'Bravo', ageMs: 123 };
  client.receive(2, item, 2); assert.equal(client.nodes.length, 0);
  client.receive(1, { ...item, request: first.request }, 2); assert.equal(client.nodes.length, 0);
  client.receive(1, item, 2); assert.equal(client.nodes[0].name, 'Bravo');
  const head = client.tick(2002, context)[0]; if (head.type !== 'nodeQuery') throw new Error();
  client.receive(1, { type: 'nodeReply', link: 'l', boot: 'boot-A', request: head.request, generation: 2, cursor: 0, total: 2, state: 'head' }, 2002);
  const changed = client.tick(2003, context)[0]; if (changed.type !== 'nodeQuery') throw new Error();
  client.receive(1, { type: 'nodeReply', link: 'l', boot: 'boot-A', request: changed.request, generation: 3, cursor: 0, total: 2, state: 'changed' }, 2003);
  assert.equal(client.nodes[0].name, 'Bravo'); assert.deepEqual(client.tick(2004, context), []);
  client.tick(2005); assert.equal(client.nodes[0].name, 'Bravo');
  client.tick(2006, { ...context, device: 'other', session: 2 }); assert.equal(client.nodes.length, 0);
});
