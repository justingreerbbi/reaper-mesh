import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
// Pinned upstream Semtech drivers. Each folder holds an upstream.json with a hash per file.
for (const folder of ['vendor', 'lr11xx']) {
  const base = new URL(`../firmware/components/reaper_radio/${folder}/`, import.meta.url);
  const lock = JSON.parse(readFileSync(new URL('upstream.json', base), 'utf8')) as {
    files: Record<string, string>;
  };
  for (const [name, expected] of Object.entries(lock.files)) {
    if (!/^[A-Za-z0-9_.-]+$/.test(name) || !/^[a-f0-9]{64}$/.test(expected))
      throw new Error(`invalid vendor lock in ${folder}`);
    if (
      createHash('sha256')
        .update(readFileSync(new URL(name, base)))
        .digest('hex') !== expected
    )
      throw new Error(`pinned vendor file changed: ${folder}/${name}`);
  }
}
