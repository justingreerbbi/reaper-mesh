/**
 * Signals intelligence (D61): the history of every transmitter the signals add-on has heard, where
 * the user was when it was heard, the user's notes, and where each transmitter probably is.
 * Transport- and storage-independent, so the portal and a mobile app share it. The design is
 * docs/contributing/signals-intel-design.md.
 *
 * One antenna measures no direction. A position is either reported by the transmitter (Remote ID),
 * estimated from reports heard at several of the user's positions, or unknown, leaving only a
 * distance from signal strength. Every placement says which.
 */
import type { SensorMessage } from '../protocol/sensor-messages.ts';
import type { IdentityOverride } from './signals-identify.ts';

export type SignalKind = 'drone' | 'wifi' | 'bluetooth' | 'probe';
type Of<T extends SensorMessage['type']> = Extract<SensorMessage, { type: T }>;
/** The reports that describe a transmitter. */
export type SignalReport = Of<'wifiAp'> | Of<'bleDevice'> | Of<'wifiProbe'> | Of<'remoteId'>;
/** Degrees, and metres of accuracy when the source gives it. */
export type Place = Readonly<{ lat: number; lon: number; accuracy?: number | null }>;

/** One minute of reports from one transmitter. */
export type Sighting = Readonly<{
  /** Start of the minute, in milliseconds. */
  at: number;
  rssi: number;
  count: number;
  place?: Place;
}>;
/** What an online service knows about a Wi-Fi network (D61), kept with the record. */
export type NetworkLookup = Readonly<{
  at: number;
  source: 'wigle';
  found: boolean;
  /** Where the service places the network, usually from many people's reports. */
  place?: Place;
  ssid?: string;
  firstSeen?: string;
  lastSeen?: string;
  /** Town, region and country, as the service gives them. */
  where?: string;
}>;
/** A reported position (drones), with height in metres when known. */
export type TrackPoint = Readonly<{ at: number; lat: number; lon: number; altitude?: number }>;

export type SignalRecord = {
  readonly key: string;
  readonly kind: SignalKind;
  /** Address (hex) or, for drones, the UAS ID (hex). */
  readonly id: string;
  /** The last report as sent, which carries the name, channel, maker and so on. */
  latest: SignalReport;
  firstSeen: number;
  lastSeen: number;
  /** Separate times it was heard: a gap of VISIT_GAP_MS starts a new one. */
  visits: number;
  /** A private Bluetooth address or a locally administered MAC: it changes, so it names no maker. */
  privateAddress: boolean;
  bestRssi: number;
  bestAt: number;
  /** Where the user was when it was last heard (strongest: see strongestPlace). */
  lastPlace?: Place;
  sightings: Sighting[];
  track?: TrackPoint[];
  /** The user's own: a name, a note, tags, and whether to be told when it is heard again. */
  label?: string;
  note?: string;
  tags?: string[];
  watch?: boolean;
  /** The user's correction of what it is. */
  identity?: IdentityOverride;
  lookup?: NetworkLookup;
};

export type Annotation = Partial<
  Pick<SignalRecord, 'label' | 'note' | 'tags' | 'watch' | 'identity' | 'lookup'>
>;

/** Where history is kept: IndexedDB in the portal, memory in tests. */
export interface HistoryStorage {
  loadAll(): Promise<SignalRecord[]>;
  put(records: readonly SignalRecord[]): Promise<void>;
  delete(keys: readonly string[]): Promise<void>;
  clear(): Promise<void>;
}

export const HISTORY_LIMITS = Object.freeze({
  /** Records kept in all; past this, the least recently heard unannotated one goes. */
  records: 20_000,
  sightings: 500,
  track: 2000,
});
/** A transmitter not heard for this long is a new visit when heard again. */
export const VISIT_GAP_MS = 10 * 60_000;
/** Heard within this long counts as "heard now". */
export const NOW_MS = 2 * 60_000;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/** Track points closer together than this are merged. */
const TRACK_STEP_MS = 2000;

