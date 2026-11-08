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
// The same driver for the 128 x 64 panel and, with REAPER_DISPLAY_64X32, the Wireless Stick
// V3's 64 x 32 panel.
const builds = { '128x64': [] as string[], '64x32': ['-DREAPER_DISPLAY_64X32=1'] };
for (const [geometry, defines] of Object.entries(builds))
  execFileSync(
    process.env.CXX || 'c++',
    [
      ...defines,
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
      'firmware/app/status_display.cpp',
      'firmware/heltec-v3/main/status_display.cpp',
      'firmware/tests/display_test.cpp',
      '-o',
      `${binary}-${geometry}`,
    ],
    { stdio: 'pipe', timeout: 30000 },
  );
for (const [scenario, description] of Object.entries({
  updates: 'sends full bounded frames and skips unchanged ones',
  power: 'turns the panel and charge pump off and on without drawing while off',
  'init-failure': 'leaves USB independent when the display bus fails',
  'tx-failure': 'bounds transfer timeout and disables redraws after a failed transaction',
})) {
  for (const geometry of Object.keys(builds))
    test(`OLED panel (${geometry}) ${description}`, () => {
      assert.equal(
        execFileSync(`${binary}-${geometry}`, [scenario], {
          encoding: 'utf8',
          timeout: 10000,
        }).trim(),
        `ok ${scenario}`,
      );
    });
}
