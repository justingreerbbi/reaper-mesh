import { test } from 'node:test';
import assert from 'node:assert/strict';
import sensorSchema from '../../packages/protocol/sensor-schema.json' with { type: 'json' };
import fixtures from '../../packages/protocol/fixtures/sensor-messages-v1.json' with { type: 'json' };
import envelope from '../../packages/protocol/fixtures/sensor-envelope-v1.json' with { type: 'json' };
import {
  checkSensorMessage,
  decodeSensorFrame,
  decodeSensorMessage,
  encodeSensorFrame,
  encodeSensorMessage,
  type SensorMessage,
} from '../../packages/protocol/sensor-messages.ts';
import { decodeMessage, encodeMessage } from '../../packages/protocol/messages.ts';
import {
  cobsDecode,
  decodeFrame,
  encodeFrame,
  FrameDecoder,
  maxEncoded,
  NODE_ENVELOPE,
  SENSOR_ENVELOPE,
} from '../../packages/protocol/framing.ts';

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');
const bytes = (value: string) => Uint8Array.from(Buffer.from(value, 'hex'));
const messages = fixtures.map(fixture => fixture.message as SensorMessage);
const find = <T extends SensorMessage['type']>(type: T) =>
  messages.find(message => message.type === type) as Extract<SensorMessage, { type: T }>;

test('every sensor message type has a frozen fixture', () => {
  assert.deepEqual(
    [...new Set(messages.map(message => message.type))].sort(),
    Object.keys(sensorSchema).sort(),
  );
});

test('fixtures keep their exact bytes and round-trip to frozen objects', () => {
  for (const fixture of fixtures) {
    const message = fixture.message as SensorMessage;
    assert.equal(hex(encodeSensorMessage(message)), fixture.payloadHex);
    assert.equal(hex(encodeSensorFrame(message)), fixture.frameHex);
    const decoded = decodeSensorFrame(bytes(fixture.frameHex).subarray(0, -1));
    assert.deepEqual(decoded, message);
    assert.ok(Object.isFrozen(decoded));
    assert.equal(checkSensorMessage(decoded), undefined, `${message.type} passes its checks`);
  }
});

test('the RS envelope matches an independently computed checksum', () => {
  const frame = encodeFrame(bytes(envelope.payloadHex), SENSOR_ENVELOPE);
  assert.equal(hex(frame), envelope.frameHex);
  assert.equal(hex(cobsDecode(frame.subarray(0, -1))), envelope.rawHex);
});

test('node and sensor envelopes reject each other', () => {
  const sensor = encodeSensorFrame(find('hello')).subarray(0, -1);
  const node = encodeFrame(
    encodeMessage({ type: 'hello', link: 'link-A', minVersion: 1, maxVersion: 1 }),
  ).subarray(0, -1);
  assert.throws(() => decodeFrame(sensor), /unsupported envelope/);
  assert.throws(() => decodeFrame(node, SENSOR_ENVELOPE), /unsupported envelope/);
  assert.equal(decodeMessage(decodeFrame(node, NODE_ENVELOPE)).type, 'hello');
  const counts = new FrameDecoder(SENSOR_ENVELOPE).feed(
    Uint8Array.from([...node, 0, ...sensor, 0]),
    payload => assert.equal(decodeSensorMessage(payload).type, 'hello'),
  );
  assert.deepEqual(counts, { accepted: 1, rejected: 1 });
});

test('sensor payloads are limited to 512 bytes', () => {
  assert.equal(maxEncoded(SENSOR_ENVELOPE.maxPayload), 525);
  assert.doesNotThrow(() => encodeFrame(new Uint8Array(512).fill(1), SENSOR_ENVELOPE));
  assert.throws(() => encodeFrame(new Uint8Array(513).fill(1), SENSOR_ENVELOPE), /payload length/);
  const oversized = encodeFrame(new Uint8Array(513).fill(1)).subarray(0, -1);
  assert.throws(() => decodeFrame(oversized, { ...SENSOR_ENVELOPE, magic: 0x4d }), /length/);
  const padded = encodeSensorMessage(find('status'));
  const padding = 513 - padded.length - 3;
  const tooLong = Uint8Array.from([
    ...padded,
    200,
    padding & 255,
    padding >> 8,
    ...new Uint8Array(padding),
  ]);
  assert.throws(() => decodeSensorMessage(tooLong), /unsupported payload/);
  // A stream longer than the sensor buffer is discarded up to the next delimiter.
  const decoder = new FrameDecoder(SENSOR_ENVELOPE);
  const valid = encodeSensorFrame(find('hello'));
  let accepted = 0;
  const counts = decoder.feed(
    Uint8Array.from([...new Uint8Array(600).fill(1), 0, ...valid]),
    () => accepted++,
  );
  assert.deepEqual(counts, { accepted: 1, rejected: 1 });
  assert.equal(accepted, 1);
});

test('i32 fields carry negative values and reject out-of-range numbers', () => {
  const ap = find('wifiAp');
  for (const rssi of [-128, -1, 0, 127]) {
    const value = { ...ap, rssi, rssiMin: Math.min(rssi, ap.rssiMin), rssiMax: 127 };
    assert.equal((decodeSensorMessage(encodeSensorMessage(value)) as typeof ap).rssi, rssi);
  }
  const drone = find('remoteId');
  for (const latitude of [-0x80000000, 0x7fffffff])
    assert.equal(
      (decodeSensorMessage(encodeSensorMessage({ ...drone, latitude })) as typeof drone).latitude,
      latitude,
    );
  for (const rssi of [-0x80000001, 0x80000000, 1.5, Number.NaN])
    assert.throws(() => encodeSensorMessage({ ...ap, rssi }), /signed integer/);
});