const decoder = new TextDecoder('utf-8', { fatal: false });
/** Text the air sent: decoded leniently, with control characters removed. */
export function airText(hex: string | undefined) {
  if (!hex) return '';
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(2 * i, 2 * i + 2), 16);
  return decoder
    .decode(bytes)
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
    .trim();
}

export function kindOf(report: SignalReport): SignalKind {
  switch (report.type) {
    case 'remoteId':
      return 'drone';
    case 'wifiAp':
      return 'wifi';
    case 'bleDevice':
      return 'bluetooth';
    case 'wifiProbe':
      return 'probe';
  }
}
export const idOf = (report: SignalReport) =>
  report.type === 'remoteId' ? report.uasId : report.address;
export const keyOf = (report: SignalReport) => `${kindOf(report)}:${idOf(report)}`;

/** Whether the address is one that changes, so it identifies neither a maker nor a device. */
export function isPrivateAddress(report: SignalReport) {
  if (report.type === 'remoteId') return false;
  if (report.type === 'bleDevice') return report.addressType === 2 || report.addressType === 3;
  return (parseInt(report.address.slice(0, 2), 16) & 0x02) !== 0;
}

/** The name to show: the user's, then the one sent, then a description. */
export function displayName(record: SignalRecord) {
  if (record.label) return record.label;
  const r = record.latest;
  switch (r.type) {
    case 'remoteId':
      return airText(r.uasId) || 'Drone';
    case 'wifiAp':
      return r.hidden ? 'Hidden network' : airText(r.ssid) || 'Unnamed network';
    case 'bleDevice':
      return airText(r.name) || (r.tracker ? 'Tracker' : 'Bluetooth device');
    case 'wifiProbe': {
      const wanted = airText(r.ssid);
      return wanted ? `Looking for “${wanted}”` : 'Searching device';
    }
  }
}

const annotated = (record: SignalRecord) =>
  !!(record.label || record.note || record.tags?.length || record.watch || record.identity);

function addSighting(record: SignalRecord, at: number, rssi: number, place?: Place) {
  const minute = at - (at % MINUTE);
  const last = record.sightings[record.sightings.length - 1];
  if (last && last.at === minute) {
    record.sightings[record.sightings.length - 1] = {
      at: minute,
      rssi: Math.max(last.rssi, rssi),
      count: last.count + 1,
      place: rssi >= last.rssi && place ? place : last.place,
    };
  } else
    record.sightings.push(
      place ? { at: minute, rssi, count: 1, place } : { at: minute, rssi, count: 1 },
    );
  if (record.sightings.length > HISTORY_LIMITS.sightings) thin(record.sightings);
}

/** Keeps the newest half as is, and one sighting per hour before it (the strongest). */
function thin(sightings: Sighting[]) {
  const split = sightings.length >> 1;
  const old: Sighting[] = [];
  for (const sighting of sightings.slice(0, split)) {
    const hour = sighting.at - (sighting.at % HOUR);
    const last = old[old.length - 1];
    if (last && last.at - (last.at % HOUR) === hour) {
      old[old.length - 1] = {
        ...(sighting.rssi > last.rssi ? sighting : last),
        count: last.count + sighting.count,
      };
    } else old.push(sighting);
  }
  sightings.splice(0, split, ...old);
  // Still too many after thinning hours: drop the oldest.
  if (sightings.length > HISTORY_LIMITS.sightings)
    sightings.splice(0, sightings.length - HISTORY_LIMITS.sightings);
}

function addTrack(record: SignalRecord, report: Of<'remoteId'>, at: number) {
  if (report.latitude === undefined || report.longitude === undefined) return;
  const point: TrackPoint = {
    at,
    lat: report.latitude / 1e7,
    lon: report.longitude / 1e7,
    ...(report.height !== undefined ? { altitude: report.height / 10 } : {}),
  };
  const track = (record.track ??= []);
  const last = track[track.length - 1];
  if (last && at - last.at < TRACK_STEP_MS) track[track.length - 1] = point;
  else track.push(point);
  if (track.length > HISTORY_LIMITS.track) track.splice(0, track.length - HISTORY_LIMITS.track);
}

