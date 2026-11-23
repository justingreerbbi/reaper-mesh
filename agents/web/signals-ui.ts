// The Signals tab (D60): what the signals add-on hears, its scan plan, and drones on the map.
import { preferences, render } from './app-state.ts';
import { element, text } from './dom.ts';
import { formatAgo, formatBearing, formatHeight, formatSpeed, type LngLat } from './geo.ts';
import { fieldMap } from './map-ui.ts';
import type { DroneMark } from './map.ts';
import { setView } from './nav.ts';
import { icon, setNotice, syncSegmented } from './ui.ts';
import {
  chooseSignalsPort,
  connectSignals,
  connectSimulatedSignals,
  disconnectSignals,
  onSignalsChange,
  signalsLink,
  signalsProblem,
  signalsSource,
  signalsSupported,
} from './signals.ts';
import type {
  BleDevice,
  RemoteId,
  Seen,
  SensorPlan,
  WifiAp,
  WifiProbe,
} from '../../packages/agent-core/sensor.ts';

type Tab = 'drones' | 'wifi' | 'bluetooth' | 'probes';
/** Not heard for this long: shown faded. */
const STALE_MS = 2 * 60_000;
/** Rows drawn at most, strongest or newest first. */
const MAX_ROWS = 200;

const decoder = new TextDecoder('utf-8', { fatal: false });
/** Text the air sent us: decoded leniently, with control characters removed. */
export function airText(hex: string | undefined) {
  if (!hex) return '';
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(2 * i, 2 * i + 2), 16);
  return decoder
    .decode(bytes)
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
    .trim();
}
export const formatAddress = (hex: string) => hex.toUpperCase().replace(/(..)(?!$)/g, '$1:');

const SECURITY = ['WEP', 'WPA', 'WPA2', 'WPA3', 'Enterprise', 'OWE'];
export function securityLabel(bits: number) {
  if (!bits) return 'Open';
  return SECURITY.filter((_, i) => bits & (1 << i)).join(' / ') || 'Unknown security';
}
const TRACKERS: Record<number, string> = {
  1: 'Apple Find My',
  2: 'Tile',
  3: 'Samsung SmartTag',
  4: 'Google Find Hub',
};
const COMPANIES: Record<number, string> = {
  0x0006: 'Microsoft',
  0x004c: 'Apple',
  0x0059: 'Nordic Semiconductor',
  0x0075: 'Samsung',
  0x0087: 'Garmin',
  0x009e: 'Bose',
  0x00e0: 'Google',
  0x012d: 'Sony',
  0x0171: 'Amazon',
  0x02e5: 'Espressif',
  0x038f: 'Xiaomi',
};
const ADDRESS_TYPES = ['public address', 'random address', 'private address', 'private address'];
const UA_TYPES = [
  'Unknown type',
  'Aeroplane',
  'Multirotor',
  'Gyroplane',
  'Hybrid lift',
  'Ornithopter',
  'Glider',
  'Kite',
  'Free balloon',
  'Captive balloon',
  'Airship',
  'Parachute',
  'Rocket',
  'Tethered aircraft',
  'Ground obstacle',
  'Other aircraft',
];
const TRANSPORTS: Record<number, string> = {
  1: 'Bluetooth',
  2: 'Bluetooth long range',
  3: 'Wi-Fi beacon',
  4: 'Wi-Fi NAN',
};
const band = (code: number) => (code === 2 ? '5 GHz' : code === 1 ? '2.4 GHz' : 'unknown band');
const company = (id: number | undefined) =>
  id === undefined ? '' : (COMPANIES[id] ?? `Company 0x${id.toString(16).padStart(4, '0')}`);
const degrees = (wire: number) => wire / 1e7;
const point = (lat?: number, lon?: number): LngLat | undefined =>
  lat === undefined || lon === undefined ? undefined : [degrees(lon), degrees(lat)];

function bars(rssi: number) {
  return rssi >= -55 ? 4 : rssi >= -67 ? 3 : rssi >= -80 ? 2 : 1;
}
function strength(rssi: number) {
  const span = document.createElement('span');
  span.className = 'signal-strength muted';
  span.textContent = `${'▮'.repeat(bars(rssi))}${'▯'.repeat(4 - bars(rssi))} ${rssi} dBm`;
  span.title = 'Signal strength';
  return span;
}
function badge(label: string, tone?: 'warn' | 'good') {
  const span = document.createElement('span');
  span.className = 'signal-badge';
  if (tone) span.dataset.tone = tone;
  span.textContent = label;
  return span;
}
function line(value: string) {
  const small = document.createElement('small');
  small.className = 'muted';
  small.textContent = value;
  return small;
}
function card(title: string, symbol: string, receivedAt: number, now: number, extra: Node[]) {
  const row = document.createElement('li');
  row.className = 'card signal-card';
  row.classList.toggle('is-stale', now - receivedAt > STALE_MS);
  const head = document.createElement('div');
  head.className = 'signal-card-head';
  const name = document.createElement('strong');
  name.textContent = title;
  head.append(icon(symbol), name);
  row.append(head, ...extra, line(`Heard ${formatAgo(receivedAt, now)}`));
  return row;
}

