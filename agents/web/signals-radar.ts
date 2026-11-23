/**
 * The Signals radar (D61): every shown signal around the user, placed by how its position is known.
 * One antenna measures no direction, so a point is red (the transmitter reports its position), blue
 * (estimated), or hollow (distance from signal strength only, at a steady angle).
 */
import { preferences } from './app-state.ts';
import { formatBearing, formatDistance } from './geo.ts';
import { button, el, svg } from './signals-dom.ts';
import { icon } from './ui.ts';
import {
  placementOf,
  steadyAngle,
  type Place,
  type Placement,
  type SignalRecord,
} from '../../packages/agent-core/signals-intel.ts';

/** Points drawn at most, and how many get a name under them. */
export const MAX_POINTS = 300;
const MAX_LABELS = 30;
const MIN_RADIUS = 2;
const MAX_RADIUS = 5000;

/** The radius in metres when zoomed by hand; undefined fits what is shown. */
let radiusSetting: number | undefined;
/** The radius last drawn, which zooming starts from. */
let drawnRadius = 100;
let redraw: () => void = () => {};

export function placementText(placement: Placement) {
  const distance = formatDistance(placement.distance, preferences.units);
  const bearing =
    placement.bearing === undefined ? '' : formatBearing(placement.bearing, preferences.angles);
  switch (placement.how) {
    case 'reported':
      return `${distance} at ${bearing}`;
    case 'estimated':
      return `~${distance} at ${bearing} (±${formatDistance(placement.error ?? 0, preferences.units)}${
        placement.source === 'lookup' ? ', WiGLE' : ''
      })`;
    case 'distance':
      return `~${distance}, direction unknown`;
  }
}

/** A round radius that fits most of what is shown. */
function autoRadius(distances: number[]) {
  if (!distances.length) return 100;
  const sorted = [...distances].sort((a, b) => a - b);
  const p80 = sorted[Math.floor(sorted.length * 0.8)] * 1.1;
  return [10, 25, 50, 100, 250, 500, 1000, 2000].find(step => step >= p80) ?? 2000;
}

/** The ring spacing for a radius: a round number giving three to five rings. */
function ringStep(radius: number) {
  const power = 10 ** Math.floor(Math.log10(radius / 4));
  return [1, 2, 2.5, 5, 10].map(m => m * power).find(step => radius / step <= 5) ?? power * 10;
}

function setRadius(radius: number | undefined) {
  radiusSetting =
    radius === undefined ? undefined : Math.min(MAX_RADIUS, Math.max(MIN_RADIUS, radius));
  redraw();
}
const zoomBy = (factor: number) => setRadius(drawnRadius * factor);

/**
 * Wheel, trackpad pinch and two-finger pinch zoom around the user, at the centre; a double-click
 * fits what is shown. `onZoom` redraws at once.
 */
export function initRadar(target: HTMLElement, onZoom: () => void) {
  redraw = onZoom;
  target.addEventListener(
    'wheel',
    event => {
      event.preventDefault();
      // A trackpad pinch arrives as a wheel event with ctrlKey and small steps.
      zoomBy(Math.exp(event.deltaY * (event.ctrlKey ? 0.01 : 0.0015)));
    },
    { passive: false },
  );
  const pointers = new Map<number, { x: number; y: number }>();
  let startGap = 0;
  let startRadius = 0;
  const gap = () => {
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  target.addEventListener('pointerdown', event => {
    if (event.pointerType !== 'touch') return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 2) {
      startGap = gap();
      startRadius = drawnRadius;
    }
  });
  target.addEventListener('pointermove', event => {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 2 && startGap > 20) setRadius((startRadius * startGap) / gap());
  });
  const end = (event: PointerEvent) => {
    pointers.delete(event.pointerId);
    if (pointers.size < 2) startGap = 0;
  };
  target.addEventListener('pointerup', end);
  target.addEventListener('pointercancel', end);
  target.addEventListener('dblclick', event => {
    if (!(event.target as Element).closest('.radar-point, button')) setRadius(undefined);
  });
}

type Parts = { fit: HTMLButtonElement; holder: HTMLElement };
const built = new WeakMap<HTMLElement, Parts>();

