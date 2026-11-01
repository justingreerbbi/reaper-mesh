import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory = mkdtempSync(join(tmpdir(), 'reaper-session-'));
const binary = join(directory, 'session-test');
after(() => rmSync(directory, { recursive: true, force: true }));
const sanitizers = process.platform === 'darwin' && process.env.REAPER_ASAN !== '1' ? 'undefined' : 'address,undefined';
execFileSync(process.env.CXX || 'c++', [
  '-std=c++17', '-O1', '-Wall', '-Wextra', '-Werror', '-pedantic',
  `-fsanitize=${sanitizers}`, '-fno-sanitize-recover=all', '-fno-omit-frame-pointer',
  '-Ifirmware/components/reaper_protocol/include', '-Ifirmware/components/reaper_device/include',
  'firmware/components/reaper_protocol/protocol.cpp', 'firmware/components/reaper_device/configuration.cpp',
  'firmware/components/reaper_device/session.cpp', 'firmware/components/reaper_device/inbox.cpp', 'firmware/components/reaper_device/messages.cpp', 'firmware/tests/session_test.cpp', '-o', binary,
], { stdio: 'pipe', timeout: 30000 });
for (const [scenario, description] of Object.entries({
  sync: 'requires synchronization and returns authoritative snapshots',
  identity: 'rejects stale links, wrong boot, wrong owner and unsupported region',
  reconnect: 'retains receipts across reconnect for query-only recovery',
  storage: 'emits unknown then a storage error without serving stale snapshots',
  version: 'does not admit incompatible clients or consume their owner slots',
})) {
  test(`C++ session ${description}`, () => {
    assert.equal(execFileSync(binary, [scenario], { encoding: 'utf8', timeout: 10000 }).trim(), `ok ${scenario}`);
  });
}
