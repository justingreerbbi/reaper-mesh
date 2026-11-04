// The connect screen, the session (including rejoining and reconnecting), and General settings.
import type { SerialPortLike } from '../../packages/agent-core/serial.ts';
import { BlePort, chooseBleDevice, type BleDevice } from '../../packages/agent-core/ble.ts';
import type { FieldDevice } from '../../packages/simulator/field-device.ts';
import type { ConfigModel } from './model.ts';
import {
  app,
  bluetooth,
  bluetoothHelp,
  bluetoothProblem,
  clearError,
  current,
  currentError,
  demo,
  mode,
  models,
  openLink,
  preferences,
  recovery,
  render,
  showError,
  writableConfig,
} from './app-state.ts';
import { element, text } from './dom.ts';
import { drawDeviceArt } from './device-art.ts';
import { messagesModeChanged, setConnectAction } from './messages-ui.ts';
import { fieldMap, setSelectedNode } from './map-ui.ts';
import { onLocalAppStop } from './access-ui.ts';
import { icon, setNotice } from './ui.ts';
import { formatAgo } from './geo.ts';
import {
  forgetDevice,
  readDevices,
  rememberDevice,
  type RememberedDevice,
} from './remembered-devices.ts';

type UsbPort = SerialPortLike & { getInfo?(): { usbVendorId?: number; usbProductId?: number } };
type SerialApi = EventTarget & {
  requestPort(): Promise<UsbPort>;
  getPorts?(): Promise<UsbPort[]>;
};
type BluetoothDevices = { getDevices?(): Promise<(BleDevice & { id?: string })[]> };
const serial = (navigator as Navigator & { serial?: SerialApi }).serial;

/** A device the user wants to stay connected to, and how to reach it again. */
type Target =
  | { kind: 'usb'; port: UsbPort }
  | { kind: 'ble'; device: BleDevice & { id?: string } }
  | { kind: 'demo' };

const RECONNECT_DELAYS_MS = [2000, 4000, 8000, 15000, 30000];

const label = element<HTMLInputElement>('label');
const region = element<HTMLSelectElement>('region');
const fault = element<HTMLSelectElement>('fault');
const readOnly = element<HTMLInputElement>('read-only');
const save = element<HTMLButtonElement>('save');
const reset = element<HTMLButtonElement>('reset');
const sheet = element<HTMLDialogElement>('connecting-sheet');

let wanted: Target | undefined;
/** The link has been up at least once, so a lost link stays in the app and reconnects. */
let everReady = false;
/** Looking at saved messages and the map with no device. */
let browsing = false;
let busy = false;
let attempt = 0;
let reconnectAttempt = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let rememberedSignature = '';
let devicesSignature = '';
let connectProblem = '';

export type LinkState = 'idle' | 'connecting' | 'negotiating' | 'ready' | 'lost';
export function linkState(): LinkState {
  const { adapter } = current();
  if (adapter.active && adapter.connection.sync.state === 'ready') return 'ready';
  if (busy) return 'connecting';
  if (adapter.active) return 'negotiating';
  return wanted && everReady ? 'lost' : 'idle';
}
export const inSession = () => browsing || (!!wanted && everReady);
export const hasDevice = () => !!wanted;

function modelFor(target: Target): ConfigModel {
  return target.kind === 'demo' ? models.demo : models.usb;
}

function useSource(target: Target) {
  const source = target.kind === 'demo' ? 'demo' : 'usb';
  if (mode.value !== source) {
    messagesModeChanged();
    mode.value = source;
    setSelectedNode('');
  }
  openLink.transport = target.kind === 'ble' ? 'ble' : 'usb';
}

