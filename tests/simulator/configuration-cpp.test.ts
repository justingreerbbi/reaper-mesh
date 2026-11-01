import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory = mkdtempSync(join(tmpdir(), 'reaper-configuration-'));
const binary = join(directory, 'configuration-test');
after(() => rmSync(directory, { recursive: true, force: true }));
const sanitizers = process.platform === 'darwin' && process.env.REAPER_ASAN !== '1' ? 'undefined' : 'address,undefined';
execFileSync(process.env.CXX || 'c++', [
  '-std=c++17', '-O1', '-g', '-Wall', '-Wextra', '-Werror', '-pedantic',
  `-fsanitize=${sanitizers}`, '-fno-sanitize-recover=all', '-fno-omit-frame-pointer',
  '-Ifirmware/components/reaper_protocol/include', '-Ifirmware/components/reaper_device/include',
  'firmware/components/reaper_protocol/protocol.cpp', 'firmware/components/reaper_device/configuration.cpp',
  'firmware/tests/configuration_test.cpp', '-o', binary,
], { stdio: 'pipe', timeout: 30000 });

const scenarios = {
  commit: 'publishes configuration only after durable commit returns',
  retry: 'lost-response retries do not write storage twice',
  conflict: 'concurrent stale revisions cannot overwrite newer configuration',
  failure: 'definite storage failure retains rejection and permits a new request',
  'uncertain-old': 'uncertain unwritten storage blocks mutation and recovers old state under a new boot',
  'uncertain-new': 'uncertain written storage blocks mutation without claiming command success',
  reboot: 'reboot restores config while old commands and receipts remain unusable',
  eviction: 'bounded receipt reclamation suppresses delayed old commands',
  owners: 'owner exhaustion preserves existing owners and duplicate suppression',
  corruption: 'corrupt records/read failures never trigger silent erase or defaults',
  record: 'record validation detects truncation and prevents revision wraparound',
  validation: 'malformed commands are rejected without consuming a request sequence',
  wire: 'validated framed USB commands reach configuration without exposing partial decodes',
};
for (const [scenario, description] of Object.entries(scenarios)) {
  test(`C++ authority ${description}`, () => {
    assert.equal(execFileSync(binary, [scenario], { encoding: 'utf8', timeout: 10000 }).trim(), `ok ${scenario}`);
  });
}
