import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createCipheriv, createDecipheriv, createHmac } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory = mkdtempSync(join(tmpdir(), 'reaper-frame-'));
const binary = join(directory, 'frame-test');
after(() => rmSync(directory, { recursive: true, force: true }));
const sanitizers =
  process.platform === 'darwin' && process.env.REAPER_ASAN !== '1'
    ? 'undefined'
    : 'address,undefined';
execFileSync(
  process.env.CXX || 'c++',
  [
    '-std=c++17',
    '-O1',
    '-Wall',
    '-Wextra',
    '-Werror',
    '-pedantic',
    `-fsanitize=${sanitizers}`,
    '-fno-sanitize-recover=all',
    '-fno-omit-frame-pointer',
    '-Ifirmware/components/reaper_protocol/include',
    '-Ifirmware/components/reaper_mesh/include',
    '-Ifirmware/components/reaper_crypto/include',
    'firmware/components/reaper_mesh/frame.cpp',
    'firmware/tests/crypto_host/crypto_host.cpp',
    'firmware/tests/frame_test.cpp',
    '-o',
    binary,
  ],
  { stdio: 'pipe', timeout: 60000 },
);

// An independent implementation of the contract, using Node's crypto rather than the C++ code.
const hmac = (key: Uint8Array, ...parts: Uint8Array[]) => {
  const digest = createHmac('sha256', key);
  for (const part of parts) digest.update(part);
  return digest.digest();
};
const label = (key: Uint8Array, text: string) => hmac(key, Buffer.from(text, 'ascii'));
const ratchet = (chain: Uint8Array, epoch: number) => {
  let key = chain;
  for (let i = 0; i < epoch; i++) key = label(key, 'reaper-v2 ratchet');
  return key;
};
type Vector = {
  name: string;
  relayChain: string;
  teamChain: string;
  epoch: number;
  hops: number;
  limit: number;
  nonce: string;
  kind: number;
  channel: number;
  origin: string;
  destination: string;
  boot: number;
  sequence: number;
  count: number;
  index: number;
  total: number;
  body: string;
  frame: string;
};
function reference(vector: Vector) {
  const relayChain = ratchet(Buffer.from(vector.relayChain, 'hex'), vector.epoch);
  const teamChain = ratchet(Buffer.from(vector.teamChain, 'hex'), vector.epoch);
  const clear = Buffer.alloc(14);
  clear[0] = 2;
  label(relayChain, 'reaper-v2 hint').copy(clear, 1, 0, 2);
  clear.writeUInt16LE(vector.epoch, 3);
  clear[5] = vector.limit << 4;
  Buffer.from(vector.nonce, 'hex').copy(clear, 6);
  const body = Buffer.from(vector.body, 'hex');
  const plain = Buffer.alloc(32 + body.length);
  plain[0] = vector.kind;
  plain.writeUInt32LE(vector.channel, 1);
  plain.writeBigUInt64LE(BigInt(vector.origin), 5);
  plain.writeBigUInt64LE(BigInt(vector.destination), 13);
  plain.writeUInt32LE(vector.boot, 21);
  plain.writeUInt32LE(vector.sequence, 25);
  plain[29] = (vector.count << 4) | vector.index;
  plain.writeUInt16LE(vector.total, 30);
  body.copy(plain, 32);
  const nonce = Buffer.concat([clear.subarray(6, 14), clear.subarray(3, 5), Buffer.alloc(3)]);
  const frameKey = label(teamChain, 'reaper-v2 frame');
  const cipher = createCipheriv('aes-256-ccm', frameKey, nonce, { authTagLength: 8 });
  cipher.setAAD(clear, { plaintextLength: plain.length });
  const sealed = cipher.update(plain);
  cipher.final();
  const teamTag = cipher.getAuthTag();
  const relayTag = hmac(label(relayChain, 'reaper-v2 relay tag'), clear, sealed, teamTag);
  const header = Buffer.from(clear);
  header[5] = (vector.limit << 4) | vector.hops;
  const frame = Buffer.concat([header, sealed, teamTag, relayTag.subarray(0, 4)]);
  const opener = createDecipheriv('aes-256-ccm', frameKey, nonce, { authTagLength: 8 });
  opener.setAuthTag(teamTag);
  opener.setAAD(clear, { plaintextLength: sealed.length });
  const opened = opener.update(sealed);
  opener.final();
  assert.deepEqual(opened, plain);
  return frame.toString('hex');
}
const fixture = JSON.parse(readFileSync('packages/protocol/fixtures/frame-v2.json', 'utf8')) as {
  vectors: Vector[];
};

test('Radio version 2 vectors match an independent Node implementation', () => {
  for (const vector of fixture.vectors) assert.equal(reference(vector), vector.frame, vector.name);
});
test('Radio version 2 Open mode chains are the published derivation', () => {
  const key = Buffer.from('reaper-v2 open', 'ascii');
  const open = fixture.vectors.find(vector => vector.name === 'open-mode');
  assert.equal(label(key, 'relay').toString('hex'), open?.relayChain);
  assert.equal(label(key, 'team').toString('hex'), open?.teamChain);
});
test('Radio version 2 firmware codec produces the frozen vectors', () => {
  const lines = execFileSync(binary, ['golden'], { encoding: 'utf8', timeout: 10000 })
    .trim()
    .split('\n');
  assert.deepEqual(
    lines,
    fixture.vectors.map(vector => vector.frame),
  );
});
for (const [scenario, description] of Object.entries({
  hmac: 'host HMAC matches the RFC 4231 vector',
  roundtrip: 'round trips maximum fragments and ACKs without exposing the sender',
  relay: 'lets a relay forward without the team key, and team members reject a relay-key forgery',
  keys: 'separates epochs and chains',
  tamper: 'rejects every changed bit, leaving only current hops changeable within the limit',
  malformed: 'rejects truncation and invalid fields without publishing partial output',
})) {
  test(`Radio version 2 ${description}`, () => {
    assert.equal(
      execFileSync(binary, [scenario], { encoding: 'utf8', timeout: 20000 }).trim(),
      `ok ${scenario}`,
    );
  });
}
