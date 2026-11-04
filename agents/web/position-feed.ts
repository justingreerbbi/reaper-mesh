/**
 * Following this browser's location, within what the firmware allows. It has no GPS source, so the
 * browser's position is saved to the device as its fixed position, which it then announces.
 *
 * Every position change restarts the device's beacon timer (one full interval plus up to 10%
 * jitter). Updating more often than that would mean a beacon never goes out, so updates wait until
 * the current timer must have fired. They only happen after real movement, as each one is also a
 * flash write on the device. Same rules as the mobile app's phone position.
 */
import { distanceMeters, fromWire, type LngLat } from './geo.ts';

export const MIN_MOVE_METERS = 25;
export const MAX_FIX_AGE_MS = 120000;
/** A fix worse than this could put the device somewhere it isn't. */
export const MAX_ACCURACY_METERS = 100;
const BEACON_MARGIN_MS = 5000;
const DEFAULT_BEACON_SECONDS = 300;

export const POSITION_SENT_KEY = 'reaper-mesh.browser-position.v1';

export type Fix = Readonly<{ lngLat: LngLat; at: number }>;
type Saved = Readonly<{ source: number; share: boolean; latitude: number; longitude: number }>;

/** Whether this fix should be written to the device now. */
export function shouldSendPosition(input: {
  fix?: Fix;
  now: number;
  lastSentAt: number;
  saved?: Saved;
  intervalSeconds?: number;
}) {
  const { fix, now, lastSentAt, saved, intervalSeconds } = input;
  if (!fix || now - fix.at > MAX_FIX_AGE_MS) return false;
  // Not following yet, so this first write is what turns following on.
  if (saved?.source !== 1 || !saved.share) return true;
  const at: LngLat = [fromWire(saved.longitude, 180), fromWire(saved.latitude, 90)];
  if (distanceMeters(at, fix.lngLat) < MIN_MOVE_METERS) return false;
  const wait = (intervalSeconds ?? DEFAULT_BEACON_SECONDS) * 1100 + BEACON_MARGIN_MS;
  return now - lastSentAt >= wait;
}
