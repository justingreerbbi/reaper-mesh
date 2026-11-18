/**
 * Installs the Seeed SenseCAP T1000-E (D57) through its Adafruit nRF52 bootloader's serial DFU:
 * Nordic's SDK 11 serial protocol, SLIP-framed HCI packets each acknowledged by the bootloader, as
 * Adafruit's adafruit-nrfutil speaks it. Only the application is ever written. The bootloader and
 * SoftDevice are never touched, so a failed install can always be retried.
 *
 * The bootloader erases only the pages an image needs, starting at APP_START. An update sends the
 * application alone, so the settings, key and Bluetooth areas after it survive. A first install
 * over other firmware sends it padded with 0xff up to DATA_END, which blanks those areas: Reaper
 * never erases storage it cannot read. The layout matches firmware/t1000-e (t1000_e.dts) and
 * tools/t1000e-package.py.
 */

export const APP_START = 0x27000;
/**
 * reaper_nvs, reaper_keys and Bluetooth storage end here. It is also the end of what serial DFU
 * can write: on the nRF52840 the bootloader keeps the last 40 KB before itself (0xf4000) for app
 * data, so a first-install image is exactly its largest image.
 */
export const DATA_END = 0xea000;
/** Adafruit's bootloader refuses any other device type. */
export const ADAFRUIT_DEVICE_TYPE = 0x0052;
/** The firmware ID of SoftDevice S140 v7.3.0, which the T1000-E ships with. */
export const S140_V7_3_0 = 0x0123;

/**
 * USB IDs the T1000-E shows. Seeed's bootloader uses Seeed's vendor ID and Adafruit's bootloader
 * product ID; Meshtastic and other Arduino-core firmware use Adafruit's. Reaper's are Zephyr's
 * development IDs until it has its own.
 */
export const USB = {
  bootloaders: [
    { usbVendorId: 0x2886, usbProductId: 0x0057 },
    { usbVendorId: 0x239a, usbProductId: 0x0057 },
  ],
  reaper: { usbVendorId: 0x2fe3, usbProductId: 0x0004 },
  /** Everything the chooser offers: any Seeed or Adafruit-ID device, and Reaper. */
  choose: [
    { usbVendorId: 0x2886 },
    { usbVendorId: 0x239a },
    { usbVendorId: 0x2fe3, usbProductId: 0x0004 },
  ],
} as const;

/** What is on the port the person picked, from its USB IDs. */
export type Running = 'bootloader' | 'reaper' | 'other';
export function runningOn(info: { usbVendorId?: number; usbProductId?: number }): Running {
  const is = (ids: { usbVendorId: number; usbProductId: number }) =>
    info.usbVendorId === ids.usbVendorId && info.usbProductId === ids.usbProductId;
  if (USB.bootloaders.some(is)) return 'bootloader';
  if (is(USB.reaper)) return 'reaper';
  return 'other';
}

const PACKET_BYTES = 512;
const PAGE_BYTES = 4096;
const PAGE_ERASE_MS = 89.7;
const PAGE_WRITE_MS = (PAGE_BYTES / 4) * 0.1;
const ACK_TIMEOUT_MS = 1000;
const ATTEMPTS = 3;

/** Nordic's crc16_compute: CRC-16/CCITT-FALSE. Used for packets and the image check. */
export function crc16(data: Uint8Array, crc = 0xffff): number {
  for (const byte of data) {
    crc = ((crc >>> 8) & 0xff) | ((crc << 8) & 0xff00);
    crc ^= byte;
    crc ^= (crc & 0xff) >>> 4;
    crc ^= (crc << 12) & 0xffff;
    crc ^= ((crc & 0xff) << 5) & 0xffff;
  }
  return crc & 0xffff;
}

function u16(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff];
}
function u32(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
}

/** One HCI packet with sequence number `seq` (0-7), CRC and SLIP framing. */
export function hciPacket(seq: number, payload: Uint8Array): Uint8Array {
  const length = payload.length;
  // Data integrity check and reliable packet set; type 14 is vendor specific.
  const header = [
    seq | (((seq + 1) % 8) << 3) | (1 << 6) | (1 << 7),
    14 | ((length & 0x0f) << 4),
    (length >>> 4) & 0xff,
  ];
  header.push((~(header[0] + header[1] + header[2]) + 1) & 0xff);
  const body = new Uint8Array(4 + length + 2);
  body.set(header);
  body.set(payload, 4);
  const crc = crc16(body.subarray(0, 4 + length));
  body.set(u16(crc), 4 + length);
  const out = [0xc0];
  for (const byte of body) {
    if (byte === 0xc0) out.push(0xdb, 0xdc);
    else if (byte === 0xdb) out.push(0xdb, 0xdd);
    else out.push(byte);
  }
  out.push(0xc0);
  return new Uint8Array(out);
}

