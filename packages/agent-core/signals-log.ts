/**
 * Monitoring logs (D61): while the user monitors, each signal heard is logged with where the user
 * was and how strong it was, and the user's own route is logged too, to export afterwards and put
 * on a map. Storage-independent, so the portal and a mobile app share it.
 *
 * A signal is logged when it is first heard, and again when the user has moved, its strength has
 * changed, it is the strongest it has been, or half a minute has passed. That keeps a log useful for
 * mapping without a row for every report, and never misses the spot where a signal was strongest:
 * driving past, that is the closest the user came to it.
 *
 * Every row is kept. The summary (`summarize`) is one line per signal, placed where the user was
 * when it was strongest; that is what the CSV, the map file and the map view show.
 *
 * Positions can arrive far apart: a computer without GPS gets one from Wi-Fi about once a minute.
 * So exports place each row between the route points around it, by time (`positioned`), instead of
 * at the last position, which while driving is behind by up to a minute of travel.
 */
import { distanceBetween, type Place, type SignalKind } from './signals-intel.ts';

export type LogSession = {
  readonly id: string;
  readonly startedAt: number;
  endedAt?: number;
  /** Rows stored: signal rows and route points. */
  rows: number;
  /** Different signals logged. */
  signals: number;
  /** Signal rows that have the user's position. */
  located: number;
  /** Points of the user's route. Logs from before the route was logged have none. */
  route?: number;
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
/** One time a signal was logged, with where the user was then. */
export type SignalRow = LogEntry &
  Readonly<{
    at: number;
    place?: Place;
    /** How old the user's position was, in seconds, when it was not fresh. */
    fixAge?: number;
    /** Placed between two route points by time, in exports; never stored. */
    between?: true;
  }>;
/** A point of the user's own route. */
export type RouteRow = Readonly<{ kind: 'route'; at: number; place: Place }>;
export type LogRow = SignalRow | RouteRow;
export const isSignalRow = (row: LogRow): row is SignalRow => row.kind !== 'route';
type Placed = SignalRow & { place: Place };

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
/** A signal is logged again after the user moves this far, in metres; so is the route. */
export const LOG_MOVE_M = 5;
/** …or its strength changes by this much, in dB. */
export const LOG_RSSI_DB = 5;
/** …or this long has passed, in milliseconds. */
export const LOG_EVERY_MS = 30_000;
/**
 * The user's last position is used for this long. A phone's browser sends a new position only when
 * it changes, so standing still or crawling in traffic can leave many seconds between fixes; the
 * row records how old the position was.
 */
export const LOG_FIX_MS = 2 * 60_000;
/** A position older than this is marked with its age. */
const FRESH_FIX_MS = 10_000;
/** Two route points up to this far apart in time place the rows heard between them. */
export const LOG_BETWEEN_MS = 3 * 60_000;
const CHUNK_ROWS = 200;

/** The user's position for a row, and when it was fixed. */
export type Here = Readonly<{ place: Place; at: number }>;

type Last = {
  at: number;
  rssi: number;
  /** The strongest it has been logged with a position. */
  best: number;
  place?: Place;
};

export class SignalLogger {
  session: LogSession | undefined;
  /** Why monitoring stopped by itself, if it did. */
  stoppedBecause = '';
  #storage: LogStorage;
  #last = new Map<string, Last>();
  #buffer: LogRow[] = [];
  #chunk = 0;
  /** The latest position, and when the last route point was logged. */
  #here: Here | undefined;
  #routeAt = 0;
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
    this.session = { id, startedAt: now, rows: 0, signals: 0, located: 0, route: 0, distance: 0 };
    this.stoppedBecause = '';
    this.#last.clear();
    this.#buffer = [];
    this.#chunk = 0;
    this.#here = undefined;
    this.#routeAt = 0;
    await this.#storage.putSession(this.session);
  }

  /**
   * A new position for the user: added to the route once they have moved a little (small jitter
   * while standing still is ignored), and used for signals heard until the next one. Standing still,
   * a route point is still logged every half minute, so a stop is not mistaken for slow travel when
   * rows are placed between route points.
   */
  moved(place: Place, at: number) {
    const session = this.session;
    if (!session || !this.active) return;
    const step = this.#here ? distanceBetween(this.#here.place, place) : Infinity;
    if (this.#here && step < LOG_MOVE_M) {
      // Still here: the position is as good as new.
      this.#here = { place: this.#here.place, at };
      if (at - this.#routeAt < LOG_EVERY_MS) return;
    } else {
      if (this.#here) session.distance += step;
      this.#here = { place, at };
    }
    this.#routeAt = at;
    session.route = (session.route ?? 0) + 1;
    this.#add({ kind: 'route', at, place: this.#here.place });
  }

  /** Where the user is, from the latest position if it is recent enough to use. */
  here(now: number): Here | undefined {
    return this.#here && now - this.#here.at <= LOG_FIX_MS ? this.#here : undefined;
  }

  /**
   * A signal heard at `at`, with the user's position then if known (the logger's own latest one
   * when not given). Returns whether it was logged.
   */
  observe(entry: LogEntry, at: number, here: Here | undefined = this.here(at)) {
    const session = this.session;
    if (!session || session.endedAt !== undefined) return false;
    const place = here?.place;
    const key = `${entry.kind}:${entry.id}`;
    const last = this.#last.get(key);
    const due =
      !last ||
      at - last.at >= LOG_EVERY_MS ||
      Math.abs(entry.rssi - last.rssi) >= LOG_RSSI_DB ||
      (place && !last.place) ||
      (place && entry.rssi > last.best) ||
      (place && last.place && distanceBetween(place, last.place) >= LOG_MOVE_M);
    if (!due) return false;
    if (!last) session.signals++;
    this.#last.set(key, {
      at,
      rssi: entry.rssi,
      // Only a strength heard with a position can mark a spot.
      best: Math.max(place ? entry.rssi : -Infinity, last?.best ?? -Infinity),
      ...(place ? { place } : {}),
    });
    const age = here ? at - here.at : 0;
    this.#add({
      ...entry,
      at,
      ...(place ? { place } : {}),
      ...(place && age > FRESH_FIX_MS ? { fixAge: Math.round(age / 1000) } : {}),
    });
    if (place) session.located++;
    return true;
  }

  #add(row: LogRow) {
    const session = this.session!;
    this.#buffer.push(row);
    session.rows++;
    session.lastAt = row.at;
    if (this.#buffer.length >= CHUNK_ROWS) void this.flush();
    if (session.rows >= LOG_LIMITS.rows) {
      this.stoppedBecause = 'The log is full. Start a new one to keep monitoring.';
      void this.stop(row.at);
    }
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

// Placing rows.

/**
 * Every row, with each signal row placed between the two route points around it, by time, when
 * they are at most `LOG_BETWEEN_MS` apart. Others keep the position they were logged with. A row
 * heard before the first route point or after the last is never moved.
 */
export function positioned(rows: readonly LogRow[]): LogRow[] {
  const route = rows.filter((row): row is RouteRow => row.kind === 'route');
  if (route.length < 2) return [...rows];
  route.sort((a, b) => a.at - b.at);
  return rows.map(row => {
    if (!isSignalRow(row)) return row;
    // The last route point at or before the row.
    let low = 0;
    let high = route.length - 1;
    if (row.at < route[0].at || row.at > route[high].at) return row;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (route[middle].at <= row.at) low = middle;
      else high = middle - 1;
    }
    const before = route[low];
    const after = route[Math.min(low + 1, route.length - 1)];
    if (after.at - before.at > LOG_BETWEEN_MS) return row;
    const share = after.at === before.at ? 0 : (row.at - before.at) / (after.at - before.at);
    const accuracies = [before.place.accuracy, after.place.accuracy].filter(
      (value): value is number => typeof value === 'number',
    );
    const { fixAge: _age, ...rest } = row;
    return {
      ...rest,
      place: {
        lat: before.place.lat + (after.place.lat - before.place.lat) * share,
        lon: before.place.lon + (after.place.lon - before.place.lon) * share,
        ...(accuracies.length ? { accuracy: Math.max(...accuracies) } : {}),
      },
      between: true as const,
    };
  });
}

