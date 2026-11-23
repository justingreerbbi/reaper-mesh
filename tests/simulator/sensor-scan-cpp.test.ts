import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  checkSensorMessage,
  decodeSensorFrame,
  RemoteIdTransport,
  Security,
  Tracker,
  type SensorMessage,
} from '../../packages/protocol/sensor-messages.ts';

// The signals add-on's portable core (firmware/components/reaper_sensor), built with sanitizers.
const directory = mkdtempSync(join(tmpdir(), 'reaper-sensor-scan-'));
const binary = join(directory, 'sensor-scan-test');
after(() => rmSync(directory, { recursive: true, force: true }));
const sanitizers =
  process.platform === 'darwin' && process.env.REAPER_ASAN !== '1'
    ? 'undefined'
    : 'address,undefined';
execFileSync(
  process.env.CXX || 'c++',
  [
    '-std=c++17',
    '-O1',
    '-g',
    '-Wall',
    '-Wextra',
    '-Werror',
    '-pedantic',
    `-fsanitize=${sanitizers}`,
    '-fno-sanitize-recover=all',
    '-Ifirmware/components/reaper_protocol/include',
    '-Ifirmware/components/reaper_sensor/include',
    'firmware/components/reaper_protocol/protocol.cpp',
    'firmware/components/reaper_protocol/sensor_protocol.cpp',
    'firmware/components/reaper_sensor/sensor_parse.cpp',
    'firmware/components/reaper_sensor/sensor_scan.cpp',
    'firmware/tests/sensor_scan_test.cpp',
    '-o',
    binary,
  ],
  { stdio: 'pipe', timeout: 60000 },
);

for (const scenario of ['wifi', 'ble', 'remoteid', 'tracker', 'budget', 'scheduler', 'session'])
  test(`sensor core C++ ${scenario}`, () => {
    assert.equal(
      execFileSync(binary, [scenario], { encoding: 'utf8', timeout: 10000 }).trim(),
      `ok ${scenario}`,
    );
  });

test('reports from the C++ core decode in the agent and pass its checks', () => {
  const lines = execFileSync(binary, ['frames'], { encoding: 'utf8', timeout: 10000 })
    .trim()
    .split('\n');
  const messages = lines.map(line => decodeSensorFrame(Uint8Array.from(Buffer.from(line, 'hex'))));
  for (const message of messages)
    assert.equal(checkSensorMessage(message), undefined, message.type);
  const of = <T extends SensorMessage['type']>(type: T) =>
    messages.filter((m): m is Extract<SensorMessage, { type: T }> => m.type === type);
  assert.deepEqual(
    messages.map(m => m.type),
    ['remoteId', 'wifiAp', 'wifiAp', 'bleDevice', 'wifiProbe', 'status'],
  );
  const [drone] = of('remoteId');
  assert.equal(Buffer.from(drone.uasId, 'hex').toString(), '1581F0TEST');
  assert.equal(drone.transport, RemoteIdTransport.wifiNan); // The last frame heard was NAN.
  assert.equal(drone.latitude, 389_000_000);
  assert.equal(drone.longitude, -770_365_000);
  assert.equal(drone.heading, 27_000);
  assert.equal(drone.speed, 1000);
  assert.equal(drone.altitude, 1225);
  assert.equal(drone.height, 600);
  assert.equal(drone.operatorLatitude, 388_990_000);
  assert.equal(Buffer.from(drone.operatorId!, 'hex').toString(), 'USA0TEST');
  const [open, hidden] = of('wifiAp');
  assert.equal(Buffer.from(open.ssid, 'hex').toString(), 'Field Net');
  assert.equal(open.security, Security.wpa2);
  assert.equal(open.rssi, -61);
  assert.equal(open.band, 2);
  assert.equal(hidden.ssid, '');
  assert.equal(hidden.hidden, 1);
  assert.equal(hidden.security, Security.wpa3);
  const [tag] = of('bleDevice');
  assert.equal(Buffer.from(tag.name!, 'hex').toString(), 'Tag1');
  assert.equal(tag.manufacturer, 0x004c);
  assert.equal(tag.tracker, Tracker.appleFindMy);
  const [probe] = of('wifiProbe');
  assert.equal(Buffer.from(probe.ssid!, 'hex').toString(), 'Home');
  const [status] = of('status');
  assert.equal(status.channel, 149);
  assert.equal(status.sent, 5);
});