/**
 * Every transmitter heard, kept across sessions. Changes are held in memory and written by flush(),
 * which the app calls every few seconds and when it closes.
 */
export class SignalHistory {
  readonly records = new Map<string, SignalRecord>();
  /** Changes whenever a record does, so a view can tell when to redraw. */
  version = 0;
  #storage: HistoryStorage;
  #dirty = new Set<string>();
  #deleted = new Set<string>();

  constructor(storage: HistoryStorage) {
    this.#storage = storage;
  }

  async load() {
    for (const record of await this.#storage.loadAll()) this.records.set(record.key, record);
    this.version++;
  }

  /** Records a report heard at `at`, with the user's position then, if known. */
  observe(report: SignalReport, at: number, place?: Place): SignalRecord {
    const key = keyOf(report);
    let record = this.records.get(key);
    if (!record) {
      record = {
        key,
        kind: kindOf(report),
        id: idOf(report),
        latest: report,
        firstSeen: at,
        lastSeen: at,
        visits: 1,
        privateAddress: isPrivateAddress(report),
        bestRssi: report.rssi,
        bestAt: at,
        sightings: [],
      };
      this.records.set(key, record);
      this.#cap();
    } else {
      if (at - record.lastSeen > VISIT_GAP_MS) record.visits++;
      record.latest = report;
      record.lastSeen = Math.max(record.lastSeen, at);
      if (report.rssi >= record.bestRssi) {
        record.bestRssi = report.rssi;
        record.bestAt = at;
      }
    }
    if (place) record.lastPlace = place;
    addSighting(record, at, report.rssi, place);
    if (report.type === 'remoteId') addTrack(record, report, at);
    this.#dirty.add(key);
    this.version++;
    return record;
  }

  annotate(key: string, change: Annotation) {
    const record = this.records.get(key);
    if (!record) return;
    for (const [field, value] of Object.entries(change) as [keyof Annotation, unknown][]) {
      const empty = value === undefined || value === '' || value === false;
      const list = Array.isArray(value) && value.length === 0;
      if (empty || list) delete record[field];
      else (record as Record<string, unknown>)[field] = value;
    }
    this.#dirty.add(key);
    this.version++;
  }

  remove(key: string) {
    if (!this.records.delete(key)) return;
    this.#dirty.delete(key);
    this.#deleted.add(key);
    this.version++;
  }

  async clear() {
    this.records.clear();
    this.#dirty.clear();
    this.#deleted.clear();
    this.version++;
    await this.#storage.clear();
  }

  /** Writes what changed since the last flush. */
  async flush() {
    const deleted = [...this.#deleted];
    const changed = [...this.#dirty].map(key => this.records.get(key)).filter(r => !!r);
    this.#deleted.clear();
    this.#dirty.clear();
    if (deleted.length) await this.#storage.delete(deleted);
    if (changed.length) await this.#storage.put(changed);
  }

  #cap() {
    if (this.records.size <= HISTORY_LIMITS.records) return;
    let oldest: SignalRecord | undefined;
    for (const record of this.records.values())
      if (!annotated(record) && (!oldest || record.lastSeen < oldest.lastSeen)) oldest = record;
    if (oldest) this.remove(oldest.key);
  }
}

export class MemoryHistoryStorage implements HistoryStorage {
  readonly rows = new Map<string, SignalRecord>();
  async loadAll() {
    return [...this.rows.values()].map(row => structuredClone(row));
  }
  async put(records: readonly SignalRecord[]) {
    for (const record of records) this.rows.set(record.key, structuredClone(record));
  }
  async delete(keys: readonly string[]) {
    for (const key of keys) this.rows.delete(key);
  }
  async clear() {
    this.rows.clear();
  }
}

// Where things are.

/** Where the user was when the transmitter was heard strongest, among sightings with a place. */
export function strongestPlace(record: SignalRecord) {
  let best: Sighting | undefined;
  for (const sighting of record.sightings)
    if (sighting.place && (!best || sighting.rssi >= best.rssi)) best = sighting;
  return best?.place;
}

const EARTH_RADIUS = 6_371_000;
const rad = (degrees: number) => (degrees * Math.PI) / 180;

/** Metres between two places. */
export function distanceBetween(a: Place, b: Place) {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(h)));
}
/** Degrees from true north, from `a` towards `b`. */
export function bearingBetween(a: Place, b: Place) {
  const y = Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat));
  const x =
    Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) -
    Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/**
 * Signal strength at one metre and the path-loss exponent, per kind. Typical values: an access
 * point transmits more than a phone's Bluetooth. Real distances differ by a factor of two or three.
 */
