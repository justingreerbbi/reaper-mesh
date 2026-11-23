// Hunting one signal (D61): the beep, smoothing, warmer or colder, and losing it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { beepFor, closeness, Hunt, lostAfter } from '../../packages/agent-core/signals-hunt.ts';

test('the beep gets faster and higher as the signal gets stronger', () => {
  const faint = beepFor(-100, false);
  const middle = beepFor(-67, false);
  const close = beepFor(-35, false);
  assert.deepEqual(faint, { interval: 1500, pitch: 350, lost: false });
  assert.deepEqual(close, { interval: 105, pitch: 1600, lost: false });
  assert.ok(middle.interval < faint.interval && middle.interval > close.interval);
  assert.ok(middle.pitch > faint.pitch && middle.pitch < close.pitch);
  assert.deepEqual(beepFor(-50, true), { interval: 2000, pitch: 220, lost: true });
  assert.deepEqual(beepFor(undefined, false), { interval: 2000, pitch: 220, lost: true });
  assert.equal(closeness(-95), 0);
  assert.equal(closeness(-40), 1);
});

test('reports are smoothed, the peak is kept, and the trend follows the user', () => {
  const hunt = new Hunt('wifi:aabbccddeeff', 'wifi', 0);
  assert.equal(hunt.trend(0), 'unknown');
  hunt.feed(-80, 0);
  hunt.feed(-70, 1000);
  assert.equal(hunt.smoothed, -75, 'half of each new report');
  assert.equal(hunt.peak, -70);
  for (let at = 2000; at <= 6000; at += 1000) hunt.feed(-80, at);
  for (let at = 7000; at <= 12_000; at += 1000) hunt.feed(-60, at);
  assert.equal(hunt.trend(12_000), 'warmer');
  for (let at = 13_000; at <= 22_000; at += 1000) hunt.feed(-60, at);
  assert.equal(hunt.trend(22_000), 'steady');
  for (let at = 23_000; at <= 28_000; at += 1000) hunt.feed(-85, at);
  assert.equal(hunt.trend(28_000), 'colder');
  assert.ok(hunt.distance()! > 10);
});

test('a hunted signal is lost after its expected reports stop', () => {
  assert.equal(lostAfter('wifi', false), 12_000);
  assert.equal(lostAfter('drone', false), 3000);
  assert.equal(lostAfter('bluetooth', true), 3000);
  const hunt = new Hunt('bluetooth:aa', 'bluetooth', 0);
  assert.equal(hunt.isLost(0), true, 'not heard yet');
  hunt.feed(-60, 1000);
  assert.equal(hunt.isLost(12_000), false);
  assert.equal(hunt.isLost(13_001), true);
  assert.equal(hunt.isLost(4001, true), true, 'quicker when reports come fast');
  assert.equal(hunt.beep(13_001).lost, true);
});
