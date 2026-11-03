import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory = mkdtempSync(join(tmpdir(), 'reaper-display-'));
const binary = join(directory, 'display-test');
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
    '-Ifirmware/components/reaper_device/include',
    '-Ifirmware/tests/display_stubs',
    '-Ifirmware/app',
    'firmware/heltec-v3/main/status_display.cpp',
    'firmware/tests/display_test.cpp',
    '-o',
    binary,
  ],
  { stdio: 'pipe', timeout: 30000 },
);
for (const [scenario, description] of Object.entries({
  updates: 'renders bounded frames for readiness, maximum revision and storage fault',
  'init-failure': 'leaves USB independent when the display bus fails',
  'tx-failure': 'bounds transfer timeout and disables redraws after a failed transaction',
})) {
  test(`OLED status ${description}`, () => {
    assert.equal(
      execFileSync(binary, [scenario], { encoding: 'utf8', timeout: 10000 }).trim(),
      `ok ${scenario}`,
    );
  });
}
