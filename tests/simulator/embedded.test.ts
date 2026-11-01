import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import schema from '../../packages/protocol/schema.json' with { type: 'json' };
import fixtures from '../../packages/protocol/fixtures/messages-v1.json' with { type: 'json' };
import { encodeMessage, decodeMessage, type Message } from '../../packages/protocol/messages.ts';
import { encodeFrame, FrameDecoder, MAX_ENCODED, MAX_PAYLOAD } from '../../packages/protocol/framing.ts';

const directory = mkdtempSync(join(tmpdir(), 'reaper-codec-'));
const binary = join(directory, 'codec-bridge');
// AppleClang AddressSanitizer startup stalls on this host. CI/Linux runs both;
// macOS runs UBSan unless ASan is explicitly enabled for a working toolchain.
const sanitizers = process.platform === 'darwin' && process.env.REAPER_ASAN !== '1' ? 'undefined' : 'address,undefined';
after(() => rmSync(directory, { recursive: true, force: true }));
execFileSync(process.env.CXX || 'c++', [
  '-std=c++17', '-O1', '-g', '-Wall', '-Wextra', '-Werror', '-pedantic',
  `-fsanitize=${sanitizers}`, '-fno-omit-frame-pointer', '-fno-sanitize-recover=all',
  '-Ifirmware/components/reaper_protocol/include',
  'firmware/components/reaper_protocol/protocol.cpp', 'firmware/tests/codec_bridge.cpp', '-o', binary,
], { cwd: resolve('.'), stdio: 'pipe', timeout: 30000 });
const hex = (value: Uint8Array) => Buffer.from(value).toString('hex');
const joinBytes = (...parts: Uint8Array[]) => Uint8Array.from(parts.flatMap(part => [...part]));

function expected(stream: Uint8Array) {
  const frames: string[] = [];
  new FrameDecoder().feed(stream, payload => {
    try { frames.push(hex(encodeFrame(encodeMessage(decodeMessage(payload))))); } catch { /* invalid typed payload */ }
  });
  return frames.join('|') || 'ERR';
}
function compare(streams: Uint8Array[], chunk = 1) {
  const result = execFileSync(binary, [String(chunk)], {
    input: streams.map(hex).join('\n') + '\n', encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
    timeout: 30000,
  }).trim().split('\n');
  assert.deepEqual(result, streams.map(expected));
}
const sampleValues: Record<string, unknown> = {
  link: 'link-A', device: 'node-A', boot: 'boot-A', owner: 'client-A', minVersion: 1, maxVersion: 1,
  configSchema: 1, features: 7, maxPayload: 2048, receiptCapacity: 32, ownerCapacity: 8,
  ownerAdmitted: 1, regions: 3, maxLabelBytes: 64, firmware: 'sim-0', radioVersion: 0,
  request: 1, sequence: 0xffffffff, revision: 0xffffffff, expectedRevision: 0,
  region: 'US', label: 'Café 📻', id: 'client-A:4294967295', outcome: 'committed',
};
const messages = Object.entries(schema).map(([type, message]) => Object.fromEntries([
  ['type', type], ...Object.keys(message.fields).map(name => [name, sampleValues[name]]),
]) as Message);
const frame = (message: Message) => encodeFrame(encodeMessage(message));

test('embedded codec compiles with warnings as errors and passes sanitizer self-checks', () => {
  const result = execFileSync(binary, ['selftest'], { encoding: 'utf8', timeout: 10000 });
  assert.match(result, /^ok sizeof\(Message\)=\d+ sizeof\(FrameDecoder\)=\d+/);
});

test('all generated message types have byte-identical TypeScript and C++ encodings', () => {
  const streams = messages.map(frame);
  compare(streams, 1);
  compare(streams, 17);
  compare(streams, 65536);
});

test('checked-in v1 compatibility fixtures retain exact bytes across both codecs', () => {
  for (const fixture of fixtures) {
    const message = fixture.message as Message;
    assert.equal(hex(encodeMessage(message)), fixture.payloadHex);
    assert.equal(hex(frame(message)), fixture.frameHex);
    assert.deepEqual(decodeMessage(Uint8Array.from(Buffer.from(fixture.payloadHex, 'hex'))), message);
  }
  compare(fixtures.map(fixture => Uint8Array.from(Buffer.from(fixture.frameHex, 'hex'))));
});

