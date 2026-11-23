import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NEGOTIATE_MS,
  SensorLink,
  SensorStore,
  STALL_MS,
  STORE_LIMITS,
  type WifiAp,
} from '../../packages/agent-core/sensor.ts';
import { SensorSerial } from '../../packages/agent-core/sensor-serial.ts';
import { encodeSensorFrame } from '../../packages/protocol/sensor-messages.ts';
import { DEFAULT_PLAN, SimulatedSensor } from '../../packages/simulator/sensor-device.ts';

/** Moves bytes both ways between a link and a simulated add-on on one manual clock. */
function bench(options: { dropHellos?: number } = {}) {
  const sensor = new SimulatedSensor();
  let wall = 1_000_000;
  const link = new SensorLink(() => wall);
  let now = 0;
  let dropped = 0;
  const step = (ms = 100) => {
    now += ms;
    wall += ms;
    link.tick(now);
    for (const frame of link.drain()) {
      if (frame.length > 1 && dropped < (options.dropHellos ?? 0)) {
        dropped++; // Lost while the add-on was still starting.
        continue;
      }
      sensor.write(frame, now);
    }
    sensor.tick(now);
    const bytes = sensor.read();
    if (bytes.length) link.feed(bytes, now);
  };
  link.open('link-A', now);
  return { sensor, link, step, at: () => now };
}

test('a session becomes ready and fills the store', () => {
  const { link, step } = bench();
  assert.equal(link.state, 'negotiating');
  step();
  assert.equal(link.state, 'ready');
  assert.equal(link.identity?.firmware, 'sim-0');
  step();
  assert.equal(link.store.wifiAps.size, 3);
  assert.equal(link.store.bleDevices.size, 2);
  assert.equal(link.store.drones.size, 1);
  assert.equal(link.store.wifiProbes.size, 0, 'probe capture is off by default');
  assert.ok(link.status && link.status.receivedAt > 0);
  assert.equal(link.invalid, 0);
});

test('hello is repeated while the add-on starts, then gives up', () => {
  const late = bench({ dropHellos: 3 });
  for (let i = 0; i < 20 && late.link.state !== 'ready'; i++) late.step();
  assert.equal(late.link.state, 'ready');
  const silent = new SensorLink();
  silent.open('link-B', 0);
  let hellos = 0;
  for (let now = 0; now <= NEGOTIATE_MS; now += 100) {
    silent.tick(now);
    hellos += silent.drain().filter(frame => frame.length > 1).length;
  }
  assert.equal(silent.state, 'timeout');
  assert.equal(hellos, NEGOTIATE_MS / 500);
});

test('plans apply, and probe capture can be turned on', () => {
  const { link, step } = bench();
  step();
  assert.equal(link.setPlan({ ...DEFAULT_PLAN, probes: 1 }), 1);
  step(1000);
  assert.equal(link.plan?.state, 'applied');
  assert.equal(link.plan?.probes, 1);
  step(1000);
  assert.equal(link.store.wifiProbes.size, 1);
  assert.equal(link.setPlan({ ...DEFAULT_PLAN, dwell: 1 }), 2);
  step();
  assert.equal(link.plan?.state, 'invalid');
  assert.equal(link.plan?.probes, 1, 'the plan in force stays');
});

test('a quiet add-on stalls, and a restart clears what it reported', () => {
  const { sensor, link, step, at } = bench();
  step();
  step();
  const before = link.identity!.boot;
  sensor.reboot(at()); // Silent until the next hello.
  for (let waited = 0; waited <= STALL_MS + 2000; waited += 100) step();
  assert.equal(link.state, 'stalled');
  assert.equal(link.store.wifiAps.size, 3, 'kept while stalled');
  link.open('link-C', at());
  step();
  assert.equal(link.state, 'ready');
  const boot = link.identity!.boot;
  assert.notEqual(boot, before);
  // Cleared for the new boot, then filled again by the restarted add-on in the same step.
  assert.equal(link.store.wifiAps.size, 3);
  for (const ap of link.store.wifiAps.values()) assert.equal(ap.boot, boot);
});

test('stale, incompatible and invalid messages are refused', () => {
  const link = new SensorLink();
  link.open('link-A', 0);
  const welcome = (overrides: object) =>
    encodeSensorFrame({
      type: 'welcome',
      link: 'link-A',
      sensor: 'sensor-x',
      boot: 'boot-1',
      minVersion: 1,
      maxVersion: 1,
      firmware: 'f',
      capabilities: 63,
      maxFrame: 512,
      ...overrides,
    });
  link.feed(welcome({ link: 'link-old' }), 0);
  assert.equal(link.state, 'negotiating');
  link.feed(welcome({}), 0);
  assert.equal(link.state, 'ready');
  const ap: WifiAp = {
    type: 'wifiAp',
    boot: 'boot-1',
    at: 1,
    address: '02a1b2c3d4e5',
    ssid: '',
    hidden: 1,
    channel: 6,
    band: 1,
    security: 4,
    rssi: -60,
    rssiMin: -70,
    rssiMax: -50,
    count: 1,
  };
  link.feed(encodeSensorFrame({ ...ap, boot: 'boot-old' }), 0);
  link.feed(encodeSensorFrame({ ...ap, address: 'aabb' }), 0);
  assert.equal(link.store.wifiAps.size, 0);
  assert.equal(link.invalid, 1);
  link.feed(Uint8Array.of(1, 2, 3, 0), 0);
  assert.ok(link.rejected >= 1);
  link.feed(encodeSensorFrame(ap), 0);
  assert.equal(link.store.wifiAps.size, 1);
  const newer = new SensorLink();
  newer.open('link-A', 0);
  newer.feed(welcome({ minVersion: 2, maxVersion: 3 }), 0);
  assert.equal(newer.state, 'incompatible');
  assert.equal(newer.setPlan(DEFAULT_PLAN), undefined);
});

test('the store is bounded and forgets the transmitter heard least recently', () => {
  const store = new SensorStore();
  const ap = (i: number): WifiAp => ({
    type: 'wifiAp',
    boot: 'b',
    at: i,
    address: i.toString(16).padStart(12, '0'),
    ssid: '',
    hidden: 0,
    channel: 1,
    band: 1,
    security: 0,
    rssi: -50,
    rssiMin: -50,
    rssiMax: -50,
    count: 1,
  });
  for (let i = 0; i <= STORE_LIMITS.wifiAp; i++) store.apply(ap(i), i);
  store.apply(ap(1), 9999); // Heard again, so it moves to the newest end.
  store.apply(ap(STORE_LIMITS.wifiAp + 1), 10_000);
  assert.equal(store.wifiAps.size, STORE_LIMITS.wifiAp);
  assert.ok(!store.wifiAps.has(ap(0).address) && !store.wifiAps.has(ap(2).address));
  assert.ok(store.wifiAps.has(ap(1).address));
});

test('the serial adapter runs a session over a simulated port and cleans up', async () => {
  const sensor = new SimulatedSensor();
  const serial = new SensorSerial(new SensorLink(), { newLink: () => 'link-serial' });
  let lost = 0;
  serial.onLost = () => lost++;
  await serial.connect(sensor.createPort());
  await assert.rejects(serial.connect(sensor.createPort()), /already connected/);
  for (let i = 0; i < 30 && serial.link.store.wifiAps.size < 3; i++)
    await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(serial.link.state, 'ready');
  assert.equal(serial.link.store.wifiAps.size, 3);
  await serial.disconnect();
  assert.equal(serial.link.state, 'closed');
  assert.equal(serial.port, undefined);
  assert.equal(lost, 0);
});
