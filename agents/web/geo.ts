// Distances, bearings and coordinate text, matching the mobile app so both read the same.
import * as mgrs from 'mgrs';

// The bundler loads mgrs's ES module; Node's host tests load its CommonJS build under `default`.
type Mgrs = { forward(point: [number, number], accuracy: number): string };
const mgrsModule: Partial<Mgrs> & { default?: Mgrs } = mgrs;
const toMgrs = mgrsModule.forward ?? mgrsModule.default!.forward;

/** [longitude, latitude] in degrees. */
export type LngLat = readonly [number, number];
export type Units = 'metric' | 'imperial';
export type CoordinateFormat = 'mgrs' | 'dd';
/** Bearings and headings in degrees, or NATO mils (6400 to the circle). */
export type Angles = 'degrees' | 'mils';

const EARTH_RADIUS_METERS = 6371008.8;
const rad = (degrees: number) => (degrees * Math.PI) / 180;
const deg = (radians: number) => (radians * 180) / Math.PI;

/** Wire and storage coordinates: unsigned degrees * 10^7 offset by +90 and +180. */
export const toWire = (degrees: number, limit: number) => Math.round((degrees + limit) * 1e7);
export const fromWire = (value: number, limit: number) => value / 1e7 - limit;

export function distanceMeters(a: LngLat, b: LngLat) {
  const dLat = rad(b[1] - a[1]);
  const dLon = rad(b[0] - a[0]);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function bearingDegrees(a: LngLat, b: LngLat) {
  const y = Math.sin(rad(b[0] - a[0])) * Math.cos(rad(b[1]));
  const x =
    Math.cos(rad(a[1])) * Math.sin(rad(b[1])) -
    Math.sin(rad(a[1])) * Math.cos(rad(b[1])) * Math.cos(rad(b[0] - a[0]));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

export function pathLength(points: readonly LngLat[]) {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += distanceMeters(points[i - 1], points[i]);
  return total;
}

export function formatDistance(meters: number, units: Units = 'metric') {
  if (units === 'imperial') {
    const feet = meters * 3.28084;
    if (feet < 1000) return `${Math.round(feet)} ft`;
    const miles = meters / 1609.344;
    return `${miles < 10 ? miles.toFixed(2) : miles.toFixed(1)} mi`;
  }
  if (meters < 1000) return `${Math.round(meters)} m`;
  const km = meters / 1000;
  return `${km < 10 ? km.toFixed(2) : km.toFixed(1)} km`;
}

/** Speed from metres per second, with one decimal while slow enough for it to matter. */
export function formatSpeed(metersPerSecond: number, units: Units = 'metric') {
  const value = units === 'imperial' ? metersPerSecond * 2.236936 : metersPerSecond * 3.6;
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units === 'imperial' ? 'mph' : 'km/h'}`;
}

/** Height, which reads in feet in imperial even when large. */
export function formatHeight(meters: number, units: Units = 'metric') {
  const value = Math.round(units === 'imperial' ? meters * 3.28084 : meters);
  const grouped = String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${grouped} ${units === 'imperial' ? 'ft' : 'm'}`;
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const MILS = 6400;

/**
 * A bearing as "047° NE", or with `angles` 'mils' as "0836 mils" (NATO, 6400 to the circle).
 * `magnetic` marks one measured from magnetic north, as "047° NE mag".
 */
export function formatBearing(degrees: number, angles: Angles = 'degrees', magnetic = false) {
  const turned = ((degrees % 360) + 360) % 360;
  const text =
    angles === 'mils'
      ? `${String(Math.round((turned * MILS) / 360) % MILS).padStart(4, '0')} mils`
      : `${String(Math.round(turned) % 360).padStart(3, '0')}° ${COMPASS[Math.round(turned / 45) % 8]}`;
  return magnetic ? `${text} mag` : text;
}

/** MGRS is undefined near the poles, so it falls back to decimal degrees there. */
export function formatCoordinate([lon, lat]: LngLat, format: CoordinateFormat = 'mgrs') {
  if (format === 'mgrs' && lat > -80 && lat < 84) {
    try {
      return toMgrs([lon, lat], 5).replace(/^(\d+[A-Z])([A-Z]{2})(\d{5})(\d{5})$/, '$1 $2 $3 $4');
    } catch {
      // Falls through to decimal degrees.
    }
  }
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}

export function formatAgo(at: number, now = Date.now()) {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** A duration as "42 min" or "2 h 05 min". */
export function formatDuration(ms: number) {
  const minutes = Math.max(0, Math.floor(ms / 60000));
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`;
}

/** A clock time as "14:05". */
export function formatTime(at: number) {
  const date = new Date(at);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}
