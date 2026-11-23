/**
 * Hunting one signal (D61), like a fox hunt: the signal strength of each report, smoothed, says
 * whether the user is getting closer, and sets how fast and how high the portal beeps. One antenna
 * gives strength only, so the user finds direction by moving, or by turning with their body
 * shielding the add-on.
 */
import { distanceFromRssi, type SignalKind } from './signals-intel.ts';

/** Strengths mapped onto the beep: weaker than WEAKEST is the slowest, STRONGEST the fastest. */
export const WEAKEST_DBM = -95;
export const STRONGEST_DBM = -40;
/** A change this large over the trend window counts as warmer or colder. */
export const TREND_DB = 3;
const TREND_RECENT_MS = 4000;
const TREND_BEFORE_MS = 12_000;
const KEEP_MS = 60_000;

export type Trend = 'warmer' | 'colder' | 'steady' | 'unknown';
export type Beep = Readonly<{ interval: number; pitch: number; lost: boolean }>;

/** How long without a report before the signal counts as lost, by how often it is reported. */
export function lostAfter(kind: SignalKind, fast: boolean) {
  return kind === 'drone' || fast ? 3000 : 12_000;
}

/** 0 at WEAKEST_DBM or weaker, 1 at STRONGEST_DBM or stronger. */
export function closeness(rssi: number) {
  return Math.min(1, Math.max(0, (rssi - WEAKEST_DBM) / (STRONGEST_DBM - WEAKEST_DBM)));
}

/**
 * The beep for a strength: from one every 1.5 s at 350 Hz when faint, to one every 0.1 s at 1.6 kHz
 * when close. The interval falls geometrically, so each step closer is heard as about as much
 * faster. A lost signal ticks low and slowly.
 */
export function beepFor(rssi: number | undefined, lost: boolean): Beep {
  if (lost || rssi === undefined) return { interval: 2000, pitch: 220, lost: true };
  const t = closeness(rssi);
  return { interval: Math.round(1500 * 0.07 ** t), pitch: Math.round(350 + 1250 * t), lost: false };
}

export class Hunt {
  readonly key: string;
  readonly kind: SignalKind;
  readonly startedAt: number;
  #smoothed: number | undefined;
  #peak: number | undefined;
  #lastAt: number | undefined;
  #readings: { at: number; value: number }[] = [];

  constructor(key: string, kind: SignalKind, startedAt: number) {
    this.key = key;
    this.kind = kind;
    this.startedAt = startedAt;
  }

  /** A report's strength. Smoothing takes the edge off single noisy reports. */
  feed(rssi: number, at: number) {
    this.#smoothed = this.#smoothed === undefined ? rssi : this.#smoothed * 0.5 + rssi * 0.5;
    this.#peak = this.#peak === undefined ? rssi : Math.max(this.#peak, rssi);
    this.#lastAt = at;
    this.#readings.push({ at, value: this.#smoothed });
    while (this.#readings.length && at - this.#readings[0].at > KEEP_MS) this.#readings.shift();
  }

  get smoothed() {
    return this.#smoothed;
  }
  get peak() {
    return this.#peak;
  }
  get lastAt() {
    return this.#lastAt;
  }

  isLost(now: number, fast = false) {
    return this.#lastAt === undefined || now - this.#lastAt > lostAfter(this.kind, fast);
  }

  /** The last few seconds against the ones before. */
  trend(now: number): Trend {
    const recent = this.#readings.filter(r => now - r.at <= TREND_RECENT_MS);
    const before = this.#readings.filter(
      r => now - r.at > TREND_RECENT_MS && now - r.at <= TREND_BEFORE_MS,
    );
    if (!recent.length || !before.length) return 'unknown';
    const mean = (list: typeof recent) => list.reduce((sum, r) => sum + r.value, 0) / list.length;
    const change = mean(recent) - mean(before);
    return change >= TREND_DB ? 'warmer' : change <= -TREND_DB ? 'colder' : 'steady';
  }

  /** Roughly how far, in metres, from the smoothed strength. */
  distance() {
    return this.#smoothed === undefined ? undefined : distanceFromRssi(this.kind, this.#smoothed);
  }

  beep(now: number, fast = false): Beep {
    return beepFor(this.#smoothed, this.isLost(now, fast));
  }
}
