// Assembles the GitHub Pages site in dist/site:
//
//   dist/site/                  the project's landing page (from agents/site)
//   dist/site/web/              the web portal (from dist/web)
//   dist/site/flash/            the firmware installer (from dist/flasher)
//   dist/site/flash/firmware/   firmware images and index.json, from build/<board>/
//   dist/site/flash/firmware/notices/   the licenses that must travel with the images
//   dist/site/app/, support/, privacy/  the site's own pages (from agents/site), linked from the
//                               App Store and Google Play listings
//
// The site is served from the root of https://reapermesh.com/. Every page uses relative paths, so
// it also works under a subpath such as a github.io project site.
//
// In agents/site, each page's <!-- site:header --> and <!-- site:footer --> markers are replaced by
// partials/header.html and partials/footer.html, %ROOT% by the relative path to the site root, and
// %SUPPORT_EMAIL% by the contact address. Links to the page itself are marked aria-current.
// Board listings come from agents/boards.json: <!-- site:boards --> becomes a card per board,
// %BOARD_NAMES% the boards' names in a sentence and %BOARD_MAKERS% their makers.
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
import { BOARDS as BOARD_LIST, type Board, listNames, makers } from '../agents/boards.ts';

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

const BOARDS = BOARD_LIST.map(board => ({ id: board.id, chip: board.processor }));

const args = new Set(process.argv.slice(2));
const requireFirmware = args.has('--require-firmware');
const allowDirty = args.has('--allow-dirty');
const python = process.env.PYTHON ?? 'python3';

// The contact address on the privacy and support pages, filled in wherever they say %SUPPORT_EMAIL%.
const SUPPORT_EMAIL = 'support@reapermesh.com';

const site = 'dist/site';
const installer = join(site, 'flash');
const firmwareDir = join(installer, 'firmware');

for (const part of ['dist/web/index.html', 'dist/flasher/index.html']) {
  if (!existsSync(part))
    throw new Error(`${part} is missing; run npm run build:web and build:flasher`);
}

rmSync(site, { recursive: true, force: true });
cpSync('dist/web', join(site, 'web'), { recursive: true });
cpSync('dist/flasher', installer, { recursive: true });
// The site's pages share the apps' design tokens and icon.
for (const shared of ['theme.css', 'favicon.svg']) {
  cpSync(join('agents/web/public', shared), join(site, shared));
}
const partials = {
  header: readFileSync('agents/site/partials/header.html', 'utf8'),
  footer: readFileSync('agents/site/partials/footer.html', 'utf8'),
};
for (const file of listFiles('agents/site')) {
  const path = relative('agents/site', file).split('\\').join('/');
  if (path.startsWith('partials/')) continue;
  const target = join(site, path);
  if (existsSync(target)) throw new Error(`${target} from agents/site would replace a built file`);
  mkdirSync(dirname(target), { recursive: true });
  if (file.endsWith('.html')) writeFileSync(target, renderPage(path, readFileSync(file, 'utf8')));
  else cpSync(file, target);
}
mkdirSync(firmwareDir, { recursive: true });

const boards = [];
for (const board of BOARDS) {
  const manifestPath = join('build', board.id, 'reaper-manifest.json');
  if (!existsSync(manifestPath)) {
    if (requireFirmware) throw new Error(`${manifestPath} is missing`);
    console.warn(`No firmware build for ${board.id}; the installer will show it as unavailable.`);
    continue;
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
  if (board.chip === 'nRF52840') {
    // The T1000-E has one application image for its bootloader; the installer checks the rest.
    checkNrfManifest(manifest);
  } else {
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
  }
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
if (boards.some(board => board.chip === 'nRF52840')) {
  cpSync(
    'firmware/components/reaper_radio/lr11xx/LICENSE.txt',
    join(notices, 'Semtech-LR11xx-Clear-BSD.txt'),
  );
  const zephyr = ['build/notices/zephyr/LICENSE', '.tools/zephyr/zephyr/LICENSE'].find(existsSync);
  if (!zephyr) throw new Error('Zephyr license is missing (build/notices/zephyr or .tools/zephyr)');
  mkdirSync(join(notices, 'zephyr'), { recursive: true });
  cpSync(zephyr, join(notices, 'zephyr', 'LICENSE'));
}
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

// The installer's "Download firmware instead" bundles these with the images.
const noticeFiles = listFiles(notices)
  .map(file => relative(firmwareDir, file).split('\\').join('/'))
  .sort();
const index = { format: 1, built: new Date().toISOString(), boards, notices: noticeFiles };
writeFileSync(join(firmwareDir, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
console.log(`Site ready in ${site} with ${boards.length} firmware build(s).`);

/** A card per board for the home page, in agents/boards.json's order. */
function boardCards(boards: readonly Board[], root: string): string {
  return boards
    .map(board => {
      const status =
        board.status === 'experimental'
          ? '<span class="board-status" title="Not every hardware check has passed yet">Experimental</span>'
          : '';
      const facts = board.highlights.map(fact => `<li>${escapeHtml(fact)}</li>`).join('');
      return `<article class="card board-card">
              <div class="board-card-head">
                <div class="card-icon">
                  <svg class="icon" aria-hidden="true"><use href="${root}assets/icons.svg#cpu" /></svg>
                </div>
                ${status}
              </div>
              <h3>${escapeHtml(board.name)}</h3>
              <p>${escapeHtml(board.summary)}</p>
              <ul class="meta">${facts}</ul>
            </article>`;
    })
    .join('\n            ');
}

function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"]/g,
    char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]!,
  );
}

/** The T1000-E manifest from tools/t1000e-package.py: one application image after the SoftDevice. */
function checkNrfManifest(manifest: Manifest) {
  const [image, ...extra] = manifest.artifacts;
  if (
    manifest.target !== 'nrf52840' ||
    !/^t1000e-reaper-mesh-v\d+\.\d+\.\d+/.test(manifest.firmware) ||
    manifest.flash_settings.flash_size !== '1MB' ||
    !image ||
    extra.length ||
    image.offset !== '0x27000' ||
    image.size <= 0 ||
    image.size > 0xe2000 - 0x27000
  ) {
    throw new Error('t1000-e: unexpected manifest');
  }
  if (manifest.source_dirty && !allowDirty) {
    throw new Error(
      't1000-e: built from uncommitted changes; pass --allow-dirty to publish anyway',
    );
  }
}

/** Fills in a page from agents/site: shared header and footer, root path and contact address. */
function renderPage(path: string, html: string): string {
  const dir = path.slice(0, path.lastIndexOf('/') + 1);
  const root = '../'.repeat(dir.split('/').length - 1) || './';
  const page = html
    .replace('<!-- site:header -->', partials.header.trim())
    .replace('<!-- site:footer -->', partials.footer.trim())
    .replaceAll(`href="%ROOT%${dir}"`, `href="%ROOT%${dir}" aria-current="page"`)
    .replaceAll('%ROOT%', root)
    .replaceAll('%SUPPORT_EMAIL%', SUPPORT_EMAIL)
    .replace('<!-- site:boards -->', boardCards(BOARD_LIST, root))
    .replaceAll('%BOARD_NAMES%', escapeHtml(listNames(BOARD_LIST.map(board => board.name))))
    .replaceAll('%BOARD_MAKERS%', escapeHtml(listNames(makers())));
  const left = /<!-- site:\w+ -->|%[A-Z_]+%/.exec(page);
  if (left) throw new Error(`agents/site/${path}: ${left[0]} was not filled in`);
  return page;
}

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

function listFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  });
}
