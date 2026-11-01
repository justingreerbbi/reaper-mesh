import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory = mkdtempSync(join(tmpdir(), 'reaper-mesh-'));
const binary = join(directory, 'mesh-test');
after(() => rmSync(directory, { recursive: true, force: true }));
const sanitizers = process.platform === 'darwin' && process.env.REAPER_ASAN !== '1' ? 'undefined' : 'address,undefined';
execFileSync(process.env.CXX || 'c++', [
  '-std=c++17', '-O1', '-Wall', '-Wextra', '-Werror', '-pedantic',
  `-fsanitize=${sanitizers}`, '-fno-sanitize-recover=all', '-fno-omit-frame-pointer',
  '-Ifirmware/components/reaper_protocol/include', '-Ifirmware/components/reaper_mesh/include',
  'firmware/components/reaper_protocol/protocol.cpp', 'firmware/components/reaper_mesh/radio_packet.cpp',
  'firmware/components/reaper_mesh/mesh.cpp', 'firmware/tests/mesh_test.cpp', '-o', binary,
], { stdio: 'pipe', timeout: 30000 });
for (const [scenario, description] of Object.entries({
  line: 'reassembles and acknowledges across a hidden-link three-node topology',
  loss: 'recovers lost, reordered and duplicated fragments without duplicate delivery',
  asymmetric: 'does not claim destination delivery when ACK return path is lost',
  broadcast: 'bounds triangle flooding and never generates broadcast ACKs',
  hops: 'enforces hop budget and expires unreachable messages',
  races: 'retains early ACKs and gives exact expiry precedence',
  soak: 'survives 120 seeded long-lived loss/corruption/retry cycles with bounded traffic and no false ACKs',
  bounds: 'bounds queues, suppresses retired IDs and rejects conflicting reassembly',
})) {
  test(`C++ mesh ${description}`, () => {
    assert.equal(execFileSync(binary, [scenario], { encoding: 'utf8', timeout: 10000 }).trim(), `ok ${scenario}`);
  });
}
