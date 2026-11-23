/**
 * The Signals tab (D60, D61): a radar of the transmitters around this computer, a list, and a panel
 * for the selected one, over the signal history. Text from the air is only ever set as text.
 */
import { preferences, render } from './app-state.ts';
import { element, text } from './dom.ts';
import {
  formatAgo,
  formatBearing,
  formatCoordinate,
  formatDistance,
  formatHeight,
  formatSpeed,
  type LngLat,
} from './geo.ts';
import { fieldMap } from './map-ui.ts';
import type { DroneMark } from './map.ts';
import { setView } from './nav.ts';
import { away, notify } from './notifications.ts';
import { confirmSheet, downloadBlob, icon, setNotice, syncSegmented } from './ui.ts';
import {
  chooseSignalsPort,
  connectSignals,
  connectSimulatedSignals,
  disconnectSignals,
  onSignalsChange,
  reconnectSignals,
  signalsLink,
  signalsProblem,
  signalsSource,
  signalsSupported,
} from './signals.ts';
import {
  herePlace,
  history,
  historyProblem,
  loadHistory,
  onHistoryChange,
} from './signals-history.ts';
import {
  airText,
  bandLabel,
  describe,
  DroneAnnouncer,
  formatAddress,
  historyCsv,
  ID_TYPES,
  KIND_LABELS,
  nearbyDrones,
  securityLabel,
  serviceIds,
  serviceLabel,
  STALE_MS,
  tracker,
  TRANSPORTS,
  UA_TYPES,
} from './signals-format.ts';
import type { SensorPlan } from '../../packages/agent-core/sensor.ts';
import {
  clearCorrection,
  correctIdentity,
  identityForFilter,
  identityOf,
  initSignalsSettings,
  isLookingUp,
  loadReference,
  lookUpWatched,
  onIdentityChange,
  renderSignalsSettings,
  requestLookup,
  wigleReady,
} from './signals-identity.ts';
import { CATEGORIES, type Category } from '../../packages/agent-core/signals-identify.ts';
import {
  displayName,
  matchesFilter,
  NOW_MS,
  placementOf,
  steadyAngle,
  strongestPlace,
  type Place,
  type Placement,
  type QuickFilter,
  type SignalFilter,
  type SignalKind,
  type SignalRecord,
} from '../../packages/agent-core/signals-intel.ts';

/** Rows drawn at most in the list, and points on the radar. */
const MAX_ROWS = 200;
const MAX_POINTS = 300;
/** Points that get a name under them; the rest are named when selected. */
const MAX_LABELS = 40;
/** The radar redraws at most this often while reports stream in. */
const DRAW_MS = 800;
const KIND_ICONS: Record<SignalKind, string> = {
  drone: 'drone',
  wifi: 'wifi',
  bluetooth: 'bluetooth',
  probe: 'search',
};
const SVG = 'http://www.w3.org/2000/svg';

let kind: SignalKind | '' = '';
let category: Category | '' = '';
/** The open correction form, kept across redraws so typing isn't lost. */
let correction: { key: string; form: HTMLElement } | undefined;
let mode: 'radar' | 'list' = 'radar';
let search = '';
const quick = new Set<QuickFilter>();
let hidePrivate = true;
let minRssi: number | undefined;
let within: number | undefined;
let radiusSetting: number | undefined;
let selected: string | undefined;
let editingKey: string | undefined;
let signature = '';
let droneSignature = '';
let planSignature = '';
let drawnAt = 0;
let drawTimer: ReturnType<typeof setTimeout> | undefined;
const announcer = new DroneAnnouncer();

const toLngLat = (place: Place): LngLat => [place.lon, place.lat];
const wirePoint = (lat?: number, lon?: number): LngLat | undefined =>
  lat === undefined || lon === undefined ? undefined : [lon / 1e7, lat / 1e7];

