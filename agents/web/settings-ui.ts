// Device settings pages: radio, position (including following this browser), discovery, screen,
// Bluetooth pairing and storage.
import { degrees, coordinate } from '../../packages/protocol/position-config.ts';
import { validRadio, type RadioConfig } from '../../packages/protocol/radio-config.ts';
import { SerialAdapter } from '../../packages/agent-core/serial.ts';
import { chooseBleDevice, pairBleDevice } from '../../packages/agent-core/ble.ts';
import { ConfigModel } from './model.ts';
import {
  bluetooth,
  bluetoothHelp,
  bluetoothProblem,
  clearError,
  current,
  mode,
  models,
  openLink,
  preferences,
  recovery,
  render,
  setPreference,
  showError,
  writableConfig,
} from './app-state.ts';
import { element, text } from './dom.ts';
import { invalidateThread } from './messages-ui.ts';
import { formatAgo } from './geo.ts';
import { isShowing, onPageChange } from './nav.ts';
import { confirmSheet, downloadBlob, setNotice } from './ui.ts';
import {
  MAX_ACCURACY_METERS,
  POSITION_SENT_KEY,
  shouldSendPosition,
  type Fix,
} from './position-feed.ts';
import { onLocalAppStop } from './access-ui.ts';

let positionDirty = false,
  positionBase = '';
let discoveryDirty = false,
  discoveryBase = '';
let screenDirty = false,
  screenBase = '';
let radioDirty = false;
let radioBase = '';

/** Keeps a value the device has that this portal doesn't offer selectable, not silently replaced. */
function keepCustomOption(select: HTMLSelectElement, value: string, label: string) {
  select.querySelector('option[data-custom]')?.remove();
  if (![...select.options].some(option => option.value === value)) {
    const option = new Option(label, value);
    option.dataset.custom = '';
    select.add(option);
  }
  select.value = value;
}

export function renderRadio() {
  const model = current();
  const { connection } = model.adapter;
  const { sync } = connection;
  const context = `${mode.value}:${connection.device}:${sync.boot}:${sync.revision}`;
  const controls: (HTMLInputElement | HTMLSelectElement)[] = [
    element('radio-mode'),
    element('radio-power'),
    element('radio-boost'),
    element('radio-relay'),
  ];
  const ready = sync.state === 'ready';
  const supported = ready && !connection.radioBlockReason && !!sync.config?.radio;
  if (!radioDirty && supported) {
    const radio = sync.config!.radio!;
    radioBase = context;
    element<HTMLSelectElement>('radio-mode').value = radio.mode;
    element<HTMLSelectElement>('radio-power').value = radio.level;
    element<HTMLInputElement>('radio-boost').checked = radio.boost;
    element<HTMLInputElement>('radio-relay').checked = radio.relay;
    text('radio-preset', radio.preset);
  }
  element('radio-boost-row').hidden = !connection.supportsTxBoost;
  const stale = radioDirty && radioBase !== context;
  setNotice(
    'radio-support',
    !ready
      ? 'Connect a device to configure its radio.'
      : (connection.radioBlockReason ??
          (stale
            ? "The device's settings changed while you were editing. Discard to load the latest."
            : sync.config?.region !== 'US'
              ? 'The radio can only run with the region set to US. Change it in General.'
              : undefined)),
    'warn',
  );
  for (const control of controls) control.disabled = !supported || model.pending;
  element<HTMLSelectElement>('radio-mode').disabled =
    !supported || model.pending || sync.config?.region !== 'US';
  element<HTMLButtonElement>('radio-save').disabled =
    !supported || !radioDirty || stale || model.pending || model.history.length >= 32;
  element<HTMLButtonElement>('radio-reset').disabled = !supported || model.pending || !radioDirty;
}

// ---- Position, including following this browser's location ----

let fix: Fix | undefined;
let watchId: number | undefined;
let lastSentAt = 0;
let lastPosition = '';
try {
  lastSentAt = Number(localStorage.getItem(POSITION_SENT_KEY)) || 0;
} catch {
  // Starts from zero: the worst case is one early update.
}
function recordPositionChange() {
  lastSentAt = Date.now();
  try {
    localStorage.setItem(POSITION_SENT_KEY, String(lastSentAt));
  } catch {
    // Only matters across a reload.
  }
}
function stopWatching() {
  if (watchId !== undefined) navigator.geolocation.clearWatch(watchId);
  watchId = undefined;
  fix = undefined;
}