const PATH_LOSS: Record<SignalKind, { atOneMetre: number; exponent: number }> = {
  wifi: { atOneMetre: -40, exponent: 2.7 },
  probe: { atOneMetre: -45, exponent: 2.7 },
  bluetooth: { atOneMetre: -59, exponent: 2.5 },
  drone: { atOneMetre: -50, exponent: 2.2 },
};
/** A rough distance in metres from signal strength, between 0.5 m and 2 km. */
export function distanceFromRssi(kind: SignalKind, rssi: number) {
  const { atOneMetre, exponent } = PATH_LOSS[kind];
  return Math.min(2000, Math.max(0.5, 10 ** ((atOneMetre - rssi) / (10 * exponent))));
}

/** Least spread of the user's positions, in metres, before a position is estimated from them. */
export const ESTIMATE_SPREAD_M = 30;
const ESTIMATE_PLACES = 3;
/** Sightings used: the strongest ones. */
const ESTIMATE_SAMPLES = 40;

/**
 * Where a transmitter probably is, from the user's positions weighted by received power: the
 * strongest reports pull hardest. Undefined until it was heard from three places at least 30 m
 * apart. `error` is metres, and never less than 10.
 */
export function estimatePlace(sightings: readonly Sighting[]) {
  const placed = sightings
    .filter((s): s is Sighting & { place: Place } => !!s.place)
    .sort((a, b) => b.rssi - a.rssi)
    .slice(0, ESTIMATE_SAMPLES);
  if (placed.length < ESTIMATE_PLACES) return undefined;
  let spread = 0;
  for (let i = 0; i < placed.length; i++)
    for (let j = i + 1; j < placed.length; j++)
      spread = Math.max(spread, distanceBetween(placed[i].place, placed[j].place));
  if (spread < ESTIMATE_SPREAD_M) return undefined;
  let total = 0;
  let lat = 0;
  let lon = 0;
  for (const s of placed) {
    const weight = 10 ** (s.rssi / 10); // Milliwatts.
    total += weight;
    lat += s.place.lat * weight;
    lon += s.place.lon * weight;
  }
  const centre = { lat: lat / total, lon: lon / total };
  let error = 0;
  for (const s of placed) error += distanceBetween(centre, s.place) * (10 ** (s.rssi / 10) / total);
  return { place: centre as Place, error: Math.max(10, error) };
}

export type Placement = Readonly<{
  /** Reported by the transmitter, estimated from the user's movement, or distance only. */
  how: 'reported' | 'estimated' | 'distance';
  distance: number;
  /** Degrees from true north, or undefined when direction is unknown. */
  bearing?: number;
  /** Metres, for an estimate. */
  error?: number;
  /** What an estimate came from: the user's movement, or an online lookup's position. */
  source?: 'movement' | 'lookup';
  /** Where it is, when known. */
  place?: Place;
}>;

/** A looked-up network's position is a crowd average, good to tens of metres. */
const LOOKUP_ERROR_M = 75;

