/**
 * Breadcrumb trails: each node's recent reported positions, and this browser's recorded track.
 * The same rules as the mobile app (src/utils/trail.js there), so both draw the same trails and
 * write the same GPX. Points are [longitude, latitude, ...] like the rest of the map code.
 */
import { distanceMeters, type LngLat } from './geo.ts';

/** [longitude, latitude, heard at] */
export type TrailPoint = readonly [number, number, number];
/** [longitude, latitude, altitude in metres or null, time] */
export type TrackPoint = readonly [number, number, number | null, number];

/** How far back a node's trail reaches, and how many points it keeps. */
export const NODE_TRAIL_MS = 60 * 60 * 1000;
const NODE_TRAIL_POINTS = 120;
/** Closer than this to the last point, a report adds nothing a trail would show. */
const NODE_STEP_M = 10;

/**
 * A node's trail with a newly reported position added, oldest first, dropping any points older
 * than an hour.
 */
export function extendTrail(
  trail: readonly TrailPoint[] | undefined,
  position: Readonly<{ latitude: number; longitude: number }>,
  at: number,
  now = at,
): TrailPoint[] {
  const kept = (trail ?? []).filter(point => now - point[2] <= NODE_TRAIL_MS);
  const here: LngLat = [position.longitude, position.latitude];
  const last = kept.at(-1);
  if (last && distanceMeters(last as unknown as LngLat, here) < NODE_STEP_M) {
    // Still in the same place: the trail stays as it is, but counts as heard there now.
    kept[kept.length - 1] = [last[0], last[1], Math.max(last[2], at)];
    return kept;
  }
  return [...kept, [here[0], here[1], at] as TrailPoint].slice(-NODE_TRAIL_POINTS);
}

/**
 * The steps of a node's trail, each with `fade` from 0 (an hour old) to 1 (just now), so a trail
 * fades out behind its node.
 */
export function trailSteps(trail: readonly TrailPoint[] | undefined, now = Date.now()) {
  const recent = (trail ?? []).filter(point => now - point[2] <= NODE_TRAIL_MS);
  const steps: { from: LngLat; to: LngLat; fade: number }[] = [];
  for (let i = 1; i < recent.length; i++)
    steps.push({
      from: [recent[i - 1][0], recent[i - 1][1]],
      to: [recent[i][0], recent[i][1]],
      fade: Math.max(0, 1 - (now - recent[i][2]) / NODE_TRAIL_MS),
    });
  return steps;
}

/** A recorded point worse than this is more likely to wander than to show where you went. */
export const TRACK_ACCURACY_M = 50;
/** A gap this long and this wide is a break in the track, not ground covered in between. */
const BREAK_MS = 60 * 1000;
const BREAK_M = 50;

const lngLat = (point: TrackPoint): LngLat => [point[0], point[1]];

/**
 * A recorded track split where recording stopped and started again somewhere else, so no line is
 * drawn over ground not covered.
 */
export function trackSegments(points: readonly TrackPoint[]) {
  const segments: TrackPoint[][] = [];
  let current: TrackPoint[] = [];
  for (const point of points) {
    const last = current.at(-1);
    if (
      last &&
      point[3] - last[3] > BREAK_MS &&
      distanceMeters(lngLat(last), lngLat(point)) > BREAK_M
    ) {
      segments.push(current);
      current = [];
    }
    current.push(point);
  }
  if (current.length) segments.push(current);
  return segments;
}

/** Length of a track along its segments, leaving out the breaks. */
export function trackLength(points: readonly TrackPoint[]) {
  let total = 0;
  for (const segment of trackSegments(points))
    for (let i = 1; i < segment.length; i++)
      total += distanceMeters(lngLat(segment[i - 1]), lngLat(segment[i]));
  return total;
}

/** The lines to draw for a recorded track: one per stretch recorded without a break. */
export function trackLines(points: readonly TrackPoint[]): LngLat[][] {
  return trackSegments(points)
    .filter(segment => segment.length > 1)
    .map(segment => segment.map(lngLat));
}

const escapeXml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A track as GPX 1.1, one track segment per stretch recorded without a break. */
export function toGpx(points: readonly TrackPoint[], name: string) {
  const segments = trackSegments(points)
    .map(segment => {
      const rows = segment.map(([lon, lat, altitude, time]) => {
        const ele = altitude == null ? '' : `<ele>${altitude.toFixed(1)}</ele>`;
        return `      <trkpt lat="${lat.toFixed(7)}" lon="${lon.toFixed(7)}">${ele}<time>${new Date(time).toISOString()}</time></trkpt>`;
      });
      return `    <trkseg>\n${rows.join('\n')}\n    </trkseg>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Reaper Mesh" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>${escapeXml(name)}</name>
${segments}
  </trk>
</gpx>
`;
}