/** The acknowledgment number in one SLIP frame from the bootloader, or null if it is not one. */
export function ackNumber(frame: Uint8Array): number | null {
  const bytes: number[] = [];
  for (let i = 0; i < frame.length; i++) {
    const byte = frame[i];
    if (byte === 0xc0) continue;
    if (byte === 0xdb) {
      const next = frame[++i];
      if (next === 0xdc) bytes.push(0xc0);
      else if (next === 0xdd) bytes.push(0xdb);
      else return null;
    } else bytes.push(byte);
  }
  return bytes.length >= 1 ? (bytes[0] >>> 3) & 0x07 : null;
}

/** The DFU init packet: device type, any revision and version, S140 v7.3.0, the image's CRC16. */
export function initPacket(image: Uint8Array): Uint8Array {
  return new Uint8Array([
    ...u16(ADAFRUIT_DEVICE_TYPE),
    ...u16(0xffff),
    ...u32(0xffffffff),
    ...u16(1),
    ...u16(S140_V7_3_0),
    ...u16(crc16(image)),
  ]);
}

const op = (code: number, ...rest: number[][]) => new Uint8Array([...u32(code), ...rest.flat()]);
/** Start: mode 4 (application), then SoftDevice, bootloader and application sizes. */
export const startPayload = (size: number) => op(3, u32(4), u32(0), u32(0), u32(size));
export const initPayload = (image: Uint8Array) => op(1, [...initPacket(image)], u16(0));
export const dataPayload = (chunk: Uint8Array) => op(4, [...chunk]);
export const stopPayload = () => op(5);

/** What to send: the application, padded to DATA_END for a first install. */
export function dfuImage(app: Uint8Array, fresh: boolean): Uint8Array {
  const limit = DATA_END - APP_START;
  if (!app.length || app.length > limit) throw new Error('The T1000-E image has the wrong size.');
  if (!fresh) return app;
  const image = new Uint8Array(limit).fill(0xff);
  image.set(app);
  return image;
}

/** How long the bootloader needs to erase the pages for `size` bytes, as adafruit-nrfutil waits. */
export function eraseWaitMs(size: number): number {
  return Math.max(500, (Math.floor(size / PAGE_BYTES) + 1) * PAGE_ERASE_MS);
}

/** A byte stream to the bootloader. `read` returns null when nothing arrives before the timeout. */
export interface ByteLink {
  write(bytes: Uint8Array): Promise<void>;
  read(timeoutMs: number): Promise<Uint8Array | null>;
}

export interface DfuProgress {
  (stage: 'erasing' | 'writing' | 'finishing', fraction: number): void;
}

/** Sends `image` to a bootloader in serial DFU mode. Throws if it stops acknowledging. */
export async function sendDfu(
  link: ByteLink,
  image: Uint8Array,
  progress: DfuProgress,
  sleep: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms)),
): Promise<void> {
  let seq = 0;
  let pending: number[] = [];
  // Reads until one complete frame (two delimiters) arrives, or the timeout passes.
  const nextFrame = async (): Promise<Uint8Array | null> => {
    const deadline = Date.now() + ACK_TIMEOUT_MS;
    for (;;) {
      const start = pending.indexOf(0xc0);
      const end = start < 0 ? -1 : pending.indexOf(0xc0, start + 1);
      if (end > start + 1) {
        const frame = new Uint8Array(pending.slice(start, end + 1));
        pending = pending.slice(end + 1);
        return frame;
      }
      if (end === start + 1) pending = pending.slice(end); // An empty frame: resynchronize.
      const left = deadline - Date.now();
      if (left <= 0) return null;
      const bytes = await link.read(left);
      if (bytes) pending.push(...bytes);
    }
  };
  const send = async (payload: Uint8Array) => {
    seq = (seq + 1) % 8;
    const packet = hciPacket(seq, payload);
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      await link.write(packet);
      const frame = await nextFrame();
      // The bootloader drops a repeated sequence number, so resending is safe.
      if (frame && ackNumber(frame) === (seq + 1) % 8) return;
    }
    throw new Error('The T1000-E bootloader stopped answering.');
  };
  await send(startPayload(image.length));
  progress('erasing', 0);
  await sleep(eraseWaitMs(image.length));
  await send(initPayload(image));
  const packets = Math.ceil(image.length / PACKET_BYTES);
  for (let i = 0; i < packets; i++) {
    await send(dataPayload(image.subarray(i * PACKET_BYTES, (i + 1) * PACKET_BYTES)));
    // Give the bootloader time to write each page, as adafruit-nrfutil does.
    if (i % 8 === 0) await sleep(PAGE_WRITE_MS);
    progress('writing', (i + 1) / packets);
  }
  await sleep(PAGE_WRITE_MS);
  progress('finishing', 1);
  await send(stopPayload());
}
