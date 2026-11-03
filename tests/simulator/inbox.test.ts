import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InboxReader } from '../../packages/agent-core/inbox.ts';
import type { Message } from '../../packages/protocol/messages.ts';
const context = { device: 'node-A', boot: 'boot-A', session: 1 };
function head(reader: InboxReader, oldest: number, latest: number, now = 0) {
  const query = reader.tick(now, context);
  assert.equal(query?.type, 'inboxQuery');
  reader.receive(
    1,
    { type: 'inboxHead', link: 'link', boot: 'boot-A', request: query!.request, oldest, latest },
    now,
  );
}
function item(
  request: number,
  sequence: number,
  part: number,
  count: number,
  data: string,
  messageId = `remote_${sequence}`,
  destination = 'broadcast',
): Extract<Message, { type: 'inboxItem' }> {
  return {
    type: 'inboxItem',
    link: 'link',
    boot: 'boot-A',
    request,
    sequence,
    part,
    count,
    data,
    messageId,
    origin: 'node-B',
    channel: 0,
    destination,
  };
}
test('inbox preserves destination metadata for direct delivery', () => {
  const reader = new InboxReader();
  head(reader, 1, 1);
  const query = reader.tick(0, context)!;
  reader.receive(1, item(query.request, 1, 0, 1, '6869', 'remote_direct', 'node-A'), 0);
  assert.equal(reader.history[0].destination, 'node-A');
});
test('inbox retrieves maximum UTF-8 text across byte boundaries and publishes only complete text', () => {
  const reader = new InboxReader();
  head(reader, 1, 1);
  const body = 'x'.repeat(31) + '📻' + 'z'.repeat(989);
  const bytes = Buffer.from(body);
  for (let part = 0; part < 32; part++) {
    const query = reader.tick(0, context);
    assert.equal(query?.type, 'inboxRead');
    reader.receive(
      1,
      item(query!.request, 1, part, 32, bytes.subarray(part * 32, (part + 1) * 32).toString('hex')),
      0,
    );
    assert.equal(reader.history.length, part === 31 ? 1 : 0);
  }
  assert.equal(reader.history[0].text, body);
  assert.ok(Object.isFrozen(reader.history[0]));
});
test('inbox reconnect restarts partial retrieval and rejects stale request/session replies', () => {
  const reader = new InboxReader();
  head(reader, 1, 1);
  const first = reader.tick(0, context)!;
  reader.receive(1, item(first.request, 1, 0, 2, '78'.repeat(32)), 0);
  const old = reader.tick(0, context)!;
  reader.tick(1);
  const current = { ...context, session: 2 };
  const next = reader.tick(2, current)!;
  assert.equal(next.type, 'inboxRead');
  if (next.type === 'inboxRead') assert.equal(next.part, 0);
  reader.receive(1, item(old.request, 1, 1, 2, '79'), 2);
  assert.equal(reader.history.length, 0);
  reader.receive(2, item(next.request, 1, 0, 1, '6869'), 2);
  assert.equal(reader.history[0].text, 'hi');
});
test('inbox detects retention gaps and refreshes a missing item without resetting config', () => {
  const reader = new InboxReader();
  head(reader, 10, 17);
  assert.equal(reader.gap, true);
  const query = reader.tick(0, context)!;
  assert.equal(query.type, 'inboxRead');
  if (query.type === 'inboxRead') assert.equal(query.sequence, 10);
  reader.receive(
    1,
    { type: 'inboxMissing', link: 'link', boot: 'boot-A', request: query.request, sequence: 10 },
    0,
  );
  assert.equal(reader.tick(499, context), undefined);
  assert.equal(reader.tick(500, context)?.type, 'inboxQuery');
});
test('inbox read retries are bounded and do not execute commands', () => {
  const reader = new InboxReader();
  const query = reader.tick(0, context);
  assert.deepEqual(reader.tick(1000, context), query);
  assert.deepEqual(reader.tick(2000, context), query);
  assert.equal(reader.tick(3000, context), undefined);
  assert.match(reader.error!, /timed out/);
  assert.equal(reader.tick(9999, context), undefined);
  assert.equal(reader.tick(10000, { ...context, session: 2 })?.type, 'inboxQuery');
  assert.equal(reader.error, undefined);
});
test('inbox rejects malformed heads, conflicting fragments and invalid complete UTF-8', () => {
  const reader = new InboxReader();
  const query = reader.tick(0, context)!;
  reader.receive(
    1,
    {
      type: 'inboxHead',
      link: 'link',
      boot: 'boot-A',
      request: query.request,
      oldest: 1,
      latest: 0xffffffff,
    },
    0,
  );
  assert.deepEqual(reader.tick(1000, context), query);
  reader.receive(
    1,
    {
      type: 'inboxHead',
      link: 'link',
      boot: 'boot-A',
      request: query.request,
      oldest: 1,
      latest: 1,
    },
    1000,
  );
  const read = reader.tick(1000, context)!;
  reader.receive(1, item(read.request, 1, 0, 1, 'c080'), 1000);
  assert.equal(reader.history.length, 0);
  assert.match(reader.error!, /UTF-8/);
});
test('inbox history is bounded and same-boot counter rollback cannot overwrite it', () => {
  const reader = new InboxReader();
  for (let sequence = 1; sequence <= 40; sequence++) {
    const now = sequence * 2000;
    head(reader, Math.max(1, sequence - 7), sequence, now);
    const read = reader.tick(now, context)!;
    reader.receive(1, item(read.request, sequence, 0, 1, '6869'), now);
  }
  assert.equal(reader.history.length, 32);
  assert.equal(reader.history[0].sequence, 9);
  head(reader, 1, 1, 82000);
  assert.match(reader.error!, /backwards/);
  assert.equal(reader.history.length, 32);
});

test('local received-message removal scopes device/origin/identity and leaves no wire work', () => {
  const reader = new InboxReader();
  const message = {
    device: 'device-A',
    boot: 'boot-A',
    sequence: 1,
    origin: 'node-B',
    messageId: 'received-1',
    channel: 0,
    text: 'remove me',
  };
  reader.restoreHistory([message, { ...message, device: 'device-B' }]);
  assert.equal(reader.forget('device-A', 'wrong-origin', 'received-1'), false);
  assert.equal(reader.forget('device-A', 'node-B', 'received-1'), true);
  assert.equal(reader.history.length, 1);
  assert.equal(reader.history[0].device, 'device-B');
  assert.equal(reader.tick(0), undefined);
});

test('encrypted inbox bytes stay opaque through assembly and recovery snapshots', () => {
  const payload = new Uint8Array(74);
  payload.set([0x52, 0x4d, 0x45, 0x01, 1, 0, 1]);
  new DataView(payload.buffer).setUint32(14, 1, true);
  const reader = new InboxReader();
  head(reader, 1, 1);
  for (let part = 0; part < Math.ceil(payload.length / 32); ++part) {
    const query = reader.tick(part * 10, context)!;
    assert.equal(query?.type, 'inboxRead');
    const fragment = payload.subarray(part * 32, Math.min(payload.length, (part + 1) * 32));
    reader.receive(
      1,
      item(query.request, 1, part, 3, Buffer.from(fragment).toString('hex')),
      part * 10,
    );
  }
  assert.equal(reader.history.length, 1);
  assert.equal(reader.history[0].text, '');
  assert.equal(reader.history[0].payloadHex, Buffer.from(payload).toString('hex'));
  const restored = new InboxReader();
  restored.restoreHistory(JSON.parse(JSON.stringify(reader.history)));
  assert.equal(restored.history[0].payloadHex, reader.history[0].payloadHex);
});