async function attemptConnect(target: Target, quiet: boolean) {
  const token = ++attempt;
  clearTimeout(reconnectTimer);
  reconnectTimer = undefined;
  wanted = target;
  useSource(target);
  busy = true;
  connectProblem = '';
  if (!quiet) clearError();
  render();
  const model = modelFor(target);
  try {
    let port: SerialPortLike;
    if (target.kind === 'demo') {
      demo.readOnly = readOnly.checked;
      port = demo.createPort();
    } else if (target.kind === 'ble') port = new BlePort(target.device);
    else port = target.port;
    await model.adapter.connect(port, crypto.randomUUID());
  } catch (error) {
    if (token === attempt && !everReady) {
      wanted = undefined;
      if (!quiet)
        connectProblem = String(
          target.kind === 'ble'
            ? bluetoothProblem(error)
            : error instanceof Error
              ? error.message
              : error,
        );
    }
  } finally {
    if (token === attempt) {
      busy = false;
      render();
      fieldMap.invalidate();
    }
  }
}

/** USB adapters can come back as a new port object after being unplugged. */
async function findUsbPort(known?: { usbVendorId?: number; usbProductId?: number }) {
  const ports = (await serial?.getPorts?.()) ?? [];
  return ports.find(port => {
    const info = port.getInfo?.();
    return (
      info && info.usbVendorId === known?.usbVendorId && info.usbProductId === known?.usbProductId
    );
  });
}

function scheduleReconnect() {
  if (reconnectTimer || !wanted) return;
  const delay = RECONNECT_DELAYS_MS[Math.min(reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)];
  reconnectAttempt++;
  reconnectTimer = setTimeout(() => void reconnect(), delay);
}

async function reconnect() {
  reconnectTimer = undefined;
  const target = wanted;
  if (!target || current().adapter.active || busy) return;
  if (target.kind === 'usb') {
    const ports = (await serial?.getPorts?.()) ?? [];
    if (!ports.includes(target.port)) {
      const replacement = await findUsbPort(target.port.getInfo?.());
      if (!replacement) return scheduleReconnect();
      target.port = replacement;
    }
  }
  // Never replays anything: the session only queries outcomes it isn't sure of.
  await attemptConnect(target, true);
}

/** Ends the session and returns to the connect screen. */
export async function endSession() {
  ++attempt;
  clearTimeout(reconnectTimer);
  reconnectTimer = undefined;
  wanted = undefined;
  everReady = false;
  busy = false;
  browsing = false;
  reconnectAttempt = 0;
  rememberedSignature = '';
  connectProblem = '';
  clearError();
  try {
    await current().adapter.disconnect();
  } catch (e) {
    showError(e);
  }
  setSelectedNode('');
  render();
}

async function connectUsb(known?: RememberedDevice) {
  try {
    const port = (known && (await findUsbPort(known))) ?? (await serial!.requestPort());
    await attemptConnect({ kind: 'usb', port }, false);
  } catch (error) {
    // Closing the browser's chooser isn't a problem to report.
    if (!(error instanceof DOMException && error.name === 'NotFoundError')) {
      connectProblem = error instanceof Error ? error.message : String(error);
      render();
    }
  }
}

async function connectBluetooth(known?: RememberedDevice) {
  try {
    const granted = known?.bluetoothId
      ? await (bluetooth as unknown as BluetoothDevices).getDevices?.()
      : undefined;
    const device =
      granted?.find(row => row.id === known!.bluetoothId) ??
      ((await chooseBleDevice(bluetooth!)) as BleDevice & { id?: string });
    await attemptConnect({ kind: 'ble', device }, false);
  } catch (error) {
    if (!(error instanceof DOMException && error.name === 'NotFoundError')) {
      connectProblem = bluetoothProblem(error);
      render();
    }
  }
}

function connectKnown(known: RememberedDevice) {
  if (known.kind === 'simulated') return void attemptConnect({ kind: 'demo' }, false);
  if (known.kind === 'bluetooth') return void connectBluetooth(known);
  void connectUsb(known);
}

