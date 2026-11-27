/**
 * Monitoring in the portal (D61): while it is on, every signal heard is logged with this computer's
 * position and the signal's strength, to export afterwards (CSV, or GeoJSON for mapping tools) or
 * to look at on the Map tab. One button opens one sheet: start or stop, and the saved logs.
 */
import { onLocalAppStop } from './access-ui.ts';
import { preferences, render } from './app-state.ts';
import { element } from './dom.ts';
import { formatDistance } from './geo.ts';
import { fieldMap } from './map-ui.ts';
import type { LogMark } from './map.ts';
import { currentView, onViewChange, openPage, setView } from './nav.ts';
import { keepAwake } from './keep-awake.ts';
import { currentFix, locationProblem, onFix, wantLocation, type Fix } from './location.ts';
import { IndexedDbLogs } from './signals-db.ts';
import { button, el, line, setText } from './signals-dom.ts';
import { airText, formatAddress } from './signals-format.ts';
import { history, onRecorded } from './signals-history.ts';
import { identityOf } from './signals-identity.ts';
import { whatIs } from './signals-panel.ts';
import { confirmSheet, downloadBlob } from './ui.ts';
import { displayName, type SignalKind } from '../../packages/agent-core/signals-intel.ts';
import {
  logCsv,
  logGeoJson,
  logPointsCsv,
  routeOf,
  SignalLogger,
  summarize,
  type LogEntry,
  type LogSession,
  type LogStorage,
} from '../../packages/agent-core/signals-log.ts';
import { CATEGORIES, KNOWN_DEVICES } from '../../packages/agent-core/signals-identify.ts';

const storage: LogStorage | undefined =
  typeof indexedDB === 'undefined' ? undefined : new IndexedDbLogs();
const logger = storage ? new SignalLogger(storage) : undefined;
let sessions: LogSession[] = [];
let problem = '';
let flushTimer: ReturnType<typeof setInterval> | undefined;
let clock: ReturnType<typeof setInterval> | undefined;
let signature = '';
let wiped = false;
/** When the last few positions arrived, to tell a GPS (every second) from Wi-Fi (about a minute). */
let fixTimes: number[] = [];
/** Positions rougher or rarer than this are not good enough for driving. */
const ROUGH_M = 25;
const RARE_MS = 10_000;

/** Seconds between positions lately, once there are a few to go by. */
function fixInterval() {
  if (fixTimes.length < 3) return undefined;
  return (fixTimes[fixTimes.length - 1] - fixTimes[0]) / (fixTimes.length - 1);
}

export const isMonitoring = () => !!logger?.active;

function duration(ms: number) {
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  return minutes >= 60
    ? `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`
    : `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function summary(session: LogSession) {
  return [
    `${session.signals.toLocaleString()} signal${session.signals === 1 ? '' : 's'}`,
    session.distance >= 5 ? formatDistance(session.distance, preferences.units) : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

function entryFor(key: string, rssi: number): LogEntry | undefined {
  const record = history.records.get(key);
  if (!record) return undefined;
  const r = record.latest;
  const identity = identityOf(record);
  return {
    kind: record.kind,
    id: record.kind === 'drone' ? airText(record.id) || record.id : formatAddress(record.id),
    name: displayName(record),
    rssi,
    ...('channel' in r ? { channel: r.channel } : {}),
    category: CATEGORIES[identity.category],
    ...(identity.maker ? { maker: identity.maker } : {}),
    ...(identity.device ? { device: KNOWN_DEVICES[identity.device] } : {}),
    ...(r.type === 'remoteId' && r.latitude !== undefined && r.longitude !== undefined
      ? { reported: { lat: r.latitude / 1e7, lon: r.longitude / 1e7 } }
      : {}),
  };
}

async function refresh() {
  if (!storage) return;
  sessions = (await storage.listSessions()).sort((a, b) => b.startedAt - a.startedAt);
  signature = '';
  renderMonitor();
}

const placeOf = (fix: Fix) => ({
  lat: fix.lngLat[1],
  lon: fix.lngLat[0],
  ...(fix.accuracy !== null ? { accuracy: fix.accuracy } : {}),
});

async function start() {
  if (!logger) return;
  problem = '';
  try {
    await logger.start(Date.now(), crypto.randomUUID());
  } catch (error) {
    problem = `Monitoring couldn't start: ${error instanceof Error ? error.message : error}`;
    return renderMonitor();
  }
  fixTimes = [];
  // A position the map or a track already has counts from the start.
  const fix = currentFix();
  if (fix) logger.moved(placeOf(fix), fix.at);
  wantLocation('signals-monitor', true);
  keepAwake('signals-monitor', true);
  flushTimer = setInterval(() => void logger.flush().catch(() => {}), 5000);
  clock = setInterval(renderMonitor, 1000);
  await refresh();
}

