// Alerts, following, known signals and searched networks (D61).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALERT_AGAIN_MS,
  AlertTracker,
  alertText,
  FOLLOWING_AGAIN_MS,
} from '../../packages/agent-core/signals-alerts.ts';
import { identify } from '../../packages/agent-core/signals-identify.ts';
import {
  isFollowing,
  matchesFilter,
  MemoryHistoryStorage,
  searchText,
  SignalHistory,
  VISIT_GAP_MS,
  type Place,
  type SignalReport,
} from '../../packages/agent-core/signals-intel.ts';

const hex = (text: string) => Buffer.from(text).toString('hex');
const history = () => new SignalHistory(new MemoryHistoryStorage());
const near = (north: number, east: number): Place => ({
  lat: 38.9 + north / 111_320,
  lon: -77 + east / (111_320 * Math.cos((38.9 * Math.PI) / 180)),
});
const ble = (address: string, extra: object = {}): SignalReport => ({
  type: 'bleDevice',
  boot: 'b',
  at: 1,
  address,
  addressType: 0,
  phy: 1,
  rssi: -60,
  rssiMin: -60,
  rssiMax: -60,
  count: 1,
  ...extra,
});
const probe = (address: string, ssid?: string): SignalReport => ({
  type: 'wifiProbe',
  boot: 'b',
  at: 1,
  address,
  channel: 6,
  band: 1,
  rssi: -70,
  count: 1,
  ...(ssid ? { ssid: hex(ssid) } : {}),
});
const MINUTE = 60_000;

test('a signal heard at several of the user’s places, far apart, is moving with them', () => {
  const h = history();
  const start = Date.UTC(2026, 10, 23, 12);
  const hear = (address: string, minute: number, place?: Place, extra: object = {}) =>
    h.observe(ble(address, extra), start + minute * MINUTE, place);
  // A tag in the user's bag: heard along 900 m over 25 minutes.
  let tag = hear('aabbcc000001', 0, near(0, 0));
  assert.equal(isFollowing(tag, start), false);
  hear('aabbcc000001', 10, near(300, 0));
  tag = hear('aabbcc000001', 15, near(600, 0));
  assert.equal(isFollowing(tag, start + 15 * MINUTE), false, 'not long enough yet');
  tag = hear('aabbcc000001', 25, near(900, 0));
  assert.equal(isFollowing(tag, start + 25 * MINUTE), true);
  assert.equal(isFollowing(tag, start + 25 * MINUTE + 25 * 60 * MINUTE), false, 'a day later');
  // A neighbour's speaker: heard for an hour, always from the same spot.
  let fixed = hear('aabbcc000002', 0, near(0, 0));
  for (let m = 10; m <= 60; m += 10) fixed = hear('aabbcc000002', m, near(5, 5));
  assert.equal(isFollowing(fixed, start + 60 * MINUTE), false);
  // A phone with a changing address can't be followed by address.
  let phone = hear('7abbcc000003', 0, near(0, 0), { addressType: 2 });
  hear('7abbcc000003', 10, near(300, 0), { addressType: 2 });
  phone = hear('7abbcc000003', 25, near(900, 0), { addressType: 2 });
  assert.equal(isFollowing(phone, start + 25 * MINUTE), false);
  // No positions, no verdict.
  let blind = hear('aabbcc000004', 0);
  blind = hear('aabbcc000004', 30);
  assert.equal(isFollowing(blind, start + 30 * MINUTE), false);
});

test('alerts fire when something of interest comes into range, once, and never for known signals', () => {
  const h = history();
  const alerts = new AlertTracker();
  const check = (
    record: ReturnType<typeof h.observe>,
    previous: number | undefined,
    now: number,
    following = false,
  ) => alerts.check(record, identify(record), previous, now, following)?.kind;

  const ring = h.observe(probe('649a63000a01'), 1000);
  assert.equal(check(ring, undefined, 1000), 'ring');
  assert.equal(check(ring, 1000, 6000), undefined, 'still in range');
  assert.equal(check(ring, undefined, 1000 + ALERT_AGAIN_MS - 1), undefined, 'too soon to repeat');
  assert.equal(check(ring, 6000, 6000 + ALERT_AGAIN_MS + VISIT_GAP_MS), 'ring', 'back after a gap');

  const plain = h.observe(ble('c0ffee000001'), 1000);
  assert.equal(check(plain, undefined, 1000), undefined, 'ordinary signals do not alert');
  h.annotate(plain.key, { watch: true });
  assert.equal(check(plain, 1000, 2000), undefined, 'watched, but it never left');
  assert.equal(check(plain, 1000, 1000 + VISIT_GAP_MS + 1), 'watched');

  const drone = h.observe(
    {
      type: 'remoteId',
      boot: 'b',
      at: 1,
      transport: 1,
      uasId: hex('D1'),
      idType: 1,
      uaType: 2,
      rssi: -70,
    },
    1000,
  );
  assert.equal(check(drone, undefined, 1000), 'drone');

  const tag = h.observe(ble('c0ffee000002'), 1000);
  assert.equal(check(tag, 500, 1000, true), 'following', 'even while it stays in range');
  assert.equal(check(tag, 1000, 1000 + ALERT_AGAIN_MS + 1, true), undefined, 'once an hour');
  assert.equal(check(tag, 1000, 1000 + FOLLOWING_AGAIN_MS, true), 'following');

  const mine = h.observe(probe('649a63000a02'), 1000);
  h.annotate(mine.key, { known: true });
  assert.equal(check(mine, undefined, 1000), undefined);
  assert.equal(check(mine, undefined, 1000, true), undefined);
  assert.equal(alertText('flock', 'Flock camera'), 'Flock: Flock camera');
});

test('known signals can be hidden, and are kept when the store is full', () => {
  const h = history();
  const now = 5000;
  const mine = h.observe(ble('c0ffee000010'), 1000);
  const other = h.observe(ble('c0ffee000011'), 1000);
  h.annotate(mine.key, { known: true });
  assert.equal(matchesFilter(mine, { hideKnown: true }, now), false);
  assert.equal(matchesFilter(mine, {}, now), true);
  assert.equal(matchesFilter(other, { hideKnown: true }, now), true);
  h.annotate(mine.key, { known: false });
  assert.equal(h.records.get(mine.key)!.known, undefined);
});

test('every network a device searches for is kept, and can be searched', () => {
  const h = history();
  h.observe(probe('d80102030405', 'Home'), 1);
  h.observe(probe('d80102030405', 'Airport Free WiFi'), 2);
  h.observe(probe('d80102030405'), 3);
  const record = h.observe(probe('d80102030405', 'Home'), 4);
  assert.deepEqual(record.probed, [hex('Home'), hex('Airport Free WiFi')]);
  assert.ok(searchText(record).includes('airport free wifi'));
  for (let i = 0; i < 30; i++) h.observe(probe('d80102030405', `Net ${i}`), 10 + i);
  assert.equal(record.probed!.length, 16, 'bounded');
  assert.equal(record.probed!.at(-1), hex('Net 29'));
});
