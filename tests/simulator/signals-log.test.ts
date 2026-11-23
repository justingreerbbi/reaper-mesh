// Monitoring logs (D61): what is logged, when, and how it is exported.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LOG_EVERY_MS,
  LOG_LIMITS,
  logCsv,
  logGeoJson,
  MemoryLogStorage,
  SignalLogger,
  strongestPoints,
  type LogEntry,
} from '../../packages/agent-core/signals-log.ts';
import type { Place } from '../../packages/agent-core/signals-intel.ts';

const near = (north: number, east: number): Place => ({
  lat: 38.9 + north / 111_320,
  lon: -77 + east / (111_320 * Math.cos((38.9 * Math.PI) / 180)),
  accuracy: 4,
});
const ap = (rssi: number, extra: Partial<LogEntry> = {}): LogEntry => ({
  kind: 'wifi',
  id: '02:A1:B2:C3:D4:E5',
  name: 'Field Net',
  rssi,
  channel: 36,
  category: 'Router or access point',
  ...extra,
});

test('a signal is logged when first heard, then on movement, a change or time', async () => {
  const storage = new MemoryLogStorage();
  const logger = new SignalLogger(storage);
  assert.equal(logger.observe(ap(-60), 0), false, 'not monitoring yet');
  await logger.start(1000, 'log-1');
  assert.equal(logger.observe(ap(-60), 1000, near(0, 0)), true, 'first time');
  assert.equal(logger.observe(ap(-61), 2000, near(1, 0)), false, 'nothing changed');
  assert.equal(logger.observe(ap(-62), 3000, near(6, 0)), true, 'moved 6 m');
  assert.equal(logger.observe(ap(-68), 4000, near(6, 0)), true, 'changed 6 dB');
  assert.equal(logger.observe(ap(-68), 4000 + LOG_EVERY_MS, near(6, 0)), true, 'half a minute on');
  assert.equal(logger.observe(ap(-50, { id: 'other' }), 5000), true, 'another signal');
  logger.moved(near(0, 0));
  logger.moved(near(1, 0)); // Jitter.
  logger.moved(near(40, 0));
  await logger.stop(60_000);
  assert.equal(logger.active, false);
  const [session] = await storage.listSessions();
  assert.equal(session.rows, 5);
  assert.equal(session.signals, 2);
  assert.equal(session.located, 4);
  assert.ok(Math.abs(session.distance - 40) < 1);
  assert.equal(session.endedAt, 60_000);
  assert.equal((await storage.readRows('log-1')).length, 5);
  assert.equal(logger.observe(ap(-60), 70_000), false, 'stopped');
});

test('rows are written in chunks, and a full log stops itself', async () => {
  const storage = new MemoryLogStorage();
  const logger = new SignalLogger(storage);
  await logger.start(0, 'big');
  for (let i = 0; i < 450; i++) logger.observe(ap(-60, { id: `id-${i}` }), i);
  await logger.flush();
  assert.equal((await storage.readRows('big')).length, 450);
  assert.equal(storage.chunks.get('big')!.length, 3);
  logger.session!.rows = LOG_LIMITS.rows - 1;
  logger.observe(ap(-60, { id: 'last' }), 9999);
  assert.equal(logger.active, false);
  assert.match(logger.stoppedBecause, /full/);
});

test('old logs make room for a new one', async () => {
  const storage = new MemoryLogStorage();
  for (let i = 0; i < LOG_LIMITS.sessions; i++)
    await storage.putSession({
      id: `old-${i}`,
      startedAt: i,
      endedAt: i,
      rows: 0,
      signals: 0,
      located: 0,
      distance: 0,
    });
  await new SignalLogger(storage).start(1000, 'new');
  const ids = (await storage.listSessions()).map(s => s.id);
  assert.equal(ids.length, LOG_LIMITS.sessions);
  assert.ok(!ids.includes('old-0') && ids.includes('new'));
});

