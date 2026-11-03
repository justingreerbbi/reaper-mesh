import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Synchronizer } from '../../packages/agent-core/sync.ts';
import { Messaging } from '../../packages/agent-core/messaging.ts';
import type { Message } from '../../packages/protocol/messages.ts';
type Status = Extract<Message, { type: 'messageStatus' }>;
function setup() {
  const sync = new Synchronizer();
  let session = sync.connect();
  sync.hello(session, 'boot-A', 1, 1);
  sync.snapshot({
    session,
    boot: 'boot-A',
    request: sync.snapshotRequest,
    sequence: 0,
    revision: 0,
    config: { region: 'US', label: 'node' },
  });
  const messages = new Messaging(sync, 'owner');
  const send = (body = 'hello', now = 0) => messages.send(body, 'broadcast', 0, 'node-A', now);
  const status = (
    id: string,
    state: Status['state'],
    received: number,
    messageId = 'boot-A_1',
  ): Status => ({
    type: 'messageStatus',
    link: 'link',
    boot: 'boot-A',
    id,
    state,
    received,
    messageId,
  });
  const reopen = (boot = 'boot-A') => {
    sync.disconnect();
    messages.tick(10);
    session = sync.connect();
    sync.hello(session, boot, 1, 1);
    sync.snapshot({
      session,
      boot,
      request: sync.snapshotRequest,
      sequence: 0,
      revision: 0,
      config: { region: 'US', label: 'node' },
    });
    return session;
  };
  return { sync, messages, send, status, reopen, session };
}
test('message uploads preserve maximum UTF-8 bytes including split code points', () => {
  const { messages, send, status, session } = setup();
  const body = 'x'.repeat(31) + '📻' + 'a'.repeat(989);
  assert.equal(new TextEncoder().encode(body).length, 1024);
  let packet = send(body);
  const chunks = [packet.data];
  for (let part = 0; part < 31; ++part) {
    const next = messages.receive(
      session,
      status(packet.id, 'receiving', 2 ** (part + 1) - 1),
      part,
    );
    assert.ok(next);
    packet = next;
    chunks.push(packet.data);
  }
  messages.receive(session, status(packet.id, 'queued', 0xffffffff), 32);
  assert.equal(messages.history[0].state, 'queued');
  assert.equal(Buffer.from(chunks.join(''), 'hex').toString('utf8'), body);
});
test('message retries stop after a bounded budget and never replay on a new link', () => {
  const { messages, send, reopen } = setup();
  const packet = send();
  assert.deepEqual(messages.tick(1000, 'node-A'), [packet]);
  assert.deepEqual(messages.tick(2000, 'node-A'), [packet]);
  assert.deepEqual(messages.tick(3000, 'node-A'), []);
  assert.equal(messages.history[0].state, 'unknown');
  // A separate manager exercises disconnect before the retry deadline.
  const other = setup();
  other.send();
  other.reopen();
  assert.deepEqual(other.messages.tick(11, 'node-A'), []);
  assert.equal(other.messages.history[0].state, 'unknown');
  void reopen;
});
test('lost acceptance recovers by query while old boot remains unknown', () => {
  const { messages, send, reopen, status } = setup();
  const packet = send();
  const session = reopen();
  assert.deepEqual(messages.recover(packet.id, 'node-A', 11), {
    type: 'messageQuery',
    boot: 'boot-A',
    id: packet.id,
  });
  messages.receive(session, status(packet.id, 'queued', 1), 12);
  assert.equal(messages.history[0].state, 'queued');
  messages.tick(70011, 'node-A');
  assert.equal(messages.history[0].state, 'unknown');
  const other = setup();
  const old = other.send();
  other.reopen('boot-B');
  assert.equal(other.messages.recover(old.id, 'node-A', 11), undefined);
  assert.throws(() => other.messages.recover(old.id, 'node-B', 11), /another device/);
});
test('late partial receipts cannot regress transmission or restart an abandoned upload', () => {
  const { messages, status, session, reopen } = setup();
  const packet = messages.send('hello', 'node-B', 0, 'node-A', 0);
  messages.receive(session, status(packet.id, 'queued', 1), 0);
  messages.receive(session, status(packet.id, 'transmitted', 1), 0);
  messages.receive(session, status(packet.id, 'queued', 1), 0);
  assert.equal(messages.history[0].state, 'transmitted');
  const generation = reopen();
  messages.recover(packet.id, 'node-A', 11);
  assert.equal(messages.receive(generation, status(packet.id, 'receiving', 1), 12), undefined);
  assert.equal(messages.history[0].state, 'unknown');
});
test('message validation and history limits refuse unsafe submissions before consuming IDs', () => {
  const { messages, send, status, session } = setup();
  for (const body of ['', '\u0000', '\ud800', 'x'.repeat(1025)]) assert.throws(() => send(body));
  for (let i = 0; i < 32; i++) {
    const packet = send();
    assert.equal(packet.id, `owner:${i + 1}`);
    messages.receive(session, status(packet.id, 'queued', 1), 0);
  }
  assert.throws(() => send(), /unresolved delivery/);
  messages.forget('owner:1');
  assert.equal(send().id, 'owner:33');
  assert.throws(() => messages.forget('owner:33'), /pending/);
});
test('message receipt completeness and identity are checked before acceptance', () => {
  const { messages, send, status, session } = setup();
  const packet = send('x'.repeat(64));
  messages.receive(session, status(packet.id, 'queued', 1), 0);
  assert.equal(messages.history[0].state, 'receiving');
  messages.receive(session, { ...status(packet.id, 'queued', 3), messageId: undefined }, 0);
  assert.equal(messages.history[0].state, 'receiving');
  messages.receive(session + 1, status(packet.id, 'queued', 3), 0);
  assert.equal(messages.history[0].state, 'receiving');
});

