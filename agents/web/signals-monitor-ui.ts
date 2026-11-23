/**
 * Monitoring in the portal (D61): while it is on, every signal heard is logged with this computer's
 * position and the signal's strength, to export afterwards (CSV, or GeoJSON for mapping tools).
 * One button opens one sheet: start or stop, and the saved logs.
 */
import { onLocalAppStop } from './access-ui.ts';
import { preferences } from './app-state.ts';
import { element } from './dom.ts';
import { formatDistance } from './geo.ts';
import { keepAwake } from './keep-awake.ts';
import { locationProblem, onFix, wantLocation } from './location.ts';
import { IndexedDbLogs } from './signals-db.ts';
import { button, el, line, setText } from './signals-dom.ts';
import { airText, formatAddress } from './signals-format.ts';
import { herePlace, history, onRecorded } from './signals-history.ts';
import { identityOf } from './signals-identity.ts';
import { whatIs } from './signals-panel.ts';
import { confirmSheet, downloadBlob } from './ui.ts';
import { displayName } from '../../packages/agent-core/signals-intel.ts';
import {
  logCsv,
  logGeoJson,
  SignalLogger,
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
    `${session.rows.toLocaleString()} point${session.rows === 1 ? '' : 's'}`,
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

async function start() {
  if (!logger) return;
  problem = '';
  try {
    await logger.start(Date.now(), crypto.randomUUID());
  } catch (error) {
    problem = `Monitoring couldn't start: ${error instanceof Error ? error.message : error}`;
    return renderMonitor();
  }
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

async function exportLog(session: LogSession, format: 'csv' | 'geojson') {
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
  else
    downloadBlob(
      `reaper-signals-log-${stamp}.geojson`,
      new Blob([logGeoJson(session, rows)], { type: 'application/geo+json' }),
    );
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
    button('Map file', 'map-pin', () => void exportLog(session, 'geojson')),
  );
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
    session.rows && !session.located ? line('No positions', 'faint') : '',
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
  const here = herePlace();
  setText(
    element('signals-monitor-location'),
    !active
      ? ''
      : here
        ? `Position ±${formatDistance(here.accuracy ?? 0, preferences.units)}`
        : locationProblem()
          ? 'No position: location is off'
          : 'Waiting for your position',
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
    if (entry) logger.observe(entry, at, herePlace());
    if (!logger.active) void stop(); // The log filled up.
  });
  onFix(fix => logger?.moved({ lat: fix.lngLat[1], lon: fix.lngLat[0] }));
  addEventListener('pagehide', () => void logger?.flush().catch(() => {}));
  // A wipe deletes the database next; nothing may write it again.
  onLocalAppStop(() => {
    clearInterval(flushTimer);
    clearInterval(clock);
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
