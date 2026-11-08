/**
 * Checks for the browser firmware installer. Nothing here touches a device or the DOM, so host
 * tests cover it. The rules match tools/update-firmware.py: the right chip and flash size,
 * secure boot and flash encryption off, and images whose size and SHA-256 match the build.
 */

export interface FirmwareImage {
  /** Relative to the firmware folder. */
  path: string;
  offset: number;
  size: number;
  sha256: string;
}

export interface BoardBuild {
  id: string;
  name: string;
  /** esptool's chip name: `ESP32-S3` or `ESP32`. */
  chip: string;
  flashSize: string;
  firmware: string;
  sourceCommit: string;
  sourceDirty: boolean;
  images: FirmwareImage[];
}

export interface FirmwareIndex {
  built: string;
  boards: BoardBuild[];
  /** License files that travel with the images, relative to the firmware folder. */
  notices: string[];
}

/** Older indexes listed no notices; these always exist next to the images. */
const BASE_NOTICES = ['notices/LICENSE', 'notices/NOTICE', 'notices/Semtech-Clear-BSD.txt'];
/** Plain relative paths under notices/. No segment may start with a dot, so `..` can't escape. */
const NOTICE_PATH = /^notices(?:\/[A-Za-z0-9_+-][A-Za-z0-9_.+-]*)+$/;

/** What each supported board must look like. Anything else is refused before writing. */
export const SUPPORTED: Record<string, { chip: string; flashSize: string; offsets: number[] }> = {
  'heltec-v3': { chip: 'ESP32-S3', flashSize: '8MB', offsets: [0x0, 0x8000, 0x10000, 0x21a000] },
  'heltec-stick-v3': {
    chip: 'ESP32-S3',
    flashSize: '8MB',
    offsets: [0x0, 0x8000, 0x10000, 0x21a000],
  },
  'tbeam-v12': { chip: 'ESP32', flashSize: '4MB', offsets: [0x1000, 0x8000, 0x10000, 0x21a000] },
};

function fail(message: string): never {
  throw new Error(`Firmware index: ${message}`);
}

/** Validates the published index, so a damaged or unexpected file is refused, not used. */
export function parseIndex(value: unknown): FirmwareIndex {
  const index = value as {
    format?: unknown;
    built?: unknown;
    boards?: unknown;
    notices?: unknown;
  };
  if (!index || index.format !== 1 || typeof index.built !== 'string') fail('unsupported format');
  if (!Array.isArray(index.boards)) fail('missing boards');
  const boards = index.boards.map((raw: unknown): BoardBuild => {
    const board = raw as BoardBuild;
    const rules = SUPPORTED[board?.id];
    if (!rules) fail(`unknown board ${String(board?.id)}`);
    if (board.chip !== rules.chip || board.flashSize !== rules.flashSize) {
      fail(`${board.id} has the wrong chip or flash size`);
    }
    for (const key of ['name', 'firmware', 'sourceCommit'] as const) {
      if (typeof board[key] !== 'string' || !board[key]) fail(`${board.id} is missing ${key}`);
    }
    if (!/^[A-Za-z0-9_.-]{1,64}$/.test(board.firmware))
      fail(`${board.id} has an invalid firmware ID`);
    if (typeof board.sourceDirty !== 'boolean') fail(`${board.id} is missing sourceDirty`);
    if (!Array.isArray(board.images)) fail(`${board.id} has no images`);
    const offsets = board.images.map(image => image.offset);
    if (offsets.join() !== rules.offsets.join()) fail(`${board.id} has unexpected flash offsets`);
    for (const image of board.images) {
      if (
        typeof image.path !== 'string' ||
        !/^[a-z0-9-]+\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\.bin$/.test(image.path) ||
        !Number.isInteger(image.size) ||
        image.size <= 0 ||
        image.size > 0x200000 ||
        !/^[0-9a-f]{64}$/.test(image.sha256)
      ) {
        fail(`${board.id} has an invalid image entry`);
      }
    }
    return board;
  });
  const notices = index.notices ?? BASE_NOTICES;
  if (
    !Array.isArray(notices) ||
    notices.length > 500 ||
    !notices.every(path => typeof path === 'string' && NOTICE_PATH.test(path)) ||
    !BASE_NOTICES.every(path => notices.includes(path))
  ) {
    fail('invalid notices');
  }
  return { built: index.built, boards, notices: [...new Set(notices as string[])] };
}

/** `heltec-reaper-mesh-v0.11.1` → `v0.11.1`. */
export function versionOf(firmware: string): string {
  return /-v(\d+\.\d+\.\d+.*)$/.exec(firmware)?.[0].slice(1) ?? firmware;
}