test('configuration resync pauses message queries without discarding accepted queue state', () => {
  const { sync, messages, send, status, session } = setup();
  const packet = send();
  messages.receive(session, status(packet.id, 'queued', 1), 0);
  sync.resynchronize();
  assert.deepEqual(messages.tick(2000, 'node-A'), []);
  assert.equal(messages.history[0].state, 'queued');
  sync.snapshot({
    session,
    boot: 'boot-A',
    request: sync.snapshotRequest,
    sequence: 1,
    revision: 1,
    config: { region: 'US', label: 'changed' },
  });
  assert.deepEqual(messages.tick(2001, 'node-A'), [
    { type: 'messageQuery', boot: 'boot-A', id: packet.id },
  ]);
});

test('confirmed broadcast transmission survives receipt eviction, disconnect, expiry and reload without waiting for an ACK', () => {
  const { messages, send, status, session, sync } = setup();
  const packet = send();
  messages.receive(session, status(packet.id, 'transmitted', 1), 1);
  messages.receive(session, { ...status(packet.id, 'unknown', 0), messageId: undefined }, 2);
  assert.equal(messages.history[0].state, 'transmitted');
  sync.disconnect();
  assert.deepEqual(messages.tick(100000), []);
  assert.equal(messages.history[0].state, 'transmitted');
  const restored = new Messaging(new Synchronizer(), 'owner');
  restored.restoreState(JSON.parse(JSON.stringify(messages.exportState())));
  assert.equal(restored.history[0].state, 'transmitted');
  assert.deepEqual(restored.tick(100000), []);
});
test('local outgoing deletion frees history without sending or resetting the request counter', () => {
  const { messages, send, status, session } = setup();
  const packet = send();
  assert.throws(() => messages.forget(packet.id), /pending upload/);
  messages.receive(session, status(packet.id, 'queued', 1), 1);
  messages.forget(packet.id);
  assert.equal(messages.history.length, 0);
  assert.deepEqual(messages.tick(2, 'node-A'), []);
  assert.equal(send('next', 3).id, 'owner:2');
});

test('encrypted payload is checkpointed once and RACE recovery never re-encrypts or replays it', () => {
  const { messages, sync, reopen } = setup();
  const bytes = new Uint8Array(74);
  bytes.set([0x52, 0x4d, 0x45, 0x01, 1, 0, 1]);
  new DataView(bytes.buffer).setUint32(14, 1, true);
  const original = messages.sendPayload(bytes, 'broadcast', 0, 'node-A', 0);
  const saved = JSON.parse(JSON.stringify(messages.exportState()));
  assert.equal(messages.history[0].text, '');
  assert.equal(messages.history[0].payloadHex, Buffer.from(bytes).toString('hex'));
  const restored = new Messaging(new Synchronizer(), 'owner');
  restored.restoreState(saved);
  assert.equal(restored.history[0].payloadHex, Buffer.from(bytes).toString('hex'));
  assert.equal(restored.history[0].state, 'unknown');
  assert.deepEqual(restored.tick(100000), []); // Recovery can query state but cannot resend ciphertext on a new session.
  assert.equal(original.data, Buffer.from(bytes.subarray(0, 32)).toString('hex'));
  reopen();
  assert.deepEqual(messages.tick(11, 'node-A'), []);
});

test('completed history rolls over through hundreds of sends and reload without blocking or reusing IDs', () => {
  const { messages, sync, status, session } = setup();
  const pending = messages.send('uncertain', 'node-B', 0, 'node-A', 0);
  messages.receive(session, status(pending.id, 'unknown', 0), 0);
  for (let i = 2; i <= 500; i++) {
    const packet = messages.send('saved ' + i, i % 2 ? 'node-B' : 'broadcast', 0, 'node-A', 0);
    assert.equal(packet.id, `owner:${i}`);
    messages.receive(session, status(packet.id, i % 2 ? 'acknowledged' : 'transmitted', 1), 0);
    assert.equal(messages.sendBlockReason, undefined);
    assert.ok(messages.history.length <= 160);
  }
  assert.equal(messages.history.find(m => m.id === pending.id)?.state, 'unknown');
  const restored = new Messaging(new Synchronizer(), 'owner');
  restored.restoreState(JSON.parse(JSON.stringify(messages.exportState())));
  assert.equal(restored.history.length, 160);
  assert.equal(restored.sendBlockReason, undefined);
  assert.deepEqual(restored.tick(0), []);
  assert.ok(restored.history.some(m => m.id === pending.id));
  // Restore using a ready synchronizer separately; reload never revives uploads.
  sync.disconnect();
  const next = setup();
  const resumed = new Messaging(next.sync, 'owner');
  next.sync.disconnect();
  resumed.restoreState(messages.exportState());
  const generation = next.sync.connect();
  next.sync.hello(generation, 'boot-A', 1, 1);
  next.sync.snapshot({
    session: generation,
    boot: 'boot-A',
    request: next.sync.snapshotRequest,
    sequence: 0,
    revision: 0,
    config: { region: 'US', label: 'node' },
  });
  assert.equal(resumed.send('next', 'broadcast', 0, 'node-A', 0).id, 'owner:501');
  assert.deepEqual(resumed.recover(pending.id, 'node-A', 0), {
    type: 'messageQuery',
    boot: 'boot-A',
    id: pending.id,
  });
});
