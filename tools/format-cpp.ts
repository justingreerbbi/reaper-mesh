// Formats first-party C/C++ firmware sources with the pinned clang-format.
// Usage: node tools/format-cpp.ts [--check]
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const VERSION = '23.1.3';
const check = process.argv.includes('--check');
const local = '.tools/clang-format/bin/clang-format';
const binary = process.env.CLANG_FORMAT || (existsSync(local) ? local : 'clang-format');

let version = '';
try {
  version = execFileSync(binary, ['--version'], { encoding: 'utf8' });
} catch {
  // Reported below.
}
if (!version.includes(`version ${VERSION}`)) {
  console.error(
    `clang-format ${VERSION} is required (found: ${version.trim() || 'none'}).\n` +
      `Install it with:\n  python3 -m venv .tools/clang-format\n` +
      `  .tools/clang-format/bin/pip install clang-format==${VERSION}`,
  );
  process.exit(1);
}

const files = execFileSync(
  'git',
  ['ls-files', '--', 'firmware/*.c', 'firmware/*.cpp', 'firmware/*.h', 'firmware/*.hpp'],
  {
    encoding: 'utf8',
  },
)
  .split('\n')
  .filter(file => file && !file.includes('/vendor/') && !file.includes('.generated.'));

const args = check ? ['--dry-run', '-Werror'] : ['-i'];
try {
  execFileSync(binary, [...args, ...files], { stdio: 'inherit' });
} catch {
  console.error(check ? 'C++ formatting differs; run `npm run format`.' : 'clang-format failed.');
  process.exit(1);
}
console.log(`${check ? 'Checked' : 'Formatted'} ${files.length} C/C++ files.`);
