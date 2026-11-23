/**
 * Monitoring logs (D61): while the user monitors, each signal heard is logged with where the user
 * was and how strong it was, to export afterwards and put on a map. Storage-independent, so the
 * portal and a mobile app share it.
 *
 * A signal is logged when it is first heard, and again when the user has moved, its strength has
 * changed, or half a minute has passed. That keeps a log useful for mapping without a row for every
 * report.
 */
import { distanceBetween, type Place, type SignalKind } from './signals-intel.ts';

export type LogSession = {
  readonly id: string;
  readonly startedAt: number;
  endedAt?: number;
  rows: number;
  /** Different signals logged. */
  signals: number;
  /** Rows that have the user's position. */
  located: number;
  /** Metres the user moved while monitoring. */
  distance: number;
  /** When the last row was logged, to close a log the page left open. */
  lastAt?: number;
};

/** What is logged about a signal each time. */
export type LogEntry = Readonly<{
  kind: SignalKind;
  /** Address (hex) or, for drones, the UAS ID as text. */
  id: string;
  name: string;
  rssi: number;
  channel?: number;
  /** What it most likely is, the maker, and a known device family such as "Flock Safety". */
  category?: string;
  maker?: string;
  device?: string;
  /** A drone's own reported position. */
  reported?: Place;
}>;
export type LogRow = LogEntry & Readonly<{ at: number; place?: Place }>;

export interface LogStorage {
  listSessions(): Promise<LogSession[]>;
  putSession(session: LogSession): Promise<void>;
  /** Appends rows as one chunk; chunks are numbered from 0 per session. */
  appendRows(session: string, chunk: number, rows: readonly LogRow[]): Promise<void>;
  /** Every row of a session, in order. */
  readRows(session: string): Promise<LogRow[]>;
  deleteSession(session: string): Promise<void>;
}

export const LOG_LIMITS = Object.freeze({
  /** Rows in one session; monitoring stops when it is full. */
  rows: 250_000,
  /** Sessions kept; the oldest is deleted when a new one starts past this. */
  sessions: 50,
});
/** A signal is logged again after the user moves this far, in metres. */
export const LOG_MOVE_M = 5;
/** …or its strength changes by this much, in dB. */
export const LOG_RSSI_DB = 5;
/** …or this long has passed, in milliseconds. */
export const LOG_EVERY_MS = 30_000;
const CHUNK_ROWS = 200;

type Last = { at: number; rssi: number; place?: Place };

export class SignalLogger {
  session: LogSession | undefined;
  /** Why monitoring stopped by itself, if it did. */
  stoppedBecause = '';
  #storage: LogStorage;
  #last = new Map<string, Last>();
  #buffer: LogRow[] = [];
  #chunk = 0;
  #here: Place | undefined;
  #writing: Promise<void> = Promise.resolve();

  constructor(storage: LogStorage) {
    this.#storage = storage;
  }

  get active() {
    return !!this.session && this.session.endedAt === undefined;
  }

  async start(now: number, id: string) {
    if (this.active) return;
    const sessions = await this.#storage.listSessions();
    sessions.sort((a, b) => a.startedAt - b.startedAt);
    while (sessions.length >= LOG_LIMITS.sessions)
      await this.#storage.deleteSession(sessions.shift()!.id);
    this.session = { id, startedAt: now, rows: 0, signals: 0, located: 0, distance: 0 };
    this.stoppedBecause = '';
    this.#last.clear();
    this.#buffer = [];
    this.#chunk = 0;
    this.#here = undefined;
    await this.#storage.putSession(this.session);
  }

