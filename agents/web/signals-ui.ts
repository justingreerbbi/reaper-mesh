/**
 * The Signals screen (D60, D61), laid out for a phone first: a status line and two buttons, one row
 * of chips that pick what to show, search with the rarer filters in a sheet, then the radar or the
 * list, and a panel for the selected signal. The pieces are in signals-radar.ts, signals-panel.ts,
 * signals-hunt-ui.ts and signals-monitor-ui.ts.
 */
import { preferences, render } from './app-state.ts';
import { element, text } from './dom.ts';
import { formatAgo, type LngLat } from './geo.ts';
import { fieldMap } from './map-ui.ts';
import type { DroneMark } from './map.ts';
import { setView } from './nav.ts';
import { away, notify } from './notifications.ts';
import { downloadBlob, icon, setNotice, syncSegmented } from './ui.ts';
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
import { badge, el, line, setText } from './signals-dom.ts';
import {
  airText,
  DroneAnnouncer,
  historyCsv,
  nearbyDrones,
  STALE_MS,
  TRANSPORTS,
  UA_TYPES,
} from './signals-format.ts';
import {
  herePlace,
  history,
  historyProblem,
  loadHistory,
  onHistoryChange,
} from './signals-history.ts';
import { huntedKey, onHuntChange, renderHunt } from './signals-hunt-ui.ts';
import {
  identityForFilter,
  identityOf,
  initSignalsSettings,
  loadReference,
  lookUpWatched,
  onIdentityChange,
  renderSignalsSettings,
} from './signals-identity.ts';
import { initMonitor, isMonitoring, renderMonitor } from './signals-monitor-ui.ts';
import { initPanel, KIND_ICONS, renderPanel, titleOf, whatIs } from './signals-panel.ts';
import { drawRadar, initRadar, MAX_POINTS } from './signals-radar.ts';
import type { Identity } from '../../packages/agent-core/signals-identify.ts';
import {
  matchesFilter,
  NOW_MS,
  type QuickFilter,
  type SignalFilter,
  type SignalRecord,
} from '../../packages/agent-core/signals-intel.ts';

/** Rows drawn at most in the list. */
const MAX_ROWS = 200;
/** The screen redraws at most this often while reports stream in. */
const DRAW_MS = 800;

type View = Readonly<{
  id: string;
  label: string;
  test: (record: SignalRecord, identity: Identity) => boolean;
}>;
/** The chips: one tap picks what to show. */
const VIEWS: readonly View[] = [
  { id: 'all', label: 'All', test: () => true },
  { id: 'drone', label: 'Drones', test: r => r.kind === 'drone' },
  { id: 'flock', label: 'Flock', test: (_, i) => i.device === 'flock' },
  { id: 'ring', label: 'Ring', test: (_, i) => i.device === 'ring' },
  { id: 'camera', label: 'Cameras', test: (_, i) => i.category === 'camera' },
  { id: 'tracker', label: 'Trackers', test: (_, i) => i.category === 'tracker' },
  { id: 'wifi', label: 'Wi-Fi', test: r => r.kind === 'wifi' },
  { id: 'bluetooth', label: 'Bluetooth', test: r => r.kind === 'bluetooth' },
  { id: 'probe', label: 'Searching', test: r => r.kind === 'probe' },
  { id: 'watched', label: 'Watched', test: r => !!r.watch },
];
/**
 * With Live on, a signal drops off this long after it was last heard, and fades halfway there.
 * The add-on takes about 11 s to go round every channel, so 30 s allows two missed rounds.
 */
const LIVE_MS = 30_000;
const LIVE_FADE_MS = 15_000;

let view = 'all';
let mode: 'radar' | 'list' = 'radar';
let search = '';
let live = true;
let minRssi: number | undefined;
let hidePrivate = true;
let notedOnly = false;
let newToday = false;
let selected: string | undefined;
let signature = '';
let droneSignature = '';
let drawnAt = 0;
let drawTimer: ReturnType<typeof setTimeout> | undefined;
const announcer = new DroneAnnouncer();

/** Redraws now, past the throttle: for something the user just did. */
function redraw() {
  signature = '';
  drawnAt = 0;
  render();
}

function select(key: string | undefined) {
  selected = key;
  redraw();
}

/** How many of the sheet's filters are away from their defaults. */
function filtersChanged() {
  return (
    Number(minRssi !== undefined) + Number(!hidePrivate) + Number(notedOnly) + Number(newToday)
  );
}

/** The records the filters and the chip let through, newest first, and a count per chip. */
function shown(now: number) {
  const quick: QuickFilter[] = [];
  if (notedOnly) quick.push('noted');
  if (newToday) quick.push('today');
  const filter: SignalFilter = {
    quick,
    text: search,
    hidePrivate,
    ...(minRssi !== undefined ? { minRssi } : {}),
  };
  const hunted = huntedKey();
  const counts = new Map<string, number>();
  const records: SignalRecord[] = [];
  const chosen = VIEWS.find(v => v.id === view) ?? VIEWS[0];
  for (const record of history.records.values()) {
    // Live shows only what is being heard; the selected and hunted signals stay in view.
    if (live && now - record.lastSeen > LIVE_MS && record.key !== selected && record.key !== hunted)
      continue;
    if (!matchesFilter(record, filter, now, identityForFilter)) continue;
    const identity = identityOf(record);
    for (const v of VIEWS)
      if (v.test(record, identity)) counts.set(v.id, (counts.get(v.id) ?? 0) + 1);
    if (chosen.test(record, identity)) records.push(record);
  }
  records.sort((a, b) => b.lastSeen - a.lastSeen);
  return { records, counts };
}

