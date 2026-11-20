// The Device tab's home page, Diagnostics, and This app.
import {
  access,
  clearError,
  current,
  currentError,
  knownConfig,
  mode,
  nodeCache,
  preferences,
  recovery,
  setPreference,
  render,
} from './app-state.ts';
import { element, text } from './dom.ts';
import { drawDeviceArt } from './device-art.ts';
import { endSession, hasDevice, linkState } from './connection-ui.ts';
import { lastDeviceId, shortNode } from './messages-ui.ts';
import {
  DEFAULT_CHANNEL_IDS,
  DEFAULT_CHANNELS,
  channelList,
} from '../../packages/protocol/radio-config.ts';
import { setNotice } from './ui.ts';
import type { Preferences } from './preferences.ts';
import { canKeepAwake } from './keep-awake.ts';
import {
  connectGps,
  disconnectGps,
  gpsState,
  gpsSupported,
  hasSavedGps,
  onGpsChange,
} from './gps.ts';
import { updateSource } from './location.ts';
import {
  notificationPermission,
  notificationsSupported,
  requestNotifications,
} from './notifications.ts';

const NODE_CAPACITY = 32;
const MODE_LABELS = { off: 'Off', receive: 'Listen', mesh: 'Mesh' };
const LEVEL_LABELS = { low: 'Low', medium: 'Medium', high: 'High' };

function formatKb(bytes: number | undefined) {
  if (bytes === undefined) return '—';
  return (bytes / 1024).toFixed(bytes < 10240 ? 1 : 0);
}

let meterSignature = '';
function renderMeter(value: number, max: number) {
  const ticks = 16;
  const filled = max > 0 ? Math.round((Math.min(value, max) / max) * ticks) : 0;
  const signature = `${filled}`;
  const meter = element('stat-nodes-meter');
  meter.setAttribute('aria-valuemin', '0');
  meter.setAttribute('aria-valuemax', String(max));
  meter.setAttribute('aria-valuenow', String(value));
  if (signature === meterSignature) return;
  meterSignature = signature;
  meter.replaceChildren(
    ...Array.from({ length: ticks }, (_, index) => {
      const tick = document.createElement('span');
      tick.classList.toggle('is-on', index < filled);
      return tick;
    }),
  );
}

const factSignatures = new Map<string, string>();
function renderFacts(id: string, rows: [string, string | number | undefined][]) {
  const signature = JSON.stringify(rows);
  if (factSignatures.get(id) === signature) return;
  factSignatures.set(id, signature);
  element(id).replaceChildren(
    ...rows.flatMap(([label, value]) => {
      const term = document.createElement('dt');
      term.textContent = label;
      const detail = document.createElement('dd');
      detail.textContent = value === undefined ? '—' : String(value);
      return [term, detail];
    }),
  );
}