// Summary.

/** One signal over a whole log. */
export type SignalSummary = Readonly<{
  kind: SignalKind;
  id: string;
  /** The latest of each: a name or guess can arrive after the first report. */
  name: string;
  channel?: number;
  category?: string;
  maker?: string;
  device?: string;
  reported?: Place;
  firstAt: number;
  lastAt: number;
  /** Rows logged for it. */
  logged: number;
  /** The strongest it was heard, with or without a position. */
  strongest: number;
  /**
   * Its strongest row that has the user's position: where the user was when it was strongest.
   * Driving past, that is the closest the user came, so it is the best single guess at where the
   * signal is from. Missing only when it was never heard while the user's position was known.
   */
  best?: Placed;
}>;

/** One line per signal, in the order first heard, with rows placed by `positioned`. */
export function summarize(logged: readonly LogRow[]): SignalSummary[] {
  const rows = positioned(logged);
  type Building = { -readonly [K in keyof SignalSummary]: SignalSummary[K] };
  const signals = new Map<string, Building>();
  for (const row of rows) {
    if (!isSignalRow(row)) continue;
    const key = `${row.kind}:${row.id}`;
    let signal = signals.get(key);
    if (!signal) {
      signal = {
        kind: row.kind,
        id: row.id,
        name: row.name,
        firstAt: row.at,
        lastAt: row.at,
        logged: 0,
        strongest: row.rssi,
      };
      signals.set(key, signal);
    }
    signal.logged++;
    signal.lastAt = Math.max(signal.lastAt, row.at);
    signal.strongest = Math.max(signal.strongest, row.rssi);
    if (row.name) signal.name = row.name;
    if (row.channel !== undefined) signal.channel = row.channel;
    if (row.category) signal.category = row.category;
    if (row.maker) signal.maker = row.maker;
    if (row.device) signal.device = row.device;
    if (row.reported) signal.reported = row.reported;
    // The same strength later keeps the earlier spot; only a stronger one moves it.
    if (row.place && (!signal.best || row.rssi > signal.best.rssi)) signal.best = row as Placed;
  }
  return [...signals.values()];
}