function browserFix() {
  return new Promise<GeolocationPosition>((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('This browser has no location access.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, error => reject(new Error(error.message)), {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 10000,
    });
  });
}

/** Writes the browser's location to the device when the rules allow it. */
function publishPosition() {
  const model = current();
  const { connection } = model.adapter;
  const { sync } = connection;
  const following = preferences.positionMode === 'browser';
  const ready = sync.state === 'ready';
  if (following && ready && watchId === undefined && navigator.geolocation)
    watchId = navigator.geolocation.watchPosition(
      position => {
        // A fix worse than this could put the device somewhere it isn't.
        if (position.coords.accuracy > MAX_ACCURACY_METERS) return;
        fix = {
          lngLat: [position.coords.longitude, position.coords.latitude],
          at: Date.now(),
        };
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 10000 },
    );
  if ((!following || !ready) && watchId !== undefined) stopWatching();

  // Any position change restarts the device's beacon timer, whoever made it.
  const saved = sync.config?.position;
  const signature = saved
    ? `${saved.source}:${saved.share}:${saved.latitude}:${saved.longitude}`
    : '';
  if (ready && signature !== lastPosition) {
    if (lastPosition) recordPositionChange();
    lastPosition = signature;
  }

  if (
    !following ||
    !ready ||
    positionDirty ||
    connection.writeBlockReason ||
    !connection.supportsPosition ||
    model.pending ||
    // The re-sync after a save would interrupt an upload, and a change cancels discovery.
    connection.messaging.history.some(m => m.state === 'receiving') ||
    connection.discovery.last?.state === 'collecting'
  )
    return;
  if (
    !shouldSendPosition({
      fix,
      now: Date.now(),
      lastSentAt,
      saved,
      intervalSeconds: sync.config?.discovery?.interval,
    })
  )
    return;
  const [longitude, latitude] = fix!.lngLat;
  try {
    model.adapter.configure({
      ...writableConfig(connection),
      position: {
        share: true,
        source: 1,
        latitude: Math.round((latitude + 90) * 1e7),
        longitude: Math.round((longitude + 180) * 1e7),
      },
    });
    recordPositionChange();
  } catch {
    // Tries again on a later pass.
  }
}

export function renderPosition() {
  publishPosition();
  const model = current(),
    connection = model.adapter.connection,
    { sync } = connection;
  const ready = connection.supportsPosition && sync.state === 'ready';
  const writable = ready && !connection.writeBlockReason && !!sync.config?.position;
  const context = `${mode.value}:${connection.device}:${sync.boot}:${sync.revision}`;
  const position = sync.config?.position;
  const select = element<HTMLSelectElement>('position-mode');
  if (!positionDirty && position) {
    select.value =
      preferences.positionMode === 'browser' ? 'browser' : position.source === 1 ? 'fixed' : 'off';
    element<HTMLInputElement>('position-share').checked = position.share;
    element<HTMLInputElement>('position-latitude').value = degrees(position.latitude, 90);
    element<HTMLInputElement>('position-longitude').value = degrees(position.longitude, 180);
    positionBase = context;
  }
  const chosen = select.value;
  const stale = positionDirty && positionBase !== context;
  setNotice(
    'position-support',
    !connection.supportsPosition
      ? "This firmware doesn't support saved positions."
      : stale
        ? "The device's settings changed while you were editing. Discard to load the latest."
        : (connection.writeBlockReason ?? undefined),
    'warn',
  );
  element('position-browser').hidden = chosen !== 'browser';
  element('fixed-position-fields').hidden = chosen !== 'fixed';
  element('position-warning').hidden = chosen === 'off';
  text(
    'position-last-sent',
    preferences.positionMode === 'browser' && lastSentAt
      ? `Last sent to the device ${formatAgo(lastSentAt)}.`
      : '',
  );
  const discovery = sync.config?.discovery;
  element('position-beacon-off').hidden = !discovery || discovery.beacon;
  text(
    'position-beacon-slow',
    discovery?.beacon && discovery.interval > 60
      ? `Announcing every ${Math.round(discovery.interval / 60)} min. Set Discovery to 1 min for the closest tracking.`
      : '',
  );
  for (const id of [
    'position-mode',
    'position-share',
    'position-latitude',
    'position-longitude',
    'position-fill',
  ])
    element<HTMLInputElement>(id).disabled = !writable || model.pending;
  element<HTMLButtonElement>('position-save').disabled =
    !writable || !positionDirty || stale || model.pending;
  element<HTMLButtonElement>('position-reset').disabled = !ready || !positionDirty;
}

