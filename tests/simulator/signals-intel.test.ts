// Signals intelligence (D61): history, placement and filters in packages/agent-core/signals-intel.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  distanceBetween,
  distanceFromRssi,
  estimatePlace,
  HISTORY_LIMITS,
  matchesFilter,
  MemoryHistoryStorage,
  placementOf,
  SignalHistory,
  steadyAngle,
  strongestPlace,
  VISIT_GAP_MS,
  type Place,
  type SignalReport,
} from '../../packages/agent-core/signals-intel.ts';

const hex = (text: string) => Buffer.from(text).toString('hex');
const ble = (address: string, rssi: number, extra: object = {}): SignalReport => ({
  type: 'bleDevice',
  boot: 'b',
  at: 1,
  address,
  addressType: 0,
  phy: 1,
  rssi,
  rssiMin: rssi,
  rssiMax: rssi,
  count: 1,
  ...extra,
});
/** A place `north` and `east` metres from a fixed origin. */
const near = (north: number, east: number): Place => ({
  lat: 38.9 + north / 111_320,
  lon: -77 + east / (111_320 * Math.cos((38.9 * Math.PI) / 180)),
});

test('history keeps first and last seen, visits, minute sightings and survives a reload', async () => {
  const storage = new MemoryHistoryStorage();
  const history = new SignalHistory(storage);
  const start = Date.UTC(2026, 10, 23, 12, 0);
  history.observe(ble('aabbccddeeff', -70), start, near(0, 0));
  history.observe(ble('aabbccddeeff', -60), start + 20_000, near(5, 0));
  history.observe(ble('aabbccddeeff', -80), start + 70_000);
  history.observe(ble('aabbccddeeff', -75), start + 70_000 + VISIT_GAP_MS + 1, near(9, 9));
  const record = history.records.get('bluetooth:aabbccddeeff')!;
  assert.equal(record.firstSeen, start);
  assert.equal(record.lastSeen, start + 70_000 + VISIT_GAP_MS + 1);
  assert.equal(record.visits, 2);
  assert.equal(record.bestRssi, -60);
  assert.deepEqual(record.lastPlace, near(9, 9));
  assert.deepEqual(strongestPlace(record), near(5, 0));
  assert.deepEqual(
    record.sightings.map(s => [s.rssi, s.count]),
    [
      [-60, 2],
      [-80, 1],
      [-75, 1],
    ],
  );
  history.annotate(record.key, { label: 'My watch', note: 'On the desk', watch: true });
  await history.flush();
  const reloaded = new SignalHistory(storage);
  await reloaded.load();
  const again = reloaded.records.get(record.key)!;
  assert.equal(again.label, 'My watch');
  assert.equal(again.watch, true);
  assert.equal(again.visits, 2);
  reloaded.annotate(record.key, { note: '', watch: false });
  assert.equal(reloaded.records.get(record.key)!.note, undefined);
  assert.equal(reloaded.records.get(record.key)!.watch, undefined);
  reloaded.remove(record.key);
  await reloaded.flush();
  assert.equal(storage.rows.size, 0);
});

test('sightings stay bounded and keep the newest', () => {
  const history = new SignalHistory(new MemoryHistoryStorage());
  const start = Date.UTC(2026, 10, 1);
  for (let minute = 0; minute < HISTORY_LIMITS.sightings * 3; minute++)
    history.observe(ble('aabbccddeeff', -50 - (minute % 30)), start + minute * 60_000);
  const { sightings } = history.records.get('bluetooth:aabbccddeeff')!;
  assert.ok(sightings.length <= HISTORY_LIMITS.sightings);
  assert.equal(
    sightings[sightings.length - 1].at,
    start + (HISTORY_LIMITS.sightings * 3 - 1) * 60_000,
  );
  for (let i = 1; i < sightings.length; i++) assert.ok(sightings[i].at > sightings[i - 1].at);
});

test('private addresses are recognised for Bluetooth and Wi-Fi', () => {
  const history = new SignalHistory(new MemoryHistoryStorage());
  assert.equal(
    history.observe(ble('aabbccddeeff', -60, { addressType: 2 }), 1).privateAddress,
    true,
  );
  assert.equal(
    history.observe(ble('a8bbccddeeff', -60, { addressType: 1 }), 1).privateAddress,
    false,
  );
  const probe = (address: string): SignalReport => ({
    type: 'wifiProbe',
    boot: 'b',
    at: 1,
    address,
    channel: 6,
    band: 1,
    rssi: -60,
    count: 1,
  });
  assert.equal(history.observe(probe('da0102030405'), 1).privateAddress, true);
  assert.equal(history.observe(probe('d80102030405'), 1).privateAddress, false);
});

