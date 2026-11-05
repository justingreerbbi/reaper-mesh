import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory = mkdtempSync(join(tmpdir(), 'reaper-inbox-'));
const binary = join(directory, 'inbox-test');
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
    'firmware/components/reaper_device/configuration.cpp',
    'firmware/components/reaper_device/discovery.cpp',
    'firmware/components/reaper_mesh/radio_packet.cpp',
    'firmware/components/reaper_device/session.cpp',
    'firmware/components/reaper_device/inbox.cpp',
    'firmware/components/reaper_device/messages.cpp',
    'firmware/tests/inbox_test.cpp',
    '-o',
    binary,
  ],
  { stdio: 'pipe', timeout: 30000 },
);
for (const [scenario, description] of Object.entries({
  retention: 'bounds retention and binds retained IDs to immutable content',
  wire: 'serves diagnostics and bounded inbox chunks only after synchronization',
})) {
  test(`C++ inbox ${description}`, () => {
    assert.equal(
      execFileSync(binary, [scenario], { encoding: 'utf8', timeout: 10000 }).trim(),
      `ok ${scenario}`,
    );
  });
}
