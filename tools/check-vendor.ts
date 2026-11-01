import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import lock from '../firmware/components/reaper_radio/vendor/upstream.json' with { type: 'json' };
for (const [name, expected] of Object.entries(lock.files)) {
  if (!/^[A-Za-z0-9_.-]+$/.test(name) || !/^[a-f0-9]{64}$/.test(expected)) throw new Error('invalid vendor lock');
  const path = new URL(`../firmware/components/reaper_radio/vendor/${name}`, import.meta.url);
  if (createHash('sha256').update(readFileSync(path)).digest('hex') !== expected) throw new Error(`pinned vendor file changed: ${name}`);
}