/** The user's route, oldest first. */
export const routeOf = (rows: readonly LogRow[]) =>
  rows.filter((row): row is RouteRow => row.kind === 'route').map(row => row.place);

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
const KINDS: Record<SignalKind | 'route', string> = {
  drone: 'Drone',
  wifi: 'Wi-Fi network',
  bluetooth: 'Bluetooth device',
  probe: 'Searching device',
  route: 'You',
};
/** How a row was placed: at a position, or between two by time. */
const positionFrom = (row: SignalRow | undefined) =>
  !row?.place ? undefined : row.between ? 'Between fixes' : 'Fix';
const csv = (columns: readonly string[], lines: readonly Cell[][]) =>
  [columns.map(csvCell).join(','), ...lines.map(line => line.map(csvCell).join(','))].join('\r\n') +
  '\r\n';

const SUMMARY_COLUMNS = [
  'Kind',
  'Name',
  'Address or ID',
  'Most likely',
  'Maker',
  'Known device',
  'Strongest (dBm)',
  'Latitude',
  'Longitude',
  'Accuracy (m)',
  'Signal there (dBm)',
  'There at (UTC)',
  'Position from',
  'Position age (s)',
  'First heard (UTC)',
  'Last heard (UTC)',
  'Times logged',
  'Channel',
  'Reported latitude',
  'Reported longitude',
] as const;

/**
 * A log as CSV, one row per signal: placed where the user was when it was strongest. "Signal
 * there" differs from "Strongest" only when the strongest report came while the position was
 * unknown.
 */
export function logCsv(rows: readonly LogRow[]) {
  return csv(
    SUMMARY_COLUMNS,
    summarize(rows).map(signal => [
      KINDS[signal.kind],
      signal.name,
      signal.id,
      signal.category,
      signal.maker,
      signal.device,
      signal.strongest,
      signal.best?.place.lat,
      signal.best?.place.lon,
      signal.best?.place.accuracy ?? undefined,
      signal.best?.rssi,
      signal.best && iso(signal.best.at),
      positionFrom(signal.best),
      signal.best?.fixAge,
      iso(signal.firstAt),
      iso(signal.lastAt),
      signal.logged,
      signal.channel,
      signal.reported?.lat,
      signal.reported?.lon,
    ]),
  );
}

const POINT_COLUMNS = [
  'Time (UTC)',
  'Latitude',
  'Longitude',
  'Accuracy (m)',
  'Position from',
  'Position age (s)',
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

/** Every row of a log as CSV, the user's route ("You") included: for mapping coverage. */
export function logPointsCsv(rows: readonly LogRow[]) {
  return csv(
    POINT_COLUMNS,
    positioned(rows).map(row =>
      isSignalRow(row)
        ? [
            iso(row.at),
            row.place?.lat,
            row.place?.lon,
            row.place?.accuracy ?? undefined,
            positionFrom(row),
            row.fixAge,
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
          ]
        : [
            iso(row.at),
            row.place.lat,
            row.place.lon,
            row.place.accuracy ?? undefined,
            'Fix',
            undefined,
            undefined,
            KINDS.route,
          ],
    ),
  );
}

/**
 * A log as GeoJSON for mapping tools: one point per signal where it was strongest (signals never
 * placed are left out), and the user's route as a line.
 */
export function logGeoJson(session: LogSession, rows: readonly LogRow[]) {
  const route = routeOf(rows);
  return JSON.stringify({
    type: 'FeatureCollection',
    name: `Reaper Mesh signals log ${iso(session.startedAt)}`,
    features: [
      ...(route.length > 1
        ? [
            {
              type: 'Feature',
              geometry: {
                type: 'LineString',
                coordinates: route.map(place => [place.lon, place.lat]),
              },
              properties: { kind: KINDS.route, name: 'Route' },
            },
          ]
        : []),
      ...summarize(rows)
        .filter((signal): signal is SignalSummary & { best: Placed } => !!signal.best)
        .map(({ best, ...signal }) => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [best.place.lon, best.place.lat] },
          properties: {
            kind: KINDS[signal.kind],
            name: signal.name,
            id: signal.id,
            signal: best.rssi,
            time: iso(best.at),
            strongest: signal.strongest,
            firstHeard: iso(signal.firstAt),
            lastHeard: iso(signal.lastAt),
            logged: signal.logged,
            ...(signal.channel !== undefined ? { channel: signal.channel } : {}),
            ...(signal.category ? { mostLikely: signal.category } : {}),
            ...(signal.maker ? { maker: signal.maker } : {}),
            ...(signal.device ? { knownDevice: signal.device } : {}),
            ...(best.place.accuracy ? { accuracy: best.place.accuracy } : {}),
            positionFrom: positionFrom(best),
            ...(best.fixAge ? { positionAge: best.fixAge } : {}),
            ...(signal.reported
              ? { reportedLatitude: signal.reported.lat, reportedLongitude: signal.reported.lon }
              : {}),
          },
        })),
    ],
  });
}