test('a log exports as CSV and as GeoJSON points where each signal was heard', async () => {
  const storage = new MemoryLogStorage();
  const logger = new SignalLogger(storage);
  await logger.start(Date.UTC(2026, 10, 23, 12), 'log');
  logger.observe(
    ap(-61, { name: '=Cafe, "free"', device: 'Flock Safety camera', maker: 'Flock' }),
    Date.UTC(2026, 10, 23, 12, 0, 1),
    { lat: 38.9, lon: -77, accuracy: 4 },
  );
  logger.observe(
    {
      kind: 'drone',
      id: 'DRONE1',
      name: 'DRONE1',
      rssi: -70,
      reported: { lat: 38.91, lon: -77.01 },
    },
    Date.UTC(2026, 10, 23, 12, 0, 2),
  );
  await logger.stop(Date.UTC(2026, 10, 23, 12, 1));
  const rows = await storage.readRows('log');
  const [head, first, second, end] = logCsv(rows).split('\r\n');
  assert.match(head, /^Time \(UTC\),Latitude,Longitude,Accuracy \(m\),Signal \(dBm\),Kind,Name,/);
  assert.equal(
    first,
    `2026-11-23T12:00:01.000Z,38.9,-77,4,-61,Wi-Fi network,"'=Cafe, ""free""",02:A1:B2:C3:D4:E5,36,Router or access point,Flock,Flock Safety camera,,`,
  );
  assert.equal(second, '2026-11-23T12:00:02.000Z,,,,-70,Drone,DRONE1,DRONE1,,,,,38.91,-77.01');
  assert.equal(end, '');
  const geo = JSON.parse(logGeoJson(logger.session!, rows));
  assert.equal(geo.type, 'FeatureCollection');
  assert.equal(geo.features.length, 1, 'only rows with the user’s position');
  assert.deepEqual(geo.features[0].geometry, { type: 'Point', coordinates: [-77, 38.9] });
  assert.equal(geo.features[0].properties.knownDevice, 'Flock Safety camera');
  assert.equal(geo.features[0].properties.signal, -61);
});

test('a signal stronger than ever is logged, even standing still', async () => {
  const logger = new SignalLogger(new MemoryLogStorage());
  await logger.start(0, 'peak');
  assert.equal(logger.observe(ap(-70), 1000), true, 'first time, no position');
  assert.equal(logger.observe(ap(-72), 2000, near(0, 0)), true, 'first position');
  assert.equal(logger.observe(ap(-71), 3000, near(1, 0)), true, 'strongest with a position');
  assert.equal(logger.observe(ap(-71), 4000, near(1, 0)), false, 'only as strong');
  assert.equal(logger.observe(ap(-73), 5000, near(1, 0)), false, 'weaker');
  assert.equal(logger.observe(ap(-69), 6000), false, 'stronger, but nowhere to put it');
});

test('a log maps to one point per signal, where it was strongest', () => {
  const at = (rssi: number, place: Place | undefined, extra: Partial<LogEntry> = {}) => ({
    ...ap(rssi, extra),
    at: 0,
    ...(place ? { place } : {}),
  });
  const points = strongestPoints([
    at(-80, near(0, 0)),
    at(-55, near(50, 0)),
    at(-55, near(90, 0)), // As strong, later: the first spot stays.
    at(-70, near(120, 0)),
    at(-40, undefined), // Stronger, but no position.
    at(-60, near(10, 10), { kind: 'bluetooth', id: 'same-address-other-kind' }),
    at(-90, undefined, { id: 'never-placed' }),
  ]);
  assert.equal(points.length, 2);
  assert.deepEqual(
    points.map(point => [point.kind, point.rssi, point.heard]),
    [
      ['bluetooth', -60, 1],
      ['wifi', -55, 4],
    ],
    'weakest first, so the strongest draws on top',
  );
  assert.deepEqual(points[1].place, near(50, 0));
});
