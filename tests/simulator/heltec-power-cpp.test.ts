import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory = mkdtempSync(join(tmpdir(), 'reaper-heltec-power-'));
const binary = join(directory, 'heltec-power-test');
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
    '-Ifirmware/app',
    '-Ifirmware/tests/power_stubs',
    'firmware/heltec-v3/main/board_power.cpp',
    'firmware/tests/heltec_power_test.cpp',
    '-o',
    binary,
  ],
  { stdio: 'pipe', timeout: 30000 },
);
for (const [scenario, description] of Object.entries({
  low: 'reads a low-active battery divider and releases it between polls',
  high: 'reads a high-active battery divider and releases it between polls',
  init: 'fails closed when ADC initialization fails',
  calibration: 'does not invent voltage without calibration',
  bounds: 'rejects disconnected and implausible voltage readings',
})) {
  test(`Heltec power ${description}`, () => {
    assert.equal(
      execFileSync(binary, [scenario], { encoding: 'utf8', timeout: 10000 }).trim(),
      `ok ${scenario}`,
    );
  });
}
