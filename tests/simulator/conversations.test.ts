import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalNode,
  conversationKey,
  conversations,
  threadMessages,
  ConversationDrafts,
  deliveryLabel,
} from '../../agents/web/conversations.ts';
const out = {
  id: 'x:1',
  device: 'device-A',
  destination: 'node-0000000000000002',
  channel: 0,
  text: 'hello',
  state: 'unknown',
};
const incoming = {
  device: 'device-A',
  origin: 'node-0000000000000002',
  destination: 'device-A',
  channel: 0,
  text: 'reply',
  messageId: 'remote-1',
};
test('conversation projection isolates device, channel and recipient with canonical Heltec identities', () => {
  assert.equal(canonicalNode('heltec-34b7da622d34'), 'node-000034b7da622d34');
  assert.equal(
    conversationKey('heltec-34b7da622d34', 1),
    conversationKey('node-000034b7da622d34', 1),
  );
  const rows = threadMessages(
    'device-A',
    out.destination,
    0,
    [out, { ...out, device: 'device-B' }, { ...out, channel: 1 }],
    [incoming, { ...incoming, origin: 'other' }, { ...incoming, device: 'device-B' }],
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[0].text, 'reply');
  assert.equal(rows[1].status, 'Unknown · not resent');
  assert.equal(threadMessages(undefined, out.destination, 0, [out], [incoming]).length, 0);
});
test('channel activity does not invent the missing RF destination and discovered peers stay messageable without position', () => {
  const publicMessage = { ...incoming, destination: 'broadcast' };
  const rows = conversations(
    'device-A',
    ['Public'],
    [{ node: out.destination, name: 'Field unit' }],
    [out],
    [publicMessage],
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[1].name, 'Field unit');
  assert.equal(
    threadMessages('device-A', 'broadcast', 0, [], [publicMessage])[0].status,
    'Received on this channel',
  );
  assert.equal(
    deliveryLabel({ ...out, state: 'acknowledged' }),
    'Delivered · destination acknowledged',
  );
  assert.ok(!deliveryLabel({ ...out, state: 'acknowledged' }).includes('read'));
});
test('broadcast and direct traffic stay in separate threads while every configured channel is listed', () => {
  const broadcast = {
    ...incoming,
    destination: 'broadcast',
    text: 'public from peer',
    messageId: 'public-1',
  };
  const direct = { ...incoming, text: 'private route from peer', messageId: 'direct-1' };
  const rows = conversations(
    'device-A',
    ['Public', 'Camp', '', 'Ops'],
    [{ node: out.destination, name: 'Field unit' }],
    [],
    [broadcast, direct],
  );
  assert.deepEqual(
    rows.filter(row => row.kind === 'channel').map(row => [row.name, row.channel]),
    [
      ['Public', 0],
      ['Camp', 1],
      ['Ops', 3],
    ],
  );
  const publicThread = threadMessages('device-A', 'broadcast', 0, [], [broadcast, direct]);
  const directThread = threadMessages('device-A', incoming.origin, 0, [], [broadcast, direct]);
  assert.deepEqual(
    publicThread.map(message => message.text),
    ['public from peer'],
  );
  assert.deepEqual(
    directThread.map(message => message.text),
    ['private route from peer'],
  );
});
test('drafts remain isolated, bounded and removable after successful upload', () => {
  const drafts = new ConversationDrafts();
  drafts.save('usb:A:0:peer', 'A');
  drafts.save('usb:B:0:peer', 'B');
  assert.equal(drafts.get('usb:A:0:peer'), 'A');
  drafts.save('usb:A:0:peer', '');
  assert.equal(drafts.get('usb:A:0:peer'), '');
  for (let i = 0; i < 65; i++) drafts.save('draft' + i, 'text');
  assert.equal(drafts.get('draft0'), '');
  assert.equal(drafts.get('draft64'), 'text');
});