export async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Refuses a download whose size or hash differs from the published build. */
export async function verifyImage(image: FirmwareImage, data: Uint8Array): Promise<void> {
  if (data.length !== image.size) {
    throw new Error(`${image.path} is ${data.length} bytes, expected ${image.size}.`);
  }
  if ((await sha256Hex(data)) !== image.sha256) {
    throw new Error(`${image.path} does not match its published SHA-256 hash.`);
  }
}

/**
 * Compares what the bootloader reports with the chosen board. `description` is esptool's chip
 * description, such as `ESP32-D0WDQ6-V3 (revision v3.1)`.
 */
export function checkChip(
  board: BoardBuild,
  chip: string,
  description: string,
  flashSize: string | undefined,
): string | null {
  if (chip !== board.chip) {
    return `This board has an ${chip} processor, but the ${board.name} uses an ${board.chip}. Choose the board you actually have.`;
  }
  if (board.chip === 'ESP32' && !description.startsWith('ESP32-D0WD')) {
    return `Unexpected ESP32 variant (${description}). Only the T-Beam V1.2's ESP32-D0WD is supported.`;
  }
  if (flashSize !== board.flashSize) {
    return `This board has ${flashSize ?? 'an unknown amount of'} flash, but the ${board.name} has ${board.flashSize}.`;
  }
  return null;
}

const SECURED =
  'This board has secure boot or flash encryption turned on. The installer never writes to secured boards.';

/** ESP32-S3: the ROM's security report must show no flags and flash encryption off. */
export function checkSecurityInfo(info: { flags: number; flashCryptCnt: number }): string | null {
  const encrypted = popcount(info.flashCryptCnt) % 2 === 1;
  return info.flags !== 0 || encrypted ? SECURED : null;
}

/** ESP32 eFuse words the original ESP32 needs checking, since its ROM has no security report. */
export const ESP32_EFUSE = { base: 0x3ff5a000, words: [0, 6, 34] } as const;

/**
 * ESP32: the same fields espefuse reads for tools/update-firmware.py. Word 0 holds RD_DIS
 * (bits 16–19) and FLASH_CRYPT_CNT (20–26); word 6 holds ABS_DONE_0/1 (4, 5) and
 * DISABLE_DL_ENCRYPT/DECRYPT/CACHE (7–9); word 34 is block 3 word 4, SECURE_VERSION.
 */
export function checkEsp32Efuses(
  word0: number,
  word6: number,
  secureVersion: number,
): string | null {
  const flashCryptCnt = (word0 >>> 20) & 0x7f;
  const secureVersionReadable = ((word0 >>> 16) & 0b0100) === 0;
  const word6Flags = word6 & ((1 << 4) | (1 << 5) | (1 << 7) | (1 << 8) | (1 << 9));
  if (flashCryptCnt !== 0 || word6Flags !== 0 || !secureVersionReadable || secureVersion !== 0) {
    return SECURED;
  }
  return null;
}

function popcount(value: number): number {
  let count = 0;
  for (let v = value >>> 0; v; v &= v - 1) count++;
  return count;
}