export function renderDevice() {
  const { connection, active } = current().adapter;
  const { sync, capabilities: c, radioInfo: r } = connection;
  const state = linkState();
  const ready = state === 'ready';
  const config = knownConfig();
  const radio = config?.radio;
  const device = lastDeviceId();
  const connected = hasDevice();
  const name = config?.label || (device ? `Node ${shortNode(device)}` : 'No device connected');

  text('device-name', connected ? name : 'No device connected');
  element('device-link-dot').dataset.tone = ready ? 'good' : connected ? 'bad' : 'muted';
  text('device-link', ready ? 'Linked' : connected ? 'Link lost' : 'Not connected');
  text(
    'device-identity',
    connected
      ? `${c?.firmware ?? 'Unknown firmware'}${device ? ` · ${shortNode(device)}` : ''}${mode.value === 'demo' ? ' · simulated, no radio traffic' : ''}`
      : 'Saved messages and map items are still here.',
  );
  drawDeviceArt(
    element('device-art'),
    connected ? name.toUpperCase() : 'REAPER',
    connected && radio && config ? `${MODE_LABELS[radio.mode]} · ${config.region}` : '',
    ready,
  );
  text('device-disconnect', connected ? 'Disconnect' : 'Connect a device');
  element('lock-app').hidden = !active || !access?.protected;
  setNotice('device-block', ready ? (connection.writeBlockReason ?? undefined) : undefined, 'warn');

  text('stat-radio', radio ? MODE_LABELS[radio.mode] : '—');
  text('stat-radio-detail', r ? r.state : (connection.radioError ?? ''));
  text('stat-power', radio ? LEVEL_LABELS[radio.level] : '—');
  text(
    'stat-power-detail',
    !radio ? '' : radio.boost ? 'Boost on' : radio.relay ? 'Relay on' : 'Relay off',
  );
  const capacity = c?.nodeCapacity ?? NODE_CAPACITY;
  const nodes = nodeCache.nodes;
  text('stat-nodes', nodes.length);
  // This browser remembers more nodes than a device holds, so the count can pass its capacity.
  text('stat-nodes-of', nodes.length <= capacity ? `of ${capacity}` : '');
  text(
    'stat-nodes-detail',
    `Remembered across channels · ${nodes.filter(node => node.position).length} with a position`,
  );
  renderMeter(nodes.length, capacity);
  text('stat-traffic', r ? `${r.transmitted} · ${r.received}` : '—');
  text('stat-memory', formatKb(r?.heapFree));

  text('row-general', config ? `Region ${config.region}` : '');
  text(
    'row-radio',
    radio ? `${MODE_LABELS[radio.mode]}, ${LEVEL_LABELS[radio.level]}` : 'Not available',
  );
  const channels = channelList({
    channels: radio?.channels ?? DEFAULT_CHANNELS,
    channelIds: radio?.channelIds ?? DEFAULT_CHANNEL_IDS,
  });
  text('row-channels', `${channels.length} in use`);
  text(
    'row-position',
    preferences.positionMode === 'browser'
      ? 'Following this browser'
      : config?.position?.share
        ? 'Sharing a fixed point'
        : 'Not sharing',
  );
  text('row-discovery', config?.discovery?.beacon ? 'Announcing' : 'Quiet');
  text(
    'row-screen',
    config?.screen
      ? config.screen.timeout
        ? `Off after ${config.screen.timeout}s`
        : 'Always on'
      : '',
  );

  renderFacts('diagnostics-device', [
    ['Node ID', connection.device ?? device],
    ['Short ID', device ? shortNode(device) : undefined],
    ['Firmware', c?.firmware],
    ['Settings revision', sync.state === 'ready' ? sync.revision : undefined],
    ['Configuration schema', c?.configSchema],
    ['Feature bits', c?.features],
    ['Radio protocol', c ? (c.radioVersion === 0 ? 'Not implemented' : c.radioVersion) : undefined],
    ['Max message', c?.maxMessageBytes ? `${c.maxMessageBytes} bytes` : undefined],
    ['Inbox size', c?.inboxCapacity],
    [
      'Request history',
      c ? `${c.receiptCapacity} receipts / ${c.ownerCapacity} owners` : undefined,
    ],
    ['This app admitted', c ? (c.ownerAdmitted === 1 ? 'Yes' : 'No, read-only') : undefined],
  ]);
  renderFacts('diagnostics-radio', [
    ['State', r?.state ?? connection.radioError],
    ['Reason', r?.reason],
    ['Hardware probe', r ? (r.probe === 1 ? 'OK' : 'Failed') : undefined],
    ['Packets sent', r?.transmitted],
    ['Packets heard', r?.received],
    ['Free memory', r ? `${r.heapFree} bytes` : undefined],
    ['Free stack', r ? `${r.stackFree} bytes` : undefined],
    [
      'Inbox',
      connection.inbox.error ?? (connection.inbox.gap ? 'Older messages were missed' : 'OK'),
    ],
    ['Recovery storage', recovery.connection.recoveryError ?? 'OK'],
  ]);

  // This app.
  element<HTMLSelectElement>('pref-theme').value = preferences.theme;
  element<HTMLSelectElement>('pref-units').value = preferences.units;
  element<HTMLSelectElement>('pref-coordinates').value = preferences.coordinates;
  element<HTMLInputElement>('pref-connect-on-load').checked = preferences.connectOnLoad;
  element<HTMLSelectElement>('pref-angles').value = preferences.angles;
  element<HTMLSelectElement>('pref-north').value = preferences.north;
  text(
    'pref-north-detail',
    preferences.north === 'magnetic'
      ? 'The heading readout matches a hand compass and shows "mag". Bearings measured on the map stay true, like a protractor on a paper map.'
      : 'The heading readout is from true north, like the map. Choose Magnetic to match a hand compass.',
  );
  element<HTMLInputElement>('pref-keep-awake').checked = preferences.keepAwake;
  element<HTMLInputElement>('pref-keep-awake').disabled = !canKeepAwake();
  text(
    'pref-keep-awake-detail',
    canKeepAwake()
      ? 'While the map follows your position or a track records, so the screen and computer stay on. Uses more battery.'
      : "This browser can't keep the screen on.",
  );
  element<HTMLSelectElement>('pref-notifications').value = preferences.notifications;
  text('pref-notifications-detail', notificationText());
  renderLocationSettings();
}

