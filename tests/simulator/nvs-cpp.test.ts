import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory = mkdtempSync(join(tmpdir(), 'reaper-nvs-'));
const binary = join(directory, 'nvs-test');
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
    '-Ifirmware/tests/stubs',
    '-Ifirmware/app',
    '-Ifirmware/components/reaper_protocol/include',
    '-Ifirmware/components/reaper_device/include',
    '-Ifirmware/components/reaper_mesh/include',
    'firmware/app/nvs_storage.cpp',
    'firmware/tests/nvs_storage_test.cpp',
    '-o',
    binary,
  ],
  { stdio: 'pipe', timeout: 30000 },
);
for (const [scenario, description] of Object.entries({
  init: 'preserves failed initialization without erasing or writing',
  reads: 'distinguishes missing config, valid read, and backend failures',
  bounds: 'rejects oversized reads and invalid writes before calling storage',
  commit: 'acknowledges only after set and commit succeed and closes its handle',
  uncertain: 'classifies set or commit failures as indeterminate',
})) {
  test(`NVS adapter ${description}`, () => {
    assert.equal(
      execFileSync(binary, [scenario], { encoding: 'utf8', timeout: 10000 }).trim(),
      `ok ${scenario}`,
    );
  });
}
