import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory = mkdtempSync(join(tmpdir(), 'reaper-radio-driver-'));
const binary = join(directory, 'radio-test');
after(() => rmSync(directory, { recursive: true, force: true }));
const sanitizers =
  process.platform === 'darwin' && process.env.REAPER_ASAN !== '1'
    ? 'undefined'
    : 'address,undefined';
const vendor = join(directory, 'sx126x.o');
execFileSync(
  process.env.CC || 'cc',
  [
    '-std=c11',
    '-O1',
    `-fsanitize=${sanitizers}`,
    '-fno-sanitize-recover=all',
    '-Ifirmware/components/reaper_radio/vendor',
    '-c',
    'firmware/components/reaper_radio/vendor/sx126x.c',
    '-o',
    vendor,
  ],
  { timeout: 30000, stdio: 'pipe' },
);
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
    '-Ifirmware/components/reaper_radio/include',
    '-Ifirmware/components/reaper_radio/vendor',
    'firmware/components/reaper_protocol/protocol.cpp',
    'firmware/components/reaper_mesh/radio_packet.cpp',
    'firmware/components/reaper_mesh/regional.cpp',
    'firmware/components/reaper_radio/radio.cpp',
    'firmware/components/reaper_radio/hal.cpp',
    'firmware/tests/radio_test.cpp',
    vendor,
    '-o',
    binary,
  ],
  { stdio: 'pipe', timeout: 30000 },
);
for (const [scenario, description] of Object.entries({
  receive: 'configures receive-only without transmitting and rejects bad CRC packets',
  tx: 'requires explicit TX admission, budgets airtime and waits for TX_DONE',
  faults: 'fails closed on calibration, SPI and busy faults without false TX success',
})) {
  test(`SX1262 driver ${description}`, () => {
    assert.equal(
      execFileSync(binary, [scenario], { encoding: 'utf8', timeout: 10000 }).trim(),
      `ok ${scenario}`,
    );
  });
}