  /** The user's position, for the distance moved. Small jitter while standing still is ignored. */
  moved(place: Place) {
    if (!this.active) return;
    if (!this.#here) this.#here = place;
    else {
      const step = distanceBetween(this.#here, place);
      if (step >= LOG_MOVE_M) {
        this.session!.distance += step;
        this.#here = place;
      }
    }
  }

  /** A signal heard at `at`, with the user's position then if known. Returns whether it was logged. */
  observe(entry: LogEntry, at: number, place?: Place) {
    const session = this.session;
    if (!session || session.endedAt !== undefined) return false;
    const key = `${entry.kind}:${entry.id}`;
    const last = this.#last.get(key);
    const due =
      !last ||
      at - last.at >= LOG_EVERY_MS ||
      Math.abs(entry.rssi - last.rssi) >= LOG_RSSI_DB ||
      (place && !last.place) ||
      (place && last.place && distanceBetween(place, last.place) >= LOG_MOVE_M);
    if (!due) return false;
    if (!last) session.signals++;
    this.#last.set(key, { at, rssi: entry.rssi, ...(place ? { place } : {}) });
    this.#buffer.push({ ...entry, at, ...(place ? { place } : {}) });
    session.rows++;
    session.lastAt = at;
    if (place) session.located++;
    if (this.#buffer.length >= CHUNK_ROWS) void this.flush();
    if (session.rows >= LOG_LIMITS.rows) {
      this.stoppedBecause = 'The log is full. Start a new one to keep monitoring.';
      void this.stop(at);
    }
    return true;
  }

  /** Writes buffered rows and the session's totals. Writes never overlap. */
  flush() {
    const session = this.session;
    if (!session) return this.#writing;
    const rows = this.#buffer;
    this.#buffer = [];
    const chunk = rows.length ? this.#chunk++ : -1;
    const snapshot = { ...session };
    this.#writing = this.#writing
      .catch(() => {})
      .then(async () => {
        if (rows.length) await this.#storage.appendRows(snapshot.id, chunk, rows);
        await this.#storage.putSession(snapshot);
      });
    return this.#writing;
  }

  async stop(now: number) {
    if (!this.session || this.session.endedAt !== undefined) return;
    this.session.endedAt = now;
    await this.flush();
  }
}

export class MemoryLogStorage implements LogStorage {
  readonly sessions = new Map<string, LogSession>();
  readonly chunks = new Map<string, LogRow[][]>();
  async listSessions() {
    return [...this.sessions.values()].map(session => ({ ...session }));
  }
  async putSession(session: LogSession) {
    this.sessions.set(session.id, { ...session });
  }
  async appendRows(session: string, chunk: number, rows: readonly LogRow[]) {
    const list = this.chunks.get(session) ?? [];
    list[chunk] = [...rows];
    this.chunks.set(session, list);
  }
  async readRows(session: string) {
    return (this.chunks.get(session) ?? []).flat();
  }
  async deleteSession(session: string) {
    this.sessions.delete(session);
    this.chunks.delete(session);
  }
}

// Export.

type Cell = string | number | undefined;
/** One CSV field: quoted when needed, and text a spreadsheet would run as a formula kept as text. */
export function csvCell(value: Cell) {
  if (value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
const iso = (ms: number) => new Date(ms).toISOString();
const KINDS: Record<SignalKind, string> = {
  drone: 'Drone',
  wifi: 'Wi-Fi network',
  bluetooth: 'Bluetooth device',
  probe: 'Searching device',
};
const COLUMNS = [
  'Time (UTC)',
  'Latitude',
  'Longitude',
  'Accuracy (m)',
  'Signal (dBm)',
  'Kind',
  'Name',
  'Address or ID',
  'Channel',
  'Most likely',
  'Maker',
  'Known device',
  'Reported latitude',
  'Reported longitude',
] as const;

function cells(row: LogRow): Cell[] {
  return [
    iso(row.at),
    row.place?.lat,
    row.place?.lon,
    row.place?.accuracy ?? undefined,
    row.rssi,
    KINDS[row.kind],
    row.name,
    row.id,
    row.channel,
    row.category,
    row.maker,
    row.device,
    row.reported?.lat,
    row.reported?.lon,
  ];
}

/** A log as CSV: one row per time a signal was logged, with where the user was. */
export function logCsv(rows: readonly LogRow[]) {
  return (
    [COLUMNS.map(csvCell).join(','), ...rows.map(row => cells(row).map(csvCell).join(','))].join(
      '\r\n',
    ) + '\r\n'
  );
}

/**
 * A log as GeoJSON for mapping tools: one point per logged row that has the user's position, at
 * that position (where the signal was heard, not where the transmitter is).
 */
export function logGeoJson(session: LogSession, rows: readonly LogRow[]) {
  return JSON.stringify({
    type: 'FeatureCollection',
    name: `Reaper Mesh signals log ${iso(session.startedAt)}`,
    features: rows
      .filter((row): row is LogRow & { place: Place } => !!row.place)
      .map(row => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [row.place.lon, row.place.lat] },
        properties: {
          time: iso(row.at),
          signal: row.rssi,
          kind: KINDS[row.kind],
          name: row.name,
          id: row.id,
          ...(row.channel !== undefined ? { channel: row.channel } : {}),
          ...(row.category ? { mostLikely: row.category } : {}),
          ...(row.maker ? { maker: row.maker } : {}),
          ...(row.device ? { knownDevice: row.device } : {}),
          ...(row.place.accuracy ? { accuracy: row.place.accuracy } : {}),
          ...(row.reported
            ? { reportedLatitude: row.reported.lat, reportedLongitude: row.reported.lon }
            : {}),
        },
      })),
  });
}