/** Checks for the last device on load. Never prompts, so a first visit arrives at Connect cleanly. */
export async function connectOnLoad() {
  if (!preferences.connectOnLoad || !recovery.writable) return;
  const last = readDevices(localStorage)[0];
  if (!last) return;
  if (last.kind === 'simulated') return void attemptConnect({ kind: 'demo' }, true);
  if (last.kind === 'usb') {
    const port = await findUsbPort(last);
    if (port) await attemptConnect({ kind: 'usb', port }, true);
    return;
  }
  const granted = await (bluetooth as unknown as BluetoothDevices | undefined)?.getDevices?.();
  const device = granted?.find(row => row.id === last.bluetoothId);
  if (device) await attemptConnect({ kind: 'ble', device }, true);
}

function rememberCurrent() {
  const { connection } = current().adapter;
  if (!wanted || !connection.device) return;
  const name = connection.sync.config?.label;
  const signature = `${connection.device}|${name}|${wanted.kind}`;
  if (signature === rememberedSignature) return;
  rememberedSignature = signature;
  const usb = wanted.kind === 'usb' ? wanted.port.getInfo?.() : undefined;
  try {
    rememberDevice(localStorage, {
      id: connection.device,
      kind: wanted.kind === 'demo' ? 'simulated' : wanted.kind === 'ble' ? 'bluetooth' : 'usb',
      ...(name ? { label: name } : {}),
      ...(wanted.kind === 'ble' && wanted.device.id ? { bluetoothId: wanted.device.id } : {}),
      ...(usb?.usbVendorId !== undefined ? { usbVendorId: usb.usbVendorId } : {}),
      ...(usb?.usbProductId !== undefined ? { usbProductId: usb.usbProductId } : {}),
      lastConnectedAt: Date.now(),
    });
  } catch {
    // Only means this device won't be listed next time.
  }
}

function deviceTitle(row: RememberedDevice) {
  return row.label || (row.kind === 'simulated' ? 'Simulated device' : 'Reaper device');
}
const KIND_LABELS = { usb: 'USB', bluetooth: 'Bluetooth', simulated: 'Simulated' };

/** Lists remembered devices on the connect screen and in This app. */
function renderDevices() {
  const devices = readDevices(localStorage);
  const signature = JSON.stringify([devices, Math.floor(Date.now() / 60000)]);
  if (signature === devicesSignature) return;
  devicesSignature = signature;
  element('connect-devices-section').hidden = devices.length === 0;
  element('connect-devices').replaceChildren(
    ...devices.map(row => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'row-button';
      button.setAttribute('aria-label', `Connect to ${deviceTitle(row)}`);
      const textBox = document.createElement('span');
      textBox.className = 'row-text';
      const title = document.createElement('strong');
      title.textContent = deviceTitle(row);
      const detail = document.createElement('small');
      detail.textContent = `${KIND_LABELS[row.kind]} · last connected ${formatAgo(row.lastConnectedAt)}`;
      textBox.append(title, detail);
      button.append(icon('radio'), textBox);
      button.addEventListener('click', () => connectKnown(row));
      return button;
    }),
  );
  const list = element('app-devices');
  list.replaceChildren(
    ...devices.map(row => {
      const wrap = document.createElement('div');
      wrap.className = 'device-row';
      const textBox = document.createElement('div');
      textBox.className = 'grow';
      const title = document.createElement('div');
      title.textContent = deviceTitle(row);
      const detail = document.createElement('small');
      detail.className = 'muted';
      detail.textContent = `Last connected ${formatAgo(row.lastConnectedAt)}`;
      textBox.append(title, detail);
      const forget = document.createElement('button');
      forget.type = 'button';
      forget.className = 'compact';
      forget.textContent = 'Forget';
      forget.addEventListener('click', () => {
        forgetDevice(localStorage, row.id);
        devicesSignature = '';
        render();
      });
      wrap.append(textBox, forget);
      return wrap;
    }),
  );
  if (!devices.length) {
    const none = document.createElement('small');
    none.className = 'muted';
    none.textContent = 'None yet.';
    list.append(none);
  }
}

