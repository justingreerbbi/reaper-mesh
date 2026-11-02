import { crc32 } from '../../packages/protocol/framing.ts';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory = mkdtempSync(join(tmpdir(), 'reaper-radio-packet-'));
const binary = join(directory, 'radio-packet-test');
after(() => rmSync(directory, { recursive: true, force: true }));
const sanitizers = process.platform === 'darwin' && process.env.REAPER_ASAN !== '1' ? 'undefined' : 'address,undefined';
execFileSync(process.env.CXX || 'c++', [
  '-std=c++17', '-O1', '-Wall', '-Wextra', '-Werror', '-pedantic',
  `-fsanitize=${sanitizers}`, '-fno-sanitize-recover=all', '-fno-omit-frame-pointer',
  '-Ifirmware/components/reaper_protocol/include', '-Ifirmware/components/reaper_mesh/include',
  'firmware/components/reaper_protocol/protocol.cpp', 'firmware/components/reaper_mesh/radio_packet.cpp',
  'firmware/tests/radio_packet_test.cpp', '-o', binary,
], { stdio: 'pipe', timeout: 30000 });
for (const [scenario, description] of Object.entries({
  roundtrip: 'round trips maximum message fragments and destination ACK packets',
  encrypted: 'recognizes opaque encrypted envelopes without keys and keeps plaintext validation',
  malformed: 'rejects corruption, invalid metadata and all truncations without publishing partial output',
})) {
  test(`Radio packet ${description}`, () => {
    assert.equal(execFileSync(binary, [scenario], { encoding: 'utf8', timeout: 10000 }).trim(), `ok ${scenario}`);
  });
}

test('radio packet golden bytes independently match documented offsets and little endian fields', () => {
  const header = Buffer.alloc(52); // 50-byte fixed header plus two payload bytes.
  header.write('RM', 0); header[2] = 1; header[3] = 1;
  header.writeBigUInt64LE(0x0102030405060708n, 8); header.writeBigUInt64LE(0xffffffffffffffffn, 16);
  for (let i = 0; i < 16; i++) header[24 + i] = i;
  header.writeUInt32LE(1, 40); header[44] = 1; header[46] = 3; header.writeUInt16LE(2, 47); header[49] = 2; header.write('hi', 50);
  const checksum = Buffer.alloc(4); checksum.writeUInt32LE(crc32(header));
  assert.equal(execFileSync(binary, ['golden'], { encoding: 'utf8', timeout: 10000 }).trim(), Buffer.concat([header, checksum]).toString('hex'));
});