test('bytes fields are lowercase hex of up to 64 bytes, and may be empty', () => {
  const probe = find('wifiProbe');
  for (const ssid of ['', 'ab'.repeat(64)])
    assert.equal(
      (decodeSensorMessage(encodeSensorMessage({ ...probe, ssid })) as typeof probe).ssid,
      ssid,
    );
  for (const ssid of ['ab'.repeat(65), 'abc', 'AB', 'zz'])
    assert.throws(() => encodeSensorMessage({ ...probe, ssid }), /invalid bytes/);
  // Raw bytes on the wire: a 65-byte field is refused when decoding too.
  const payload = encodeSensorMessage({ ...probe, ssid: undefined });
  const tag = Object.keys(sensorSchema.wifiProbe.fields).indexOf('ssid') + 1;
  const field = Uint8Array.from([tag, 65, 0, ...new Uint8Array(65)]);
  assert.throws(
    () => decodeSensorMessage(Uint8Array.from([...payload, ...field])),
    /invalid bytes/,
  );
});

test('optional, unknown and reordered fields stay compatible', () => {
  const device = find('bleDevice');
  const minimal = messages.filter(message => message.type === 'bleDevice')[1];
  assert.equal(
    (decodeSensorMessage(encodeSensorMessage(minimal)) as typeof device).name,
    undefined,
  );
  const payload = encodeSensorMessage(device);
  const fields: Uint8Array[] = [];
  for (let cursor = 2; cursor < payload.length;) {
    const length = payload[cursor + 1] | (payload[cursor + 2] << 8);
    fields.push(payload.subarray(cursor, cursor + 3 + length));
    cursor += 3 + length;
  }
  const unknown = Uint8Array.of(99, 2, 0, 0xaa, 0xbb);
  const reordered = Uint8Array.from([
    ...payload.subarray(0, 2),
    ...unknown,
    ...fields.reverse().flatMap(field => [...field]),
  ]);
  assert.deepEqual(decodeSensorMessage(reordered), device);
  const duplicate = Uint8Array.from([...payload, ...fields[0]]);
  assert.throws(() => decodeSensorMessage(duplicate), /invalid field/);
  const { address: _address, ...missing } = device;
  assert.throws(() => encodeSensorMessage(missing as SensorMessage), /invalid string/);
});

test('version ranges must not be inverted', () => {
  assert.throws(() => encodeSensorMessage({ ...find('hello'), minVersion: 2 }), /version range/);
  assert.throws(() => encodeSensorMessage({ ...find('welcome'), minVersion: 2 }), /version range/);
});

test('semantic checks catch values the codec cannot', () => {
  const cases: [SensorMessage, string][] = [
    [{ ...find('wifiAp'), address: 'aabb' }, 'invalid address'],
    [{ ...find('wifiAp'), ssid: 'ab'.repeat(33) }, 'invalid SSID'],
    [{ ...find('wifiAp'), rssi: -129 }, 'invalid RSSI'],
    [{ ...find('wifiAp'), rssiMin: -50, rssiMax: -60 }, 'invalid RSSI range'],
    [{ ...find('wifiProbe'), ssid: 'ab'.repeat(33) }, 'invalid SSID'],
    [{ ...find('bleDevice'), manufacturer: 0x10000 }, 'invalid manufacturer'],
    [{ ...find('bleDevice'), services: '0d' }, 'invalid services'],
    [{ ...find('remoteId'), uasId: '' }, 'invalid UAS ID'],
    [{ ...find('remoteId'), latitude: 900_000_001 }, 'invalid latitude'],
    [{ ...find('remoteId'), longitude: -1_800_000_001 }, 'invalid longitude'],
    [{ ...find('remoteId'), longitude: undefined }, 'incomplete position'],
    [{ ...find('remoteId'), operatorLongitude: undefined }, 'incomplete operator position'],
    [{ ...find('remoteId'), heading: 36_000 }, 'invalid heading'],
    [{ ...find('planSet'), bands: 0 }, 'no bands'],
    [{ ...find('planSet'), dwell: 5 }, 'invalid dwell'],
    [{ ...find('planSet'), probes: 2 }, 'invalid switch'],
    [{ ...find('planSet'), channels: '' }, 'empty channel list'],
  ];
  for (const [message, problem] of cases) assert.equal(checkSensorMessage(message), problem);
});

test('code values this agent does not know pass, so newer add-ons keep working', () => {
  const unknown: SensorMessage[] = [
    { ...find('wifiAp'), band: 4, security: 0xff },
    { ...find('bleDevice'), phy: 9, addressType: 7, tracker: 99 },
    { ...find('remoteId'), transport: 9, idType: 200, uaType: 200 },
    { ...find('planStatus'), state: 'paused', bands: 4, profile: 12 },
    { ...find('status'), band: 4 },
  ];
  for (const message of unknown) assert.equal(checkSensorMessage(message), undefined, message.type);
});
