import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory = mkdtempSync(join(tmpdir(), 'reaper-network-'));
const binary = join(directory, 'network-test');
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
    '-Ifirmware/components/reaper_device/include',
    'firmware/components/reaper_protocol/protocol.cpp',
    'firmware/components/reaper_mesh/radio_packet.cpp',
    'firmware/components/reaper_mesh/frame.cpp',
    'firmware/components/reaper_device/network.cpp',
    'firmware/tests/crypto_host/crypto_host.cpp',
    'firmware/tests/network_test.cpp',
    '-o',
    binary,
  ],
  { stdio: 'pipe', timeout: 60000 },
);

for (const [scenario, description] of Object.entries({
  store:
    'keeps relay keys in flash and the team key out of it, and leaves no old key after a change',
  powercut: 'leaves exactly one whole network after a power cut at any step',
  rules: 'refuses invalid fills, makes retries harmless and keeps the network when a save fails',
  erase: 'blanks flash and leaves the radio with no keys',
  corrupt: 'treats damaged or unreadable flash as no network',
  rotate: 'moves epochs only on a valid proof, erases old keys and leaves traffic undisturbed',
  thief: 'gives a stolen relay key no way to move or strand a relay',
  rotatecut: 'keeps one whole record after a power cut at any step of an advance',
  oldrecord: 'treats a record from the previous format as no network and clears it',
})) {
  test(`Radio network ${description}`, () => {
    assert.equal(
      execFileSync(binary, [scenario], { encoding: 'utf8', timeout: 10000 }).trim(),
      `ok ${scenario}`,
    );
  });
}
