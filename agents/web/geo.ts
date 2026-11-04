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

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export function formatBearing(degrees: number) {
  const whole = Math.round(degrees) % 360;
  return `${String(whole).padStart(3, '0')}° ${COMPASS[Math.round(degrees / 45) % 8]}`;
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