let tab: Tab = 'drones';
let search = '';
let signature = '';
let droneSignature = '';
let planSignature = '';

const matches = (...values: (string | undefined)[]) =>
  !search || values.some(value => value?.toLowerCase().includes(search));

function droneRow(d: Seen<RemoteId>, now: number) {
  const id = airText(d.uasId) || formatAddress(d.uasId);
  const facts: string[] = [UA_TYPES[d.uaType] ?? 'Unknown type'];
  if (d.altitude !== undefined)
    facts.push(`${formatHeight(d.altitude / 10, preferences.units)} altitude`);
  if (d.height !== undefined) facts.push(`${formatHeight(d.height / 10, preferences.units)} high`);
  if (d.speed !== undefined) facts.push(formatSpeed(d.speed / 100, preferences.units));
  if (d.heading !== undefined)
    facts.push(`heading ${formatBearing(d.heading / 100, preferences.angles)}`);
  const extra: Node[] = [line(facts.join(' · '))];
  const operator = airText(d.operatorId);
  extra.push(
    line(
      `${TRANSPORTS[d.transport] ?? 'Unknown transport'}${operator ? ` · operator ${operator}` : ''}`,
    ),
  );
  extra.push(strength(d.rssi));
  const at = point(d.latitude, d.longitude);
  const actions = document.createElement('div');
  actions.className = 'signal-card-actions';
  const show = document.createElement('button');
  show.type = 'button';
  show.className = 'compact';
  show.disabled = !at;
  show.append(icon(at ? 'map-pin' : 'map-pin-off'), at ? 'Show on map' : 'No position yet');
  show.addEventListener('click', () => {
    if (!at) return;
    setView('map');
    fieldMap.invalidate();
    fieldMap.showPoint(at);
  });
  actions.append(show);
  extra.push(actions);
  return card(id, 'drone', d.receivedAt, now, extra);
}

function wifiRow(ap: Seen<WifiAp>, now: number) {
  const name = ap.hidden ? 'Hidden network' : airText(ap.ssid) || 'Unnamed network';
  const security = securityLabel(ap.security);
  const extra: Node[] = [
    line(`${formatAddress(ap.address)} · ${band(ap.band)} channel ${ap.channel}`),
    line(`${security} · heard ${ap.count} time${ap.count === 1 ? '' : 's'}`),
    strength(ap.rssi),
  ];
  const row = card(name, 'wifi', ap.receivedAt, now, extra);
  if (!ap.security) row.querySelector('.signal-card-head')!.append(badge('Open', 'warn'));
  return row;
}

function bluetoothRow(device: Seen<BleDevice>, now: number) {
  const maker = company(device.manufacturer);
  const name = airText(device.name) || maker || 'Unnamed device';
  const extra: Node[] = [
    line(`${formatAddress(device.address)} · ${ADDRESS_TYPES[device.addressType] ?? 'address'}`),
  ];
  if (maker && airText(device.name)) extra.push(line(maker));
  if (device.phy === 3) extra.push(line('Long range'));
  extra.push(strength(device.rssi));
  const row = card(name, 'bluetooth', device.receivedAt, now, extra);
  const tracker =
    device.tracker === undefined ? undefined : (TRACKERS[device.tracker] ?? 'Tracker');
  if (tracker) row.querySelector('.signal-card-head')!.append(badge(tracker, 'warn'));
  return row;
}

function probeRow(probe: Seen<WifiProbe>, now: number) {
  const wanted = airText(probe.ssid);
  const extra: Node[] = [
    line(`${formatAddress(probe.address)} · ${band(probe.band)} channel ${probe.channel}`),
    strength(probe.rssi),
  ];
  return card(
    wanted ? `Looking for “${wanted}”` : 'Looking for any network',
    'search',
    probe.receivedAt,
    now,
    extra,
  );
}

