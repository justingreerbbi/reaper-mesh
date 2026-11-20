/**
 * This computer's own location, for the map's follow mode, track recording and following this
 * browser with the device's position. It comes from one of two sources, chosen in This app:
 *
 * - the browser's location service, watched only while something wants it;
 * - a USB GPS receiver (gps.ts), which reports for as long as it is connected. This is the one for
 *   a laptop in a vehicle: most laptops have no GPS, and Wi-Fi location has no speed or heading.
 */
import type { LngLat } from './geo.ts';
import { preferences } from './app-state.ts';

export type Fix = Readonly<{
  lngLat: LngLat;
  /** When it arrived, in milliseconds. */
  at: number;
  /** Metres, or null when the source doesn't say. */
  accuracy: number | null;
  /** Metres above mean sea level. Only a USB GPS gives this; see browserFix below. */
  altitude: number | null;
  /** Metres per second over the ground. */
  speed: number | null;
  /** Direction of travel in degrees from true north, while moving. */
  course: number | null;
  source: 'browser' | 'gps';
}>;

/** Older than this, a fix says nothing about where this computer is now. */
export const FIX_STALE_MS = 10000;

const wants = new Set<string>();
const listeners = new Set<(fix: Fix) => void>();
let latest: Fix | undefined;
let watchId: number | undefined;
let problem = '';
/** Re-renders the parts of the page that show location. Set by main.ts. */
let changed: () => void = () => {};

export function onLocationChange(callback: () => void) {
  changed = callback;
}

/** The latest fix from the chosen source, if it is recent enough to use. */
export function currentFix(maxAgeMs = FIX_STALE_MS, now = Date.now()) {
  return latest && now - latest.at <= maxAgeMs ? latest : undefined;
}
/** Why there is no location, for example a refused permission. Empty when there is no problem. */
export const locationProblem = () => problem;

/** Hears each new fix. Returns a function that stops listening. */
export function onFix(listener: (fix: Fix) => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/**
 * Says whether `reason` (the map, a track, the device's position) needs this computer's location.
 * The browser's location service runs only while something does.
 */
export function wantLocation(reason: string, on: boolean) {
  const before = wants.size;
  if (on) wants.add(reason);
  else wants.delete(reason);
  if (wants.size !== before) updateSource();
}

/** Called by gps.ts with each fix from the receiver, and when the source preference changes. */
export function publishFix(fix: Fix) {
  if (fix.source !== preferences.locationSource) return;
  latest = fix;
  problem = '';
  for (const listener of listeners) {
    try {
      listener(fix);
    } catch {
      // One consumer failing mustn't stop the others.
    }
  }
  changed();
}

export function setLocationProblem(message: string) {
  if (message === problem) return;
  problem = message;
  changed();
}

/** Starts or stops the browser's location service to match what is wanted and chosen. */
export function updateSource() {
  const browser = wants.size > 0 && preferences.locationSource === 'browser';
  if (latest && latest.source !== preferences.locationSource) {
    latest = undefined;
    problem = '';
  }
  if (browser && watchId === undefined) {
    if (!navigator.geolocation) {
      setLocationProblem('This browser has no location access.');
      return;
    }
    watchId = navigator.geolocation.watchPosition(
      position => publishFix(browserFix(position)),
      error => {
        if (error.code === error.PERMISSION_DENIED) {
          stopBrowser();
          setLocationProblem(
            'Location permission is off. Allow it for this site to show your position, or use a USB GPS (This app settings).',
          );
        } else setLocationProblem('Waiting for a location fix.');
      },
      { enableHighAccuracy: true, maximumAge: 5000 },
    );
  }
  if (!browser) stopBrowser();
}

function stopBrowser() {
  if (watchId !== undefined) navigator.geolocation.clearWatch(watchId);
  watchId = undefined;
}

/**
 * Browsers report height above the WGS 84 ellipsoid, which can be tens of metres from height above
 * sea level, and the phone app corrects it with a geoid model a browser doesn't have. So browser
 * fixes carry no altitude, rather than a misleading one.
 */
function browserFix(position: GeolocationPosition): Fix {
  const { coords } = position;
  const known = (value: number | null) =>
    value === null || !Number.isFinite(value) ? null : value;
  return {
    lngLat: [coords.longitude, coords.latitude],
    at: Date.now(),
    accuracy: known(coords.accuracy),
    altitude: null,
    speed: known(coords.speed),
    course: known(coords.heading),
    source: 'browser',
  };
}

/** Stops everything when the app stops for a local wipe or a lock. */
export function stopLocation() {
  wants.clear();
  stopBrowser();
  latest = undefined;
}
