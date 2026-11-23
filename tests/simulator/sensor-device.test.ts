import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FrameDecoder, SENSOR_ENVELOPE } from '../../packages/protocol/framing.ts';
import {
  Band,
  checkSensorMessage,
  decodeSensorMessage,
  encodeSensorFrame,
  Profile,
  RemoteIdTransport,
  SensorCapability,
  type SensorMessage,
} from '../../packages/protocol/sensor-messages.ts';
import {
  DEFAULT_PLAN,
  OUTBOX_LIMIT,
  SimulatedSensor,
} from '../../packages/simulator/sensor-device.ts';

type Of<T extends SensorMessage['type']> = Extract<SensorMessage, { type: T }>;

function read(sensor: SimulatedSensor) {
  const messages: SensorMessage[] = [];
  new FrameDecoder(SENSOR_ENVELOPE).feed(sensor.read(), payload =>
    messages.push(decodeSensorMessage(payload)),
  );
  return messages;
}
const only = <T extends SensorMessage['type']>(messages: SensorMessage[], type: T) =>
  messages.filter((message): message is Of<T> => message.type === type);

function connect(now = 0) {
  const sensor = new SimulatedSensor();
  sensor.write(
    encodeSensorFrame({ type: 'hello', link: 'link-A', minVersion: 1, maxVersion: 1 }),
    now,
  );
  const [welcome] = read(sensor);
  return { sensor, welcome: welcome as Of<'welcome'> };
}
function plan(sensor: SimulatedSensor, now: number, changes: Partial<Of<'planSet'>>) {
  sensor.write(
    encodeSensorFrame({
      type: 'planSet',
      boot: sensor.boot,
      request: 7,
      ...DEFAULT_PLAN,
      ...changes,
    }),
    now,
  );
  return only(read(sensor), 'planStatus')[0];
}

test('the add-on stays silent until a hello, then identifies itself', () => {
  const sensor = new SimulatedSensor();
  sensor.tick(5000);
  assert.equal(sensor.read().length, 0);
  const { welcome } = connect();
  assert.equal(welcome.type, 'welcome');
  assert.equal(welcome.link, 'link-A');
  assert.equal(welcome.minVersion, 1);
  assert.equal(welcome.maxFrame, 512);
  assert.ok(welcome.capabilities & SensorCapability.remoteId);
  assert.ok(welcome.capabilities & SensorCapability.wifi5);
});

test('reports decode, pass their checks, and leave probe capture off by default', () => {
  const { sensor } = connect();
  sensor.tick(0);
  const messages = read(sensor);
  for (const message of messages)
    assert.equal(checkSensorMessage(message), undefined, message.type);
  assert.equal(only(messages, 'status').length, 1);
  assert.equal(only(messages, 'wifiAp').length, 3);
  assert.equal(only(messages, 'bleDevice').length, 2);
  assert.equal(only(messages, 'remoteId').length, 1);
  assert.equal(only(messages, 'wifiProbe').length, 0);
  const hidden = only(messages, 'wifiAp').find(ap => ap.hidden === 1)!;
  assert.equal(hidden.ssid, '');
});

test('a plan is applied whole and echoed back', () => {
  const { sensor } = connect();
  const status = plan(sensor, 0, { probes: 1, bands: Band.ghz24, channels: '01060b' });
  assert.equal(status.state, 'applied');
  assert.equal(status.request, 7);
  assert.equal(status.probes, 1);
  assert.equal(status.channels, '01060b');
  sensor.tick(0);
  const messages = read(sensor);
  assert.equal(only(messages, 'wifiProbe').length, 3);
  // Field Net is on 5 GHz channel 36, which this plan does not listen to.
  assert.deepEqual(
    only(messages, 'wifiAp').map(ap => ap.channel),
    [6, 11],
  );
  // Repeating the same plan is harmless.
  assert.equal(
    plan(sensor, 10, { probes: 1, bands: Band.ghz24, channels: '01060b' }).state,
    'applied',
  );
});