function svg<K extends keyof SVGElementTagNameMap>(
  name: K,
  attributes: Record<string, string | number>,
) {
  const node = document.createElementNS(SVG, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  return node;
}
function line(value: string, className = 'muted') {
  const small = document.createElement('small');
  small.className = className;
  small.textContent = value;
  return small;
}
function button(label: string, symbol: string, onClick: () => void, className = 'compact') {
  const control = document.createElement('button');
  control.type = 'button';
  control.className = className;
  control.append(icon(symbol), label);
  control.addEventListener('click', onClick);
  return control;
}
function badge(label: string, tone?: 'warn' | 'good') {
  const span = document.createElement('span');
  span.className = 'signal-badge';
  if (tone) span.dataset.tone = tone;
  span.textContent = label;
  return span;
}
function bars(rssi: number) {
  return rssi >= -55 ? 4 : rssi >= -67 ? 3 : rssi >= -80 ? 2 : 1;
}
function strength(rssi: number) {
  return `${'▮'.repeat(bars(rssi))}${'▯'.repeat(4 - bars(rssi))} ${rssi} dBm`;
}

function filter(): SignalFilter {
  return {
    ...(kind ? { kinds: [kind] } : {}),
    quick: [...quick],
    text: search,
    hidePrivate,
    ...(minRssi !== undefined ? { minRssi } : {}),
    ...(within !== undefined ? { within } : {}),
    ...(category ? { category } : {}),
  };
}

/** The records the filters let through, newest first, and how many of each kind. */
function shown(now: number) {
  const base = { ...filter(), kinds: undefined };
  const counts: Record<SignalKind | 'all', number> = {
    all: 0,
    drone: 0,
    wifi: 0,
    bluetooth: 0,
    probe: 0,
  };
  const records: SignalRecord[] = [];
  for (const record of history.records.values()) {
    if (!matchesFilter(record, base, now, identityForFilter)) continue;
    counts.all++;
    counts[record.kind]++;
    if (!kind || record.kind === kind) records.push(record);
  }
  records.sort((a, b) => b.lastSeen - a.lastSeen);
  return { records, counts };
}

/** A round radius that fits most of what is shown. */
function autoRadius(distances: number[]) {
  if (!distances.length) return 100;
  const sorted = [...distances].sort((a, b) => a - b);
  const p80 = sorted[Math.floor(sorted.length * 0.8)] * 1.1;
  return [25, 50, 100, 250, 500, 1000, 2000].find(step => step >= p80) ?? 2000;
}

function placementText(placement: Placement) {
  const distance = formatDistance(placement.distance, preferences.units);
  const bearing =
    placement.bearing === undefined ? '' : formatBearing(placement.bearing, preferences.angles);
  switch (placement.how) {
    case 'reported':
      return `${distance} at ${bearing}, reported by the transmitter`;
    case 'estimated':
      return `About ${distance} at ${bearing} (±${formatDistance(placement.error ?? 0, preferences.units)}), ${
        placement.source === 'lookup'
          ? 'where WiGLE places it'
          : 'estimated from where you heard it'
      }`;
    case 'distance':
      return `About ${distance} from signal strength; direction unknown`;
  }
}

function select(key: string | undefined) {
  selected = key;
  signature = '';
  render();
}

// The radar.

function marker(record: SignalRecord, x: number, y: number, how: Placement['how'], size: number) {
  const group = svg('g', { class: `radar-point radar-${how} radar-${record.kind}` });
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

function drawRadar(records: SignalRecord[], now: number) {
  const me = herePlace();
  const size = 400;
  const centre = size / 2;
  const edge = centre - 22;
  const placed = records.slice(0, MAX_POINTS).map(record => ({
    record,
    placement: placementOf(record, me),
  }));
  const radius = radiusSetting ?? autoRadius(placed.map(p => p.placement.distance));
  const root = svg('svg', {
    viewBox: `0 0 ${size} ${size}`,
    class: 'radar-svg',
    role: 'img',
    'aria-label': `Radar of ${placed.length} signals within ${formatDistance(radius, preferences.units)}`,
  });
  for (let ring = 1; ring <= 4; ring++) {
    const r = (edge * ring) / 4;
    root.append(svg('circle', { cx: centre, cy: centre, r, class: 'radar-ring' }));
    const label = svg('text', { x: centre + 4, y: centre - r + 12, class: 'radar-ring-label' });
    label.textContent = formatDistance((radius * ring) / 4, preferences.units);
    root.append(label);
  }
  root.append(
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

  // Names under the newest and strongest few, the watched and the selected.
  const named = new Set(
    [...placed]
      .sort((a, b) => b.record.latest.rssi - a.record.latest.rssi)
      .slice(0, MAX_LABELS)
      .map(p => p.record.key),
  );
  let selectedGroup: SVGGElement | undefined;
  for (const { record, placement } of placed.reverse()) {
    const angle = ((placement.bearing ?? steadyAngle(record.key)) - 90) * (Math.PI / 180);
    const beyond = placement.distance > radius;
    const r = Math.min(placement.distance / radius, 1) * edge;
    const x = centre + r * Math.cos(angle);
    const y = centre + r * Math.sin(angle);
    const isSelected = record.key === selected;
    const group = marker(record, x, y, placement.how, isSelected ? 7 : 5);
    group.classList.toggle('is-stale', now - record.lastSeen > NOW_MS);
    group.classList.toggle('is-beyond', beyond);
    group.classList.toggle('is-selected', isSelected);
    if (record.watch) group.append(svg('circle', { cx: x, cy: y, r: 10, class: 'radar-watch' }));
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
    if (isSelected || record.watch || named.has(record.key)) {
      const label = svg('text', { x, y: y + 19, class: 'radar-label', 'text-anchor': 'middle' });
      const name = displayName(record);
      label.textContent = name.length > 18 ? `${name.slice(0, 17)}…` : name;
      group.append(label);
    }
    const hit = svg('circle', { cx: x, cy: y, r: 14, class: 'radar-hit' });
    const title = svg('title', {});
    title.textContent = `${displayName(record)} · ${CATEGORIES[identityOf(record).category]} · ${placementText(placement)}`;
    hit.append(title);
    group.append(hit);
    group.addEventListener('click', () => select(record.key));
    if (isSelected) selectedGroup = group;
    else root.append(group);
  }
  if (selectedGroup) root.append(selectedGroup); // On top.
  root.append(svg('circle', { cx: centre, cy: centre, r: 5, class: 'radar-you' }));
  const you = svg('text', { x: centre + 9, y: centre + 15, class: 'radar-ring-label' });
  you.textContent = me ? 'You' : 'You (no position)';
  root.append(you);

  const legend = document.createElement('div');
  legend.className = 'radar-legend';
  for (const [how, label] of [
    ['reported', 'Position reported'],
    ['estimated', 'Estimated from where you heard it'],
    ['distance', 'Distance only, direction unknown'],
  ] as const) {
    const item = document.createElement('span');
    const swatch = svg('svg', { width: 12, height: 12, 'aria-hidden': 'true' });
    swatch.append(svg('circle', { cx: 6, cy: 6, r: 4.5, class: `radar-mark radar-${how}-swatch` }));
    item.append(swatch, label);
    legend.append(item);
  }
  const shapes = document.createElement('span');
  shapes.className = 'faint';
  shapes.textContent = '▲ drone · ■ Wi-Fi · ● Bluetooth · ◆ searching';
  legend.append(shapes);
  if (!me) legend.append(line('Without your position, nothing has a direction.', 'faint'));
  element('signals-radar').replaceChildren(root, legend);
}

// The list.

function listRow(record: SignalRecord, now: number) {
  const row = document.createElement('li');
  row.className = 'card signal-card';
  row.classList.toggle('is-stale', now - record.lastSeen > STALE_MS);
  row.classList.toggle('is-selected', record.key === selected);
  row.tabIndex = 0;
  row.setAttribute('role', 'button');
  row.setAttribute('aria-pressed', String(record.key === selected));
  const head = document.createElement('div');
  head.className = 'signal-card-head';
  const name = document.createElement('strong');
  name.textContent = displayName(record);
  head.append(icon(KIND_ICONS[record.kind]), name);
  const r = record.latest;
  if (r.type === 'bleDevice' && r.tracker !== undefined)
    head.append(badge(tracker(r.tracker), 'warn'));
  if (r.type === 'wifiAp' && !r.security) head.append(badge('Open', 'warn'));
  if (record.watch) head.append(badge('Watched'));
  const identity = identityOf(record);
  row.append(
    head,
    line(
      `${CATEGORIES[identity.category]}${identity.maker ? ` · ${identity.maker}` : ''}${
        identity.fromUser ? '' : ` · ${identity.confidence} confidence`
      }`,
    ),
    line(describe(record), 'faint'),
  );
  if (record.kind !== 'drone')
    row.append(
      line(`${formatAddress(record.id)}${record.privateAddress ? ' · changing address' : ''}`),
    );
  if (record.note) row.append(line(record.note, 'signal-note'));
  row.append(
    line(strength(r.rssi), 'signal-strength muted'),
    line(
      `Heard ${formatAgo(record.lastSeen, now)}${record.visits > 1 ? ` · ${record.visits} times` : ''}`,
    ),
  );
  row.addEventListener('click', () => select(record.key));
  row.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      select(record.key);
    }
  });
  return row;
}

