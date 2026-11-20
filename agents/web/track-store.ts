/**
 * This browser's recorded track, kept in local storage like the rest of the portal's data. A long
 * track is stored in chunks, so each new point rewrites only the last chunk rather than the whole
 * track. One track is kept at a time: starting a new one replaces it. Same rules as the mobile
 * app's TrackStore.
 */
import { TRACK_ACCURACY_M, trackLength, type TrackPoint } from './trail.ts';

export const TRACK_KEY = 'reaper-mesh.track.v1';
const CHUNK = 500;
/** A fix this much older than the track's start was cached from before it. */
const STALE_START_MS = 5000;
const chunkKey = (index: number) => `${TRACK_KEY}.${index}`;

type Meta = {
  version: 1;
  recording: boolean;
  startedAt: number;
  stoppedAt: number;
  chunks: number;
};
const EMPTY: Meta = { version: 1, recording: false, startedAt: 0, stoppedAt: 0, chunks: 0 };

export type RawFix = Readonly<{
  latitude: number;
  longitude: number;
  accuracy?: number | null;
  altitude?: number | null;
  time: number;
}>;

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function validPoint(value: unknown): value is TrackPoint {
  return (
    Array.isArray(value) &&
    value.length === 4 &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1]) &&
    (value[2] === null || Number.isFinite(value[2])) &&
    Number.isFinite(value[3])
  );
}

export class TrackStore {
  #store: Store;
  #writable: () => boolean;
  #meta: Meta = { ...EMPTY };
  #points: TrackPoint[] = [];
  #length = 0;
  revision = 0;

  constructor(store: Store, writable: () => boolean = () => true) {
    this.#store = store;
    this.#writable = writable;
    try {
      const meta = JSON.parse(store.getItem(TRACK_KEY) ?? 'null') as Meta | null;
      if (!meta || meta.version !== 1) return;
      const points: TrackPoint[] = [];
      for (let i = 0; i < meta.chunks; i++) {
        const chunk = JSON.parse(store.getItem(chunkKey(i)) ?? '[]');
        if (Array.isArray(chunk)) points.push(...chunk.filter(validPoint));
      }
      // A track left recording when the page closed has stopped; its points so far are kept.
      this.#meta = meta.recording
        ? { ...meta, recording: false, stoppedAt: points.at(-1)?.[3] ?? meta.startedAt }
        : meta;
      this.#points = points;
      this.#length = trackLength(points);
    } catch {
      // A damaged track starts empty rather than failing.
    }
  }

  get recording() {
    return this.#meta.recording;
  }
  get startedAt() {
    return this.#meta.startedAt;
  }
  /** When recording stopped, or for one still going, the latest point. */
  get endedAt() {
    return this.#meta.recording
      ? (this.#points.at(-1)?.[3] ?? this.#meta.startedAt)
      : this.#meta.stoppedAt;
  }
  get points(): readonly TrackPoint[] {
    return this.#points;
  }
  /** Metres along the track, leaving out breaks in recording. */
  get length() {
    return this.#length;
  }

  /** Starts a new track, replacing the last. */
  start(now = Date.now()) {
    this.#removeChunks();
    this.#points = [];
    this.#length = 0;
    this.#meta = { version: 1, recording: true, startedAt: now, stoppedAt: 0, chunks: 0 };
    this.#save();
  }

  stop(now = Date.now()) {
    if (!this.#meta.recording) return;
    this.#meta = { ...this.#meta, recording: false, stoppedAt: now };
    this.#save();
  }

  clear() {
    this.#removeChunks();
    this.#points = [];
    this.#length = 0;
    this.#meta = { ...EMPTY };
    this.#remove(TRACK_KEY);
    this.revision++;
  }

  /** Adds fixes. Drops rough ones, and any not newer than the last point. Returns how many it kept. */
  append(raw: readonly RawFix[]) {
    if (!this.#meta.recording) return 0;
    const before = this.#points.length;
    for (const fix of raw) {
      if (!Number.isFinite(fix?.latitude) || !Number.isFinite(fix.longitude) || !(fix.time > 0))
        continue;
      if (fix.accuracy != null && (fix.accuracy < 0 || fix.accuracy > TRACK_ACCURACY_M)) continue;
      // A location source can hand over its last known position first, from somewhere else.
      if (fix.time < this.#meta.startedAt - STALE_START_MS) continue;
      const last = this.#points.at(-1);
      if (last && fix.time <= last[3]) continue;
      this.#points.push([
        fix.longitude,
        fix.latitude,
        typeof fix.altitude === 'number' && Number.isFinite(fix.altitude) ? fix.altitude : null,
        fix.time,
      ]);
    }
    const added = this.#points.length - before;
    if (!added) return 0;
    this.#length = trackLength(this.#points);
    // Rewrites only the chunks the new points landed in.
    const first = Math.floor(before / CHUNK);
    const chunks = Math.ceil(this.#points.length / CHUNK);
    for (let i = first; i < chunks; i++)
      this.#set(chunkKey(i), this.#points.slice(i * CHUNK, (i + 1) * CHUNK));
    this.#meta = { ...this.#meta, chunks };
    this.#save();
    return added;
  }

  #removeChunks() {
    for (let i = 0; i < this.#meta.chunks; i++) this.#remove(chunkKey(i));
  }
  #save() {
    this.#set(TRACK_KEY, this.#meta);
    this.revision++;
  }
  #set(key: string, value: unknown) {
    if (!this.#writable()) return;
    try {
      this.#store.setItem(key, JSON.stringify(value));
    } catch {
      // Still kept for this session if storage is full.
    }
  }
  #remove(key: string) {
    if (!this.#writable()) return;
    try {
      this.#store.removeItem(key);
    } catch {
      // Nothing more to do.
    }
  }
}
