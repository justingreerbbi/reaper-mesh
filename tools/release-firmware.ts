// Writes one firmware zip per board for a GitHub release, from the firmware the site build
// published (dist/site/flash/firmware). Each zip is what the installer's "Download firmware
// instead" saves: the verified images, a README, the license notices and SHA256SUMS.
//
// Usage: node tools/release-firmware.ts OUTPUT_DIR
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { downloadFiles, parseIndex, verifyImage, zip } from '../agents/flasher/firmware.ts';

const out = process.argv[2];
if (!out) throw new Error('usage: node tools/release-firmware.ts OUTPUT_DIR');
const REPO = 'https://github.com/justingreerbbi/reaper-mesh';
const INSTALLER = 'https://reapermesh.com/flash/';
const firmware = 'dist/site/flash/firmware';
const index = parseIndex(JSON.parse(readFileSync(join(firmware, 'index.json'), 'utf8')));
const notices = index.notices.map(path => ({
  path,
  data: new Uint8Array(readFileSync(join(firmware, path))),
}));
mkdirSync(out, { recursive: true });
for (const board of index.boards) {
  const images = [];
  for (const image of board.images) {
    const data = new Uint8Array(readFileSync(join(firmware, image.path)));
    await verifyImage(image, data);
    images.push(data);
  }
  const name = `${board.firmware}.zip`;
  writeFileSync(join(out, name), zip(await downloadFiles(board, images, notices, INSTALLER, REPO)));
  console.log(`${name}: ${board.name}`);
}