async function stop() {
  if (!logger) return;
  clearInterval(flushTimer);
  clearInterval(clock);
  wantLocation('signals-monitor', false);
  keepAwake('signals-monitor', false);
  try {
    // A full log has already ended itself; this still writes its last rows.
    if (logger.active) await logger.stop(Date.now());
    else await logger.flush();
  } catch (error) {
    problem = `The log couldn't be saved: ${error instanceof Error ? error.message : error}`;
  }
  await refresh();
}

async function exportLog(session: LogSession, format: 'csv' | 'points' | 'geojson') {
  if (!storage) return;
  if (logger?.session?.id === session.id) await logger.flush();
  const rows = await storage.readRows(session.id);
  const stamp = new Date(session.startedAt)
    .toISOString()
    .slice(0, 16)
    .replace(/[-:]/g, '')
    .replace('T', '-');
  if (format === 'csv')
    downloadBlob(`reaper-signals-log-${stamp}.csv`, new Blob([logCsv(rows)], { type: 'text/csv' }));
  else if (format === 'points')
    downloadBlob(
      `reaper-signals-log-${stamp}-all-points.csv`,
      new Blob([logPointsCsv(rows)], { type: 'text/csv' }),
    );
  else
    downloadBlob(
      `reaper-signals-log-${stamp}.geojson`,
      new Blob([logGeoJson(session, rows)], { type: 'application/geo+json' }),
    );
}

/** Point colours on the map, by kind; a known device family (Flock, Ring) outranks its kind. */
const MAP_COLORS: Record<SignalKind | 'known', string> = {
  wifi: '#4c9aff',
  bluetooth: '#a78bfa',
  probe: '#ebbb5f',
  drone: '#e5484d',
  known: '#ff4fd8',
};
const MAP_KEY: [SignalKind | 'known', string][] = [
  ['wifi', 'Wi-Fi'],
  ['bluetooth', 'Bluetooth'],
  ['probe', 'Searching'],
  ['drone', 'Drone'],
  ['known', 'Flock or Ring'],
];
const KIND_NAMES: Record<SignalKind, string> = {
  wifi: 'Wi-Fi network',
  bluetooth: 'Bluetooth device',
  probe: 'Searching device',
  drone: 'Drone',
};
const timeOf = (at: number) =>
  new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

/**
 * Shows a log on the Map tab until the user leaves it: the user's route, and one point per signal
 * where it was strongest. Nothing is added to the map's own items.
 */
