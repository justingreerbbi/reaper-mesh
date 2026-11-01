import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory = mkdtempSync(join(tmpdir(), 'reaper-messages-'));
const binary = join(directory, 'messages-test');
after(() => rmSync(directory, { recursive: true, force: true }));
const sanitizers = process.platform === 'darwin' && process.env.REAPER_ASAN !== '1' ? 'undefined' : 'address,undefined';
execFileSync(process.env.CXX || 'c++', [
  '-std=c++17', '-O1', '-Wall', '-Wextra', '-Werror', '-pedantic',
  `-fsanitize=${sanitizers}`, '-fno-sanitize-recover=all', '-fno-omit-frame-pointer',
  '-Ifirmware/components/reaper_protocol/include', '-Ifirmware/components/reaper_device/include',
  'firmware/components/reaper_device/messages.cpp', 'firmware/tests/messages_test.cpp', '-o', binary,
], { stdio: 'pipe', timeout: 30000 });
for (const [scenario, description] of Object.entries({
  chunks: 'reassembles reordered 1024-byte text and rejects conflicting duplicates',
  expiry: 'expires partial messages at the exact deadline without reexecution',
  ack: 'distinguishes destination ACK, expiry and broadcast transmission',
  capacity: 'bounds queues and prevents execution after receipt eviction',
  validation: 'rejects invalid text, wrong owners and owner exhaustion',
})) {
  test(`C++ message queue ${description}`, () => {
    assert.equal(execFileSync(binary, [scenario], { encoding: 'utf8', timeout: 10000 }).trim(), `ok ${scenario}`);
  });
}
