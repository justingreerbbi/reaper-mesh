import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import {
  type BoardBuild,
  checkChip,
  checkEsp32Efuses,
  checkSecurityInfo,
  md5Hex,
  parseIndex,
  verifyImage,
  versionOf,
} from '../../agents/flasher/firmware.ts';

const hash = (n: number) => n.toString(16).padStart(64, '0');

function heltec(): BoardBuild {
  const folder = 'heltec-v3/heltec-reaper-mesh-v0.11.1-0123456789ab';
  return {
    id: 'heltec-v3',
    name: 'Heltec WiFi LoRa 32 V3',
    chip: 'ESP32-S3',
    flashSize: '8MB',
    firmware: 'heltec-reaper-mesh-v0.11.1',
    sourceCommit: '0123456789abcdef0123456789abcdef01234567',
    sourceDirty: false,
    images: [
      { path: `${folder}/bootloader.bin`, offset: 0x0, size: 13776, sha256: hash(1) },
      { path: `${folder}/partition-table.bin`, offset: 0x8000, size: 3072, sha256: hash(2) },
      { path: `${folder}/reaper_mesh_usb.bin`, offset: 0x10000, size: 577216, sha256: hash(3) },
      { path: `${folder}/ota_data_initial.bin`, offset: 0x21a000, size: 8192, sha256: hash(4) },
    ],
  };
}

const index = (boards: unknown[]) => ({ format: 1, built: '2026-11-07T00:00:00Z', boards });

test('md5Hex matches node:crypto across block boundaries', () => {
  const random = new Uint8Array(100_003).map((_, i) => (i * 2654435761) >>> 24);
  for (const length of [0, 1, 55, 56, 63, 64, 65, 1000, random.length]) {
    const data = random.subarray(0, length);
    assert.equal(md5Hex(data), createHash('md5').update(data).digest('hex'), `length ${length}`);
  }
});

test('the firmware index accepts a published build', () => {
  const parsed = parseIndex(index([heltec()]));
  assert.equal(parsed.boards[0].firmware, 'heltec-reaper-mesh-v0.11.1');
  assert.equal(versionOf(parsed.boards[0].firmware), 'v0.11.1');
});

test('the firmware index refuses anything unexpected', () => {
  const cases: [string, (b: BoardBuild) => unknown][] = [
    ['unknown board', b => ({ ...b, id: 'other-board' })],
    ['wrong chip', b => ({ ...b, chip: 'ESP32' })],
    ['wrong flash size', b => ({ ...b, flashSize: '4MB' })],
    [
      'moved offset',
      b => ({ ...b, images: b.images.map((i, n) => (n ? i : { ...i, offset: 0x1000 })) }),
    ],
    ['missing image', b => ({ ...b, images: b.images.slice(1) })],
    [
      'path escape',
      b => ({ ...b, images: b.images.map((i, n) => (n ? i : { ...i, path: '../x.bin' })) }),
    ],
    [
      'bad hash',
      b => ({ ...b, images: b.images.map((i, n) => (n ? i : { ...i, sha256: 'xyz' })) }),
    ],
    [
      'oversized image',
      b => ({ ...b, images: b.images.map((i, n) => (n ? i : { ...i, size: 0x300000 })) }),
    ],
    ['invalid firmware ID', b => ({ ...b, firmware: 'a b' })],
  ];
  for (const [name, change] of cases) {
    assert.throws(() => parseIndex(index([change(heltec())])), /Firmware index/, name);
  }
  assert.throws(() => parseIndex({ format: 2, built: '', boards: [] }), /unsupported format/);
});

test('downloads must match their published size and hash', async () => {
  const data = new TextEncoder().encode('firmware');
  const sha256 = createHash('sha256').update(data).digest('hex');
  const image = { path: 'a/b/c.bin', offset: 0, size: data.length, sha256 };
  await verifyImage(image, data);
  await assert.rejects(verifyImage({ ...image, size: 9 }, data), /bytes, expected 9/);
  await assert.rejects(verifyImage({ ...image, sha256: hash(5) }, data), /SHA-256/);
});

test('the connected chip and flash must match the chosen board', () => {
  const board = heltec();
  assert.equal(checkChip(board, 'ESP32-S3', 'ESP32-S3 (QFN56) (revision v0.2)', '8MB'), null);
  assert.match(checkChip(board, 'ESP32', 'ESP32-D0WDQ6-V3', '4MB')!, /ESP32 processor/);
  assert.match(checkChip(board, 'ESP32-S3', 'ESP32-S3', '4MB')!, /4MB flash/);
  assert.match(checkChip(board, 'ESP32-S3', 'ESP32-S3', undefined)!, /unknown amount/);
  const tbeam = {
    ...board,
    id: 'tbeam-v12',
    name: 'LILYGO T-Beam V1.2',
    chip: 'ESP32',
    flashSize: '4MB',
  };
  assert.equal(checkChip(tbeam, 'ESP32', 'ESP32-D0WDQ6-V3 (revision v3.1)', '4MB'), null);
  assert.match(checkChip(tbeam, 'ESP32', 'ESP32-PICO-D4', '4MB')!, /Unexpected ESP32 variant/);
});

test('secured ESP32-S3 boards are refused', () => {
  assert.equal(checkSecurityInfo({ flags: 0, flashCryptCnt: 0 }), null);
  assert.equal(checkSecurityInfo({ flags: 0, flashCryptCnt: 0b11 }), null); // Even: disabled.
  assert.match(
    checkSecurityInfo({ flags: 0, flashCryptCnt: 0b1 })!,
    /secure boot or flash encryption/,
  );
  assert.match(checkSecurityInfo({ flags: 1, flashCryptCnt: 0 })!, /secure boot/);
});

test('secured ESP32 boards are refused', () => {
  assert.equal(checkEsp32Efuses(0, 0, 0), null);
  // Unrelated bits (write protection, coding scheme, JTAG) are allowed.
  assert.equal(checkEsp32Efuses(0xffff, 0b1000011, 0), null);
  for (const [word0, word6, secureVersion] of [
    [1 << 20, 0, 0], // FLASH_CRYPT_CNT
    [0, 1 << 4, 0], // ABS_DONE_0
    [0, 1 << 5, 0], // ABS_DONE_1
    [0, 1 << 7, 0], // DISABLE_DL_ENCRYPT
    [0, 1 << 8, 0], // DISABLE_DL_DECRYPT
    [0, 1 << 9, 0], // DISABLE_DL_CACHE
    [1 << 18, 0, 0], // SECURE_VERSION read-protected
    [0, 0, 1], // SECURE_VERSION set
  ]) {
    assert.ok(checkEsp32Efuses(word0, word6, secureVersion), `${word0} ${word6} ${secureVersion}`);
  }
});