test('distance from signal strength is rough and bounded', () => {
  assert.ok(Math.abs(distanceFromRssi('bluetooth', -59) - 1) < 0.01);
  assert.ok(distanceFromRssi('bluetooth', -84) > 8 && distanceFromRssi('bluetooth', -84) < 12);
  assert.equal(distanceFromRssi('wifi', -200), 2000);
  assert.equal(distanceFromRssi('wifi', 0), 0.5);
});

test('a position is estimated only after hearing it from places far enough apart', () => {
  const history = new SignalHistory(new MemoryHistoryStorage());
  const transmitter = near(100, 0);
  let at = 0;
  const hear = (place: Place) => {
    const metres = distanceBetween(place, transmitter);
    history.observe(
      ble('aabbccddeeff', Math.round(-59 - 25 * Math.log10(metres))),
      (at += 61_000),
      place,
    );
  };
  hear(near(0, 0));
  hear(near(10, 0));
  hear(near(0, 10));
  const record = history.records.get('bluetooth:aabbccddeeff')!;
  assert.equal(estimatePlace(record.sightings), undefined, 'all within 30 m');
  assert.equal(placementOf(record, near(0, 0)).how, 'distance');
  for (const [n, e] of [
    [60, -40],
    [80, 30],
    [140, 0],
    [120, -30],
    [90, 60],
  ])
    hear(near(n, e));
  const placement = placementOf(record, near(0, 0));
  assert.equal(placement.how, 'estimated');
  assert.ok(distanceBetween(placement.place!, transmitter) < 40, 'close to the transmitter');
  assert.ok(placement.bearing! < 30 || placement.bearing! > 330, 'roughly north');
  assert.ok(placement.error! >= 10);
});

test('a drone that reports its position is placed exactly; without the user it is distance only', () => {
  const history = new SignalHistory(new MemoryHistoryStorage());
  const where = near(0, 200);
  const record = history.observe(
    {
      type: 'remoteId',
      boot: 'b',
      at: 1,
      transport: 1,
      uasId: hex('DRONE1'),
      idType: 1,
      uaType: 2,
      rssi: -70,
      latitude: Math.round(where.lat * 1e7),
      longitude: Math.round(where.lon * 1e7),
      height: 600,
    },
    1000,
  );
  const placement = placementOf(record, near(0, 0));
  assert.equal(placement.how, 'reported');
  assert.ok(Math.abs(placement.distance - 200) < 1);
  assert.ok(Math.abs(placement.bearing! - 90) < 1);
  assert.equal(record.track?.length, 1);
  assert.equal(record.track![0].altitude, 60);
  assert.equal(placementOf(record).how, 'distance');
  assert.equal(steadyAngle(record.key), steadyAngle(record.key));
});

test('filters narrow by kind, flags, signal, time and text', () => {
  const history = new SignalHistory(new MemoryHistoryStorage());
  const now = Date.UTC(2026, 10, 23, 15, 0);
  const watched = history.observe(ble('aabbccddeeff', -50, { name: hex('Tag') }), now - 1000);
  history.annotate(watched.key, { watch: true, tags: ['car'] });
  const old = history.observe(ble('112233445566', -90), now - 3 * 86_400_000);
  const phone = history.observe(ble('7a2233445566', -60, { addressType: 2 }), now - 1000);
  const all = [watched, old, phone];
  const pick = (filter: Parameters<typeof matchesFilter>[1]) =>
    all.filter(record => matchesFilter(record, filter, now)).map(record => record.id);
  assert.deepEqual(pick({ kinds: ['wifi'] }), []);
  assert.deepEqual(pick({ quick: ['watched'] }), ['aabbccddeeff']);
  assert.deepEqual(pick({ quick: ['now'] }), ['aabbccddeeff', '7a2233445566']);
  assert.deepEqual(pick({ quick: ['today'] }), ['aabbccddeeff', '7a2233445566']);
  assert.deepEqual(pick({ minRssi: -70 }), ['aabbccddeeff', '7a2233445566']);
  assert.deepEqual(pick({ within: 86_400_000 }), ['aabbccddeeff', '7a2233445566']);
  assert.deepEqual(pick({ hidePrivate: true }), ['aabbccddeeff', '112233445566']);
  assert.deepEqual(pick({ text: 'car' }), ['aabbccddeeff']);
  assert.deepEqual(pick({ text: 'tag' }), ['aabbccddeeff']);
});
