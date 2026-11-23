// The Signals tab's labels and CSV export (agents/web/signals-format.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  airText,
  csvCell,
  nearbyDrones,
  securityLabel,
  serviceIds,
  serviceLabel,
  historyCsv,
  STALE_MS,
} from '../../agents/web/signals-format.ts';
import { SensorStore, type Heard, type RemoteId } from '../../packages/agent-core/sensor.ts';
import { MemoryHistoryStorage, SignalHistory } from '../../packages/agent-core/signals-intel.ts';

const hex = (text: string) => Buffer.from(text).toString('hex');

test('text from the air is decoded leniently and stripped of control characters', () => {
  assert.equal(airText(hex('Field\u0007 Net\n')), 'Field Net');
  assert.equal(airText('ff41'), '�A');
  assert.equal(airText(undefined), '');
  assert.equal(securityLabel(0), 'Open');
  assert.equal(securityLabel(0b1100), 'WPA2 / WPA3');
});

test('services are read as little-endian 16-bit UUIDs', () => {
  assert.deepEqual(serviceIds('0f18faff3412'), ['180F', 'FFFA', '1234']);
  assert.deepEqual(serviceIds(undefined), []);
  assert.equal(serviceLabel('180F'), 'Battery (180F)');
  assert.equal(serviceLabel('1234'), '1234');
});

test('CSV cells quote separators and keep formulas from the air as text', () => {
  assert.equal(csvCell('Field Net'), 'Field Net');
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('=HYPERLINK("x")'), `"'=HYPERLINK(""x"")"`);
  assert.equal(csvCell('+1'), "'+1");
  assert.equal(csvCell('@cmd'), "'@cmd");
  assert.equal(csvCell(-61), '-61', 'numbers are not text');
  assert.equal(csvCell(undefined), '');
  assert.equal(csvCell(Number.NaN), '');
});

function drone(overrides: Partial<Heard<RemoteId>> = {}): Heard<RemoteId> {
  return {
    type: 'remoteId',
    boot: 'b',
    at: 1,
    transport: 1,
    uasId: hex('1581F0TEST'),
    idType: 1,
    uaType: 2,
    rssi: -70,
    latitude: 389_000_000,
    longitude: -770_365_000,
    altitude: 1225,
    speed: 1000,
    heading: 27_000,
    operatorId: hex('=cmd'),
    receivedAt: Date.UTC(2026, 10, 23, 12, 1),
    firstReceivedAt: Date.UTC(2026, 10, 23, 12, 0),
    ...overrides,
  };
}

test('the export has one row per signal, with notes and places', () => {
  const history = new SignalHistory(new MemoryHistoryStorage());
  const { receivedAt: _r, firstReceivedAt: _f, ...report } = drone();
  history.observe(report, Date.UTC(2026, 10, 23, 12, 0), { lat: 38.9, lon: -77 });
  history.observe(
    {
      type: 'wifiAp',
      boot: 'b',
      at: 1,
      address: '02a1b2c3d4e5',
      ssid: hex('Cafe, "free"'),
      hidden: 0,
      channel: 149,
      band: 2,
      security: 0,
      rssi: -61,
      rssiMin: -70,
      rssiMax: -55,
      count: 4,
    },
    1000,
  );
  history.annotate('wifi:02a1b2c3d4e5', { note: '=cmd', tags: ['cafe', 'open'], watch: true });
  const [head, droneRow, wifiRow, end] = historyCsv([...history.records.values()]).split('\r\n');
  assert.match(head, /^Kind,Name,Most likely,Maker,Address or ID,Private address,Details,/);
  assert.equal(
    droneRow,
    'Drone,1581F0TEST,,,1581F0TEST,no,Multirotor · Bluetooth,-70,-70,2026-11-23T12:00:00.000Z,' +
      '2026-11-23T12:00:00.000Z,1,38.9,-77,38.9,-77,38.9,-77.0365,,,no,no,',
  );
  assert.equal(
    wifiRow,
    'Wi-Fi network,"Cafe, ""free""",,,02:A1:B2:C3:D4:E5,yes,Open · 5 GHz channel 149,-61,-61,' +
      "1970-01-01T00:00:01.000Z,1970-01-01T00:00:01.000Z,1,,,,,,,'=cmd,cafe open,yes,no,",
  );
  assert.equal(end, '');
});

test('drones are counted while recent', () => {
  const now = Date.UTC(2026, 10, 23, 12, 1);
  const old = drone({ uasId: hex('OLD'), receivedAt: now - STALE_MS - 1 });
  assert.equal(nearbyDrones([drone(), old], now), 1);
});

test('the store keeps when a transmitter was first heard', () => {
  const store = new SensorStore();
  const { receivedAt: _r, firstReceivedAt: _f, ...message } = drone();
  store.apply(message, 100);
  store.apply({ ...message, rssi: -50 }, 900);
  const kept = store.drones.get(message.uasId)!;
  assert.equal(kept.firstReceivedAt, 100);
  assert.equal(kept.receivedAt, 900);
  assert.equal(kept.rssi, -50);
});
