import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory = mkdtempSync(join(tmpdir(), 'reaper-regional-'));
const binary = join(directory, 'regional-test');
after(() => rmSync(directory, { recursive: true, force: true }));
const sanitizers = process.platform === 'darwin' && process.env.REAPER_ASAN !== '1' ? 'undefined' : 'address,undefined';
execFileSync(process.env.CXX || 'c++', [
  '-std=c++17', '-O1', '-Wall', '-Wextra', '-Werror', '-pedantic',
  `-fsanitize=${sanitizers}`, '-fno-sanitize-recover=all', '-fno-omit-frame-pointer',
  '-Ifirmware/components/reaper_mesh/include',
  'firmware/components/reaper_mesh/regional.cpp', 'firmware/tests/regional_test.cpp', '-o', binary,
], { stdio: 'pipe', timeout: 30000 });
test('regional airtime covers full data, ACKs, slow profiles, budget exhaustion and monotonic overflow', () => {
  assert.equal(execFileSync(binary, [], { encoding: 'utf8', timeout: 10000 }).trim(), 'ok regional');
});