async function viewOnMap(session: LogSession) {
  if (!storage) return;
  if (logger?.session?.id === session.id) await logger.flush();
  const rows = await storage.readRows(session.id);
  const signals = summarize(rows);
  const points = signals.flatMap(signal =>
    signal.best ? [{ ...signal.best, name: signal.name, device: signal.device }] : [],
  );
  const route = routeOf(rows);
  if (!points.length && route.length < 2) {
    problem = 'This log has no positions to show.';
    return renderMonitor();
  }
  // Weakest first, so the strongest are drawn on top.
  points.sort((a, b) => a.rssi - b.rssi);
  const marks: LogMark[] = points.map(point => ({
    at: [point.place.lon, point.place.lat],
    color: MAP_COLORS[point.device ? 'known' : point.kind],
    known: !!point.device,
    strength: (point.rssi + 95) / 55,
    lines: [
      point.name || point.id,
      point.device ??
        [point.category ?? KIND_NAMES[point.kind], point.maker].filter(Boolean).join(' · '),
      `Strongest ${point.rssi} dBm at ${timeOf(point.at)}`,
      point.name && point.name !== point.id ? point.id : '',
    ].filter(Boolean),
  }));
  element<HTMLDialogElement>('signals-monitor-sheet').close();
  setView('map');
  fieldMap.setLog(
    marks,
    route.map(place => [place.lon, place.lat]),
  );
  const unplaced = signals.length - points.length;
  setText(
    element('map-log-title'),
    `${points.length.toLocaleString()} signal${points.length === 1 ? '' : 's'}, where strongest` +
      (unplaced > 0 ? ` · ${unplaced.toLocaleString()} not placed` : ''),
  );
  const shown = new Set(points.map(point => (point.device ? 'known' : point.kind)));
  element('map-log-key').replaceChildren(
    ...MAP_KEY.filter(([kind]) => shown.has(kind)).map(([kind, label]) => {
      const item = el('span', '', label);
      item.style.setProperty('--dot', MAP_COLORS[kind]);
      return item;
    }),
  );
  element('map-log').hidden = false;
  element('map-empty').hidden = true;
}

function clearMapLog() {
  if (!fieldMap.hasLog) return;
  fieldMap.setLog([], []);
  element('map-log').hidden = true;
}

function logRow(session: LogSession) {
  const active = logger?.session?.id === session.id && logger.active;
  const started = new Date(session.startedAt);
  const title = el(
    'strong',
    '',
    `${started.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${started.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`,
  );
  const length = active
    ? 'recording'
    : duration((session.endedAt ?? session.lastAt ?? session.startedAt) - session.startedAt);
  const actions = el(
    'div',
    'signal-card-actions',
    button('CSV', 'download', () => void exportLog(session, 'csv')),
    button('All points', 'download', () => void exportLog(session, 'points')),
    button('Map file', 'map-pin', () => void exportLog(session, 'geojson')),
  );
  if (session.located || session.route)
    actions.prepend(button('View on map', 'map-pinned', () => void viewOnMap(session)));
  if (!active)
    actions.append(
      button('Delete', 'trash-2', () => {
        void confirmSheet({
          title: 'Delete this log?',
          body: 'Its points are deleted. Signal history and notes are kept.',
          confirm: 'Delete',
          danger: true,
        }).then(async ok => {
          if (!ok) return;
          await storage?.deleteSession(session.id);
          await refresh();
        });
      }),
    );
  return el(
    'li',
    'card signals-log',
    title,
    line(`${length} · ${summary(session)}`),
    session.rows && !session.located && !session.route ? line('No positions', 'faint') : '',
    actions,
  );
}