/** The zoom buttons are built once: the drawing under them is replaced on every update. */
function partsOf(container: HTMLElement): Parts {
  let parts = built.get(container);
  if (!parts) {
    const zoomIn = button('', 'plus', () => zoomBy(1 / 1.5), 'round compact');
    zoomIn.setAttribute('aria-label', 'Zoom in');
    const zoomOut = button('', 'minus', () => zoomBy(1.5), 'round compact');
    zoomOut.setAttribute('aria-label', 'Zoom out');
    const fit = button('Auto', 'scan', () => setRadius(undefined), 'compact');
    fit.title = 'Fit what is shown';
    const holder = el('div', 'radar-holder');
    container.replaceChildren(el('div', 'radar-zoom', zoomIn, fit, zoomOut), holder);
    parts = { fit, holder };
    built.set(container, parts);
  }
  return parts;
}

function marker(record: SignalRecord, x: number, y: number, how: Placement['how'], size: number) {
  const group = svg('g', { class: `radar-point radar-${how}` });
  let shape: SVGElement;
  if (record.kind === 'wifi')
    shape = svg('rect', { x: x - size, y: y - size, width: size * 2, height: size * 2, rx: 1.5 });
  else if (record.kind === 'drone')
    shape = svg('path', {
      d: `M${x} ${y - size * 1.3}L${x + size * 1.2} ${y + size}L${x - size * 1.2} ${y + size}Z`,
    });
  else if (record.kind === 'probe')
    shape = svg('path', {
      d: `M${x} ${y - size * 1.3}L${x + size * 1.3} ${y}L${x} ${y + size * 1.3}L${x - size * 1.3} ${y}Z`,
    });
  else shape = svg('circle', { cx: x, cy: y, r: size });
  shape.setAttribute('class', 'radar-mark');
  group.append(shape);
  return group;
}