/** MD5, which the bootloader uses to confirm each written image. Not used for security. */
export function md5Hex(data: Uint8Array): string {
  const s = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9,
    14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ];
  const k = Array.from(
    { length: 64 },
    (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0,
  );
  const length = data.length;
  const padded = new Uint8Array((((length + 8) >>> 6) + 1) << 6);
  padded.set(data);
  padded[length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, (length * 8) >>> 0, true);
  view.setUint32(padded.length - 4, Math.floor(length / 0x20000000), true);
  let [a0, b0, c0, d0] = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
  const m = new Uint32Array(16);
  for (let chunk = 0; chunk < padded.length; chunk += 64) {
    for (let i = 0; i < 16; i++) m[i] = view.getUint32(chunk + i * 4, true);
    let [a, b, c, d] = [a0, b0, c0, d0];
    for (let i = 0; i < 64; i++) {
      let f: number;
      let g: number;
      if (i < 16) [f, g] = [(b & c) | (~b & d), i];
      else if (i < 32) [f, g] = [(d & b) | (~d & c), (5 * i + 1) % 16];
      else if (i < 48) [f, g] = [b ^ c ^ d, (3 * i + 5) % 16];
      else [f, g] = [c ^ (b | ~d), (7 * i) % 16];
      const rotated = (a + f + k[i] + m[g]) >>> 0;
      [a, d, c] = [d, c, b];
      b = (b + ((rotated << s[i]) | (rotated >>> (32 - s[i])))) >>> 0;
    }
    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }
  const out = new DataView(new ArrayBuffer(16));
  [a0, b0, c0, d0].forEach((word, i) => out.setUint32(i * 4, word, true));
  return [...new Uint8Array(out.buffer)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** esptool's `--chip` value for an index chip name. */
function esptoolChip(chip: string): string {
  return chip.toLowerCase().replace('-', '');
}

/** The file name an image is saved as: the last part of its published path. */
export function imageName(image: FirmwareImage): string {
  return image.path.slice(image.path.lastIndexOf('/') + 1);
}

/** The README in a firmware download: what it is and how to write it without erasing settings. */
export function downloadReadme(board: BoardBuild, installerUrl: string, repo: string): string {
  const offsets = board.images
    .map(image => `0x${image.offset.toString(16)} ${imageName(image)}`)
    .join(' ');
  return [
    `Reaper Mesh firmware ${board.firmware}`,
    `Board: ${board.name} (${board.chip}, ${board.flashSize} flash)`,
    `Source: ${repo}/commit/${board.sourceCommit}${board.sourceDirty ? ' (with uncommitted changes)' : ''}`,
    '',
    'The easiest way to install it is the browser installer:',
    installerUrl,
    '',
    'To write these files yourself, put the board in its bootloader (hold BOOT/PRG, tap RESET,',
    'release BOOT) and run esptool 4.x from this folder:',
    '',
    `esptool.py --chip ${esptoolChip(board.chip)} --baud 460800 write_flash --flash_mode keep --flash_freq keep --flash_size keep ${offsets}`,
    '',
    'Write only these four images, at these offsets. Never erase the whole chip: the space between',
    "them holds the board's settings, Bluetooth pairings and team keys.",
    '',
    "SHA256SUMS lists every file's SHA-256 hash. It detects corruption, not a malicious publisher:",
    'releases are not signed yet. This is prototype firmware, not an RF certification.',
    '',
    'Reaper Mesh is licensed under Apache-2.0 (LICENSE, NOTICE). Third-party notices are in notices/.',
    '',
  ].join('\n');
}

/** A download's files: the four verified images, a README, the notices and SHA256SUMS. */
export async function downloadFiles(
  board: BoardBuild,
  images: Uint8Array[],
  notices: { path: string; data: Uint8Array }[],
  installerUrl: string,
  repo: string,
): Promise<ZipEntry[]> {
  const encoder = new TextEncoder();
  const files: ZipEntry[] = board.images.map((image, i) => ({
    name: imageName(image),
    data: images[i],
  }));
  files.push({
    name: 'README.txt',
    data: encoder.encode(downloadReadme(board, installerUrl, repo)),
  });
  for (const notice of notices) {
    // LICENSE and NOTICE sit at the top, as in tools/package-firmware.py; the rest stay in notices/.
    const top = notice.path === 'notices/LICENSE' || notice.path === 'notices/NOTICE';
    files.push({
      name: top ? notice.path.slice('notices/'.length) : notice.path,
      data: notice.data,
    });
  }
  files.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const sums = [];
  for (const file of files) sums.push(`${await sha256Hex(file.data)}  ${file.name}\n`);
  files.push({ name: 'SHA256SUMS', data: encoder.encode(sums.join('')) });
  return files.map(file => ({ name: `${board.firmware}/${file.name}`, data: file.data }));
}

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * A stored (uncompressed) zip archive. Every entry gets the same fixed date, so the same files
 * always give the same bytes. Firmware images barely compress, so storing keeps this small.
 */
export function zip(entries: ZipEntry[]): Uint8Array {
  const encoder = new TextEncoder();
  const date = ((2026 - 1980) << 9) | (1 << 5) | 1; // 2026-01-01, 00:00
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const crc = crc32(entry.data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true); // version needed
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, entry.data.length, true);
    local.setUint32(22, entry.data.length, true);
    local.setUint16(26, name.length, true);
    const record = new DataView(new ArrayBuffer(46));
    record.setUint32(0, 0x02014b50, true);
    record.setUint16(4, (3 << 8) | 20, true); // made by Unix, so the mode below applies
    record.setUint16(6, 20, true);
    record.setUint16(8, 0x0800, true);
    record.setUint16(14, date, true);
    record.setUint32(16, crc, true);
    record.setUint32(20, entry.data.length, true);
    record.setUint32(24, entry.data.length, true);
    record.setUint16(28, name.length, true);
    record.setUint32(38, (0o100644 << 16) >>> 0, true);
    record.setUint32(42, offset, true);
    parts.push(new Uint8Array(local.buffer), name, entry.data);
    central.push(new Uint8Array(record.buffer), name);
    offset += 30 + name.length + entry.data.length;
  }
  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of all) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