// The chips and the list.

function buildChips() {
  const row = element('signals-chips');
  for (const v of VIEWS) {
    const chip = el('button', 'chip', el('span', '', v.label), el('span', 'chip-count'));
    chip.type = 'button';
    chip.dataset.view = v.id;
    chip.addEventListener('click', () => {
      view = v.id;
      redraw();
    });
    row.append(chip);
  }
}

function renderChips(counts: Map<string, number>) {
  for (const chip of element('signals-chips').querySelectorAll<HTMLElement>('.chip')) {
    const id = chip.dataset.view!;
    const count = counts.get(id) ?? 0;
    chip.setAttribute('aria-pressed', String(id === view));
    chip.classList.toggle('is-empty', count === 0 && id !== view && id !== 'all');
    setText(chip.querySelector('.chip-count')!, count ? String(count) : '');
  }
}

/** One row: name and what it is on the left, strength and when on the right. */
function listRow(record: SignalRecord, now: number) {
  const identity = identityOf(record);
  const name = el('span', 'signal-row-name', el('strong', '', titleOf(record, identity)));
  const r = record.latest;
  if (identity.device) name.append(badge(identity.device === 'flock' ? 'Flock' : 'Ring', 'warn'));
  else if (r.type === 'bleDevice' && r.tracker !== undefined) name.append(badge('Tracker', 'warn'));
  if (record.watch) name.append(badge('Watched'));
  const row = el(
    'li',
    'signal-row',
    icon(KIND_ICONS[record.kind]),
    el('div', 'signal-row-main', name, line(record.note || whatIs(identity))),
    el(
      'div',
      'signal-row-meta',
      el('span', 'signal-strength', `${r.rssi} dBm`),
      line(formatAgo(record.lastSeen, now), 'faint'),
    ),
  );
  row.classList.toggle('is-stale', now - record.lastSeen > (live ? LIVE_FADE_MS : STALE_MS));
  row.classList.toggle('is-selected', record.key === selected);
  row.tabIndex = 0;
  row.setAttribute('role', 'button');
  // On press, not click: the list redraws while reports stream in.
  row.addEventListener('pointerdown', event => {
    if (event.button === 0) select(record.key);
  });
  row.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      select(record.key);
    }
  });
  return row;
}

// The header, the add-on and drones.

function stateText() {
  const link = signalsLink();
  const simulated = signalsSource() === 'simulated' ? 'Simulated · ' : '';
  switch (link.state) {
    case 'closed':
      return 'Not connected';
    case 'negotiating':
      return `${simulated}Starting the add-on`;
    case 'timeout':
      return "The add-on didn't answer";
    case 'incompatible':
      return 'Add-on firmware and portal don’t match';
    case 'stalled':
      return `${simulated}Add-on went quiet`;
    case 'ready':
      return `${simulated}Listening`;
  }
}

/**
 * The add-on listens to everything: both Wi-Fi bands, Bluetooth and devices searching for networks
 * (the owner's choice, replacing the scan plan). The filters decide what is shown.
 */
const LISTEN_TO_ALL = { profile: 0, bands: 3, dwell: 150, bluetooth: 1, probes: 1 } as const;
/** The connection and boot the plan was last sent to: a new connection gets it again. */
let planSentTo: { link: object; boot: string } | undefined;

function listenToAll() {
  const link = signalsLink();
  const boot = link.identity?.boot;
  if (!boot || link.state !== 'ready') return;
  if (planSentTo?.link === link && planSentTo.boot === boot) return;
  const plan = link.plan;
  if (
    plan &&
    plan.profile === LISTEN_TO_ALL.profile &&
    plan.bands === LISTEN_TO_ALL.bands &&
    plan.bluetooth === LISTEN_TO_ALL.bluetooth &&
    plan.probes === LISTEN_TO_ALL.probes
  ) {
    planSentTo = { link, boot };
    return;
  }
  // Once per boot: the add-on starts with its default plan after every restart.
  if (link.setPlan({ ...LISTEN_TO_ALL, dwell: plan?.dwell ?? LISTEN_TO_ALL.dwell }))
    planSentTo = { link, boot };
}

