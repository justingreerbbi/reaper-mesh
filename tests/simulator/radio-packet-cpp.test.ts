import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory = mkdtempSync(join(tmpdir(), 'reaper-radio-packet-'));
const binary = join(directory, 'radio-packet-test');
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
    'firmware/components/reaper_protocol/protocol.cpp',
    'firmware/components/reaper_mesh/radio_packet.cpp',
    'firmware/tests/radio_packet_test.cpp',
    '-o',
    binary,
  ],
  { stdio: 'pipe', timeout: 30000 },
);
for (const [scenario, description] of Object.entries({
  validation: 'rejects invalid metadata before it can be sealed or published',
  encrypted: 'recognizes opaque encrypted envelopes without keys and keeps plaintext validation',
})) {
  test(`Radio packet ${description}`, () => {
    assert.equal(
      execFileSync(binary, [scenario], { encoding: 'utf8', timeout: 10000 }).trim(),
      `ok ${scenario}`,
    );
  });
}
