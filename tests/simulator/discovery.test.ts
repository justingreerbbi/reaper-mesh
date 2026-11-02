import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Discovery } from '../../packages/agent-core/discovery.ts';
const context = { device: 'node-A', boot: 'boot-A', session: 1 };
test('discovery sends one mutation and only queries afterward, with a fixed observation deadline', () => {
  const agent = new Discovery('owner'); agent.tick(0, context);
  assert.deepEqual(agent.start(context, 0), { type: 'discover', boot: 'boot-A', id: 'owner:1', action: 1 });
  for (let now = 2000; now <= 32000; now += 2000) {
    const packets = agent.tick(now, context);
    assert.ok(packets.every(packet => packet.type !== 'discover' || packet.action === 0));
  }
  assert.equal(agent.last?.state, 'unknown');
  const restored = new Discovery('owner'); restored.restoreState(JSON.parse(JSON.stringify(agent.exportState())));
  restored.tick(0, { ...context, session: 2 }); assert.equal(restored.start({ ...context, session: 2 }, 0).id, 'owner:2');
});
test('discovery recovery is device/boot bound and restored work is never resent', () => {
  const agent = new Discovery('owner'); agent.tick(0, context); agent.start(context, 0);
  const restored = new Discovery('owner'); restored.restoreState(JSON.parse(JSON.stringify(agent.exportState())));
  assert.equal(restored.last?.state, 'unknown');
  assert.equal(restored.recover({ ...context, boot: 'boot-B' }, 0), undefined);
  assert.throws(() => restored.recover({ ...context, device: 'other' }, 0), /another device/);
  assert.equal(restored.recover(context, 0)?.action, 0);
});
test('node snapshots commit atomically, restart on generation change, and reject stale request/session rows', () => {
  const agent = new Discovery('owner');
  const first = agent.tick(0, context)[0]; assert.equal(first.type, 'nodeQuery'); if (first.type !== 'nodeQuery') throw new Error();
  agent.receive(1, { type: 'nodeReply', link: 'l', boot: 'boot-A', request: first.request, generation: 1, cursor: 0, total: 1, state: 'head' }, 0);
  const row = agent.tick(1, context)[0]; if (row.type !== 'nodeQuery') throw new Error();
  const item = { type: 'nodeReply' as const, link: 'l', boot: 'boot-A', request: row.request, generation: 1, cursor: 0, total: 1, state: 'item', node: 'node-0000000000000002', peerBoot: '02000000000000000000000000000000', peerSequence: 1, name: 'Bravo', ageMs: 123 };
  agent.receive(2, item, 2); assert.equal(agent.nodes.length, 0);
  agent.receive(1, { ...item, request: first.request }, 2); assert.equal(agent.nodes.length, 0);
  agent.receive(1, { ...item, peerBoot: 'bad' }, 2); assert.equal(agent.nodes.length, 0);
  agent.receive(1, item, 2); assert.equal(agent.nodes[0].name, 'Bravo');
  const head = agent.tick(2002, context)[0]; if (head.type !== 'nodeQuery') throw new Error();
  agent.receive(1, { type: 'nodeReply', link: 'l', boot: 'boot-A', request: head.request, generation: 2, cursor: 0, total: 2, state: 'head' }, 2002);
  const changed = agent.tick(2003, context)[0]; if (changed.type !== 'nodeQuery') throw new Error();
  agent.receive(1, { type: 'nodeReply', link: 'l', boot: 'boot-A', request: changed.request, generation: 3, cursor: 0, total: 2, state: 'changed' }, 2003);
  assert.equal(agent.nodes[0].name, 'Bravo'); assert.deepEqual(agent.tick(2004, context), []);
  agent.tick(2005); assert.equal(agent.nodes[0].name, 'Bravo');
  agent.tick(2006, { ...context, device: 'other', session: 2 }); assert.equal(agent.nodes.length, 0);
});
test('exhausted node reads recover on reconnect using a new snapshot and no mutation replay', () => {
  const agent = new Discovery('owner'); const first = agent.tick(0, context)[0];
  assert.equal(first.type, 'nodeQuery');
  assert.equal(agent.tick(1000, context)[0].type, 'nodeQuery');
  assert.equal(agent.tick(2000, context)[0].type, 'nodeQuery');
  assert.deepEqual(agent.tick(3000, context), []); assert.match(agent.error!, /reconnect/);
  agent.tick(3001); const next = agent.tick(3002, { ...context, session: 2 })[0];
  assert.equal(agent.error, undefined); assert.equal(next.type, 'nodeQuery');
  if (first.type !== 'nodeQuery' || next.type !== 'nodeQuery') throw Error();
  assert.ok(next.request > first.request); assert.equal(next.generation, 0);
  agent.receive(1, { type: 'nodeReply', link: 'l', boot: 'boot-A', request: first.request, generation: 0, cursor: 0, total: 0, state: 'head' }, 3003);
  agent.receive(2, { type: 'nodeReply', link: 'l', boot: 'boot-A', request: next.request, generation: 0, cursor: 0, total: 0, state: 'head' }, 3004);
  assert.deepEqual(agent.nodes, []); assert.deepEqual(agent.tick(3005, { ...context, session: 2 }), []);
});