const wirePoint = (lat?: number, lon?: number): LngLat | undefined =>
  lat === undefined || lon === undefined ? undefined : [lon / 1e7, lat / 1e7];

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
  renderHunt();
  listenToAll();
  const key = [
    link.state,
    history.version,
    link.status?.receivedAt,
    view,
    mode,
    search,
    live,
    minRssi,
    hidePrivate,
    notedOnly,
    newToday,
    selected,
    huntedKey(),
    isMonitoring(),
    signalsSource(),
    signalsProblem(),
    historyProblem(),
    Math.floor(now / 5000), // "Heard … ago" moves on.
    preferences.units,
    preferences.coordinates,
    preferences.angles,
  ].join('|');
  if (key === signature) return;
  // Reports stream in many times a second; the screen keeps up a few times a second.
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
  element('signals-disconnect').hidden = !connected;
  setNotice(
    'signals-notice',
    signalsProblem() ||
      historyProblem() ||
      (!signalsSupported() && !connected
        ? 'This browser has no Web Serial. Use Chrome, Edge or the desktop app.'
        : undefined),
    'warn',
  );
  renderMonitor();

  const { records, counts } = shown(now);
  renderChips(counts);
  const changed = filtersChanged();
  text('signals-filter-label', changed ? `Filters · ${changed}` : 'Filters');
  element('signals-filter').classList.toggle('is-changed', changed > 0);
  for (const control of document.querySelectorAll<HTMLElement>('[data-signals-mode]')) {
    const on = control.dataset.signalsMode === mode;
    control.classList.toggle('is-active', on);
    control.setAttribute('aria-pressed', String(on));
  }

  const radar = element('signals-radar');
  const list = element('signals-list');
  radar.hidden = mode !== 'radar' || !records.length;
  list.hidden = mode !== 'list' || !records.length;
  if (!radar.hidden)
    drawRadar(radar, records, now, {
      me: herePlace(),
      selected,
      hunted: huntedKey(),
      staleAfter: live ? LIVE_FADE_MS : NOW_MS,
      onSelect: select,
      name: record => titleOf(record, identityOf(record)),
      describe: record => whatIs(identityOf(record)),
    });
  if (!list.hidden) list.replaceChildren(...records.slice(0, MAX_ROWS).map(r => listRow(r, now)));
  const cap = mode === 'radar' ? MAX_POINTS : MAX_ROWS;
  const limit = element('signals-limit');
  limit.hidden = records.length <= cap;
  limit.textContent = `Newest ${cap} of ${records.length}`;
  element('signals-live').setAttribute('aria-pressed', String(live));
  renderPanel(element('signals-panel'), selected, now);

  let message = '';
  if (!history.records.size) message = connected ? 'Nothing heard yet' : 'Not connected';
  else if (!records.length) message = live ? 'Nothing heard right now' : 'Nothing matches';
  text('signals-empty-text', message);
  element('signals-empty').hidden = !message;
  element('signals-simulate').hidden = connected;
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

function initFilters() {
  const sheet = element<HTMLDialogElement>('signals-filter-sheet');
  const rssiSelect = element<HTMLSelectElement>('signals-min-rssi');
  const hide = element<HTMLInputElement>('signals-hide-private');
  const noted = element<HTMLInputElement>('signals-noted');
  const today = element<HTMLInputElement>('signals-today');
  const read = () => {
    minRssi = rssiSelect.value === '' ? undefined : Number(rssiSelect.value);
    hidePrivate = hide.checked;
    notedOnly = noted.checked;
    newToday = today.checked;
    redraw();
  };
  for (const control of [rssiSelect, hide, noted, today]) control.addEventListener('change', read);
  element('signals-filter').addEventListener('click', () => {
    sheet.showModal();
    syncSegmented();
  });
  element('signals-filter-close').addEventListener('click', () => sheet.close());
  element('signals-filter-reset').addEventListener('click', () => {
    rssiSelect.value = '';
    hide.checked = true;
    noted.checked = today.checked = false;
    syncSegmented();
    read();
  });
  element('signals-export').addEventListener('click', exportShown);
}

export function initSignals() {
  onSignalsChange(render);
  for (const subscribe of [onHuntChange, onIdentityChange, onHistoryChange])
    subscribe(() => {
      signature = '';
      render();
    });
  buildChips();
  initFilters();
  initPanel(() => select(undefined), redraw);
  initRadar(element('signals-radar'), redraw);
  initMonitor();
  initSignalsSettings();
  element('signals-connect').addEventListener('click', () => void connectSignalsFromClick());
  element('signals-simulate').addEventListener('click', () => void connectSimulatedSignals());
  element('signals-disconnect').addEventListener('click', () => void disconnectSignals(true));
  for (const control of document.querySelectorAll<HTMLElement>('[data-signals-mode]'))
    control.addEventListener('click', () => {
      mode = control.dataset.signalsMode as 'radar' | 'list';
      redraw();
    });
  element('signals-live').addEventListener('click', () => {
    live = !live;
    redraw();
  });
  // Signals drop off the live view as they go quiet, even when nothing else changes.
  setInterval(renderSignals, 5000);
  element<HTMLInputElement>('signals-search').addEventListener('input', event => {
    search = (event.target as HTMLInputElement).value.trim().toLowerCase();
    redraw();
  });
  void loadHistory().then(() => lookUpWatched());
  void loadReference();
  // A remembered add-on that is plugged in reconnects without a click.
  void reconnectSignals();
}
