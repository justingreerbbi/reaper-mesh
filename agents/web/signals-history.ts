/**
 * The portal's signal history (D61): every report from the signals add-on is recorded with this
 * computer's position at the time, kept in IndexedDB, and written every few seconds.
 */
import { onLocalAppStop } from './access-ui.ts';
import { currentFix } from './location.ts';
import { IndexedDbHistory } from './signals-db.ts';
import {
  SignalHistory,
  type Place,
  type SignalReport,
} from '../../packages/agent-core/signals-intel.ts';
import type { SensorMessage } from '../../packages/protocol/sensor-messages.ts';

const FLUSH_MS = 5000;
const storage = typeof indexedDB === 'undefined' ? undefined : new IndexedDbHistory();
/** The signals database, for the reference pack too; undefined without IndexedDB. */
export const historyStorage = storage;
export const history = new SignalHistory(
  storage ?? {
    loadAll: async () => [],
    put: async () => {},
    delete: async () => {},
    clear: async () => {},
  },
);

let problem = '';
let stopped = false;
let timer: ReturnType<typeof setInterval> | undefined;
let changed: () => void = () => {};

/** Why history can't be kept, for example private browsing without IndexedDB. */
export const historyProblem = () => problem;
export function onHistoryChange(callback: () => void) {
  changed = callback;
}

/** This computer's position now, if it is known and recent. */
export function herePlace(): Place | undefined {
  const fix = currentFix();
  return fix ? { lat: fix.lngLat[1], lon: fix.lngLat[0], accuracy: fix.accuracy } : undefined;
}

const isReport = (message: SensorMessage): message is SignalReport =>
  message.type === 'wifiAp' ||
  message.type === 'bleDevice' ||
  message.type === 'wifiProbe' ||
  message.type === 'remoteId';

const recorded = new Set<(key: string, rssi: number, at: number) => void>();
/** Hears each report as it is recorded, for hunting one signal. */
export function onRecorded(listener: (key: string, rssi: number, at: number) => void) {
  recorded.add(listener);
}

export function recordReport(message: SensorMessage, receivedAt: number) {
  if (stopped || !isReport(message)) return;
  const record = history.observe(message, receivedAt, herePlace());
  for (const listener of recorded) listener(record.key, message.rssi, receivedAt);
}

async function flush() {
  if (stopped) return;
  try {
    await history.flush();
    if (problem) {
      problem = '';
      changed();
    }
  } catch (error) {
    problem = `Signal history couldn't be saved: ${error instanceof Error ? error.message : error}`;
    changed();
  }
}

export async function loadHistory() {
  // Registered here, not at import: access-ui.ts imports modules that import this one.
  onLocalAppStop(() => {
    // A wipe deletes the database next; nothing may write it again.
    stopped = true;
    clearInterval(timer);
  });
  if (!storage) {
    problem = 'This browser has no IndexedDB, so signal history lasts only until the page closes.';
    return;
  }
  try {
    await history.load();
  } catch (error) {
    problem = `Signal history couldn't be read: ${error instanceof Error ? error.message : error}`;
  }
  changed();
  timer = setInterval(() => void flush(), FLUSH_MS);
  addEventListener('pagehide', () => void flush());
}