function notificationText() {
  const permission = notificationPermission();
  if (preferences.notifications === 'off')
    return 'No notifications. New messages still wait in Comms.';
  if (permission === 'unsupported') return "This browser can't show notifications.";
  if (permission === 'denied')
    return "Notifications are blocked for this site. Allow them in the browser's site settings.";
  if (permission === 'default') return 'Choose a setting again to allow notifications.';
  return preferences.notifications === 'full'
    ? 'Shows who sent it and the message, while the portal is in the background.'
    : 'Shows who sent it, not the message, while the portal is in the background.';
}

function renderLocationSettings() {
  const gps = preferences.locationSource === 'gps';
  element<HTMLSelectElement>('pref-location-source').value = preferences.locationSource;
  element('gps-settings').hidden = !gps;
  element('location-browser-note').hidden = gps;
  if (!gps) return;
  const state = gpsState();
  const satellites = (count: number | null) =>
    count === null ? '' : ` · ${count} ${count === 1 ? 'satellite' : 'satellites'}`;
  text(
    'gps-status',
    !gpsSupported()
      ? 'This browser has no Web Serial. Use Chrome, Edge or the desktop app.'
      : state.kind === 'off'
        ? 'Not connected.'
        : state.kind === 'connecting'
          ? `Connecting · ${state.detail}`
          : state.kind === 'searching'
            ? `Connected · searching for satellites${satellites(state.satellites)}`
            : state.kind === 'fix'
              ? `Connected · position fix${satellites(state.satellites)}`
              : state.message,
  );
  const connected = state.kind !== 'off' && state.kind !== 'error';
  const connect = element<HTMLButtonElement>('gps-connect');
  connect.hidden = connected;
  connect.disabled = !gpsSupported();
  element('gps-disconnect').hidden = !connected && !(state.kind === 'error' && hasSavedGps());
}

export function initDevice() {
  // Changing something again makes the last save's result old news.
  document.querySelector('.device-view')!.addEventListener('input', () => {
    if (!currentError()) return;
    clearError();
    render();
  });
  element('device-disconnect').addEventListener('click', () => void endSession());
  const bind = <K extends 'theme' | 'units' | 'coordinates' | 'angles' | 'north'>(
    id: string,
    key: K,
  ) =>
    element(id).addEventListener('change', () =>
      setPreference(key, element<HTMLSelectElement>(id).value as Preferences[K]),
    );
  bind('pref-theme', 'theme');
  bind('pref-units', 'units');
  bind('pref-coordinates', 'coordinates');
  bind('pref-angles', 'angles');
  bind('pref-north', 'north');
  element('pref-keep-awake').addEventListener('change', () =>
    setPreference('keepAwake', element<HTMLInputElement>('pref-keep-awake').checked),
  );
  element('pref-notifications').addEventListener('change', () => {
    setPreference(
      'notifications',
      element<HTMLSelectElement>('pref-notifications').value as Preferences['notifications'],
    );
    // Asking needs a click, and this is one.
    if (preferences.notifications !== 'off' && notificationPermission() === 'default')
      void requestNotifications().then(render);
  });
  element('pref-location-source').addEventListener('change', () => {
    const source = element<HTMLSelectElement>('pref-location-source')
      .value as Preferences['locationSource'];
    setPreference('locationSource', source);
    if (source === 'browser') void disconnectGps();
    else if (hasSavedGps()) void connectGps(false);
    updateSource();
  });
  element('gps-connect').addEventListener('click', () => void connectGps(true));
  element('gps-disconnect').addEventListener('click', () => void disconnectGps(true));
  onGpsChange(render);
  // A receiver used before reconnects on load, as the radio does.
  if (preferences.locationSource === 'gps' && hasSavedGps()) void connectGps(false);
  element('pref-connect-on-load').addEventListener('change', () => {
    setPreference('connectOnLoad', element<HTMLInputElement>('pref-connect-on-load').checked);
    render();
  });
}
