// Display preferences for this browser. Device settings stay on the device.
import type { Angles, CoordinateFormat, Units } from './geo.ts';

export const PREFERENCES_KEY = 'reaper-mesh.preferences.v1';

export type Preferences = {
  theme: 'night' | 'day';
  units: Units;
  coordinates: CoordinateFormat;
  /** Bearings and headings: degrees, or NATO mils. */
  angles: Angles;
  /** Which north the heading readout is from: true, or magnetic to match a hand compass. */
  north: 'true' | 'magnetic';
  /** Keep the screen awake while the map follows this computer or a track is recording. */
  keepAwake: boolean;
  /** Where this browser's own location comes from: the browser, or a USB GPS receiver. */
  locationSource: 'browser' | 'gps';
  /** What a message notification shows: the sender only, the full text, or nothing. */
  notifications: 'sender' | 'full' | 'off';
  basemap: 'dark' | 'topo' | 'imagery';
  /** Whether the device's saved position is its own, or follows this browser's location. */
  positionMode: 'fixed' | 'browser';
  /** Rejoin the last device when the page opens. */
  connectOnLoad: boolean;
};

export const DEFAULT_PREFERENCES: Readonly<Preferences> = Object.freeze({
  theme: 'night',
  units: 'metric',
  coordinates: 'mgrs',
  angles: 'degrees',
  north: 'true',
  keepAwake: true,
  locationSource: 'browser',
  notifications: 'sender',
  basemap: 'dark',
  positionMode: 'fixed',
  connectOnLoad: true,
});

const ALLOWED: { [K in keyof Preferences]: readonly Preferences[K][] } = {
  theme: ['night', 'day'],
  units: ['metric', 'imperial'],
  coordinates: ['mgrs', 'dd'],
  angles: ['degrees', 'mils'],
  north: ['true', 'magnetic'],
  keepAwake: [true, false],
  locationSource: ['browser', 'gps'],
  notifications: ['sender', 'full', 'off'],
  basemap: ['dark', 'topo', 'imagery'],
  positionMode: ['fixed', 'browser'],
  connectOnLoad: [true, false],
};

/** Unknown or damaged saved values fall back to the default, one field at a time. */
export function readPreferences(store: Pick<Storage, 'getItem'>): Preferences {
  const result: Preferences = { ...DEFAULT_PREFERENCES };
  let saved: Record<string, unknown> = {};
  try {
    saved = JSON.parse(store.getItem(PREFERENCES_KEY) ?? '{}') ?? {};
  } catch {
    return result;
  }
  for (const key of Object.keys(ALLOWED) as (keyof Preferences)[]) {
    const options = ALLOWED[key] as readonly unknown[];
    if (options.includes(saved[key])) (result as Record<string, unknown>)[key] = saved[key];
  }
  return result;
}

export function writePreferences(store: Pick<Storage, 'setItem'>, value: Preferences) {
  store.setItem(PREFERENCES_KEY, JSON.stringify(value));
}
