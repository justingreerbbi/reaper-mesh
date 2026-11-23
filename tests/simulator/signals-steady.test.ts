// Keeping a live list readable (D61): steadied strengths and rows that keep their place.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NEW_ROW_MS,
  RESORT_MS,
  StableOrder,
  SteadyRssi,
  type ListItem,
} from '../../packages/agent-core/signals-steady.ts';

const item = (key: string, extra: Partial<ListItem> = {}): ListItem => ({
  key,
  pinned: false,
  lastSeen: 0,
  rssi: -70,
  name: key,
  ...extra,
});

test('a shown strength ignores jitter and follows a real change', () => {
  const steady = new SteadyRssi();
  assert.equal(steady.shown('a', -77), -77, 'no report yet: the fallback');
  steady.update('a', -70);
  for (const reading of [-72, -68, -71, -69, -73, -70]) steady.update('a', reading);
  assert.equal(steady.shown('a', 0), -70, 'jitter of a few dB changes nothing');
  for (let i = 0; i < 12; i++) steady.update('a', -55);
  assert.ok(steady.shown('a', 0) > -60, 'a real change shows');
  const before = steady.shown('a', 0);
  steady.update('a', -56);
  assert.equal(steady.shown('a', 0), before);
});

test('rows keep their place, and a new signal arrives at the top, marked', () => {
  const order = new StableOrder();
  const a = item('a', { lastSeen: 3 });
  const b = item('b', { lastSeen: 2 });
  const c = item('c', { lastSeen: 1 });
  let result = order.sync([c, a, b], 'new', 'all', 1000);
  assert.deepEqual(result.keys, ['a', 'b', 'c'], 'laid out newest first');
  assert.equal(result.fresh.size, 0, 'nothing is new in a fresh view');
  // c is heard again: it does not jump to the top.
  result = order.sync([a, b, { ...c, lastSeen: 99 }], 'new', 'all', 2000);
  assert.deepEqual(result.keys, ['a', 'b', 'c']);
  const d = item('d', { lastSeen: 100 });
  result = order.sync([a, b, c, d], 'new', 'all', 3000);
  assert.deepEqual(result.keys, ['d', 'a', 'b', 'c']);
  assert.deepEqual([...result.fresh], ['d']);
  result = order.sync([a, c, d], 'new', 'all', 3000 + NEW_ROW_MS);
  assert.deepEqual(result.keys, ['d', 'a', 'c'], 'one that leaves closes the gap');
  assert.equal(result.fresh.size, 0, 'the mark fades');
  // It comes back: new again.
  result = order.sync([a, b, c, d], 'new', 'all', 20_000);
  assert.deepEqual(result.keys, ['b', 'd', 'a', 'c']);
  assert.deepEqual([...result.fresh], ['b']);
});

test('watched signals stay first, and a changed view lays the list out afresh', () => {
  const order = new StableOrder();
  const a = item('a', { lastSeen: 3 });
  const b = item('b', { lastSeen: 2, pinned: true });
  const c = item('c', { lastSeen: 1 });
  assert.deepEqual(order.sync([a, b, c], 'new', 'all', 0).keys, ['b', 'a', 'c']);
  const later = [a, b, { ...c, lastSeen: 50 }];
  assert.deepEqual(order.sync(later, 'new', 'all', 100).keys, ['b', 'a', 'c']);
  const fresh = order.sync(later, 'new', 'wifi', 200);
  assert.deepEqual(fresh.keys, ['b', 'c', 'a'], 'another filter sorts again');
  assert.equal(fresh.fresh.size, 0);
});

test('sorting by strength holds still between re-sorts, and by name stays alphabetical', () => {
  const order = new StableOrder();
  const a = item('a', { rssi: -50 });
  const b = item('b', { rssi: -60 });
  assert.deepEqual(order.sync([a, b], 'strong', 's', 0).keys, ['a', 'b']);
  const flipped = [{ ...a, rssi: -80 }, b];
  assert.deepEqual(order.sync(flipped, 'strong', 's', RESORT_MS - 1).keys, ['a', 'b'], 'held');
  assert.deepEqual(order.sync(flipped, 'strong', 's', RESORT_MS).keys, ['b', 'a'], 're-sorted');
  const names = new StableOrder();
  assert.deepEqual(names.sync([item('m'), item('B')], 'name', 's', 0).keys, ['B', 'm']);
  assert.deepEqual(
    names.sync([item('m'), item('B'), item('c')], 'name', 's', 10).keys,
    ['B', 'c', 'm'],
    'a new row takes its alphabetical place',
  );
});
