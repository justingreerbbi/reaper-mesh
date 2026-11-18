// Assembles the desktop app's pages in dist/desktop from the built site (npm run build:site):
//
//   dist/desktop/web/     the web portal
//   dist/desktop/flash/   the firmware installer, with the firmware the site build published
//   dist/desktop/index.html  opens the portal
//
// The pages are the same files the website serves. Usage: node tools/build-desktop.ts
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const site = 'dist/site';
const out = 'dist/desktop';
for (const part of ['web/index.html', 'flash/index.html']) {
  if (!existsSync(join(site, part)))
    throw new Error(`${site}/${part} is missing; run npm run build:site`);
}
if (!existsSync('dist/desktop-shim/serial-shim.js'))
  throw new Error('dist/desktop-shim/serial-shim.js is missing; run npm run build:desktop-shim');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(join(site, 'web'), join(out, 'web'), { recursive: true });
cpSync(join(site, 'flash'), join(out, 'flash'), { recursive: true });
writeFileSync(
  join(out, 'index.html'),
  '<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=web/index.html"><title>Reaper Mesh</title>\n',
);
const firmware = existsSync(join(out, 'flash/firmware/index.json'));
console.log(
  `Desktop pages ready in ${out}${firmware ? ', with firmware' : ', without firmware (the installer will show none)'}.`,
);