function renderConnectScreen() {
  const usbMissing = !serial;
  const bluetoothMissing = !bluetooth;
  const insecure = !isSecureContext;
  element<HTMLButtonElement>('connect-usb').disabled = usbMissing || insecure || !recovery.writable;
  element<HTMLButtonElement>('connect-ble').disabled =
    bluetoothMissing || insecure || !recovery.writable;
  setNotice(
    'connect-support',
    !recovery.writable
      ? 'Reaper Mesh is open in another tab. Close that tab and reload to connect here.'
      : insecure
        ? 'USB and Bluetooth need HTTPS or localhost.'
        : usbMissing && bluetoothMissing
          ? 'This browser has no USB or Bluetooth access. Use Chrome or Edge on a desktop.'
          : bluetoothMissing
            ? bluetoothHelp
            : usbMissing
              ? 'This browser has no USB access. Use Chrome or Edge on a desktop for USB.'
              : undefined,
    'bad',
  );
  const { connection } = models[mode.value].adapter;
  setNotice('connect-error', connectProblem || connection.error, 'bad');
  drawDeviceArt(element('connect-art'), 'REAPER', 'Waiting', false);
}

function renderConnectingSheet(state: LinkState) {
  const show = (state === 'connecting' || state === 'negotiating') && !everReady;
  if (show && !sheet.open) sheet.showModal();
  if (!show && sheet.open) sheet.close();
  if (!show) return;
  const ble = openLink.transport === 'ble' && mode.value !== 'demo';
  text(
    'connecting-title',
    state === 'negotiating' ? 'Starting session' : ble ? 'Securing the link' : 'Connecting',
  );
  text(
    'connecting-text',
    state === 'negotiating'
      ? 'Stay close to your device.'
      : ble
        ? 'If your browser asks for a passkey, type the 6 digits shown on the device screen. A paired device skips this.'
        : 'Opening the port. This can restart the board.',
  );
}

export function renderConnection(model: ConfigModel, active: boolean, cleanupError?: string) {
  const { connection } = model.adapter;
  const { sync, capabilities } = connection;
  const ready = sync.state === 'ready';
  const writable = ready && !connection.writeBlockReason;

  if (wanted && ready) {
    if (!everReady) {
      everReady = true;
      browsing = false;
    }
    reconnectAttempt = 0;
    rememberCurrent();
  }
  // Whatever closed the link, the session decides here whether to keep trying.
  if (wanted && !busy && !active) {
    if (everReady) scheduleReconnect();
    else wanted = undefined;
  }
  const state = linkState();
  app.dataset.session = inSession() ? 'in' : 'out';
  element('rail-status').dataset.tone =
    state === 'ready' ? 'good' : state === 'lost' ? 'bad' : state === 'idle' ? 'muted' : 'warn';
  element('link-banner').hidden = !wanted || !everReady || state === 'ready';
  text('link-banner-text', state === 'lost' ? 'Link lost. Reconnecting' : 'Reconnecting');
  renderConnectingSheet(state);
  renderConnectScreen();
  renderDevices();

  // General settings.
  setNotice(
    'write-reason',
    ready
      ? (connection.writeBlockReason ?? undefined)
      : 'Connect and synchronize to edit settings.',
    'warn',
  );
  const gaps: string[] = [];
  if (ready) {
    if (connection.messageBlockReason) gaps.push('messaging');
    if (connection.radioBlockReason) gaps.push('radio');
    if (!connection.supportsDiscovery) gaps.push('discovery');
    if (!connection.supportsPosition) gaps.push('position');
  }
  setNotice(
    'capability-note',
    gaps.length ? `This firmware does not expose: ${gaps.join(', ')}.` : undefined,
    'warn',
  );
  if (document.activeElement !== label && label.value !== model.draft.label)
    label.value = model.draft.label;
  region.value = model.draft.region;
  label.disabled = !writable || model.pending;
  region.disabled = !writable || model.pending;
  for (const option of region.options) {
    const mask = { UNSET: 1, US: 2, EU: 4 }[option.value];
    option.disabled = !mask || !((capabilities?.regions ?? 0) & mask);
  }
  const bytes = new TextEncoder().encode(model.draft.label).length;
  const max = capabilities?.maxLabelBytes ?? 64;
  text('byte-count', `Shown to other nodes. ${bytes} of ${max} bytes.`);
  save.disabled = !writable || !model.dirty || model.stale || model.pending || bytes > max;
  reset.disabled = !ready || model.pending || !model.dirty;
  element<HTMLButtonElement>('export-settings').disabled = !ready;
  element('draft-warning').hidden = !ready || !model.dirty || !model.stale;
  element('region-warning').hidden =
    !ready ||
    model.draft.region === 'US' ||
    !sync.config?.radio ||
    sync.config.radio.mode === 'off';

  // A cleanup problem matters only while it holds the port; a lost link is shown by the banner.
  const message = (active ? cleanupError : '') || currentError();
  text('error', message);
  element('toast').hidden = !message;
  text(
    'recovery-status',
    recovery.connection.recoveryError ??
      'Device history is saved in this browser before commands are sent.',
  );
  element<HTMLButtonElement>('recovery-reset').disabled = busy || models.usb.adapter.active;
  element('simulation').hidden = mode.value !== 'demo';
  element<HTMLButtonElement>('reboot').disabled = busy;
  element<HTMLButtonElement>('sim-drop').disabled = !active;
  readOnly.disabled = active || busy;
}

