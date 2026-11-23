/**
 * How the Signals tab names what the add-on heard, and the CSV it exports. No DOM, so it is tested
 * directly. Everything that came off the air (names, IDs) is untrusted text.
 */
import type { Heard, RemoteId } from '../../packages/agent-core/sensor.ts';
import {
  airText,
  displayName,
  strongestPlace,
  type SignalKind,
  type SignalRecord,
} from '../../packages/agent-core/signals-intel.ts';

import { csvCell } from '../../packages/agent-core/signals-log.ts';

export { airText, csvCell };

/** Not heard for this long: shown faded, and no longer counted as nearby. */
export const STALE_MS = 2 * 60_000;

export const formatAddress = (hex: string) => hex.toUpperCase().replace(/(..)(?!$)/g, '$1:');

const SECURITY = ['WEP', 'WPA', 'WPA2', 'WPA3', 'Enterprise', 'OWE'];
export function securityLabel(bits: number) {
  if (!bits) return 'Open';
  return SECURITY.filter((_, i) => bits & (1 << i)).join(' / ') || 'Unknown security';
}
export const TRACKERS: Record<number, string> = {
  1: 'Apple Find My',
  2: 'Tile',
  3: 'Samsung SmartTag',
  4: 'Google Find Hub',
};
const COMPANIES: Record<number, string> = {
  0x0006: 'Microsoft',
  0x004c: 'Apple',
  0x0059: 'Nordic Semiconductor',
  0x0075: 'Samsung',
  0x0087: 'Garmin',
  0x009e: 'Bose',
  0x00e0: 'Google',
  0x012d: 'Sony',
  0x0171: 'Amazon',
  0x02e5: 'Espressif',
  0x038f: 'Xiaomi',
};
export const ADDRESS_TYPES = [
  'public address',
  'random address',
  'private address',
  'private address',
];
export const PHYS: Record<number, string> = { 1: 'LE 1M', 2: 'LE 2M', 3: 'Long range' };
export const UA_TYPES = [
  'Unknown type',
  'Aeroplane',
  'Multirotor',
  'Gyroplane',
  'Hybrid lift',
  'Ornithopter',
  'Glider',
  'Kite',
  'Free balloon',
  'Captive balloon',
  'Airship',
  'Parachute',
  'Rocket',
  'Tethered aircraft',
  'Ground obstacle',
  'Other aircraft',
];
/** F3411's UAS ID types. */
export const ID_TYPES = ['No ID type', 'Serial number', 'Registration ID', 'UTM ID', 'Session ID'];
export const TRANSPORTS: Record<number, string> = {
  1: 'Bluetooth',
  2: 'Bluetooth long range',
  3: 'Wi-Fi beacon',
  4: 'Wi-Fi NAN',
};
/** Common 16-bit service UUIDs; others show as hex. */
const SERVICES: Record<string, string> = {
  '180A': 'Device information',
  '180D': 'Heart rate',
  '180F': 'Battery',
  '1812': 'Keyboard or mouse',
  '181C': 'User data',
  FD5A: 'Samsung SmartTag',
  FD6F: 'Exposure notification',
  FE2C: 'Google Fast Pair',
  FEAA: 'Eddystone',
  FEEC: 'Tile',
  FEED: 'Tile',
  FFFA: 'Remote ID',
};

export const bandLabel = (code: number) =>
  code === 2 ? '5 GHz' : code === 1 ? '2.4 GHz' : 'unknown band';
export const company = (id: number | undefined) =>
  id === undefined ? '' : (COMPANIES[id] ?? `Company 0x${id.toString(16).padStart(4, '0')}`);
export const tracker = (code: number | undefined) =>
  code === undefined ? '' : (TRACKERS[code] ?? 'Tracker');

/** A device's advertised 16-bit services, as UUIDs: two little-endian bytes each. */
export function serviceIds(hex: string | undefined) {
  const ids: string[] = [];
  for (let i = 0; hex && i + 4 <= hex.length; i += 4)
    ids.push((hex.slice(i + 2, i + 4) + hex.slice(i, i + 2)).toUpperCase());
  return ids;
}
export const serviceLabel = (id: string) => (SERVICES[id] ? `${SERVICES[id]} (${id})` : id);

/** The drones heard recently, for the badge on the Signals button. */
export function nearbyDrones(drones: Iterable<Heard<RemoteId>>, now: number) {
  let count = 0;
  for (const drone of drones) if (now - drone.receivedAt <= STALE_MS) count++;
  return count;
}

type Cell = string | number | undefined;
const csv = (rows: Cell[][]) => rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
const iso = (ms: number) => new Date(ms).toISOString();

export const KIND_LABELS: Record<SignalKind, string> = {
  drone: 'Drone',
  wifi: 'Wi-Fi network',
  bluetooth: 'Bluetooth device',
  probe: 'Searching device',
};

/** One line saying what a transmitter is, from what it sent. */
export function describe(record: SignalRecord) {
  const r = record.latest;
  switch (r.type) {
    case 'remoteId':
      return [UA_TYPES[r.uaType] ?? 'Unknown type', TRANSPORTS[r.transport] ?? 'Remote ID'].join(
        ' · ',
      );
    case 'wifiAp':
      return `${securityLabel(r.security)} · ${bandLabel(r.band)} channel ${r.channel}`;
    case 'bleDevice':
      return (
        [tracker(r.tracker), company(r.manufacturer), PHYS[r.phy]].filter(Boolean).join(' · ') ||
        'Bluetooth LE'
      );
    case 'wifiProbe':
      return `${bandLabel(r.band)} channel ${r.channel}`;
  }
}

/** Every shown signal as CSV, one row each. Times are UTC and positions degrees. */
export function historyCsv(
  records: readonly SignalRecord[],
  identityOf?: (record: SignalRecord) => { category: string; maker?: string },
): string {
  return csv([
    [
      'Kind',
      'Name',
      'Most likely',
      'Maker',
      'Address or ID',
      'Private address',
      'Details',
      'Last signal (dBm)',
      'Strongest (dBm)',
      'First heard',
      'Last heard',
      'Times heard',
      'Last heard from latitude',
      'Last heard from longitude',
      'Strongest from latitude',
      'Strongest from longitude',
      'Reported latitude',
      'Reported longitude',
      'Note',
      'Tags',
      'Watched',
      'Known',
      'Searched for',
    ],
    ...records.map(record => {
      const r = record.latest;
      const strongest = strongestPlace(record);
      const reported =
        r.type === 'remoteId' && r.latitude !== undefined && r.longitude !== undefined
          ? [r.latitude / 1e7, r.longitude / 1e7]
          : [undefined, undefined];
      const identity = identityOf?.(record);
      return [
        KIND_LABELS[record.kind],
        displayName(record),
        identity?.category,
        identity?.maker,
        record.kind === 'drone' ? airText(record.id) || record.id : formatAddress(record.id),
        record.privateAddress ? 'yes' : 'no',
        describe(record),
        r.rssi,
        record.bestRssi,
        iso(record.firstSeen),
        iso(record.lastSeen),
        record.visits,
        record.lastPlace?.lat,
        record.lastPlace?.lon,
        strongest?.lat,
        strongest?.lon,
        ...reported,
        record.note,
        record.tags?.join(' '),
        record.watch ? 'yes' : 'no',
        record.known ? 'yes' : 'no',
        record.probed?.map(ssid => airText(ssid)).join(' | '),
      ];
    }),
  ]);
}