export function drawRadar(
  container: HTMLElement,
  records: readonly SignalRecord[],
  now: number,
  options: {
    me: Place | undefined;
    selected: string | undefined;
    hunted: string | undefined;
    /** Points not heard for this long are faded. */
    staleAfter: number;
    onSelect: (key: string) => void;
    /** The steadied strength, so a point doesn't twitch with every report. */
    rssi: (record: SignalRecord) => number;
    name: (record: SignalRecord) => string;
    describe: (record: SignalRecord) => string;
  },
) {
  const size = 400;
  const centre = size / 2;
  const edge = centre - 22;
  const placed = records.slice(0, MAX_POINTS).map(record => ({
    record,
    placement: placementOf(record, options.me, options.rssi(record)),
  }));
  const radius = radiusSetting ?? autoRadius(placed.map(p => p.placement.distance));
  drawnRadius = radius;
  const root = svg('svg', {
    viewBox: `0 0 ${size} ${size}`,
    class: 'radar-svg',
    role: 'img',
    'aria-label': `Radar of ${placed.length} signals within ${formatDistance(radius, preferences.units)}`,
  });
  // Rings at round distances (1, 2 or 5 times a power of ten), three to five of them.
  const step = ringStep(radius);
  for (let distance = step; distance <= radius * 1.001; distance += step) {
    const r = (edge * distance) / radius;
    root.append(svg('circle', { cx: centre, cy: centre, r, class: 'radar-ring' }));
    const label = svg('text', { x: centre + 4, y: centre - r + 12, class: 'radar-ring-label' });
    label.textContent = formatDistance(distance, preferences.units);
    root.append(label);
  }
  root.append(
    svg('circle', { cx: centre, cy: centre, r: edge, class: 'radar-ring radar-edge' }),
    svg('line', {
      x1: centre,
      y1: centre - edge,
      x2: centre,
      y2: centre + edge,
      class: 'radar-axis',
    }),
    svg('line', {
      x1: centre - edge,
      y1: centre,
      x2: centre + edge,
      y2: centre,
      class: 'radar-axis',
    }),
  );
  const north = svg('text', { x: centre, y: 14, class: 'radar-north', 'text-anchor': 'middle' });
  north.textContent = 'N';
  root.append(north);

  const points = placed.map(({ record, placement }) => {
    const angle = ((placement.bearing ?? steadyAngle(record.key)) - 90) * (Math.PI / 180);
    const r = Math.min(placement.distance / radius, 1) * edge;
    return { record, placement, x: centre + r * Math.cos(angle), y: centre + r * Math.sin(angle) };
  });
  // Names go to the selected, hunted and watched first, then the strongest, and only where a
  // name doesn't land on one already placed.
  const important = (p: (typeof points)[number]) =>
    Number(p.record.key === options.selected) * 4 +
    Number(p.record.key === options.hunted) * 2 +
    Number(!!p.record.watch);
  const labels = new Map<string, string>();
  const boxes: { left: number; right: number; y: number }[] = [];
  for (const point of [...points].sort(
    (a, b) => important(b) - important(a) || options.rssi(b.record) - options.rssi(a.record),
  )) {
    if (labels.size >= MAX_LABELS && !important(point)) continue;
    const full = options.name(point.record);
    const name = full.length > 18 ? `${full.slice(0, 17)}…` : full;
    const half = name.length * 2.9 + 2;
    const box = { left: point.x - half, right: point.x + half, y: point.y + 19 };
    if (boxes.some(b => Math.abs(b.y - box.y) < 11 && b.left < box.right && box.left < b.right)) {
      if (!important(point)) continue;
    }
    boxes.push(box);
    labels.set(point.record.key, name);
  }
  let onTop: SVGGElement | undefined;
  for (const { record, placement, x, y } of [...points].reverse()) {
    const isSelected = record.key === options.selected;
    const group = marker(record, x, y, placement.how, isSelected ? 7 : 5);
    group.classList.toggle('is-stale', now - record.lastSeen > options.staleAfter);
    group.classList.toggle('is-beyond', placement.distance > radius);
    if (record.watch) group.append(svg('circle', { cx: x, cy: y, r: 10, class: 'radar-watch' }));
    if (record.key === options.hunted)
      group.append(svg('circle', { cx: x, cy: y, r: 16, class: 'radar-hunted' }));
    if (isSelected) {
      group.append(svg('circle', { cx: x, cy: y, r: 13, class: 'radar-selection' }));
      if (placement.how === 'estimated' && placement.error)
        group.append(
          svg('circle', {
            cx: x,
            cy: y,
            r: Math.min(edge, (placement.error / radius) * edge),
            class: 'radar-error',
          }),
        );
    }
    const name = labels.get(record.key);
    if (name) {
      const label = svg('text', { x, y: y + 19, class: 'radar-label', 'text-anchor': 'middle' });
      label.textContent = name;
      group.append(label);
    }
    const hit = svg('circle', { cx: x, cy: y, r: 16, class: 'radar-hit' });
    const title = svg('title', {});
    title.textContent = `${options.name(record)} · ${options.describe(record)} · ${placementText(placement)}`;
    hit.append(title);
    group.append(hit);
    // On press, not click: the radar redraws while reports stream in.
    group.addEventListener('pointerdown', event => {
      if (event.button === 0) options.onSelect(record.key);
    });
    if (isSelected) onTop = group;
    else root.append(group);
  }
  if (onTop) root.append(onTop);
  root.append(svg('circle', { cx: centre, cy: centre, r: 5, class: 'radar-you' }));
  const you = svg('text', { x: centre + 9, y: centre + 15, class: 'radar-ring-label' });
  you.textContent = options.me ? 'You' : 'No position';
  root.append(you);

  const parts = partsOf(container);
  parts.fit.replaceChildren(
    icon('scan'),
    el(
      'span',
      '',
      radiusSetting === undefined ? 'Auto' : formatDistance(radius, preferences.units),
    ),
  );

  const legend = el('div', 'radar-legend');
  for (const [how, label] of [
    ['reported', 'Reported'],
    ['estimated', 'Estimated'],
    ['distance', 'Distance only'],
  ] as const) {
    const swatch = svg('svg', { width: 12, height: 12, 'aria-hidden': 'true' });
    swatch.append(svg('circle', { cx: 6, cy: 6, r: 4.5, class: `radar-mark radar-${how}-swatch` }));
    legend.append(el('span', '', swatch, label));
  }
  parts.holder.replaceChildren(root, legend);
}
