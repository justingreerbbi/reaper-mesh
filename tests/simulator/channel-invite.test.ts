import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatInvite, parseInvite } from '../../agents/web/channel-invite.ts';
import { EncryptionVault } from '../../agents/web/encryption.ts';
import {
  ENCRYPTED_HEADER_BYTES,
  ENCRYPTED_OFFSETS,
  ENCRYPTED_TAG_BYTES,
  isMessagePayload,
  parseEncryptedHeader,
} from '../../packages/protocol/encrypted-message.ts';

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}
const encode = (value: unknown) =>
  'RMCH1.' + Buffer.from(JSON.stringify(value)).toString('base64url');

test('channel invites round-trip an ID and name and reject malformed bundles', () => {
  const invite = formatInvite({ id: 0x9c41e2a7, name: 'Ridge' });
  assert.match(invite, /^RMCH1\.[A-Za-z0-9_-]+$/);
  assert.deepEqual(parseInvite(`  ${invite}\n`), { id: 0x9c41e2a7, name: 'Ridge' });
  // Channels converted from slot numbers can be shared too; unknown fields are ignored.
  assert.deepEqual(parseInvite(encode({ format: 'RMCH1', id: '00000001', name: 'Camp', x: 1 })), {
    id: 1,
    name: 'Camp',
  });
  for (const bad of [
    'RMKEY1.abc',
    'RMCH1.',
    'RMCH1.not base64',
    encode({ format: 'RMCH2', id: '9c41e2a7', name: 'Ridge' }),
    encode({ format: 'RMCH1', id: '00000000', name: 'Public' }),
    encode({ format: 'RMCH1', id: 'ffffffff', name: 'Ridge' }),
    encode({ format: 'RMCH1', id: '9C41E2A7', name: 'Ridge' }),
    encode({ format: 'RMCH1', id: 9, name: 'Ridge' }),
    encode({ format: 'RMCH1', id: '9c41e2a7', name: 'TooLongName' }),
    encode({ format: 'RMCH1', id: '9c41e2a7', name: 'Ridge', key: 'secret' }),
    'RMCH1.' + 'A'.repeat(5000),
  ])
    assert.throws(() => parseInvite(bad));
  assert.throws(() => formatInvite({ id: 0, name: 'Public' }));
});

test('an encrypted invite carries the key so another agent decrypts on the same channel ID', () => {
  const channel = 0x9c41e2a7;
  const left = new EncryptionVault(new MemoryStorage());
  left.generate(channel);
  const invite = parseInvite(
    formatInvite({ id: channel, name: 'Ridge', key: left.exportBundle(channel) }),
  );
  const right = new EncryptionVault(new MemoryStorage());
  right.importBundle(invite.key!, invite.id);
  assert.ok(right.isRequired(channel));

  const envelope = left.encrypt('ridge check', channel, 'node-0000001122334455', 'broadcast');
  // RME2: version 2 and the 32-bit channel ID, which devices check against the radio header.
  assert.deepEqual([...envelope.subarray(0, 4)], [0x52, 0x4d, 0x45, 0x02]);
  assert.equal(
    new DataView(envelope.buffer, envelope.byteOffset).getUint32(ENCRYPTED_OFFSETS.channel, true),
    channel,
  );
  assert.equal(parseEncryptedHeader(envelope)?.channel, channel);
  assert.ok(isMessagePayload(envelope, channel));
  assert.ok(!isMessagePayload(envelope, 1));
  assert.equal(
    right.decrypt(envelope, channel, 'node-0000001122334455', 'broadcast').text,
    'ridge check',
  );
  assert.equal(right.decrypt(envelope, 1, 'node-0000001122334455', 'broadcast').state, 'invalid');
  const rme1 = envelope.slice();
  rme1[3] = 1;
  assert.ok(!isMessagePayload(rme1, channel));
  assert.equal(
    right.decrypt(rme1, channel, 'node-0000001122334455', 'broadcast').state,
    'unsupported',
  );
  const limit = 1024 - ENCRYPTED_HEADER_BYTES - ENCRYPTED_TAG_BYTES;
  assert.equal(left.encrypt('x'.repeat(limit), channel, 'node-01', 'broadcast').length, 1024);
  assert.throws(() => left.encrypt('x'.repeat(limit + 1), channel, 'node-01', 'broadcast'));
});