test('stale, invalid and unsupported plans change nothing', () => {
  const { sensor } = connect();
  sensor.write(
    encodeSensorFrame({
      type: 'planSet',
      boot: 'boot-old',
      request: 1,
      ...DEFAULT_PLAN,
      probes: 1,
    }),
    0,
  );
  const [stale] = only(read(sensor), 'planStatus');
  assert.equal(stale.state, 'invalid');
  assert.equal(stale.probes, 0);
  assert.equal(plan(sensor, 0, { dwell: 1 }).state, 'invalid');
  assert.equal(plan(sensor, 0, { profile: 9 }).state, 'unsupported');
  sensor.capabilities &= ~SensorCapability.probeCapture;
  assert.equal(plan(sensor, 0, { probes: 1 }).state, 'unsupported');
  assert.deepEqual(sensor.plan, DEFAULT_PLAN);
});

test('the drones profile reports only Remote ID, over Wi-Fi when Bluetooth is off', () => {
  const { sensor } = connect();
  plan(sensor, 0, { profile: Profile.drones, bluetooth: 0 });
  sensor.tick(0);
  const messages = read(sensor).filter(message => message.type !== 'status');
  assert.deepEqual(
    messages.map(message => message.type),
    ['remoteId'],
  );
  assert.equal((messages[0] as Of<'remoteId'>).transport, RemoteIdTransport.wifiBeacon);
});

test('the drone flies a 200 m circle and its heading follows its track', () => {
  const { sensor } = connect();
  const fixes: Of<'remoteId'>[] = [];
  for (let now = 0; now <= 4000; now += 1000) {
    sensor.tick(now);
    fixes.push(...only(read(sensor), 'remoteId'));
  }
  assert.equal(fixes.length, 5);
  const metres = (a: number, b: number) => ((a - b) / 1e7) * 111_320;
  for (const fix of fixes) {
    const north = metres(fix.latitude!, fix.operatorLatitude!);
    const east = metres(fix.longitude!, fix.operatorLongitude!) * Math.cos((39 * Math.PI) / 180);
    assert.ok(Math.abs(Math.hypot(north, east) - 200) < 1, 'stays on the circle');
  }
  const [a, b] = fixes;
  const north = metres(b.latitude!, a.latitude!);
  const east = metres(b.longitude!, a.longitude!) * Math.cos((39 * Math.PI) / 180);
  const course = ((Math.atan2(east, north) * 180) / Math.PI + 360) % 360;
  const heading = a.heading! / 100;
  assert.ok(
    Math.abs(((course - heading + 540) % 360) - 180) < 5,
    `course ${course} heading ${heading}`,
  );
});

test('unread reports are bounded and the drops are counted', () => {
  const { sensor } = connect();
  for (let now = 0; now < 30_000; now += 1000) sensor.tick(now);
  const messages = read(sensor);
  assert.equal(messages.length, OUTBOX_LIMIT);
  sensor.tick(30_000);
  const [status] = only(read(sensor), 'status');
  assert.ok(status.dropped > 0);
});

test('a restart ends the session and changes the boot ID', () => {
  const { sensor } = connect();
  const before = sensor.boot;
  plan(sensor, 0, { probes: 1 });
  sensor.reboot(1000);
  assert.notEqual(sensor.boot, before);
  assert.deepEqual(sensor.plan, DEFAULT_PLAN);
  sensor.tick(2000);
  assert.equal(sensor.read().length, 0);
  sensor.write(
    encodeSensorFrame({ type: 'hello', link: 'link-B', minVersion: 1, maxVersion: 1 }),
    2000,
  );
  assert.equal((read(sensor)[0] as Of<'welcome'>).boot, sensor.boot);
});

test('the scene is deterministic', () => {
  const run = () => {
    const { sensor } = connect();
    for (let now = 0; now < 5000; now += 500) sensor.tick(now);
    return sensor.read();
  };
  assert.deepEqual(run(), run());
});
