import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { crc32, cobsEncode, cobsDecode, encodeFrame, decodeFrame,
  FrameDecoder, MAX_PAYLOAD, MAX_ENCODED } from '../../packages/protocol/framing.ts';

const bytes = (...values: number[]) => Uint8Array.from(values);
const join = (...parts: Uint8Array[]) => Uint8Array.from(parts.flatMap(part => [...part]));
function receive(decoder: FrameDecoder, chunk: Uint8Array) {
  const payloads: Uint8Array[] = [];
  const counts = decoder.feed(chunk, payload => payloads.push(payload));
  return { ...counts, payloads };
}

test('CRC matches the independent standard check vector', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('envelope matches the shared golden fixture for future firmware implementations', () => {
  const fixture = JSON.parse(readFileSync(new URL('../../packages/protocol/fixtures/envelope-v1.json', import.meta.url), 'utf8'));
  const payload = Uint8Array.from(Buffer.from(fixture.payloadHex, 'hex'));
  const frame = encodeFrame(payload);
  assert.equal(Buffer.from(frame).toString('hex'), fixture.frameHex);
  assert.equal(Buffer.from(cobsDecode(frame.subarray(0, -1))).toString('hex'), fixture.rawHex);
  assert.deepEqual(decodeFrame(frame.subarray(0, -1)), payload);
});

test('COBS matches fixed vectors including zeros and a full block', () => {
  for (const [raw, encoded] of [
    [bytes(), bytes(1)], [bytes(0), bytes(1, 1)],
    [bytes(0, 1, 0), bytes(1, 2, 1, 1)], [bytes(1, 2, 3), bytes(4, 1, 2, 3)],
    [new Uint8Array(254).fill(7), join(bytes(255), new Uint8Array(254).fill(7), bytes(1))],
  ]) {
    assert.deepEqual(cobsEncode(raw), encoded);
    assert.deepEqual(cobsDecode(encoded), raw);
  }
});

test('all possible two-chunk split boundaries recover exactly one payload', () => {
  const payload = bytes(0, 1, 255, 0, 42);
  const frame = encodeFrame(payload);
  for (let split = 0; split <= frame.length; split++) {
    const decoder = new FrameDecoder();
    const first = receive(decoder, frame.subarray(0, split));
    const second = receive(decoder, frame.subarray(split));
    assert.deepEqual([...first.payloads, ...second.payloads], [payload]);
    assert.equal(decoder.bufferedBytes, 0);
  }
});

test('combined frames and empty delimiters preserve order', () => {
  const a = bytes(1, 0, 2), b = bytes(9);
  const result = receive(new FrameDecoder(), join(bytes(0, 0), encodeFrame(a), encodeFrame(b), bytes(0)));
  assert.deepEqual(result.payloads, [a, b]);
  assert.equal(result.rejected, 0);
});

test('maximum payload survives bytewise delivery with bounded buffering', () => {
  const payload = Uint8Array.from({ length: MAX_PAYLOAD }, (_, i) => i % 256);
  const decoder = new FrameDecoder();
  const received: Uint8Array[] = [];
  for (const byte of encodeFrame(payload)) {
    decoder.feed(bytes(byte), value => received.push(value));
    assert.ok(decoder.bufferedBytes <= MAX_ENCODED);
  }
  assert.deepEqual(received, [payload]);
  assert.throws(() => encodeFrame(new Uint8Array(MAX_PAYLOAD + 1)));
  assert.throws(() => encodeFrame(bytes()));
});

test('every single-bit corruption of a frame is rejected and next frame recovers', () => {
  const frame = encodeFrame(bytes(0, 1, 42, 255));
  const good = encodeFrame(bytes(8));
  for (let i = 0; i < frame.length - 1; i++) {
    for (let bit = 0; bit < 8; bit++) {
      const corrupt = frame.slice();
      corrupt[i] ^= 1 << bit;
      const result = receive(new FrameDecoder(), join(corrupt, good));
      assert.deepEqual(result.payloads, [bytes(8)]);
      assert.ok(result.rejected >= 1);
    }
  }
});

test('oversized delimiter-free input is discarded until alignment returns', () => {
  const decoder = new FrameDecoder();
  const noise = new Uint8Array(MAX_ENCODED * 20).fill(1);
  assert.equal(receive(decoder, noise).rejected, 1);
  assert.equal(decoder.bufferedBytes, 0);
  assert.deepEqual(receive(decoder, join(bytes(0), encodeFrame(bytes(3)))).payloads, [bytes(3)]);
});

test('missing delimiter sacrifices joined frames, then recovers at the next boundary', () => {
  const frame = encodeFrame(bytes(1));
  const result = receive(new FrameDecoder(), join(frame.subarray(0, -1), frame, encodeFrame(bytes(2))));
  assert.deepEqual(result.payloads, [bytes(2)]);
  assert.equal(result.rejected, 1);
});

test('reset drops partial data across connection generations', () => {
  const decoder = new FrameDecoder();
  const frame = encodeFrame(bytes(1));
  receive(decoder, frame.subarray(0, 4));
  decoder.reset();
  assert.deepEqual(receive(decoder, encodeFrame(bytes(2))).payloads, [bytes(2)]);
});

test('malformed COBS blocks and decoded oversize are rejected', () => {
  for (const invalid of [bytes(), bytes(0), bytes(3, 1), bytes(2, 0),
    new Uint8Array(MAX_ENCODED + 1).fill(1), new Uint8Array(MAX_ENCODED).fill(1)]) {
    assert.throws(() => cobsDecode(invalid));
  }
});

test('header and declared length are checked even with a valid checksum', () => {
  const raw = cobsDecode(encodeFrame(bytes(1)).subarray(0, -1));
  for (const [index, value] of [[0, 0], [1, 0], [2, 2], [3, 1], [4, 0], [5, 1]]) {
    const changed = raw.slice();
    changed[index] = value;
    new DataView(changed.buffer).setUint32(changed.length - 4, crc32(changed.subarray(0, -4)), true);
    assert.throws(() => decodeFrame(cobsEncode(changed)));
  }
});

test('seeded noise and chunk schedules recover without unbounded storage', () => {
  let seed = 0x524d;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
  for (let trial = 0; trial < 100; trial++) {
    const noise = Uint8Array.from({ length: random() % 5000 }, () => random() & 255);
    const payload = Uint8Array.from({ length: 1 + random() % MAX_PAYLOAD }, () => random() & 255);
    const stream = join(noise, bytes(0), encodeFrame(payload));
    const decoder = new FrameDecoder();
    const output: Uint8Array[] = [];
    for (let cursor = 0; cursor < stream.length;) {
      const count = 1 + random() % 79;
      decoder.feed(stream.subarray(cursor, cursor + count), frame => output.push(frame));
      cursor += count;
      assert.ok(decoder.bufferedBytes <= MAX_ENCODED);
    }
    assert.deepEqual(output, [payload]);
  }
});
