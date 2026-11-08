// Assembles the GitHub Pages site in dist/site:
//
//   dist/site/                  the web portal (from dist/web)
//   dist/site/flash/            the firmware installer (from dist/flasher)
//   dist/site/flash/firmware/   firmware images and index.json, from build/<board>/
//   dist/site/flash/firmware/notices/   the licenses that must travel with the images
//
// Run `npm run build:web` and `npm run build:flasher` first, and build the firmware with
// tools/build-firmware.sh. Each board's build is validated with tools/update-firmware.py (the same
// checks as a USB install) before it is published.
//
// Usage: node tools/build-site.ts [--require-firmware] [--allow-dirty]
//   --require-firmware  fail if a board's build is missing (CI uses this)
//   --allow-dirty       publish builds from uncommitted source (local previews only)
//
// ESP-IDF's license files come from build/notices/esp-idf (CI collects them while building the
// firmware) or, locally, from the bootstrapped SDK in .tools/esp-idf.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';

interface Artifact {
  offset: string;
  file: string;
  size: number;
  sha256: string;
}

interface Manifest {
  board: string;
  target: string;
  firmware: string;
  source_commit: string;
  source_dirty: boolean;
  flash_settings: { flash_size: string };
  artifacts: Artifact[];
}

const BOARDS = [
  { id: 'heltec-v3', chip: 'ESP32-S3' },
  { id: 'heltec-wsl-v3', chip: 'ESP32-S3' },
  { id: 'tbeam-v12', chip: 'ESP32' },
];

const args = new Set(process.argv.slice(2));
const requireFirmware = args.has('--require-firmware');
const allowDirty = args.has('--allow-dirty');
const python = process.env.PYTHON ?? 'python3';

const site = 'dist/site';
const installer = join(site, 'flash');
const firmwareDir = join(installer, 'firmware');

for (const part of ['dist/web/index.html', 'dist/flasher/index.html']) {
  if (!existsSync(part))
    throw new Error(`${part} is missing; run npm run build:web and build:flasher`);
}

rmSync(site, { recursive: true, force: true });
cpSync('dist/web', site, { recursive: true });
cpSync('dist/flasher', installer, { recursive: true });
mkdirSync(firmwareDir, { recursive: true });

const boards = [];
for (const board of BOARDS) {
  const manifestPath = join('build', board.id, 'reaper-manifest.json');
  if (!existsSync(manifestPath)) {
    if (requireFirmware) throw new Error(`${manifestPath} is missing`);
    console.warn(`No firmware build for ${board.id}; the installer will show it as unavailable.`);
    continue;
  }
  // The same validation as a USB install: board, SDK, schemas, image headers, partition
  // layout, sizes and hashes. It never opens a device without --flash.
  execFileSync(
    python,
    [
      'tools/update-firmware.py',
      '--manifest',
      manifestPath,
      ...(allowDirty ? ['--allow-dirty'] : []),
    ],
    { stdio: 'inherit' },
  );
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
  // A folder per build, so a cached old image can never pair with a newer index.
  const folder = `${board.id}/${manifest.firmware}-${manifest.source_commit.slice(0, 12)}`;
  mkdirSync(join(firmwareDir, folder), { recursive: true });
  const images = manifest.artifacts
    .map(artifact => {
      const data = readFileSync(join('build', board.id, artifact.file));
      const sha256 = createHash('sha256').update(data).digest('hex');
      if (sha256 !== artifact.sha256 || data.length !== artifact.size) {
        throw new Error(`${board.id}: ${artifact.file} changed after validation`);
      }
      const path = `${folder}/${basename(artifact.file)}`;
      writeFileSync(join(firmwareDir, path), data);
      return { path, offset: Number.parseInt(artifact.offset, 16), size: data.length, sha256 };
    })
    .sort((a, b) => a.offset - b.offset);
  boards.push({
    id: board.id,
    name: manifest.board,
    chip: board.chip,
    flashSize: manifest.flash_settings.flash_size,
    firmware: manifest.firmware,
    sourceCommit: manifest.source_commit,
    sourceDirty: manifest.source_dirty,
    images,
  });
  console.log(`Published ${manifest.firmware} for ${board.id}`);
}

// The same notices as tools/package-firmware.py puts in a firmware zip.
const notices = join(firmwareDir, 'notices');
mkdirSync(notices, { recursive: true });
cpSync('LICENSE', join(notices, 'LICENSE'));
cpSync('NOTICE', join(notices, 'NOTICE'));
cpSync(
  'firmware/components/reaper_radio/vendor/LICENSE.txt',
  join(notices, 'Semtech-Clear-BSD.txt'),
);
if (existsSync('build/notices/esp-idf/LICENSE')) {
  cpSync('build/notices/esp-idf', join(notices, 'esp-idf'), { recursive: true });
} else if (existsSync('.tools/esp-idf/LICENSE')) {
  for (const file of sdkNotices('.tools/esp-idf')) {
    const target = join(notices, 'esp-idf', relative('.tools/esp-idf', file));
    mkdirSync(dirname(target), { recursive: true });
    cpSync(file, target);
  }
} else if (boards.length) {
  throw new Error('ESP-IDF license notices are missing (build/notices/esp-idf or .tools/esp-idf)');
}

const index = { format: 1, built: new Date().toISOString(), boards };
writeFileSync(join(firmwareDir, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
console.log(`Site ready in ${site} with ${boards.length} firmware build(s).`);

/** License, copying, notice and copyright files anywhere in the SDK, outside .git. */
function sdkNotices(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.name === '.git' || lstatSync(path).isSymbolicLink()) continue;
    if (entry.isDirectory()) found.push(...sdkNotices(path));
    else if (/^(LICENSE|COPYING|NOTICE|COPYRIGHT)/.test(entry.name.toUpperCase())) found.push(path);
  }
  return found;
}