// The panel for the selected signal.

type Fact = readonly [string, string | Node];

function facts(rows: Fact[]) {
  const list = document.createElement('dl');
  list.className = 'signal-facts';
  for (const [label, value] of rows) {
    const term = document.createElement('dt');
    term.textContent = label;
    const detail = document.createElement('dd');
    detail.append(value);
    list.append(term, detail);
  }
  return list;
}

function when(ms: number, now: number) {
  const date = new Date(ms);
  const today = new Date(now).toDateString() === date.toDateString();
  return `${today ? date.toLocaleTimeString() : date.toLocaleString()} (${formatAgo(ms, now)})`;
}

function placeLink(place: Place | undefined, now: number, at?: number) {
  if (!place) return 'Your position was not known';
  const span = document.createElement('span');
  span.className = 'signal-place';
  span.append(
    formatCoordinate(toLngLat(place), preferences.coordinates) +
      (at ? ` · ${formatAgo(at, now)}` : ''),
    button('Map', 'map-pin', () => showOnMap(toLngLat(place))),
  );
  return span;
}

/** Signal strength over the last hour of sightings, as a small line. */
function sparkline(record: SignalRecord, now: number) {
  const points = record.sightings.filter(s => now - s.at <= 60 * 60_000);
  const width = 240;
  const height = 40;
  const chart = svg('svg', {
    viewBox: `0 0 ${width} ${height}`,
    class: 'signal-spark',
    role: 'img',
    'aria-label': 'Signal strength over the last hour',
  });
  if (points.length < 2) {
    const note = svg('text', { x: 4, y: 24, class: 'radar-ring-label' });
    note.textContent = 'Not enough reports in the last hour';
    chart.append(note);
    return chart;
  }
  const top = -30;
  const bottom = -100;
  const path = points
    .map((s, i) => {
      const x = ((s.at - (now - 60 * 60_000)) / (60 * 60_000)) * width;
      const y = ((top - Math.max(bottom, Math.min(top, s.rssi))) / (top - bottom)) * height;
      return `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join('');
  chart.append(svg('path', { d: path, class: 'signal-spark-line' }));
  return chart;
}

function telemetry(record: SignalRecord): Fact[] {
  const r = record.latest;
  if (r.type !== 'remoteId') return [];
  const rows: Fact[] = [
    ['Aircraft', UA_TYPES[r.uaType] ?? `Type ${r.uaType}`],
    ['ID type', ID_TYPES[r.idType] ?? `Type ${r.idType}`],
    ['Heard over', TRANSPORTS[r.transport] ?? 'Remote ID'],
  ];
  if (r.altitude !== undefined)
    rows.push(['Altitude', formatHeight(r.altitude / 10, preferences.units)]);
  if (r.height !== undefined) rows.push(['Height', formatHeight(r.height / 10, preferences.units)]);
  if (r.speed !== undefined) rows.push(['Speed', formatSpeed(r.speed / 100, preferences.units)]);
  if (r.heading !== undefined)
    rows.push(['Heading', formatBearing(r.heading / 100, preferences.angles)]);
  const position = wirePoint(r.latitude, r.longitude);
  if (position)
    rows.push(['Position', placeLink({ lat: position[1], lon: position[0] }, Date.now())]);
  const operator = airText(r.operatorId);
  if (operator) rows.push(['Operator ID', operator]);
  const pilot = wirePoint(r.operatorLatitude, r.operatorLongitude);
  if (pilot)
    rows.push(['Operator position', placeLink({ lat: pilot[1], lon: pilot[0] }, Date.now())]);
  if (record.track?.length) rows.push(['Track', `${record.track.length} positions kept`]);
  return rows;
}

function details(record: SignalRecord): Fact[] {
  const r = record.latest;
  switch (r.type) {
    case 'wifiAp':
      return [
        ['Network', r.hidden ? 'Hidden' : airText(r.ssid) || 'Unnamed'],
        ['Address', formatAddress(r.address)],
        ['Security', securityLabel(r.security)],
        ['Band', `${bandLabel(r.band)} channel ${r.channel}`],
        ['Signal range', `${r.rssiMin} to ${r.rssiMax} dBm`],
      ];
    case 'bleDevice': {
      const services = serviceIds(r.services);
      const rows: Fact[] = [
        ['Address', `${formatAddress(r.address)}${record.privateAddress ? ' (changes)' : ''}`],
        ['Signal range', `${r.rssiMin} to ${r.rssiMax} dBm`],
      ];
      if (services.length) rows.push(['Services', services.map(serviceLabel).join(', ')]);
      return rows;
    }
    case 'wifiProbe':
      return [
        [
          'Device address',
          `${formatAddress(r.address)}${record.privateAddress ? ' (changes)' : ''}`,
        ],
        ['Looking for', airText(r.ssid) || 'Any network'],
        ['Band', `${bandLabel(r.band)} channel ${r.channel}`],
      ];
    case 'remoteId':
      return r.address ? [['Transmitter', formatAddress(r.address)]] : [];
  }
}

function showOnMap(at: LngLat) {
  setView('map');
  fieldMap.invalidate();
  fieldMap.showPoint(at);
}

/** The editable part: built once per selection so typing isn't interrupted by updates. */
function editor(record: SignalRecord) {
  const box = document.createElement('div');
  box.className = 'signals-editor';
  const field = (label: string, control: HTMLInputElement | HTMLTextAreaElement) => {
    const wrap = document.createElement('label');
    wrap.className = 'field';
    const caption = document.createElement('span');
    caption.textContent = label;
    wrap.append(caption, control);
    return wrap;
  };
  const save = (change: Parameters<typeof history.annotate>[1]) => {
    history.annotate(record.key, change);
    signature = '';
    render();
  };
  const label = document.createElement('input');
  label.value = record.label ?? '';
  label.placeholder = 'Your name for it';
  label.maxLength = 64;
  label.addEventListener('change', () => save({ label: label.value.trim() }));
  const note = document.createElement('textarea');
  note.value = record.note ?? '';
  note.placeholder = 'Add a note';
  note.rows = 3;
  note.maxLength = 2000;
  note.addEventListener('change', () => save({ note: note.value.trim() }));
  const tags = document.createElement('input');
  tags.value = record.tags?.join(', ') ?? '';
  tags.placeholder = 'Tags, separated by commas';
  tags.addEventListener('change', () =>
    save({
      tags: [
        ...new Set(
          tags.value
            .split(',')
            .map(tag => tag.trim())
            .filter(Boolean),
        ),
      ].slice(0, 12),
    }),
  );
  const actions = document.createElement('div');
  actions.className = 'signal-card-actions';
  const watch = button(record.watch ? 'Watching' : 'Watch', 'crosshair', () => {
    save({ watch: !history.records.get(record.key)?.watch });
    lookUpWatched();
    watch.replaceChildren(
      icon('crosshair'),
      history.records.get(record.key)?.watch ? 'Watching' : 'Watch',
    );
    watch.setAttribute('aria-pressed', String(!!history.records.get(record.key)?.watch));
  });
  watch.setAttribute('aria-pressed', String(!!record.watch));
  watch.title = 'Mark it, to find it again with the Watched filter';
  const forget = button('Forget', 'trash-2', () => {
    void confirmSheet({
      title: 'Forget this signal?',
      body: 'Its history, note and tags are deleted from this computer. If it is heard again, it starts a new history.',
      confirm: 'Forget',
      danger: true,
    }).then(ok => {
      if (!ok) return;
      history.remove(record.key);
      select(undefined);
    });
  });
  actions.append(watch, forget);
  box.append(field('Name', label), field('Note', note), field('Tags', tags), actions);
  return box;
}

function renderPanel(now: number) {
  const panel = element('signals-panel');
  const record = selected ? history.records.get(selected) : undefined;
  if (!record) {
    panel.hidden = true;
    editingKey = undefined;
    return;
  }
  panel.hidden = false;
  const placement = placementOf(record, herePlace());
  let top = panel.querySelector<HTMLElement>('.signals-panel-top');
  if (editingKey !== record.key || !top) {
    editingKey = record.key;
    top = document.createElement('div');
    top.className = 'signals-panel-top';
    const close = button('', 'x', () => select(undefined), 'round compact signals-panel-close');
    close.setAttribute('aria-label', 'Close');
    panel.replaceChildren(top, editor(record), close);
  }
  const head = document.createElement('div');
  head.className = 'signal-card-head';
  const name = document.createElement('strong');
  name.textContent = displayName(record);
  head.append(icon(KIND_ICONS[record.kind]), name);
  const rows: Fact[] = [
    ['Where', placementText(placement)],
    ['Signal', `${strength(record.latest.rssi)} · strongest ${record.bestRssi} dBm`],
    ['First heard', when(record.firstSeen, now)],
    ['Last heard', when(record.lastSeen, now)],
    ['Times heard', `${record.visits} time${record.visits === 1 ? '' : 's'}`],
    ['Last heard from', placeLink(record.lastPlace, now, record.lastSeen)],
    ['Strongest from', placeLink(strongestPlace(record), now)],
    ...details(record),
    ...telemetry(record),
  ];
  const kindLine = line(`${KIND_LABELS[record.kind]} · ${describe(record)}`);
  const children: Node[] = [head, kindLine, identityBlock(record)];
  const lookup = lookupBlock(record);
  if (lookup) children.push(lookup);
  if (record.privateAddress)
    children.push(
      line(
        record.kind === 'wifi'
          ? 'This network’s address is locally assigned, so it names no maker.'
          : 'This address changes (about every 15 minutes for a phone), so the same device can appear again under a new one.',
        'faint',
      ),
    );
  children.push(sparkline(record, now), facts(rows));
  const target = placement.place ?? record.lastPlace;
  if (target)
    children.push(
      button(placement.place ? 'Show it on the map' : 'Show where you heard it', 'map-pin', () =>
        showOnMap(toLngLat(target)),
      ),
    );
  top.replaceChildren(...children);
}

/** What it most likely is, why, and the user's correction. */
function identityBlock(record: SignalRecord) {
  const identity = identityOf(record);
  const box = document.createElement('div');
  box.className = 'signal-identity';
  const title = document.createElement('div');
  title.className = 'signal-identity-title';
  const what = document.createElement('strong');
  what.textContent = `${CATEGORIES[identity.category]}${identity.maker ? ` · ${identity.maker}` : ''}`;
  title.append(
    what,
    badge(
      identity.fromUser ? 'Your correction' : `${identity.confidence} confidence`,
      identity.fromUser ? 'good' : undefined,
    ),
  );
  const reasons = document.createElement('ul');
  reasons.className = 'signal-reasons';
  for (const reason of identity.reasons) {
    const item = document.createElement('li');
    item.textContent = reason;
    reasons.append(item);
  }
  const actions = document.createElement('div');
  actions.className = 'signal-card-actions';
  actions.append(
    button('Correct', 'pencil', () => {
      correction = { key: record.key, form: correctionForm(record) };
      signature = '';
      render();
    }),
  );
  if (identity.fromUser)
    actions.append(
      button('Use the guess', 'undo-2', () => {
        clearCorrection(record);
        signature = '';
        render();
      }),
    );
  box.append(title, reasons, actions);
  if (correction?.key === record.key) box.append(correction.form);
  return box;
}

function correctionForm(record: SignalRecord) {
  const identity = identityOf(record);
  const form = document.createElement('form');
  form.className = 'signal-correction';
  const select = document.createElement('select');
  select.setAttribute('aria-label', 'What it is');
  for (const [value, label] of Object.entries(CATEGORIES)) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    select.append(option);
  }
  select.value = identity.category;
  const maker = document.createElement('input');
  maker.placeholder = 'Maker (optional)';
  maker.value = identity.maker ?? '';
  maker.maxLength = 64;
  maker.setAttribute('aria-label', 'Maker');
  const name = displayName({ ...record, label: undefined });
  const everyWrap = document.createElement('label');
  everyWrap.className = 'toggle-row';
  const every = document.createElement('input');
  every.type = 'checkbox';
  const everyText = document.createElement('span');
  everyText.textContent = `Use this for every ${KIND_LABELS[record.kind].toLowerCase()} named “${name}”`;
  everyWrap.append(everyText, every);
  const save = document.createElement('button');
  save.type = 'submit';
  save.className = 'primary compact';
  save.textContent = 'Save';
  const cancel = button('Cancel', 'x', () => {
    correction = undefined;
    signature = '';
    render();
  });
  const actions = document.createElement('div');
  actions.className = 'signal-card-actions';
  actions.append(save, cancel);
  form.append(select, maker);
  if (record.kind !== 'probe' && record.kind !== 'drone' && airTextName(record))
    form.append(everyWrap);
  form.append(actions);
  form.addEventListener('submit', event => {
    event.preventDefault();
    correctIdentity(record, select.value as Category, maker.value, every.checked);
    correction = undefined;
    signature = '';
    render();
  });
  return form;
}

/** Whether the signal sent a name a correction could be applied by. */
function airTextName(record: SignalRecord) {
  const r = record.latest;
  return (
    (r.type === 'wifiAp' && !r.hidden && !!airText(r.ssid)) ||
    (r.type === 'bleDevice' && !!airText(r.name))
  );
}

/** What WiGLE knows about a Wi-Fi network, and a button to ask. */
function lookupBlock(record: SignalRecord) {
  if (record.kind !== 'wifi') return undefined;
  const box = document.createElement('div');
  box.className = 'signal-lookup';
  const found = record.lookup;
  if (found) {
    const heading = line(
      found.found
        ? `WiGLE, ${formatAgo(found.at, Date.now())}: seen${found.where ? ` in ${found.where}` : ''}${
            found.ssid ? ` as “${found.ssid}”` : ''
          }${found.firstSeen ? `, first ${found.firstSeen.slice(0, 10)}` : ''}${
            found.lastSeen ? `, last ${found.lastSeen.slice(0, 10)}` : ''
          }.`
        : `WiGLE, ${formatAgo(found.at, Date.now())}: not in its database.`,
    );
    box.append(heading);
    const place = found.place;
    if (place)
      box.append(button('Where WiGLE places it', 'map-pin', () => showOnMap(toLngLat(place))));
  }
  if (wigleReady()) {
    const looking = isLookingUp(record.key);
    const ask = button(
      looking ? 'Looking up…' : found ? 'Look up again' : 'Look up on WiGLE',
      'search',
      () => requestLookup(record, true),
    );
    ask.disabled = looking;
    box.append(ask);
  } else if (!found)
    box.append(line('Turn on WiGLE lookups in This app to look this network up.', 'faint'));
  return box;
}

// Header, plan and drones.

function stateText() {
  const link = signalsLink();
  const simulated = signalsSource() === 'simulated' ? 'Simulated · ' : '';
  switch (link.state) {
    case 'closed':
      return history.records.size
        ? 'Not connected. Showing the history kept on this computer.'
        : 'Not connected. Plug the XIAO ESP32-C5 into this computer and connect.';
    case 'negotiating':
      return `${simulated}Starting the add-on`;
    case 'timeout':
      return "The add-on didn't answer. Check it runs the signals firmware and try again.";
    case 'incompatible':
      return 'This add-on firmware does not work with this portal. Update one of them.';
    case 'stalled':
      return `${simulated}No updates from the add-on for a while`;
    case 'ready': {
      const status = link.status;
      if (!status) return `${simulated}Connected`;
      const where = status.channel
        ? `${bandLabel(status.band)} channel ${status.channel}`
        : 'Bluetooth';
      return `${simulated}Listening · now on ${where} · ${link.identity?.firmware ?? ''}`;
    }
  }
}

function planFromForm(): SensorPlan {
  const bands =
    (element<HTMLInputElement>('signals-band24').checked ? 1 : 0) |
    (element<HTMLInputElement>('signals-band5').checked ? 2 : 0);
  return {
    profile: Number(element<HTMLSelectElement>('signals-profile').value),
    bands,
    dwell: signalsLink().plan?.dwell ?? 150,
    bluetooth: element<HTMLInputElement>('signals-bluetooth').checked ? 1 : 0,
    probes: element<HTMLInputElement>('signals-probes').checked ? 1 : 0,
  };
}

function loadPlan() {
  const plan = signalsLink().plan;
  const key = plan
    ? `${plan.request}:${plan.state}:${plan.profile}:${plan.bands}:${plan.bluetooth}:${plan.probes}`
    : '';
  if (key === planSignature) return;
  planSignature = key;
  const shownPlan = plan ?? { profile: 0, bands: 3, bluetooth: 1, probes: 0, state: '' };
  element<HTMLSelectElement>('signals-profile').value = String(shownPlan.profile);
  element<HTMLInputElement>('signals-band24').checked = !!(shownPlan.bands & 1);
  element<HTMLInputElement>('signals-band5').checked = !!(shownPlan.bands & 2);
  element<HTMLInputElement>('signals-bluetooth').checked = shownPlan.bluetooth === 1;
  element<HTMLInputElement>('signals-probes').checked = shownPlan.probes === 1;
  text(
    'signals-plan-state',
    !plan
      ? ''
      : plan.state === 'applied'
        ? 'Plan applied'
        : `Not applied (${plan.state}); the plan in force is shown`,
  );
  syncSegmented();
}

/** Drones on the map, the count on the Signals button, and a notification for a new one. */
function renderDrones(now: number) {
  const drones = signalsLink().store.drones;
  const nearby = nearbyDrones(drones.values(), now);
  text('signals-badge', nearby || '');
  element('signals-badge').hidden = nearby === 0;

  const added = announcer.fresh(drones.values());
  if (added.length && away() && preferences.notifications !== 'off')
    for (const drone of added.slice(0, 3))
      notify(
        'Drone heard',
        `${airText(drone.uasId) || 'A drone'} (${UA_TYPES[drone.uaType] ?? 'unknown type'}) over ${
          TRANSPORTS[drone.transport] ?? 'Remote ID'
        }`,
        `reaper-mesh:drone:${drone.uasId}`,
        () => {
          setView('signals');
          select(`drone:${drone.uasId}`);
        },
      );

  const marks: DroneMark[] = [];
  for (const d of drones.values()) {
    const at = wirePoint(d.latitude, d.longitude);
    if (!at) continue;
    marks.push({
      id: d.uasId,
      label: airText(d.uasId) || 'Drone',
      at,
      operator: wirePoint(d.operatorLatitude, d.operatorLongitude),
      stale: now - d.receivedAt > STALE_MS,
    });
  }
  const key = JSON.stringify(marks);
  if (key === droneSignature) return;
  droneSignature = key;
  fieldMap.setDrones(marks);
}

export function renderSignals() {
  const link = signalsLink();
  const now = Date.now();
  renderDrones(now);
  renderSignalsSettings();
  const key = [
    link.state,
    history.version,
    link.status?.receivedAt,
    link.plan?.request,
    link.plan?.state,
    kind,
    mode,
    search,
    [...quick].join(','),
    hidePrivate,
    minRssi,
    within,
    radiusSetting,
    selected,
    signalsSource(),
    signalsProblem(),
    historyProblem(),
    Math.floor(now / 5000), // "Heard … ago" moves on.
    preferences.units,
    preferences.coordinates,
    preferences.angles,
  ].join('|');
  if (key === signature) return;
  // Reports stream in many times a second; the radar and list keep up a few times a second.
  if (now - drawnAt < DRAW_MS) {
    drawTimer ??= setTimeout(
      () => {
        drawTimer = undefined;
        renderSignals();
      },
      DRAW_MS - (now - drawnAt),
    );
    return;
  }
  signature = key;
  drawnAt = now;

  const connected = link.state !== 'closed';
  text('signals-state', stateText());
  element('signals-connect').hidden = connected;
  element('signals-simulate').hidden = connected;
  element('signals-disconnect').hidden = !connected;
  setNotice(
    'signals-notice',
    signalsProblem() ||
      historyProblem() ||
      (!signalsSupported() && !connected
        ? 'This browser has no Web Serial. Use Chrome, Edge or the desktop app, or try the simulated add-on.'
        : undefined),
    'warn',
  );
  const ready = link.state === 'ready' || link.state === 'stalled';
  element('signals-plan').hidden = !ready;
  if (ready) loadPlan();

  const { records, counts } = shown(now);
  text('signals-count-all', counts.all || '');
  for (const k of ['drone', 'wifi', 'bluetooth', 'probe'] as const)
    text(`signals-count-${k}`, counts[k] || '');
  for (const control of document.querySelectorAll<HTMLElement>('[data-signals-kind]')) {
    const on = control.dataset.signalsKind === kind;
    control.classList.toggle('is-active', on);
    control.setAttribute('aria-pressed', String(on));
  }
  for (const control of document.querySelectorAll<HTMLElement>('[data-signals-mode]')) {
    const on = control.dataset.signalsMode === mode;
    control.classList.toggle('is-active', on);
    control.setAttribute('aria-pressed', String(on));
  }
  for (const control of document.querySelectorAll<HTMLElement>('[data-signals-quick]'))
    control.setAttribute(
      'aria-pressed',
      String(quick.has(control.dataset.signalsQuick as QuickFilter)),
    );
  element('signals-hide-private').setAttribute('aria-pressed', String(hidePrivate));

  const radar = element('signals-radar');
  const list = element('signals-list');
  radar.hidden = mode !== 'radar' || !records.length;
  list.hidden = mode !== 'list' || !records.length;
  if (!radar.hidden) drawRadar(records, now);
  if (!list.hidden) list.replaceChildren(...records.slice(0, MAX_ROWS).map(r => listRow(r, now)));
  const more = element('signals-more');
  const limit = mode === 'radar' ? MAX_POINTS : MAX_ROWS;
  more.hidden = records.length <= limit;
  more.textContent = `Showing the ${limit} heard most recently of ${records.length}. Export saves them all.`;
  element<HTMLButtonElement>('signals-export').disabled = records.length === 0;
  renderPanel(now);

  const empty = element('signals-empty');
  let message = '';
  if (!history.records.size)
    message = connected
      ? 'Nothing heard yet.'
      : 'Connect the signals add-on, or try the simulated one. What it hears is kept here.';
  else if (!records.length)
    message =
      kind === 'probe' && !link.plan?.probes && connected
        ? 'Capturing devices that search for networks is off. Turn it on in the scan plan.'
        : kind === 'drone' && !search && !quick.size
          ? 'No drones heard. Only drones that broadcast Remote ID can be seen.'
          : 'Nothing matches these filters.';
  empty.textContent = message;
  empty.hidden = !message;
}

/** Saves the shown signals as a CSV file: every one, with the filters applied. */
function exportShown() {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
  downloadBlob(
    `reaper-signals-${stamp}.csv`,
    new Blob([historyCsv(shown(Date.now()).records, identityForFilter)], { type: 'text/csv' }),
  );
}

/** Chooses the add-on's port and connects; the port chooser needs this click. */
export async function connectSignalsFromClick(): Promise<boolean> {
  const port = await chooseSignalsPort();
  if (!port) return false;
  await connectSignals(port);
  return true;
}

export function initSignals() {
  onSignalsChange(render);
  onIdentityChange(() => {
    signature = '';
    render();
  });
  onHistoryChange(() => {
    signature = '';
    render();
  });
  element('signals-connect').addEventListener('click', () => void connectSignalsFromClick());
  element('signals-simulate').addEventListener('click', () => void connectSimulatedSignals());
  element('signals-disconnect').addEventListener('click', () => void disconnectSignals(true));
  element('signals-export').addEventListener('click', exportShown);
  element('signals-apply').addEventListener('click', () => {
    const plan = planFromForm();
    if (!plan.bands && !plan.bluetooth) {
      text('signals-plan-state', 'Choose at least one band or Bluetooth.');
      return;
    }
    // Without a Wi-Fi band the add-on still needs one listed; Bluetooth-only uses the profile.
    const sent = signalsLink().setPlan(plan.bands ? plan : { ...plan, bands: 1, profile: 3 });
    text('signals-plan-state', sent ? 'Sending plan' : 'Not connected');
  });
  for (const control of document.querySelectorAll<HTMLElement>('[data-signals-kind]'))
    control.addEventListener('click', () => {
      kind = control.dataset.signalsKind as SignalKind | '';
      render();
    });
  for (const control of document.querySelectorAll<HTMLElement>('[data-signals-mode]'))
    control.addEventListener('click', () => {
      mode = control.dataset.signalsMode as 'radar' | 'list';
      render();
    });
  for (const control of document.querySelectorAll<HTMLElement>('[data-signals-quick]'))
    control.addEventListener('click', () => {
      const value = control.dataset.signalsQuick as QuickFilter;
      if (quick.has(value)) quick.delete(value);
      else quick.add(value);
      render();
    });
  element('signals-hide-private').addEventListener('click', () => {
    hidePrivate = !hidePrivate;
    render();
  });
  const number = (id: string) => {
    const value = element<HTMLSelectElement>(id).value;
    return value === '' ? undefined : Number(value);
  };
  element('signals-min-rssi').addEventListener('change', () => {
    minRssi = number('signals-min-rssi');
    render();
  });
  element('signals-within').addEventListener('change', () => {
    within = number('signals-within');
    render();
  });
  element('signals-category').addEventListener('change', () => {
    category = element<HTMLSelectElement>('signals-category').value as Category | '';
    render();
  });
  element('signals-radius').addEventListener('change', () => {
    radiusSetting = number('signals-radius');
    render();
  });
  element<HTMLInputElement>('signals-search').addEventListener('input', event => {
    search = (event.target as HTMLInputElement).value.trim().toLowerCase();
    render();
  });
  initSignalsSettings();
  void loadHistory().then(() => lookUpWatched());
  void loadReference();
  // A remembered add-on that is plugged in reconnects without a click.
  void reconnectSignals();
}
