/**
 * Keeping a live list of signals readable (D61). Scanners that are easy to watch share three
 * habits: rows don't move on their own, values change in place and not on every report, and a new
 * row is marked instead of silently pushing the others around. This holds that logic, apart from
 * any screen, so the portal and a mobile app behave the same.
 */

/** A shown strength changes only when the smoothed one has moved this far, in dB. */
export const RSSI_STEP_DB = 3;
/** How much of each new report goes into the smoothed strength. */
const RSSI_WEIGHT = 0.3;
const RSSI_KEPT = 5000;

/**
 * Signal strength steadied for display: smoothed over reports, and only changed on screen once it
 * has really moved. A raw reading jumps several dB between reports without anything changing.
 */
export class SteadyRssi {
  #values = new Map<string, { smoothed: number; shown: number }>();

  update(key: string, rssi: number) {
    const value = this.#values.get(key);
    if (!value) {
      if (this.#values.size >= RSSI_KEPT) this.#values.clear();
      this.#values.set(key, { smoothed: rssi, shown: rssi });
      return;
    }
    value.smoothed += (rssi - value.smoothed) * RSSI_WEIGHT;
    if (Math.abs(value.smoothed - value.shown) >= RSSI_STEP_DB)
      value.shown = Math.round(value.smoothed);
  }

  /** The strength to show, or `fallback` for a signal with no report yet this session. */
  shown(key: string, fallback: number) {
    return this.#values.get(key)?.shown ?? fallback;
  }
}

export type ListSort = 'new' | 'strong' | 'name';
export type ListItem = Readonly<{
  key: string;
  /** Kept at the top: the signals the user watches. */
  pinned: boolean;
  lastSeen: number;
  rssi: number;
  name: string;
}>;

/** A row counts as new, and is marked, for this long after it first appears. */
export const NEW_ROW_MS = 8000;
/** Sorting by strength re-sorts at most this often; between times the rows hold still. */
export const RESORT_MS = 10_000;

const COMPARE: Record<ListSort, (a: ListItem, b: ListItem) => number> = {
  new: (a, b) => b.lastSeen - a.lastSeen,
  strong: (a, b) => b.rssi - a.rssi,
  name: (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
};

/**
 * The order of rows in a live list. Rows keep their place: a signal heard again does not move, a
 * new one appears at the top (by name, in its place), and one that leaves closes the gap. Watched
 * signals stay first. Only a change of `scope` (the filters, or the sort) lays the list out afresh.
 */
export class StableOrder {
  #order: string[] = [];
  #scope: string | undefined;
  #firstShown = new Map<string, number>();
  #sortedAt = 0;

  /** The keys in display order, and which of them are new. */
  sync(items: readonly ListItem[], sort: ListSort, scope: string, now: number) {
    const byKey = new Map(items.map(item => [item.key, item]));
    const fullScope = `${sort}|${scope}`;
    if (fullScope !== this.#scope) {
      // A new view: everything is laid out by the sort, and nothing in it is "new".
      this.#scope = fullScope;
      this.#order = [...items].sort(COMPARE[sort]).map(item => item.key);
      this.#firstShown.clear();
      this.#sortedAt = now;
    } else {
      const kept = this.#order.filter(key => byKey.has(key));
      const known = new Set(kept);
      const added = items.filter(item => !known.has(item.key));
      for (const item of added) this.#firstShown.set(item.key, now);
      if (sort === 'strong' && now - this.#sortedAt >= RESORT_MS) {
        this.#order = [...items].sort(COMPARE.strong).map(item => item.key);
        this.#sortedAt = now;
      } else if (sort === 'name') {
        // Alphabetical order only changes when a row arrives or leaves.
        this.#order = [...items].sort(COMPARE.name).map(item => item.key);
      } else {
        added.sort(COMPARE[sort]);
        this.#order = [...added.map(item => item.key), ...kept];
      }
      for (const key of this.#firstShown.keys()) if (!byKey.has(key)) this.#firstShown.delete(key);
    }
    const pinned = this.#order.filter(key => byKey.get(key)!.pinned);
    const rest = this.#order.filter(key => !byKey.get(key)!.pinned);
    const fresh = new Set<string>();
    for (const [key, at] of this.#firstShown) if (now - at < NEW_ROW_MS) fresh.add(key);
    return { keys: [...pinned, ...rest], fresh };
  }
}
