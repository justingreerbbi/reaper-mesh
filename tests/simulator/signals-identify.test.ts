// Identifying signals (D61): the reference pack, the rules, corrections and WiGLE lookups.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  checkReferencePack,
  identify,
  Reference,
  type ReferencePack,
} from '../../packages/agent-core/signals-identify.ts';
import {
  MemoryHistoryStorage,
  placementOf,
  SignalHistory,
  type SignalReport,
} from '../../packages/agent-core/signals-intel.ts';
import { lookupWigle, parseWigle, WigleError } from '../../packages/agent-core/wigle.ts';

const pack = JSON.parse(
  readFileSync('agents/web/public/signals-reference.v1.json', 'utf8'),
) as ReferencePack;
const reference = new Reference(pack);
const hex = (text: string) => Buffer.from(text).toString('hex');
const history = () => new SignalHistory(new MemoryHistoryStorage());
const ap = (address: string, ssid: string, extra: object = {}): SignalReport => ({
  type: 'wifiAp',
  boot: 'b',
  at: 1,
  address,
  ssid: hex(ssid),
  hidden: 0,
  channel: 6,
  band: 1,
  security: 4,
  rssi: -60,
  rssiMin: -60,
  rssiMax: -60,
  count: 1,
  ...extra,
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

test('the committed reference pack is well formed and finds makers', () => {
  assert.equal(checkReferencePack(pack), undefined);
  assert.ok(reference.makerCount > 10_000);
  assert.match(reference.maker('b827eb010203')!, /Raspberry Pi/);
  assert.match(reference.maker('24a160010203')!, /Espressif/);
  assert.equal(reference.company(0x004c), 'Apple, Inc.');
  assert.equal(reference.service('180f'), 'Battery Service');
  assert.equal(reference.maker('020000000000'), undefined);
});

test('a malformed pack is refused with a reason', () => {
  assert.match(checkReferencePack({ ...pack, version: 2 })!, /version/);
  assert.match(checkReferencePack({ ...pack, oui: { ...pack.oui, mal: 'ZZZ' } })!, /mal entry/);
  assert.match(
    checkReferencePack({ ...pack, makers: [], oui: { mal: 'AABBCC0', mam: '', mas: '' } })!,
    /names no maker/,
  );
  assert.match(checkReferencePack(null)!, /not an object/);
});

test('guesses come from addresses, Bluetooth data, services and names, with reasons', () => {
  const h = history();
  const pi = identify(h.observe(ap('b827eb010203', 'lab'), 1), reference);
  assert.equal(pi.category, 'computer');
  assert.match(pi.maker!, /Raspberry Pi/);
  assert.ok(pi.reasons.some(r => /address belongs to/.test(r)));

  const tag = identify(
    h.observe(ble('c0ffee000001', { tracker: 1, manufacturer: 0x004c }), 1),
    reference,
  );
  assert.equal(tag.category, 'tracker');
  assert.equal(tag.confidence, 'high');

  const printer = identify(
    h.observe(ap('060000000001', 'DIRECT-7A-HP M283 LaserJet'), 1),
    reference,
  );
  assert.equal(printer.category, 'printer');
  assert.equal(printer.maker, 'HP');

  const isp = identify(h.observe(ap('0a0000000002', 'xfinitywifi'), 1), reference);
  assert.equal(isp.category, 'access-point');

  const heart = identify(
    h.observe(ble('c0ffee000002', { services: '0d18' /* 180D little-endian */ }), 1),
    reference,
  );
  assert.equal(heart.category, 'wearable');

  const phone = identify(h.observe(ble('7affee000003', { addressType: 2 }), 1), reference);
  assert.equal(phone.category, 'phone');
  assert.equal(phone.confidence, 'low');
  assert.equal(phone.maker, undefined, 'a changing address names no maker');

  const drone = identify(
    h.observe(
      {
        type: 'remoteId',
        boot: 'b',
        at: 1,
        transport: 1,
        uasId: hex('1581F5FJ9C'),
        idType: 1,
        uaType: 2,
        rssi: -70,
      },
      1,
    ),
    reference,
  );
  assert.equal(drone.category, 'drone');
  assert.equal(drone.maker, 'DJI');

  const nothing = identify(h.observe(ble('c0ffee000004'), 1));
  assert.equal(nothing.category, 'unknown');
  assert.deepEqual(nothing.reasons, ['Nothing it sends says what it is']);
});

test('the user’s correction wins, and a rule by name teaches the same answer for others', () => {
  const h = history();
  const truck = h.observe(ap('0a0000000010', 'Unit 12'), 1);
  const other = h.observe(ap('0a0000000011', 'Unit 12'), 1);
  h.annotate(truck.key, { identity: { category: 'vehicle', maker: 'Ford' } });
  const corrected = identify(truck, reference);
  assert.equal(corrected.category, 'vehicle');
  assert.equal(corrected.fromUser, true);
  const learned = [{ kind: 'wifi' as const, name: 'unit 12', category: 'vehicle' as const }];
  assert.equal(identify(other, reference, learned).category, 'vehicle');
  assert.equal(identify(other, reference, []).category, 'access-point');
  const named = h.observe(ble('c0ffee000020', { name: hex('Unit 12') }), 1);
  assert.notEqual(identify(named, reference, learned).category, 'vehicle', 'rules are per kind');
});

test('WiGLE answers are read safely, and its position places the network', () => {
  const found = parseWigle(
    {
      success: true,
      results: [
        {
          trilat: 38.9001,
          trilong: -77.0002,
          ssid: 'Field Net',
          city: 'Arlington',
          region: 'VA',
          country: 'US',
          firsttime: '2021-04-01T00:00:00.000Z',
          lasttime: '2026-10-02T00:00:00.000Z',
        },
      ],
    },
    5,
  );
  assert.deepEqual(found, {
    at: 5,
    source: 'wigle',
    found: true,
    place: { lat: 38.9001, lon: -77.0002 },
    ssid: 'Field Net',
    firstSeen: '2021-04-01T00:00:00.000Z',
    lastSeen: '2026-10-02T00:00:00.000Z',
    where: 'Arlington, VA, US',
  });
  assert.deepEqual(parseWigle({ results: [] }, 5), { at: 5, source: 'wigle', found: false });
  assert.deepEqual(parseWigle('nonsense', 5), { at: 5, source: 'wigle', found: false });
  assert.equal(parseWigle({ results: [{ trilat: 200, trilong: 0 }] }, 5).place, undefined);

  const h = history();
  const record = h.observe(ap('aabbccddeeff', 'Field Net'), 1);
  h.annotate(record.key, { lookup: found });
  const placement = placementOf(record, { lat: 38.9, lon: -77 });
  assert.equal(placement.how, 'estimated');
  assert.equal(placement.source, 'lookup');
  assert.ok(placement.distance > 5 && placement.distance < 30);
});

test('WiGLE lookups send the address with the user’s key, and report refusals', async () => {
  let asked: { url: string; auth: string } | undefined;
  const reply = (status: number, body: unknown) => async (url: string, init: RequestInit) => {
    asked = { url, auth: (init.headers as Record<string, string>).Authorization };
    return new Response(JSON.stringify(body), { status });
  };
  const result = await lookupWigle(
    'aabbccddeeff',
    { name: 'AIDuser', token: 'secret' },
    { fetch: reply(200, { results: [{ ssid: 'X' }] }), now: () => 9 },
  );
  assert.equal(result.ssid, 'X');
  assert.match(asked!.url, /netid=AA%3ABB%3ACC%3ADD%3AEE%3AFF$/);
  assert.equal(asked!.auth, `Basic ${btoa('AIDuser:secret')}`);
  await assert.rejects(
    lookupWigle('aa', { name: 'a', token: 'b' }, { fetch: reply(401, {}) }),
    (error: WigleError) => error.stop && /refused/.test(error.message),
  );
  await assert.rejects(
    lookupWigle('aa', { name: 'a', token: 'b' }, { fetch: reply(429, {}) }),
    (error: WigleError) => error.stop && /limit/.test(error.message),
  );
  await assert.rejects(
    lookupWigle(
      'aa',
      { name: 'a', token: 'b' },
      {
        fetch: async () => {
          throw new TypeError('offline');
        },
      },
    ),
    (error: WigleError) => !error.stop,
  );
});
