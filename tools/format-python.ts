// Formats and lints the tracked Python tools and tests with the pinned ruff.
// Usage: node tools/format-python.ts [--check]
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const VERSION = '0.17.1';
const check = process.argv.includes('--check');
const local = '.tools/ruff/bin/ruff';
const binary = process.env.RUFF || (existsSync(local) ? local : 'ruff');

let version = '';
try {
  version = execFileSync(binary, ['--version'], { encoding: 'utf8' });
} catch {
  // Reported below.
}
if (version.trim() !== `ruff ${VERSION}`) {
  console.error(
    `ruff ${VERSION} is required (found: ${version.trim() || 'none'}).\n` +
      `Install it with:\n  python3 -m venv .tools/ruff\n` +
      `  .tools/ruff/bin/pip install ruff==${VERSION}`,
  );
  process.exit(1);
}

const files = execFileSync('git', ['ls-files', '--', '*.py'], { encoding: 'utf8' })
  .split('\n')
  .filter(Boolean);

// Formatting first, then lint; in write mode lint applies only ruff's safe fixes.
const steps = check
  ? [
      ['format', '--check', ...files],
      ['check', ...files],
    ]
  : [
      ['format', ...files],
      ['check', '--fix', ...files],
    ];
for (const args of steps) {
  try {
    execFileSync(binary, args, { stdio: 'inherit' });
  } catch {
    console.error(
      check ? 'Python formatting or lint differs; run `npm run format`.' : 'ruff failed.',
    );
    process.exit(1);
  }
}
console.log(`${check ? 'Checked' : 'Formatted'} ${files.length} Python files.`);
