import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory = mkdtempSync(join(tmpdir(), 'reaper-mesh-service-'));
const binary = join(directory, 'mesh-service-test');
after(() => rmSync(directory, { recursive: true, force: true }));
const sanitizers = process.platform === 'darwin' && process.env.REAPER_ASAN !== '1' ? 'undefined' : 'address,undefined';
const vendor = join(directory, 'sx126x.o');
execFileSync(process.env.CC || 'cc', ['-std=c11', '-O1', `-fsanitize=${sanitizers}`, '-fno-sanitize-recover=all',
  '-Ifirmware/components/reaper_radio/vendor', '-c', 'firmware/components/reaper_radio/vendor/sx126x.c', '-o', vendor], { timeout: 30000, stdio: 'pipe' });
execFileSync(process.env.CXX || 'c++', [
  '-std=c++17', '-O1', '-Wall', '-Wextra', '-Werror', '-pedantic',
  `-fsanitize=${sanitizers}`, '-fno-sanitize-recover=all', '-fno-omit-frame-pointer',
  '-Ifirmware/components/reaper_protocol/include', '-Ifirmware/components/reaper_device/include', '-Ifirmware/heltec-v3/main', '-Ifirmware/tests/radio_stubs', '-Ifirmware/components/reaper_mesh/include',
  '-Ifirmware/components/reaper_radio/include', '-Ifirmware/components/reaper_radio/vendor',
  'firmware/components/reaper_protocol/protocol.cpp', 'firmware/components/reaper_mesh/radio_packet.cpp',
  'firmware/components/reaper_mesh/regional.cpp', 'firmware/components/reaper_radio/radio.cpp',
  'firmware/components/reaper_radio/hal.cpp', 'firmware/heltec-v3/main/mesh_service.cpp', 'firmware/components/reaper_mesh/mesh.cpp',
  'firmware/components/reaper_device/discovery.cpp', 'firmware/components/reaper_device/messages.cpp', 'firmware/components/reaper_device/inbox.cpp', 'firmware/tests/mesh_service_test.cpp', vendor, '-o', binary,
], { stdio: 'pipe', timeout: 30000 });
for (const [scenario, description] of Object.entries({
  privacy: 'stops an old location-bearing control flight after a committed privacy change',
  discovery: 'routes real driver control frames through the independent discovery cache without chat delivery',
  local: 'delivers to the local inbox without claiming RF transmission',
  gate: 'refuses remote transmit admission while the antenna is unconfirmed',
  tx: 'publishes TX_DONE then accepts only the matching destination ACK',
  policy: 'cancels in-flight work when radio policy changes',
})) {
  test(`Board mesh service ${description}`, () => {
    assert.equal(execFileSync(binary, [scenario], { encoding: 'utf8', timeout: 10000 }).trim(), `ok ${scenario}`);
  });
}
