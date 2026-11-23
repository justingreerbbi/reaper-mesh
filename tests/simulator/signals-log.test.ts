// Monitoring logs (D61): what is logged, when, and how it is exported.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LOG_EVERY_MS,
  LOG_FIX_MS,
  LOG_LIMITS,
  logCsv,
  logGeoJson,
  logPointsCsv,
  MemoryLogStorage,
  routeOf,
  SignalLogger,
  summarize,
  type Here,
  type LogEntry,
  type LogRow,
} from '../../packages/agent-core/signals-log.ts';
import type { Place } from '../../packages/agent-core/signals-intel.ts';

const near = (north: number, east: number): Place => ({
  lat: 38.9 + north / 111_320,
  lon: -77 + east / (111_320 * Math.cos((38.9 * Math.PI) / 180)),
  accuracy: 4,
});
/** A fresh position at `at`. */
const fix = (place: Place, at: number): Here => ({ place, at });
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
  assert.equal(logger.observe(ap(-60), 1000, fix(near(0, 0), 1000)), true, 'first time');
  assert.equal(logger.observe(ap(-61), 2000, fix(near(1, 0), 2000)), false, 'nothing changed');
  assert.equal(logger.observe(ap(-62), 3000, fix(near(6, 0), 3000)), true, 'moved 6 m');
  assert.equal(logger.observe(ap(-68), 4000, fix(near(6, 0), 4000)), true, 'changed 6 dB');
  assert.equal(
    logger.observe(ap(-68), 4000 + LOG_EVERY_MS, fix(near(6, 0), 4000 + LOG_EVERY_MS)),
    true,
    'half a minute on',
  );
  assert.equal(logger.observe(ap(-50, { id: 'other' }), 5000, undefined), true, 'another signal');
  await logger.stop(60_000);
  assert.equal(logger.active, false);
  const [session] = await storage.listSessions();
  assert.equal(session.rows, 5);
  assert.equal(session.signals, 2);
  assert.equal(session.located, 4);
  assert.equal(session.endedAt, 60_000);
  assert.equal((await storage.readRows('log-1')).length, 5);
  assert.equal(logger.observe(ap(-60), 70_000), false, 'stopped');
});

test("the user's route is logged, and its last point places the signals heard", async () => {
  const storage = new MemoryLogStorage();
  const logger = new SignalLogger(storage);
  await logger.start(0, 'route');
  assert.equal(logger.observe(ap(-70), 500), true);
  logger.moved(near(0, 0), 1000);
  logger.moved(near(1, 0), 2000); // Jitter: not a route point, but the position is fresh again.
  logger.moved(near(40, 0), 3000);
  // A phone sends nothing while standing still: the last position still places what is heard.
  logger.moved(near(40, 0), 4000);
  assert.equal(logger.observe(ap(-71), 50_000), true, 'first time with a position');
  assert.equal(logger.observe(ap(-65, { id: 'parked' }), 4000 + LOG_FIX_MS + 1), true);
  await logger.stop(200_000);
  const rows = await storage.readRows('route');
  assert.deepEqual(routeOf(rows), [near(0, 0), near(40, 0)]);
  const [session] = await storage.listSessions();
  assert.equal(session.route, 2);
  assert.ok(Math.abs(session.distance - 40) < 1);
  const signals = rows.filter(row => row.kind === 'wifi');
  assert.equal(signals[0].kind === 'wifi' && signals[0].place, undefined, 'before any position');
  assert.deepEqual(signals[1].kind === 'wifi' && signals[1].place, near(40, 0));
  assert.equal(signals[1].kind === 'wifi' && signals[1].fixAge, 46, 'an old position says so');
  assert.equal(signals[2].kind === 'wifi' && signals[2].place, undefined, 'too old to use');
});

