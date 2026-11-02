import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalNode, conversationKey, conversations, threadMessages, ConversationDrafts, deliveryLabel } from '../../clients/web/conversations.ts';
const out = { id: 'x:1', device: 'device-A', destination: 'node-0000000000000002', channel: 0, text: 'hello', state: 'unknown' };
const incoming = { device: 'device-A', origin: 'node-0000000000000002', channel: 0, text: 'reply', messageId: 'remote-1' };
test('conversation projection isolates device, channel and recipient with canonical Heltec identities', () => {
  assert.equal(canonicalNode('heltec-34b7da622d34'), 'node-000034b7da622d34');
  assert.equal(conversationKey('heltec-34b7da622d34', 1), conversationKey('node-000034b7da622d34', 1));
  const rows = threadMessages('device-A', out.destination, 0, [out, {...out, device: 'device-B'}, {...out, channel: 1}], [incoming, {...incoming, origin: 'other'}, {...incoming, device: 'device-B'}]);
  assert.equal(rows.length, 2); assert.equal(rows[0].text, 'reply'); assert.equal(rows[1].status, 'Unknown · not resent');
  assert.equal(threadMessages(undefined, out.destination, 0, [out], [incoming]).length, 0);
});
test('channel activity does not invent the missing RF destination and discovered peers stay messageable without position', () => {
  const rows = conversations('device-A', ['Public'], [{node: out.destination, name: 'Field unit'}], [out], [incoming]);
  assert.equal(rows.length, 2); assert.equal(rows[1].name, 'Field unit');
  assert.equal(threadMessages('device-A', 'broadcast', 0, [], [incoming])[0].status, 'Received on this channel');
  assert.equal(deliveryLabel({...out, state: 'acknowledged'}), 'Delivered · destination acknowledged');
  assert.ok(!deliveryLabel({...out, state: 'acknowledged'}).includes('read'));
});
test('drafts remain isolated, bounded and removable after successful upload', () => {
  const drafts = new ConversationDrafts(); drafts.save('usb:A:0:peer', 'A'); drafts.save('usb:B:0:peer', 'B');
  assert.equal(drafts.get('usb:A:0:peer'), 'A'); drafts.save('usb:A:0:peer', ''); assert.equal(drafts.get('usb:A:0:peer'), '');
  for(let i=0;i<65;i++) drafts.save('draft'+i,'text'); assert.equal(drafts.get('draft0'),''); assert.equal(drafts.get('draft64'),'text');
});