export function renderScreen() {
  const model = current(),
    connection = model.adapter.connection,
    { sync } = connection;
  const ready = connection.supportsScreen && sync.state === 'ready';
  const screen = sync.config?.screen;
  const writable = ready && !connection.writeBlockReason && !!screen;
  const context = `${mode.value}:${connection.device}:${sync.boot}:${sync.revision}`;
  const select = element<HTMLSelectElement>('screen-timeout');
  if (!screenDirty && screen) {
    keepCustomOption(select, String(screen.timeout), `${screen.timeout} s`);
    element<HTMLInputElement>('screen-wake').checked = screen.wake;
    element<HTMLInputElement>('screen-led').checked = sync.config?.led ?? true;
    screenBase = context;
  }
  element('screen-led-row').hidden = !connection.supportsLed;
  const stale = screenDirty && screenBase !== context;
  setNotice(
    'screen-support',
    !connection.supportsScreen
      ? "This firmware doesn't support screen settings."
      : stale
        ? "The device's settings changed while you were editing. Discard to load the latest."
        : (connection.writeBlockReason ?? undefined),
    'warn',
  );
  for (const id of ['screen-timeout', 'screen-wake', 'screen-led'])
    element<HTMLInputElement>(id).disabled = !writable || model.pending;
  element<HTMLButtonElement>('screen-save').disabled =
    !writable || !screenDirty || stale || model.pending;
  element<HTMLButtonElement>('screen-reset').disabled = !ready || !screenDirty;
}

const PAIRING_MESSAGES: Record<string, string> = {
  open: 'Pairing is open.',
  passkey: 'Enter this passkey on the phone or computer you are pairing:',
  full: 'Four devices are already paired. Hold the device button for 15 seconds to forget them.',
  paired: 'Paired.',
  failed: 'Pairing failed. Start pairing to try again.',
  forgotten: 'All paired devices were forgotten.',
  unavailable: 'Bluetooth is not available on this device right now.',
  refused: 'The device refused. Pairing can only be started over USB.',
};
export function renderBluetooth() {
  const connection = current().adapter.connection,
    ready = connection.sync.state === 'ready';
  const usb = mode.value === 'demo' || openLink.transport === 'usb';
  const can = ready && usb && connection.supportsPairing;
  // Stops polling, and forgets any passkey in memory, when the page is closed.
  if (ready) connection.watchPairing(can && isShowing('bluetooth'));
  const pairing = can ? connection.pairing : undefined;
  setNotice(
    'pairing-support',
    !ready
      ? 'Connect over USB to start pairing here.'
      : !usb
        ? 'Connected over Bluetooth. Pairing another device needs USB or the device button.'
        : !connection.supportsPairing
          ? "Update this device's firmware to start pairing here."
          : undefined,
    'warn',
  );
  const message = pairing ? PAIRING_MESSAGES[pairing.state] : undefined;
  element('pairing-state').hidden = !message;
  text('pairing-message', message ?? '');
  const passkey = element('pairing-passkey');
  passkey.hidden = pairing?.passkey === undefined;
  passkey.textContent =
    pairing?.passkey === undefined ? '' : String(pairing.passkey).padStart(6, '0');
  text(
    'pairing-detail',
    pairing?.name
      ? `Device name: ${pairing.name} · closes in ${pairing.seconds} s · ${pairing.bonds} of 4 paired`
      : pairing
        ? `${pairing.bonds} of 4 paired`
        : '',
  );
  const open = pairing?.state === 'open' || pairing?.state === 'passkey';
  element<HTMLButtonElement>('pairing-start').disabled = !can || open;
  element<HTMLButtonElement>('pairing-browser').disabled = !bluetooth || !open || pairingBrowser;
  if (!bluetooth) text('pairing-browser-status', bluetoothHelp);
}
let pairingBrowser = false;
async function pairThisBrowser() {
  pairingBrowser = true;
  text('pairing-browser-status', 'Choose the device, then type the passkey when asked.');
  render();
  try {
    await pairBleDevice(await chooseBleDevice(bluetooth!));
    text(
      'pairing-browser-status',
      'This browser is paired. Disconnect USB, then connect over Bluetooth.',
    );
  } catch (error) {
    text('pairing-browser-status', `Not paired: ${bluetoothProblem(error)}`);
  } finally {
    pairingBrowser = false;
    render();
  }
}

