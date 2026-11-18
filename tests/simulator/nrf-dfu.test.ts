import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  APP_START,
  DATA_END,
  type ByteLink,
  ackNumber,
  crc16,
  dfuImage,
  eraseWaitMs,
  hciPacket,
  initPacket,
  runningOn,
  sendDfu,
  startPayload,
} from '../../agents/flasher/nrf-dfu.ts';

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');

// Expected bytes come from Adafruit's adafruit-nrfutil algorithms (crc16.py, util.py and
// dfu_transport_serial.py), run separately in Python.
test('crc16 is Nordic crc16_compute', () => {
  assert.equal(crc16(new TextEncoder().encode('123456789')), 0x29b1);
  const image = new Uint8Array(768).map((_, i) => i & 0xff);
  assert.equal(crc16(image), 0xd51a);
});

test('HCI packets match adafruit-nrfutil, including SLIP escapes', () => {
  assert.equal(
    hex(hciPacket(1, startPayload(0x387f4))),
    'c0d14e01e003000000040000000000000000000000f48703004e11c0',
  );
  assert.equal(
    hex(hciPacket(7, new Uint8Array([0xc0, 0xdb, 4, 0, 0, 0]))),
    'c0c76e00cbdbdcdbdd040000005972c0',
  );
});

test('acknowledgments are read from SLIP frames', () => {
  assert.equal(ackNumber(new Uint8Array([0xc0, 0x10, 0x0e, 0, 0xe2, 0xc0])), 2);
  assert.equal(ackNumber(new Uint8Array([0xc0, 0xdb, 0xdc, 0xc0])), 0); // escaped 0xc0
  assert.equal(ackNumber(new Uint8Array([0xc0, 0xdb, 0x00, 0xc0])), null);
});

test('the init packet names the Adafruit device, S140 v7.3.0 and the image CRC', () => {
  const image = new Uint8Array(768).map((_, i) => i & 0xff);
  assert.equal(hex(initPacket(image)), '5200ffffffffffff010023011ad5');
});

test('an update sends the application only; a first install blanks the data areas', () => {
  const app = new Uint8Array(1000).fill(7);
  assert.equal(dfuImage(app, false), app);
  const fresh = dfuImage(app, true);
  assert.equal(fresh.length, DATA_END - APP_START);
  assert.deepEqual(fresh.subarray(0, 1000), app);
  assert.ok(fresh.subarray(1000).every(byte => byte === 0xff));
  assert.throws(() => dfuImage(new Uint8Array(0), false));
  assert.throws(() => dfuImage(new Uint8Array(DATA_END - APP_START + 1), false));
  assert.equal(eraseWaitMs(100), 500);
  assert.ok(eraseWaitMs(DATA_END - APP_START) > 17_000);
});

test('the port tells a running Reaper, the bootloader and other firmware apart', () => {
  assert.equal(runningOn({ usbVendorId: 0x2886, usbProductId: 0x0057 }), 'bootloader'); // Seeed
  assert.equal(runningOn({ usbVendorId: 0x239a, usbProductId: 0x0057 }), 'bootloader'); // Adafruit
  assert.equal(runningOn({ usbVendorId: 0x2fe3, usbProductId: 0x0004 }), 'reaper');
  assert.equal(runningOn({ usbVendorId: 0x239a, usbProductId: 0x8029 }), 'other');
  assert.equal(runningOn({}), 'other');
});

/** A bootloader that decodes each packet, acknowledges it and records what it received. */
class Bootloader implements ByteLink {
  received: { type: number; payload: Uint8Array }[] = [];
  private queue: Uint8Array[] = [];
  private lastSeq = -1;
  dropNextAck = false;
  silent = false;
  async write(bytes: Uint8Array) {
    assert.equal(bytes[0], 0xc0);
    assert.equal(bytes[bytes.length - 1], 0xc0);
    const body: number[] = [];
    for (let i = 1; i < bytes.length - 1; i++) {
      if (bytes[i] === 0xdb) body.push(bytes[++i] === 0xdc ? 0xc0 : 0xdb);
      else body.push(bytes[i]);
    }
    const data = new Uint8Array(body);
    const length = (data[1] >>> 4) | (data[2] << 4);
    assert.equal(data.length, 4 + length + 2);
    assert.equal((data[0] + data[1] + data[2] + data[3]) & 0xff, 0, 'header checksum');
    const crc = crc16(data.subarray(0, 4 + length));
    assert.equal(data[4 + length] | (data[5 + length] << 8), crc, 'packet CRC');
    const seq = data[0] & 0x07;
    if (this.silent) return;
    // Like the real HCI layer, a repeated sequence number is acknowledged but not processed again.
    if (seq !== this.lastSeq) {
      const payload = data.subarray(4, 4 + length);
      this.received.push({ type: payload[0], payload: payload.subarray(4) });
      this.lastSeq = seq;
    }
    if (this.dropNextAck) {
      this.dropNextAck = false;
      return;
    }
    const ack = ((seq + 1) % 8) << 3;
    this.queue.push(new Uint8Array([0xc0, ack, 0x0e, 0x00, (0x100 - ack - 0x0e) & 0xff, 0xc0]));
  }
  async read() {
    return this.queue.shift() ?? null;
  }
}

test('a DFU sends start, init, the image in 512-byte packets and stop, each acknowledged', async () => {
  const app = new Uint8Array(1300).map((_, i) => (i * 7) & 0xff);
  const bootloader = new Bootloader();
  const stages: string[] = [];
  const waits: number[] = [];
  await sendDfu(
    bootloader,
    app,
    stage => stages.push(stage),
    async ms => void waits.push(ms),
  );
  assert.deepEqual(
    bootloader.received.map(packet => packet.type),
    [3, 1, 4, 4, 4, 5],
  );
  const [start, init, ...rest] = bootloader.received;
  assert.equal(hex(start.payload), `04000000000000000000000014050000`);
  assert.equal(hex(init.payload), `${hex(initPacket(app))}0000`);
  const data = Buffer.concat(rest.slice(0, 3).map(packet => packet.payload));
  assert.deepEqual(new Uint8Array(data), app);
  assert.equal(waits[0], 500); // Erasing before the init packet.
  assert.deepEqual([...new Set(stages)], ['erasing', 'writing', 'finishing']);
});

test('a lost acknowledgment is retried without duplicating data', async () => {
  const app = new Uint8Array(2048).fill(1);
  const bootloader = new Bootloader();
  bootloader.dropNextAck = true;
  await sendDfu(
    bootloader,
    app,
    () => {},
    async () => {},
  );
  assert.deepEqual(
    bootloader.received.map(packet => packet.type),
    [3, 1, 4, 4, 4, 4, 5],
  );
});

test('a bootloader that stops answering ends the install with an error', async () => {
  const bootloader = new Bootloader();
  bootloader.silent = true;
  const read = bootloader.read.bind(bootloader);
  // No acknowledgments arrive; time out quickly instead of waiting a second per attempt.
  bootloader.read = async () => {
    await new Promise(resolve => setTimeout(resolve, 5));
    return read();
  };
  const realNow = Date.now;
  let now = 0;
  Date.now = () => (now += 400);
  try {
    await assert.rejects(
      sendDfu(
        bootloader,
        new Uint8Array(10),
        () => {},
        async () => {},
      ),
      /stopped answering/,
    );
  } finally {
    Date.now = realNow;
  }
});
