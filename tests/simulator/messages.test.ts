import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeMessage, decodeMessage, type Message } from '../../packages/protocol/messages.ts';

const messages: Message[] = [
  { type: 'hello', link: 'link_1', minVersion: 1, maxVersion: 1 },
  { type: 'welcome', link: 'link_1', device: 'device-A', boot: 'boot-A', minVersion: 1, maxVersion: 1 },
  { type: 'sync', link: 'link_1', boot: 'boot-A', request: 1 },
  { type: 'snapshot', link: 'link_1', boot: 'boot-A', request: 1, sequence: 0, revision: 0, region: 'US', label: 'Café 📻' },
  { type: 'event', link: 'link_1', boot: 'boot-A', sequence: 1, revision: 1, region: 'UNSET', label: '' },
  { type: 'ping', link: 'link_1', request: 0xffffffff },
  { type: 'pong', link: 'link_1', boot: 'boot-A', request: 1 },
  { type: 'configure', link: 'link_1', boot: 'boot-A', id: 'client-A:1', expectedRevision: 0, region: 'US', label: 'updated' },
  { type: 'result', link: 'link_1', boot: 'boot-A', id: 'client-A:1', outcome: 'committed', revision: 1 },
  { type: 'query', link: 'link_1', boot: 'boot-A', id: 'client-A:1' },
];

test('all schema variants round-trip with immutable decoded objects', () => {
  for (const message of messages) {
    const result = decodeMessage(encodeMessage(message));
    assert.deepEqual(result, message);
    assert.ok(Object.isFrozen(result));
  }
});

test('fixed hello vector preserves tag order and integer endianness', () => {
  const message: Message = { type: 'hello', link: 'A', minVersion: 1, maxVersion: 2 };
  const hex = '0101010100410204000100000003040002000000';
  assert.equal(Buffer.from(encodeMessage(message)).toString('hex'), hex);
  assert.deepEqual(decodeMessage(Uint8Array.from(Buffer.from(hex, 'hex'))), message);
});

test('invalid identity, integer, Unicode, label and region are rejected', () => {
  for (const changed of [
    { ...messages[0], link: '' }, { ...messages[0], link: 'a'.repeat(65) },
    { ...messages[0], link: '../bad' }, { ...messages[0], minVersion: -1 },
    { ...messages[0], minVersion: 1.5 }, { ...messages[0], maxVersion: 2 ** 32 },
    { ...messages[0], minVersion: NaN }, { ...messages[0], minVersion: 3, maxVersion: 1 },
    { ...messages[3], label: '\ud800' }, { ...messages[3], label: 'bad\nlabel' },
    { ...messages[3], label: '📻'.repeat(17) }, { ...messages[3], region: 'anywhere' },
  ]) assert.throws(() => encodeMessage(changed as Message));
});

test('unknown optional tags are skipped; duplicate and zero tags are rejected', () => {
  const payload = encodeMessage(messages[0]);
  const extended = Uint8Array.from([...payload, 200, 2, 0, 4, 5]);
  assert.deepEqual(decodeMessage(extended), messages[0]);
  assert.throws(() => decodeMessage(Uint8Array.from([...extended, 200, 0, 0])));
  assert.throws(() => decodeMessage(Uint8Array.from([...payload, 0, 0, 0])));
  assert.throws(() => decodeMessage(Uint8Array.from([...payload, ...payload.subarray(2, 6)])));
});

test('unknown payload version/type and oversized payloads are rejected', () => {
  for (const payload of [[], [1], [2, 1], [1, 255], new Array(2049).fill(1)]) {
    assert.throws(() => decodeMessage(Uint8Array.from(payload)));
  }
});

test('every truncated sample is rejected unless ending at a complete required message', () => {
  for (const message of messages) {
    const payload = encodeMessage(message);
    for (let end = 0; end < payload.length; end++) {
      assert.throws(() => decodeMessage(payload.subarray(0, end)));
    }
  }
});

test('malformed UTF-8 and integer widths never reach typed state', () => {
  const hello = encodeMessage({ type: 'hello', link: 'A', minVersion: 1, maxVersion: 1 });
  const badText = hello.slice();
  badText[5] = 0xff;
  assert.throws(() => decodeMessage(badText));
  const badInteger = hello.slice();
  badInteger[7] = 3;
  assert.throws(() => decodeMessage(badInteger));
  const inverted = hello.slice();
  inverted[9] = 2;
  assert.throws(() => decodeMessage(inverted));
});

test('command IDs and result outcomes are bounded and canonical', () => {
  for (const id of ['client:0', 'client:01', 'client:4294967296', 'client:-1', ':1', 'client:1:2']) {
    assert.throws(() => encodeMessage({ ...messages[9], id } as Message));
  }
  assert.throws(() => encodeMessage({ ...messages[8], outcome: 'delivered' } as unknown as Message));
  assert.deepEqual(decodeMessage(encodeMessage({ ...messages[9], id: 'client:4294967295' } as Message)),
    { ...messages[9], id: 'client:4294967295' });
});
