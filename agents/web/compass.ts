/**
 * The device's compass, where it has one: phones and tablets that open the portal. Laptops have
 * none, so the heading readout there uses the direction of travel instead (a USB GPS gives that).
 *
 * Browsers report the compass from magnetic north. With a position, it is turned to true north
 * with the World Magnetic Model, like the map; without one it stays magnetic and says so.
 */
import { declination, decimalYear, turnHeading } from './declination.ts';
import type { LngLat } from './geo.ts';

export type CompassReading = Readonly<{
  /** Degrees clockwise from true north, or from magnetic north while `trueNorth` is false. */
  heading: number;
  /** Degrees clockwise from magnetic north. */
  magnetic: number;
  trueNorth: boolean;
  /** Degrees, or null when the browser doesn't say. */
  accuracy: number | null;
}>;

type OrientationEvent = DeviceOrientationEvent & {
  webkitCompassHeading?: number;
  webkitCompassAccuracy?: number;
};
type PermissionRequest = { requestPermission?: () => Promise<'granted' | 'denied'> };

let magnetic: number | undefined;
let accuracy: number | null = null;
let at = 0;
let listening = false;
let changed: () => void = () => {};

/** Readings older than this mean the compass has stopped. */
const COMPASS_STALE_MS = 3000;

/** Only touch devices: desktop browsers can fire orientation events with no compass behind them. */
export const hasCompass = () =>
  typeof DeviceOrientationEvent !== 'undefined' && matchMedia('(pointer: coarse)').matches;

/**
 * Heading from alpha, beta and gamma. Lying flat, it is the way the top edge points. Held up, it
 * is the way the back of the device looks, from the W3C spec's worked example
 * (https://www.w3.org/TR/orientation-event/#worked-example-2), which has no answer when flat.
 */
export function headingFromAngles(alpha: number, beta: number, gamma: number) {
  if (Math.abs(beta) < 45 && Math.abs(gamma) < 45) return (360 - alpha) % 360;
  const a = (alpha * Math.PI) / 180;
  const b = (beta * Math.PI) / 180;
  const g = (gamma * Math.PI) / 180;
  const cA = Math.cos(a),
    sA = Math.sin(a),
    sB = Math.sin(b),
    cG = Math.cos(g),
    sG = Math.sin(g);
  const rA = -cA * sG - sA * sB * cG;
  const rB = -sA * sG + cA * sB * cG;
  let heading = Math.atan(rA / rB);
  if (rB < 0) heading += Math.PI;
  else if (rA < 0) heading += 2 * Math.PI;
  return (heading * 180) / Math.PI;
}

function onOrientation(event: OrientationEvent) {
  if (typeof event.webkitCompassHeading === 'number' && event.webkitCompassHeading >= 0) {
    magnetic = event.webkitCompassHeading;
    accuracy =
      typeof event.webkitCompassAccuracy === 'number' && event.webkitCompassAccuracy >= 0
        ? event.webkitCompassAccuracy
        : null;
  } else if (
    event.absolute &&
    event.alpha !== null &&
    event.beta !== null &&
    event.gamma !== null
  ) {
    magnetic = headingFromAngles(event.alpha, event.beta, event.gamma);
    accuracy = null;
  } else return;
  at = Date.now();
  changed();
}

/**
 * Starts listening. iOS asks permission, which needs a tap, so call this from the button that
 * turns follow mode on.
 */
export async function startCompass(onChange: () => void) {
  changed = onChange;
  if (listening || !hasCompass()) return;
  const request = (DeviceOrientationEvent as unknown as PermissionRequest).requestPermission;
  if (request) {
    try {
      if ((await request()) !== 'granted') return;
    } catch {
      return;
    }
  }
  listening = true;
  // Chrome sends the compass as a separate absolute event; Safari adds webkitCompassHeading.
  addEventListener('deviceorientationabsolute', onOrientation as EventListener);
  addEventListener('deviceorientation', onOrientation as EventListener);
}

export function stopCompass() {
  if (!listening) return;
  listening = false;
  removeEventListener('deviceorientationabsolute', onOrientation as EventListener);
  removeEventListener('deviceorientation', onOrientation as EventListener);
  magnetic = undefined;
}

/** The current reading, corrected to true north when `at` gives a place to correct it for. */
export function compassReading(place?: LngLat, now = Date.now()): CompassReading | undefined {
  if (magnetic === undefined || now - at > COMPASS_STALE_MS) return undefined;
  if (!place) return { heading: magnetic, magnetic, trueNorth: false, accuracy };
  const offset = declination(place[1], place[0], decimalYear(now));
  return { heading: turnHeading(magnetic, offset), magnetic, trueNorth: true, accuracy };
}