/** The header button, and the sheet if it is open. */
export function renderMonitor() {
  const active = isMonitoring();
  const session = logger?.session;
  const toggle = element('signals-monitor');
  toggle.classList.toggle('is-recording', active);
  setText(
    element('signals-monitor-label'),
    active && session ? duration(Date.now() - session.startedAt) : 'Monitor',
  );
  const sheet = element<HTMLDialogElement>('signals-monitor-sheet');
  if (!sheet.open) return;
  const status = !logger
    ? 'Logs need IndexedDB, which this browser lacks'
    : active && session
      ? `Recording ${duration(Date.now() - session.startedAt)} · ${summary(session)}`
      : logger.stoppedBecause || 'Logs signals with your position, for export.';
  setText(element('signals-monitor-status'), problem || status);
  const now = Date.now();
  const here = logger?.here(now);
  const age = here ? Math.round((now - here.at) / 1000) : 0;
  const interval = fixInterval();
  const accuracy = here?.place.accuracy ?? 0;
  setText(
    element('signals-monitor-location'),
    !active
      ? ''
      : here
        ? [
            `Position ±${formatDistance(accuracy, preferences.units)}`,
            interval !== undefined ? `every ${Math.max(1, Math.round(interval / 1000))} s` : '',
            age > 10 ? `${age} s old` : '',
          ]
            .filter(Boolean)
            .join(' · ')
        : locationProblem()
          ? 'No position: location is off'
          : 'Waiting for your position',
  );
  // A computer without GPS places itself from Wi-Fi: tens of metres, about once a minute.
  const rough =
    active &&
    !!here &&
    preferences.locationSource === 'browser' &&
    (accuracy > ROUGH_M || (interval ?? 0) > RARE_MS);
  element('signals-monitor-rough').hidden = !rough;
  setText(
    element('signals-monitor-rough-text'),
    rough
      ? "Rough position: this computer has no GPS, so it uses Wi-Fi. A phone's hotspot doesn't share its GPS."
      : '',
  );
  const startStop = element<HTMLButtonElement>('signals-monitor-toggle');
  startStop.disabled = !logger;
  setText(startStop, active ? 'Stop monitoring' : 'Start monitoring');
  startStop.className = active ? 'danger grow' : 'primary grow';
  // The list has buttons: rebuilt only when it changes, never on the clock.
  const key = JSON.stringify([sessions.map(s => [s.id, s.endedAt, active ? 0 : s.rows]), active]);
  if (key !== signature) {
    signature = key;
    const list = element('signals-monitor-logs');
    list.replaceChildren(...sessions.map(logRow));
    element('signals-monitor-none').hidden = sessions.length > 0;
  }
}

export function initMonitor() {
  const sheet = element<HTMLDialogElement>('signals-monitor-sheet');
  element('signals-monitor').addEventListener('click', () => {
    sheet.showModal();
    void refresh();
  });
  element('signals-monitor-close').addEventListener('click', () => sheet.close());
  element('signals-monitor-toggle').addEventListener('click', () => {
    void (isMonitoring() ? stop() : start());
  });
  onRecorded((key, rssi, at) => {
    if (!logger?.active || wiped) return;
    const entry = entryFor(key, rssi);
    // The logger's own latest position: a phone sends none while it is standing still.
    if (entry) logger.observe(entry, at);
    if (!logger.active) void stop(); // The log filled up.
  });
  onFix(fix => {
    if (!logger?.active) return;
    fixTimes = [...fixTimes, fix.at].slice(-4);
    logger.moved(placeOf(fix), fix.at);
  });
  element('signals-monitor-gps').addEventListener('click', () => {
    element<HTMLDialogElement>('signals-monitor-sheet').close();
    openPage('app');
  });
  // A log on the map is only a look: it goes when the user leaves the Map tab.
  onViewChange(() => {
    if (currentView() !== 'map') clearMapLog();
  });
  element('map-log-close').addEventListener('click', () => {
    clearMapLog();
    render();
  });
  addEventListener('pagehide', () => void logger?.flush().catch(() => {}));
  // A wipe deletes the database next; nothing may write it again.
  onLocalAppStop(() => {
    clearInterval(flushTimer);
    clearInterval(clock);
    clearMapLog();
    wiped = true;
  });
  // A log left open by a closed page ends at its last point.
  void (async () => {
    if (!storage) return;
    try {
      for (const session of await storage.listSessions())
        if (session.endedAt === undefined)
          await storage.putSession({ ...session, endedAt: session.lastAt ?? session.startedAt });
    } catch {
      // Shown when the sheet is opened.
    }
    await refresh().catch(() => {});
  })();
}