export function renderDiscovery() {
  const model = current(),
    connection = model.adapter.connection,
    { sync } = connection;
  const supported = connection.supportsDiscovery;
  const ready = supported && sync.state === 'ready',
    writable = ready && !connection.writeBlockReason && !!sync.config?.discovery;
  const context = `${mode.value}:${connection.device}:${sync.boot}:${sync.revision}`;
  const settings = sync.config?.discovery;
  if (!discoveryDirty && settings) {
    element<HTMLInputElement>('beacon-enabled').checked = settings.beacon;
    element<HTMLInputElement>('respond-enabled').checked = settings.respond;
    keepCustomOption(
      element<HTMLSelectElement>('beacon-interval'),
      String(settings.interval),
      `${settings.interval} s`,
    );
    discoveryBase = context;
  }
  const stale = discoveryDirty && discoveryBase !== context;
  setNotice(
    'discovery-panel-support',
    !supported
      ? "This firmware doesn't support discovery."
      : stale
        ? "The device's settings changed while you were editing. Discard to load the latest."
        : (connection.writeBlockReason ?? undefined),
    'warn',
  );
  element<HTMLButtonElement>('discovery-save').disabled =
    !writable || !discoveryDirty || stale || model.pending;
  element<HTMLButtonElement>('discovery-reset').disabled = !ready || !discoveryDirty;
  for (const id of ['beacon-enabled', 'respond-enabled', 'beacon-interval'])
    element<HTMLInputElement>(id).disabled = !writable || model.pending;
}