export function initConnection() {
  setConnectAction(() => {
    browsing = false;
    render();
  });
  element('connect-usb').addEventListener('click', () => void connectUsb());
  element('connect-ble').addEventListener('click', () => void connectBluetooth());
  element('connect-sim').addEventListener(
    'click',
    () => void attemptConnect({ kind: 'demo' }, false),
  );
  element('connect-browse').addEventListener('click', () => {
    browsing = true;
    connectProblem = '';
    render();
    fieldMap.invalidate();
  });
  element('connecting-cancel').addEventListener('click', () => void endSession());
  sheet.addEventListener('cancel', event => {
    event.preventDefault();
    void endSession();
  });
  element('link-banner-disconnect').addEventListener('click', () => void endSession());
  element('toast-close').addEventListener('click', () => {
    clearError();
    render();
  });
  serial?.addEventListener('connect', () => {
    // Plugged back in: no need to wait out the backoff.
    if (wanted?.kind === 'usb' && everReady && !current().adapter.active) void reconnect();
  });
  onLocalAppStop(() => {
    ++attempt;
    clearTimeout(reconnectTimer);
    wanted = undefined;
  });
  const edit = () => {
    current().edit({ ...current().draft, label: label.value, region: region.value });
    render();
  };
  label.addEventListener('input', edit);
  region.addEventListener('change', edit);
  element('configuration').addEventListener('submit', event => {
    event.preventDefault();
    try {
      clearError();
      const model = current();
      if (mode.value === 'demo') demo.nextFault = fault.value as FieldDevice['nextFault'];
      const base = {
        ...writableConfig(model.adapter.connection),
        label: model.draft.label,
        region: model.draft.region,
      };
      // Radio is only allowed in the US profile, so the radio turns off with any other region.
      model.edit(
        base.region !== 'US' && base.radio
          ? { ...base, radio: { ...base.radio, mode: 'off' } }
          : base,
      );
      model.save();
      fault.value = 'none';
      render();
    } catch (e) {
      showError(e);
    }
  });
  reset.addEventListener('click', () => {
    try {
      current().reset();
      clearError();
      render();
    } catch (e) {
      showError(e);
    }
  });
  element('reboot').addEventListener('click', () => {
    demo.reboot();
    render();
  });
  element('sim-drop').addEventListener('click', () => {
    demo.drop();
    render();
  });
}
