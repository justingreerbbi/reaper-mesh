// The portal's follow, trail, track, USB GPS and notification logic, kept in step with the mobile app.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { declination, decimalYear, turnHeading } from '../../agents/web/declination.ts';
import {
  formatBearing,
  formatDuration,
  formatHeight,
  formatSpeed,
  toWire,
} from '../../agents/web/geo.ts';
import {
  NODE_TRAIL_MS,
  extendTrail,
  toGpx,
  trackLength,
  trackLines,
  trackSegments,
  trailSteps,
  type TrackPoint,
} from '../../agents/web/trail.ts';
import { TRACK_KEY, TrackStore } from '../../agents/web/track-store.ts';
import { NODE_CACHE_PREFIX, NodeCache } from '../../agents/web/node-cache.ts';
import {
  DEFAULT_PREFERENCES,
  PREFERENCES_KEY,
  readPreferences,
} from '../../agents/web/preferences.ts';
import { NmeaReader, sentenceFields, type GpsFix } from '../../agents/web/nmea.ts';
import { Announcer, alertFor } from '../../agents/web/notifications.ts';
import { headingFromAngles } from '../../agents/web/compass.ts';

class MemoryStorage {
  #items = new Map<string, string>();
  get length() {
    return this.#items.size;
  }
  key(index: number) {
    return [...this.#items.keys()][index] ?? null;
  }
  getItem(key: string) {
    return this.#items.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.#items.set(key, String(value));
  }
  removeItem(key: string) {
    this.#items.delete(key);
  }
}

/** A sentence with its checksum, as a receiver sends it. */
function nmea(body: string) {
  let sum = 0;
  for (const char of body) sum ^= char.charCodeAt(0);
  return `$${body}*${sum.toString(16).toUpperCase().padStart(2, '0')}\r\n`;
}

test('bearings read in degrees or NATO mils, and say when they are magnetic', () => {
  assert.equal(formatBearing(47), '047° NE');
  assert.equal(formatBearing(47, 'mils'), '0836 mils');
  assert.equal(formatBearing(359.99, 'mils'), '0000 mils');
  assert.equal(formatBearing(359.9, 'mils'), '6398 mils');
  assert.equal(formatBearing(-90), '270° W');
  assert.equal(formatBearing(180, 'degrees', true), '180° S mag');
  assert.equal(formatBearing(90, 'mils', true), '1600 mils mag');
});

test('speed, height and duration read as on the phone', () => {
  assert.equal(formatSpeed(1.1667), '4.2 km/h');
  assert.equal(formatSpeed(25), '90 km/h');
  assert.equal(formatSpeed(1, 'imperial'), '2.2 mph');
  assert.equal(formatHeight(1610), '1,610 m');
  assert.equal(formatHeight(1610, 'imperial'), '5,282 ft');
  assert.equal(formatDuration(42 * 60000 + 59000), '42 min');
  assert.equal(formatDuration(125 * 60000), '2 h 05 min');
});

test('magnetic declination matches NOAA WMM2025 test values', () => {
  // From WMM2025_TestValues.txt: year, altitude km, latitude, longitude, declination.
  const rows = [
    [2025.0, 28, 89, -121, -99.77],
    [2025.0, 51, -33, 109, -5.49],
    [2025.5, 63, 26, 81, 0.51],
    [2025.5, 44, 33, -118, 11.1],
    [2026.0, 82, -64, 87, -81.74],
    [2027.5, 96, -46, -85, 17.93],
    [2028.5, 11, 34, 0, 1.57],
    [2029.5, 63, 88, 26, 36.52],
  ];
  for (const [year, altitude, latitude, longitude, expected] of rows)
    assert.ok(
      Math.abs(declination(latitude, longitude, year, altitude) - expected) < 0.01,
      `${latitude}, ${longitude} in ${year}`,
    );
  // Denver is about 7.5° east; a hand compass's 0° there is about 007° true.
  const denver = declination(39.74, -104.99, decimalYear(Date.UTC(2026, 10, 20)));
  assert.ok(denver > 6.5 && denver < 8.5, String(denver));
  assert.equal(turnHeading(355, 10), 5);
  assert.equal(turnHeading(5, -10), 355);
  assert.equal(decimalYear(Date.UTC(2026, 0, 1)), 2026);
});

test('the compass heading holds when the device is tilted', () => {
  // Flat, facing east: alpha is counter-clockwise, so 270 is a heading of 90.
  assert.ok(Math.abs(headingFromAngles(270, 0, 0) - 90) < 1e-9);
  assert.equal(headingFromAngles(0, 0, 0), 0);
  assert.ok(Math.abs(headingFromAngles(90, 10, -5) - 270) < 1e-9);
  // Upright, as when held up to sight along: still east.
  assert.ok(Math.abs(headingFromAngles(270, 80, 0) - 90) < 1e-6);
});

test('a node trail keeps an hour of moves and fades with age', () => {
  const at = 1_000_000_000;
  let trail = extendTrail(undefined, { latitude: 39.7, longitude: -105 }, at);
  // A report in the same place only refreshes the time.
  trail = extendTrail(trail, { latitude: 39.70001, longitude: -105 }, at + 30_000);
  assert.equal(trail.length, 1);
  assert.equal(trail[0][2], at + 30_000);
  trail = extendTrail(trail, { latitude: 39.701, longitude: -105 }, at + 60_000);
  trail = extendTrail(trail, { latitude: 39.702, longitude: -105 }, at + 90_000);
  assert.equal(trail.length, 3);
  const steps = trailSteps(trail, at + 90_000);
  assert.equal(steps.length, 2);
  assert.equal(steps[1].fade, 1);
  assert.ok(steps[0].fade < 1 && steps[0].fade > 0.98);
  // Over an hour later, the old points are gone.
  const later = extendTrail(
    trail,
    { latitude: 39.71, longitude: -105 },
    at + NODE_TRAIL_MS + 70_000,
  );
  assert.equal(later.length, 2);
  assert.equal(trailSteps(trail, at + 2 * NODE_TRAIL_MS).length, 0);
  // A long walk keeps only the latest 120 points.
  let long = extendTrail(undefined, { latitude: 39, longitude: -105 }, at);
  for (let i = 1; i < 200; i++)
    long = extendTrail(long, { latitude: 39 + i * 0.001, longitude: -105 }, at + i * 1000);
  assert.equal(long.length, 120);
  assert.equal(long.at(-1)![0], -105);
});

test('a recorded track breaks where recording stopped elsewhere, and writes GPX', () => {
  const t = 1_700_000_000_000;
  const points: TrackPoint[] = [
    [-105, 39.7, 1600, t],
    [-105, 39.701, 1601.25, t + 10_000],
    // Two minutes later and 1 km away: a break, not ground covered.
    [-105, 39.71, null, t + 130_000],
    [-105, 39.711, null, t + 140_000],
  ];
  assert.equal(trackSegments(points).length, 2);
  assert.equal(trackLines(points).length, 2);
  const length = trackLength(points);
  assert.ok(length > 200 && length < 240, String(length));
  const gpx = toGpx(points, 'Track <one> & "two"');
  assert.match(gpx, /<name>Track &lt;one&gt; &amp; &quot;two&quot;<\/name>/);
  assert.equal(gpx.match(/<trkseg>/g)?.length, 2);
  assert.match(gpx, /<trkpt lat="39.7010000" lon="-105.0000000"><ele>1601.3<\/ele><time>/);
  assert.match(gpx, /<trkpt lat="39.7100000" lon="-105.0000000"><time>/);
});

test('the track store keeps good points across reloads and stops a track left recording', () => {
  const store = new MemoryStorage();
  const track = new TrackStore(store);
  const t = 1_700_000_000_000;
  track.start(t);
  assert.equal(track.recording, true);
  const kept = track.append([
    { latitude: 39.7, longitude: -105, accuracy: 8, altitude: 1600, time: t + 1000 },
    // Too rough, cached from before the start, and not newer than the last point.
    { latitude: 39.8, longitude: -105, accuracy: 80, time: t + 2000 },
    { latitude: 39.8, longitude: -105, accuracy: 5, time: t - 60_000 },
    { latitude: 39.8, longitude: -105, accuracy: 5, time: t + 1000 },
    { latitude: 39.701, longitude: -105, accuracy: null, altitude: null, time: t + 3000 },
  ]);
  assert.equal(kept, 2);
  for (let i = 0; i < 600; i++)
    track.append([{ latitude: 39.701 + i * 1e-5, longitude: -105, time: t + 4000 + i * 1000 }]);
  assert.equal(track.points.length, 602);
  assert.ok(store.getItem(`${TRACK_KEY}.1`), 'a long track is stored in chunks');

  // The page closed while recording: the track comes back stopped, ending at its last point.
  const reopened = new TrackStore(store);
  assert.equal(reopened.recording, false);
  assert.equal(reopened.points.length, 602);
  assert.equal(reopened.endedAt, reopened.points.at(-1)![3]);
  assert.equal(reopened.append([{ latitude: 1, longitude: 1, time: t + 9e9 }]), 0);

  reopened.start(t + 1e7);
  assert.equal(reopened.points.length, 0);
  assert.equal(store.getItem(`${TRACK_KEY}.1`), null);
  reopened.clear();
  assert.equal(store.getItem(TRACK_KEY), null);

  // A damaged track starts empty rather than failing.
  store.setItem(TRACK_KEY, '{nope');
  assert.equal(new TrackStore(store).points.length, 0);
  // Nothing is written while storage is read-only.
  const frozen = new MemoryStorage();
  new TrackStore(frozen, () => false).start(t);
  assert.equal(frozen.length, 0);
});

test('heard nodes keep a trail of their reports across reloads', () => {
  const store = new MemoryStorage();
  const cache = new NodeCache(store);
  const row = (sequence: number, latitude: number) => ({
    node: 'node-00000000bb01e7f2',
    name: 'Alpha 1',
    peerBoot: 'boot-1',
    peerSequence: sequence,
    ageMs: 0,
    position: { latitude: toWire(latitude, 90), longitude: toWire(-105, 180) },
  });
  cache.sync('device-a', [row(1, 39.7)], 1_000_000);
  cache.sync('device-a', [row(2, 39.701)], 1_030_000);
  cache.sync('device-a', [row(3, 39.702)], 1_060_000);
  assert.equal(cache.nodes[0].trail?.length, 3);
  const reopened = new NodeCache(store);
  reopened.use('device-a');
  assert.equal(reopened.nodes[0].trail?.length, 3);
  // A damaged trail drops that node rather than drawing nonsense.
  store.setItem(
    `${NODE_CACHE_PREFIX}device-b`,
    JSON.stringify([{ ...cache.nodes[0], trail: [[1, 'x', 3]] }]),
  );
  const damaged = new NodeCache(store);
  damaged.use('device-b');
  assert.equal(damaged.nodes.length, 0);
});

test('new preferences default like the phone and reject unknown values', () => {
  assert.equal(DEFAULT_PREFERENCES.angles, 'degrees');
  assert.equal(DEFAULT_PREFERENCES.north, 'true');
  assert.equal(DEFAULT_PREFERENCES.keepAwake, true);
  assert.equal(DEFAULT_PREFERENCES.locationSource, 'browser');
  assert.equal(DEFAULT_PREFERENCES.notifications, 'sender');
  const store = new MemoryStorage();
  store.setItem(
    PREFERENCES_KEY,
    JSON.stringify({
      angles: 'mils',
      north: 'grid',
      keepAwake: false,
      locationSource: 'gps',
      notifications: 'loud',
    }),
  );
  const read = readPreferences(store);
  assert.equal(read.angles, 'mils');
  assert.equal(read.north, 'true');
  assert.equal(read.keepAwake, false);
  assert.equal(read.locationSource, 'gps');
  assert.equal(read.notifications, 'sender');
});

test('NMEA sentences need a correct checksum', () => {
  assert.deepEqual(sentenceFields(nmea('GPGGA,1,2')), ['GPGGA', '1', '2']);
  assert.equal(sentenceFields('$GPGGA,1,2*00'), undefined);
  assert.equal(sentenceFields('GPGGA,1,2'), undefined);
  assert.equal(sentenceFields('$GPGGA,1,2'), undefined);
});

test('a USB GPS gives one fix per report from RMC and GGA together', () => {
  const reader = new NmeaReader();
  const fixes: GpsFix[] = [];
  reader.onFix = fix => fixes.push(fix);
  // Split anywhere, as a serial port delivers it, with noise before the first full line.
  const text =
    'garbage\r\n$GPGSV,partial' +
    nmea('GNGGA,123519.00,3944.5000,N,10459.4000,W,1,08,0.9,1610.4,M,-17.0,M,,') +
    nmea('GNGSA,A,3,04,05,,09,12,,,24,,,,,2.5,1.3,2.1') +
    nmea('GNRMC,123519.00,A,3944.5000,N,10459.4000,W,22.4,084.4,201126,,,A');
  for (let i = 0; i < text.length; i += 7) reader.push(text.slice(i, i + 7));
  assert.equal(fixes.length, 1);
  const [fix] = fixes;
  assert.ok(Math.abs(fix.latitude - 39.741667) < 1e-6);
  assert.ok(Math.abs(fix.longitude + 104.99) < 1e-6);
  assert.equal(fix.altitude, 1610.4);
  assert.ok(Math.abs(fix.speed! - 22.4 * 0.514444) < 1e-6);
  assert.equal(fix.course, 84.4);
  assert.equal(fix.accuracy, 4.5);
  assert.equal(fix.satellites, 8);
  assert.equal(reader.hasFix, true);
});

test('a receiver that sends only RMC reports each fix when the next begins', () => {
  const reader = new NmeaReader();
  const fixes: GpsFix[] = [];
  reader.onFix = fix => fixes.push(fix);
  reader.push(nmea('GPRMC,000001,A,0130.000,S,03600.000,E,0.0,,201126,,,A'));
  assert.equal(fixes.length, 0);
  reader.push(nmea('GPRMC,000002,A,0130.000,S,03600.000,E,0.0,,201126,,,A'));
  assert.equal(fixes.length, 1);
  assert.equal(fixes[0].latitude, -1.5);
  assert.equal(fixes[0].longitude, 36);
  assert.equal(fixes[0].altitude, null);
  assert.equal(fixes[0].accuracy, null);
  assert.equal(fixes[0].course, null);
});

test('a receiver without a fix reports none, and says so', () => {
  const reader = new NmeaReader();
  const fixes: GpsFix[] = [];
  reader.onFix = fix => fixes.push(fix);
  reader.push(nmea('GPGGA,000001,,,,,0,03,,,M,,M,,'));
  reader.push(nmea('GPRMC,000001,V,,,,,,,201126,,,N'));
  reader.push(nmea('GPGGA,000002,,,,,0,04,,,M,,M,,'));
  assert.equal(fixes.length, 0);
  assert.equal(reader.hasFix, false);
  assert.equal(reader.satellites, 4);
  assert.ok(reader.sentences >= 3);
});

test('a message notification says only what the setting allows', () => {
  const context = {
    channels: [{ id: 0, name: 'Public' }],
    nodes: [{ node: 'node-00000000bb01e7f2', name: 'Alpha 1' }],
  };
  const channel = {
    origin: 'node-00000000bb01e7f2',
    destination: 'broadcast',
    channel: 0,
    text: 'On the ridge',
  };
  const direct = { ...channel, destination: 'node-00000000a1b2c3d4' };
  assert.deepEqual(alertFor(channel, context, 'sender'), {
    title: 'Public',
    body: 'New message from Alpha 1',
    destination: 'broadcast',
    channel: 0,
  });
  assert.equal(alertFor(channel, context, 'full')?.body, 'Alpha 1: On the ridge');
  assert.deepEqual(alertFor(direct, context, 'sender'), {
    title: 'Alpha 1',
    body: 'New message',
    destination: 'node-00000000bb01e7f2',
    channel: 0,
  });
  assert.equal(alertFor(direct, context, 'full')?.body, 'On the ridge');
  assert.equal(alertFor(direct, context, 'off'), undefined);
  // A sender not yet discovered goes by its short ID.
  assert.equal(
    alertFor({ ...direct, origin: 'node-00000000cafe0001' }, context, 'sender')?.title,
    'Node 0001',
  );
});

test('messages already waiting when the page opens are not announced', () => {
  const announcer = new Announcer();
  assert.deepEqual(announcer.fresh('device-a', ['one', 'two']), []);
  assert.deepEqual(announcer.fresh('device-a', ['one', 'two', 'three']), ['three']);
  assert.deepEqual(announcer.fresh('device-a', ['three']), []);
  assert.deepEqual(announcer.fresh('device-b', ['four']), []);
});