test('optional, unknown, and reordered fields preserve compatibility across languages', () => {
  const hello: Message = { type: 'hello', link: 'A', minVersion: 1, maxVersion: 1 };
  const payload = encodeMessage(hello);
  const extended = Uint8Array.from([...payload, 200, 2, 0, 0xff, 0]);
  const fields: Uint8Array[] = [];
  for (let cursor = 2; cursor < payload.length;) {
    const size = payload[cursor + 1] | (payload[cursor + 2] << 8);
    fields.push(payload.slice(cursor, cursor + 3 + size)); cursor += 3 + size;
  }
  compare([frame(hello), encodeFrame(extended), encodeFrame(joinBytes(payload.slice(0, 2), ...fields.reverse()))]);
});

test('all truncated payloads and corrupt bit positions agree with the client decoder', () => {
  const samples: Uint8Array[] = [];
  for (const message of messages) {
    const payload = encodeMessage(message);
    for (let end = 1; end < payload.length; end++) samples.push(encodeFrame(payload.subarray(0, end)));
  }
  const valid = frame(messages[0]);
  for (let i = 0; i < valid.length; i++) {
    for (let bit = 0; bit < 8; bit++) {
      const corrupt = valid.slice(); corrupt[i] ^= 1 << bit;
      samples.push(joinBytes(corrupt, Uint8Array.of(0), valid));
    }
  }
  compare(samples);
});

test('boundary text, Unicode and command IDs match the client validation contract', () => {
  const snapshot = messages.find(message => message.type === 'snapshot')!;
  const streams = ['', 'a'.repeat(64), '📻'.repeat(16), '\ufefftest'].map(label => frame({ ...snapshot, label } as Message));
  const payload = encodeMessage({ ...snapshot, label: 'X' } as Message);
  const labelTag = Object.keys(schema.snapshot.fields).indexOf('label') + 1;
  let prefix = 2;
  while (payload[prefix] !== labelTag) prefix += 3 + payload[prefix + 1] + (payload[prefix + 2] << 8);
  for (const bad of [[0xc0, 0xaf], [0xed, 0xa0, 0x80], [0xf4, 0x90, 0x80, 0x80], [0xe2, 0x82],
    [0], [127], new Array(65).fill(65)]) {
    streams.push(encodeFrame(joinBytes(payload.slice(0, prefix), Uint8Array.of(labelTag, bad.length, 0), Uint8Array.from(bad))));
  }
  const query = encodeMessage({ type: 'query', link: 'A', boot: 'B', id: 'owner:1' });
  // Query's ID is the final field. Inject invalid IDs with a correct envelope checksum.
  const start = query.length - ('owner:1'.length + 3);
  for (const id of ['owner:0', 'owner:01', 'owner:4294967296', ':1', 'owner:-1', 'owner:1:2']) {
    const bytes = new TextEncoder().encode(id);
    streams.push(encodeFrame(joinBytes(query.slice(0, start), Uint8Array.of(3, bytes.length, 0), bytes)));
  }
  compare(streams);
});

test('oversized streams, missing delimiters and combined frames recover identically', () => {
  const valid = frame(messages[0]);
  const hello = encodeMessage(messages[0]);
  const padding = MAX_PAYLOAD - hello.length - 3;
  const maximum = joinBytes(hello, Uint8Array.of(200, padding & 255, padding >> 8), new Uint8Array(padding).fill(0x7e));
  compare([
    joinBytes(new Uint8Array(MAX_ENCODED * 3).fill(1), Uint8Array.of(0), valid),
    joinBytes(valid.subarray(0, -1), valid, valid),
    joinBytes(valid, valid, Uint8Array.of(0, 0), valid),
    encodeFrame(new Uint8Array(MAX_PAYLOAD).fill(255)),
    encodeFrame(maximum),
  ], 13);
});

test('seeded malformed payloads and corrupted streams have matching accept/reject behavior', () => {
  let seed = 0x524d;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
  const samples: Uint8Array[] = [];
  for (let i = 0; i < 500; i++) {
    const payload = encodeMessage(messages[random() % messages.length]);
    const corrupt = payload.slice();
    for (let j = 0, edits = 1 + random() % 5; j < edits; j++) corrupt[random() % corrupt.length] ^= 1 + random() % 255;
    samples.push(encodeFrame(corrupt));
    const noise = Uint8Array.from({ length: random() % 250 }, () => random() >>> 24);
    samples.push(joinBytes(noise, Uint8Array.of(0), frame(messages[i % messages.length])));
  }
  compare(samples, 7);
});