/** Where to draw a transmitter relative to the user at `me` (if the user's position is known). */
export function placementOf(record: SignalRecord, me?: Place): Placement {
  const r = record.latest;
  if (r.type === 'remoteId' && r.latitude !== undefined && r.longitude !== undefined) {
    const place = { lat: r.latitude / 1e7, lon: r.longitude / 1e7 };
    if (me)
      return {
        how: 'reported',
        place,
        distance: distanceBetween(me, place),
        bearing: bearingBetween(me, place),
      };
  }
  if (record.lookup?.place && me)
    return {
      how: 'estimated',
      source: 'lookup',
      place: record.lookup.place,
      error: LOOKUP_ERROR_M,
      distance: distanceBetween(me, record.lookup.place),
      bearing: bearingBetween(me, record.lookup.place),
    };
  const estimate = estimatePlace(record.sightings);
  if (estimate && me)
    return {
      how: 'estimated',
      source: 'movement',
      place: estimate.place,
      error: estimate.error,
      distance: distanceBetween(me, estimate.place),
      bearing: bearingBetween(me, estimate.place),
    };
  return { how: 'distance', distance: distanceFromRssi(record.kind, r.rssi) };
}

/** A steady angle for a transmitter whose direction is unknown, so it doesn't wander on screen. */
export function steadyAngle(key: string) {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) hash = Math.imul(hash ^ key.charCodeAt(i), 16777619);
  return (hash >>> 0) % 360;
}

// Filters.

export type QuickFilter = 'now' | 'watched' | 'noted' | 'today' | 'telemetry';
export type SignalFilter = Readonly<{
  /** Kinds shown; empty means all. */
  kinds?: readonly SignalKind[];
  quick?: readonly QuickFilter[];
  /** Lower-case text matched against names, addresses, notes and tags. */
  text?: string;
  /** Weakest last signal shown, in dBm. */
  minRssi?: number;
  hidePrivate?: boolean;
  /** Only those heard within this many milliseconds. */
  within?: number;
  /** Only this category (signals-identify.ts), with identityOf given to matchesFilter. */
  category?: string;
}>;

/** What identification says about a record, for filtering and search. */
export type IdentityOf = (
  record: SignalRecord,
) => Readonly<{ category: string; maker?: string; label: string }>;

export function hasTelemetry(record: SignalRecord) {
  return record.kind === 'drone';
}

const startOfDay = (now: number) => {
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
};

/** The words a search looks in. */
export function searchText(record: SignalRecord) {
  const r = record.latest;
  const words = [displayName(record), record.id, record.note ?? '', ...(record.tags ?? [])];
  if (r.type === 'remoteId') words.push(airText(r.operatorId));
  if (r.type === 'wifiAp' || r.type === 'wifiProbe') words.push(airText(r.ssid));
  if (r.type === 'bleDevice') words.push(airText(r.name));
  return words.join(' ').toLowerCase();
}

export function matchesFilter(
  record: SignalRecord,
  filter: SignalFilter,
  now: number,
  identityOf?: IdentityOf,
) {
  if (filter.kinds?.length && !filter.kinds.includes(record.kind)) return false;
  // Phones' Bluetooth addresses change about every 15 minutes, so each phone becomes many entries.
  if (
    filter.hidePrivate &&
    record.kind === 'bluetooth' &&
    record.privateAddress &&
    !annotated(record)
  )
    return false;
  if (filter.minRssi !== undefined && record.latest.rssi < filter.minRssi) return false;
  if (filter.within !== undefined && now - record.lastSeen > filter.within) return false;
  for (const quick of filter.quick ?? []) {
    if (quick === 'now' && now - record.lastSeen > NOW_MS) return false;
    if (quick === 'watched' && !record.watch) return false;
    if (quick === 'noted' && !record.note && !record.label && !record.tags?.length) return false;
    if (quick === 'today' && record.firstSeen < startOfDay(now)) return false;
    if (quick === 'telemetry' && !hasTelemetry(record)) return false;
  }
  const identity = filter.category || filter.text ? identityOf?.(record) : undefined;
  if (filter.category && identity?.category !== filter.category) return false;
  if (filter.text) {
    const words = identity
      ? `${searchText(record)} ${identity.label} ${identity.maker ?? ''}`.toLowerCase()
      : searchText(record);
    if (!words.includes(filter.text)) return false;
  }
  return true;
}