export function initSettings() {
  onLocalAppStop(() => {
    if (watchId !== undefined) navigator.geolocation.clearWatch(watchId);
    watchId = undefined;
  });
  onPageChange(left => {
    // A page's unsaved edits don't follow you away from it.
    if (left === 'radio') radioDirty = false;
    if (left === 'position') {
      positionDirty = false;
      setNotice('position-error', undefined);
    }
    if (left === 'discovery') discoveryDirty = false;
    if (left === 'screen') screenDirty = false;
  });
  element('radio-form').addEventListener('input', () => {
    radioDirty = true;
    render();
  });
  element('radio-reset').addEventListener('click', () => {
    radioDirty = false;
    render();
  });
  element('radio-form').addEventListener('submit', event => {
    event.preventDefault();
    try {
      const model = current();
      const currentConfig = model.adapter.connection.sync.config!;
      const radio: RadioConfig = {
        mode: element<HTMLSelectElement>('radio-mode').value as RadioConfig['mode'],
        level: element<HTMLSelectElement>('radio-power').value as RadioConfig['level'],
        boost:
          model.adapter.connection.supportsTxBoost &&
          element<HTMLInputElement>('radio-boost').checked,
        relay: element<HTMLInputElement>('radio-relay').checked,
        // Channels are edited on their own page; keep the device's current table here.
        channels: currentConfig.radio!.channels,
        channelIds: currentConfig.radio!.channelIds,
        preset: 'US915_LAB1',
      };
      if (!validRadio(radio, currentConfig.region))
        throw new Error('Use the US region to turn the radio on.');
      model.adapter.configure({ ...writableConfig(model.adapter.connection), radio });
      radioDirty = false;
      clearError();
      render();
    } catch (e) {
      showError(e);
    }
  });
  element('recovery-retry').addEventListener('click', () => {
    recovery.retry();
    render();
  });
  element('recovery-export').addEventListener('click', () => {
    downloadBlob(
      'reaper-mesh-recovery.json',
      new Blob([recovery.exportText()], { type: 'application/json' }),
    );
  });
  element('recovery-reset').addEventListener('click', async () => {
    const yes = await confirmSheet({
      title: 'Reset device history?',
      body: 'This discards saved history and allocates a new agent identity. Unknown device work is not cancelled. Export your history first if you need it. Device owner slots are limited.',
      confirm: 'Reset',
      danger: true,
    });
    if (!yes) return;
    try {
      recovery.reset();
      models.usb = new ConfigModel(new SerialAdapter(recovery.connection));
      invalidateThread();
      clearError();
      render();
    } catch (error) {
      showError(error);
    }
  });

  element('export-settings').addEventListener('click', () => {
    const { connection } = current().adapter;
    if (connection.sync.state !== 'ready') return;
    const snapshot = {
      format: 'reaper-mesh-settings-1',
      device: connection.device,
      boot: connection.sync.boot,
      revision: connection.sync.revision,
      config: connection.sync.config,
    };
    downloadBlob(
      'reaper-mesh-settings.json',
      new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' }),
    );
  });

  const positionSelect = element<HTMLSelectElement>('position-mode');
  const fillFromBrowser = async () => {
    setNotice('position-error', undefined);
    try {
      const position = await browserFix();
      element<HTMLInputElement>('position-latitude').value = position.coords.latitude.toFixed(7);
      element<HTMLInputElement>('position-longitude').value = position.coords.longitude.toFixed(7);
      positionDirty = true;
      render();
      return true;
    } catch (error) {
      setNotice('position-error', error instanceof Error ? error.message : String(error), 'bad');
      return false;
    }
  };
  element('position-form').addEventListener('input', () => {
    positionDirty = true;
    render();
  });
  positionSelect.addEventListener('change', async () => {
    setNotice('position-error', undefined);
    if (positionSelect.value === 'browser' && !(await fillFromBrowser())) {
      positionDirty = false;
      render();
    }
  });
  element('position-fill').addEventListener('click', () => void fillFromBrowser());
  element('position-reset').addEventListener('click', () => {
    positionDirty = false;
    setNotice('position-error', undefined);
    render();
  });
  element('position-form').addEventListener('submit', event => {
    event.preventDefault();
    try {
      const { connection } = current().adapter;
      const chosen = positionSelect.value;
      const saved = connection.sync.config!.position!;
      const latitude = element<HTMLInputElement>('position-latitude').value;
      const longitude = element<HTMLInputElement>('position-longitude').value;
      const position =
        chosen === 'off'
          ? { ...saved, source: 0 as const, share: false }
          : {
              source: 1 as const,
              share: chosen === 'browser' || element<HTMLInputElement>('position-share').checked,
              latitude: coordinate(latitude, 90),
              longitude: coordinate(longitude, 180),
            };
      current().adapter.configure({ ...writableConfig(connection), position });
      setPreference('positionMode', chosen === 'browser' ? 'browser' : 'fixed');
      positionDirty = false;
      clearError();
      setNotice('position-error', undefined);
      render();
    } catch (error) {
      setNotice('position-error', error instanceof Error ? error.message : String(error), 'bad');
    }
  });

  element('pairing-start').addEventListener('click', () => {
    try {
      clearError();
      current().adapter.openPairing();
    } catch (error) {
      showError(error);
    }
    render();
  });
  element('pairing-browser').addEventListener('click', () => void pairThisBrowser());
  element('screen-form').addEventListener('input', () => {
    screenDirty = true;
    render();
  });
  element('screen-reset').addEventListener('click', () => {
    screenDirty = false;
    render();
  });
  element('screen-form').addEventListener('submit', event => {
    event.preventDefault();
    try {
      const { connection } = current().adapter;
      current().adapter.configure({
        ...writableConfig(connection),
        screen: {
          timeout: Number(element<HTMLSelectElement>('screen-timeout').value),
          wake: element<HTMLInputElement>('screen-wake').checked,
        },
        ...(connection.supportsLed ? { led: element<HTMLInputElement>('screen-led').checked } : {}),
      });
      screenDirty = false;
      clearError();
      render();
    } catch (error) {
      showError(error);
    }
  });
  element('discovery-form').addEventListener('input', () => {
    discoveryDirty = true;
    render();
  });
  element('discovery-reset').addEventListener('click', () => {
    discoveryDirty = false;
    render();
  });
  element('discovery-form').addEventListener('submit', event => {
    event.preventDefault();
    try {
      const { connection } = current().adapter;
      current().adapter.configure({
        ...writableConfig(connection),
        discovery: {
          beacon: element<HTMLInputElement>('beacon-enabled').checked,
          respond: element<HTMLInputElement>('respond-enabled').checked,
          interval: Number(element<HTMLSelectElement>('beacon-interval').value),
        },
      });
      discoveryDirty = false;
      clearError();
      render();
    } catch (error) {
      showError(error);
    }
  });
}
