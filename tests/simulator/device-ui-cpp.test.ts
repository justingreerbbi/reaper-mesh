import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory = mkdtempSync(join(tmpdir(), 'reaper-device-ui-'));
const binary = join(directory, 'device-ui-test');
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
    'firmware/app/device_ui.cpp',
    'firmware/tests/device_ui_test.cpp',
    '-o',
    binary,
  ],
  { stdio: 'pipe', timeout: 30000 },
);
for (const [scenario, description] of Object.entries({
  gestures: 'decodes debounced single, double and long presses',
  screen: 'runs the startup sequence, page cycling, wake and timeout',
  unread: 'counts messages that arrived since the screen last turned off',
  led: 'lights the LED at startup, pulses on activity, blinks for waiting messages and stays dark when off',
  settings: 'applies the stored timeout and wakes on a new message when enabled',
  render: 'draws every page within the frame, deterministically, for odd input',
  ble: 'draws the pairing page over any page and wakes the screen for it',
  battery: 'draws the battery and plugged-in indicator top right and keeps the name clear',
})) {
  test(`device screen ${description}`, () => {
    assert.equal(
      execFileSync(binary, [scenario], { encoding: 'utf8', timeout: 10000 }).trim(),
      `ok ${scenario}`,
    );
  });
}