function stateText() {
  const link = signalsLink();
  const simulated = signalsSource() === 'simulated' ? 'Simulated · ' : '';
  switch (link.state) {
    case 'closed':
      return 'Not connected. Plug the XIAO ESP32-C5 into this computer and connect.';
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
      const where = status.channel ? `${band(status.band)} channel ${status.channel}` : 'Bluetooth';
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
  const shown = plan ?? { profile: 0, bands: 3, bluetooth: 1, probes: 0, state: '' };
  element<HTMLSelectElement>('signals-profile').value = String(shown.profile);
  element<HTMLInputElement>('signals-band24').checked = !!(shown.bands & 1);
  element<HTMLInputElement>('signals-band5').checked = !!(shown.bands & 2);
  element<HTMLInputElement>('signals-bluetooth').checked = shown.bluetooth === 1;
  element<HTMLInputElement>('signals-probes').checked = shown.probes === 1;
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

function renderDrones(now: number) {
  const marks: DroneMark[] = [];
  for (const d of signalsLink().store.drones.values()) {
    const at = point(d.latitude, d.longitude);
    if (!at) continue;
    marks.push({
      id: d.uasId,
      label: airText(d.uasId) || 'Drone',
      at,
      operator: point(d.operatorLatitude, d.operatorLongitude),
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
  const key = [
    link.state,
    link.store.version,
    link.status?.receivedAt,
    link.plan?.request,
    link.plan?.state,
    tab,
    search,
    signalsSource(),
    signalsProblem(),
    Math.floor(now / 5000), // "Heard … ago" moves on.
    preferences.units,
  ].join('|');
  if (key === signature) return;
  signature = key;

  const connected = link.state !== 'closed';
  text('signals-state', stateText());
  element('signals-connect').hidden = connected;
  element('signals-simulate').hidden = connected;
  element('signals-disconnect').hidden = !connected;
  setNotice(
    'signals-notice',
    signalsProblem() ||
      (!signalsSupported() && !connected
        ? 'This browser has no Web Serial. Use Chrome, Edge or the desktop app, or try the simulated add-on.'
        : undefined),
    'warn',
  );
  const ready = link.state === 'ready' || link.state === 'stalled';
  element('signals-plan').hidden = !ready;
  if (ready) loadPlan();

  const store = link.store;
  text('signals-count-drones', store.drones.size || '');
  text('signals-count-wifi', store.wifiAps.size || '');
  text('signals-count-bluetooth', store.bleDevices.size || '');
  text('signals-count-probes', store.wifiProbes.size || '');
  for (const button of document.querySelectorAll<HTMLElement>('[data-signals-tab]')) {
    const selected = button.dataset.signalsTab === tab;
    button.classList.toggle('is-active', selected);
    button.setAttribute('aria-pressed', String(selected));
  }

  let rows: HTMLElement[] = [];
  let total = 0;
  if (tab === 'drones') {
    const list = [...store.drones.values()]
      .filter(d => matches(airText(d.uasId), airText(d.operatorId)))
      .sort((a, b) => b.receivedAt - a.receivedAt);
    total = list.length;
    rows = list.slice(0, MAX_ROWS).map(d => droneRow(d, now));
  } else if (tab === 'wifi') {
    const list = [...store.wifiAps.values()]
      .filter(ap => matches(airText(ap.ssid), formatAddress(ap.address), ap.address))
      .sort((a, b) => b.rssi - a.rssi);
    total = list.length;
    rows = list.slice(0, MAX_ROWS).map(ap => wifiRow(ap, now));
  } else if (tab === 'bluetooth') {
    const list = [...store.bleDevices.values()]
      .filter(d =>
        matches(airText(d.name), company(d.manufacturer), formatAddress(d.address), d.address),
      )
      .sort((a, b) => b.rssi - a.rssi);
    total = list.length;
    rows = list.slice(0, MAX_ROWS).map(d => bluetoothRow(d, now));
  } else {
    const list = [...store.wifiProbes.values()]
      .filter(p => matches(airText(p.ssid), formatAddress(p.address), p.address))
      .sort((a, b) => b.receivedAt - a.receivedAt);
    total = list.length;
    rows = list.slice(0, MAX_ROWS).map(p => probeRow(p, now));
  }
  element('signals-list').replaceChildren(...rows);
  const more = element('signals-more');
  more.hidden = total <= MAX_ROWS;
  more.textContent = `Showing ${MAX_ROWS} of ${total}.`;

  const empty = element('signals-empty');
  let message = '';
  if (!connected) message = 'Connect the signals add-on, or try the simulated one.';
  else if (!ready) message = '';
  else if (search && !total) message = 'Nothing matches that search.';
  else if (!total)
    message =
      tab === 'drones'
        ? 'No drones heard. Only drones that broadcast Remote ID can be seen.'
        : tab === 'probes' && !link.plan?.probes
          ? 'Capturing devices that search for networks is off. Turn it on in the scan plan.'
          : 'Nothing heard yet.';
  empty.textContent = message;
  empty.hidden = !message;
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
  element('signals-connect').addEventListener('click', () => void connectSignalsFromClick());
  element('signals-simulate').addEventListener('click', () => void connectSimulatedSignals());
  element('signals-disconnect').addEventListener('click', () => void disconnectSignals());
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
  for (const button of document.querySelectorAll<HTMLElement>('[data-signals-tab]'))
    button.addEventListener('click', () => {
      tab = button.dataset.signalsTab as Tab;
      render();
    });
  element<HTMLInputElement>('signals-search').addEventListener('input', event => {
    search = (event.target as HTMLInputElement).value.trim().toLowerCase();
    render();
  });
}
