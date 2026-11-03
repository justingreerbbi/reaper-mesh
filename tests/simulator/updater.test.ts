import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
test('firmware updater rejects incompatible images, layout changes and secured targets before writes', () => {
  const result = spawnSync(
    process.env.PYTHON ?? 'python3',
    [fileURLToPath(new URL('../update-firmware-test.py', import.meta.url))],
    {
      encoding: 'utf8',
      timeout: 10000,
      maxBuffer: 1024 * 1024,
    },
  );
  assert.equal(result.status, 0, result.error?.message ?? result.stderr ?? result.stdout);
});
