/**
 * Alerts (D61): the few moments worth interrupting for. A watched signal is heard again, a drone
 * or a Flock or Ring device comes into range, or something has been moving with the user. Signals
 * the user marked as known never alert, and nothing alerts twice within ten minutes.
 */
import type { Identity } from './signals-identify.ts';
import { VISIT_GAP_MS, type SignalRecord } from './signals-intel.ts';

export type AlertKind = 'watched' | 'following' | 'drone' | 'flock' | 'ring';
export type SignalAlert = Readonly<{ key: string; kind: AlertKind; at: number }>;

/** The least time between two alerts for the same signal. */
export const ALERT_AGAIN_MS = 10 * 60_000;
/** Something moving with the user is said once an hour, not every ten minutes. */
export const FOLLOWING_AGAIN_MS = 60 * 60_000;
const KEPT = 2000;

export class AlertTracker {
  #last = new Map<string, number>();

  /**
   * Called for each report, after it is recorded. `previousSeen` is when the signal was last heard
   * before this report, or undefined if it is new. Returns the alert to raise, if any.
   */
  check(
    record: SignalRecord,
    identity: Identity,
    previousSeen: number | undefined,
    now: number,
    following: boolean,
  ): SignalAlert | undefined {
    if (record.known) return undefined;
    // Coming into range: new, or heard again after a gap.
    const arrived = previousSeen === undefined || now - previousSeen > VISIT_GAP_MS;
    let kind: AlertKind | undefined;
    if (following) kind = 'following';
    else if (!arrived) kind = undefined;
    else if (record.watch) kind = 'watched';
    else if (record.kind === 'drone') kind = 'drone';
    else if (identity.device && identity.confidence !== 'low') kind = identity.device;
    if (!kind) return undefined;
    const last = this.#last.get(record.key);
    const again = kind === 'following' ? FOLLOWING_AGAIN_MS : ALERT_AGAIN_MS;
    if (last !== undefined && now - last < again) return undefined;
    if (this.#last.size >= KEPT) this.#last.clear();
    this.#last.set(record.key, now);
    return { key: record.key, kind, at: now };
  }
}

/** What an alert says, given the signal's name. */
export function alertText(kind: AlertKind, name: string) {
  switch (kind) {
    case 'watched':
      return `Watched: ${name}`;
    case 'following':
      return `Moving with you: ${name}`;
    case 'drone':
      return `Drone: ${name}`;
    case 'flock':
      return `Flock: ${name}`;
    case 'ring':
      return `Ring: ${name}`;
  }
}