test('a signal stronger than ever is logged, even standing still', async () => {
  const logger = new SignalLogger(new MemoryLogStorage());
  await logger.start(0, 'peak');
  const here = fix(near(0, 0), 0);
  assert.equal(logger.observe(ap(-70), 1000, undefined), true, 'first time, no position');
  assert.equal(logger.observe(ap(-72), 2000, here), true, 'first position');
  assert.equal(logger.observe(ap(-71), 3000, here), true, 'strongest with a position');
  assert.equal(logger.observe(ap(-71), 4000, here), false, 'only as strong');
  assert.equal(logger.observe(ap(-73), 5000, here), false, 'weaker');
  assert.equal(logger.observe(ap(-69), 6000, undefined), false, 'stronger, nowhere to put it');
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

const row = (
  rssi: number,
  place: Place | undefined,
  at: number,
  extra: Partial<LogEntry> = {},
): LogRow => ({ ...ap(rssi, extra), at, ...(place ? { place } : {}) });

test('a log sums up to one line per signal, placed where it was strongest', () => {
  const signals = summarize([
    row(-80, near(0, 0), 1),
    { kind: 'route', at: 2, place: near(0, 0) },
    row(-55, near(50, 0), 3, { name: '' }),
    row(-55, near(90, 0), 4), // As strong, later: the first spot stays.
    row(-70, near(120, 0), 5, { maker: 'Ubiquiti' }),
    row(-40, undefined, 6), // Stronger, but no position.
    row(-60, near(10, 10), 7, { kind: 'bluetooth', id: 'same-address-other-kind' }),
    row(-90, undefined, 8, { id: 'never-placed', name: 'Hidden' }),
  ]);
  assert.deepEqual(
    signals.map(signal => [signal.kind, signal.id, signal.strongest, signal.best?.rssi]),
    [
      ['wifi', '02:A1:B2:C3:D4:E5', -40, -55],
      ['bluetooth', 'same-address-other-kind', -60, -60],
      ['wifi', 'never-placed', -90, undefined],
    ],
  );
  const [first] = signals;
  assert.deepEqual(first.best?.place, near(50, 0));
  assert.equal(first.logged, 5);
  assert.equal(first.name, 'Field Net', 'the latest name that is not empty');
  assert.equal(first.maker, 'Ubiquiti');
  assert.equal([first.firstAt, first.lastAt].join(), '1,6');
});

test('a log exports a CSV per signal, a CSV of every point, and a map file', () => {
  const t = (s: number) => Date.UTC(2026, 10, 23, 12, 0, s);
  const rows: LogRow[] = [
    { kind: 'route', at: t(0), place: { lat: 38.9, lon: -77, accuracy: 4 } },
    {
      ...ap(-61, { name: '=Cafe, "free"', device: 'Flock Safety camera', maker: 'Flock' }),
      at: t(1),
      place: { lat: 38.9, lon: -77, accuracy: 4 },
      fixAge: 12,
    },
    {
      kind: 'drone',
      id: 'DRONE1',
      name: 'DRONE1',
      rssi: -70,
      reported: { lat: 38.91, lon: -77.01 },
      at: t(2),
    },
    { kind: 'route', at: t(3), place: { lat: 38.901, lon: -77, accuracy: 5 } },
  ];
  const [head, cafe, drone, end] = logCsv(rows).split('\r\n');
  assert.match(head, /^Kind,Name,Address or ID,Most likely,Maker,Known device,Strongest \(dBm\),/);
  assert.equal(
    cafe,
    `Wi-Fi network,"'=Cafe, ""free""",02:A1:B2:C3:D4:E5,Router or access point,Flock,Flock Safety camera,-61,38.9,-77,4,-61,2026-11-23T12:00:01.000Z,12,2026-11-23T12:00:01.000Z,2026-11-23T12:00:01.000Z,1,36,,`,
  );
  assert.equal(
    drone,
    'Drone,DRONE1,DRONE1,,,,-70,,,,,,,2026-11-23T12:00:02.000Z,2026-11-23T12:00:02.000Z,1,,38.91,-77.01',
    'never placed, still listed',
  );
  assert.equal(end, '');

  const points = logPointsCsv(rows).split('\r\n');
  assert.match(points[0], /^Time \(UTC\),Latitude,Longitude,Accuracy \(m\),Position age \(s\),/);
  assert.equal(points.length, 6);
  assert.equal(points[1], '2026-11-23T12:00:00.000Z,38.9,-77,4,,,You');

  const geo = JSON.parse(logGeoJson({ id: 'log', startedAt: t(0) } as never, rows));
  assert.equal(geo.type, 'FeatureCollection');
  assert.equal(geo.features.length, 2, 'the route, and the one signal with a position');
  assert.deepEqual(geo.features[0].geometry, {
    type: 'LineString',
    coordinates: [
      [-77, 38.9],
      [-77, 38.901],
    ],
  });
  assert.deepEqual(geo.features[1].geometry, { type: 'Point', coordinates: [-77, 38.9] });
  assert.equal(geo.features[1].properties.knownDevice, 'Flock Safety camera');
  assert.equal(geo.features[1].properties.signal, -61);
  assert.equal(geo.features[1].properties.positionAge, 12);
});
