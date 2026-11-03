// Device connection controls, the simulator, and device status in Settings.
import { SimulatedDevice } from '../../packages/simulator/serial-device.ts';
import type { SerialPortLike } from '../../packages/agent-core/serial.ts';
import type { ConfigModel } from './model.ts';
import {
  clearError,
  current,
  currentError,
  demo,
  mode,
  models,
  recovery,
  render,
  showError,
} from './app-state.ts';
import { element, text } from './dom.ts';
import { messagesModeChanged } from './messages-ui.ts';
import { fieldMap, setPanelOpen, setSelectedNode, setView } from './map-ui.ts';
import { invalidateHistory } from './settings-ui.ts';

const label = element<HTMLInputElement>('label');
const region = element<HTMLSelectElement>('region');
const fault = element<HTMLSelectElement>('fault');
const readOnly = element<HTMLInputElement>('read-only');
export const connect = element<HTMLButtonElement>('connect');
const disconnect = element<HTMLButtonElement>('disconnect');
const save = element<HTMLButtonElement>('save');
const reset = element<HTMLButtonElement>('reset');
const serial = (navigator as Navigator & { serial?: { requestPort(): Promise<SerialPortLike> } })
  .serial;
let busy = false;
let attempt = 0;

export function renderConnection(model: ConfigModel, active: boolean, cleanupError?: string) {
  const { connection } = model.adapter;
  const { sync, capabilities } = connection;
  const ready = sync.state === 'ready';
  const writable = ready && !connection.writeBlockReason;
  mode.disabled = busy || active;
  connect.disabled = busy || active || (mode.value === 'usb' && (!serial || !isSecureContext));
  connect.textContent = busy
    ? 'Connecting…'
    : mode.value === 'demo'
      ? 'Connect simulator'
      : 'Connect USB';
  disconnect.disabled = !busy && !active;
  text(
    'support',
    mode.value === 'demo'
      ? 'An in-memory device. No USB access or radio traffic.'
      : !isSecureContext
        ? 'USB requires HTTPS or localhost.'
        : !serial
          ? 'Use a desktop browser with Web Serial support.'
          : 'Choose Heltec (usbserial-0001) or T-Beam (wchusbserial…) in the browser port chooser. One device at a time.',
  );
  text(
    'status',
    busy ? 'Opening' : sync.state === 'ready' ? (writable ? 'Connected' : 'Read-only') : sync.state,
  );
  element('status').dataset.state = sync.state;
  element('rail-status').dataset.state = busy ? 'opening' : sync.state;
  text('source-caption', connection.device ? connection.device : 'No device');
  text('revision', ready ? `REV ${sync.revision}` : 'REV —');
  text(
    'write-reason',
    ready
      ? (connection.writeBlockReason ?? 'Settings are synchronized with the device.')
      : 'Connect and synchronize to edit settings.',
  );
  const note = element('capability-note');
  if (!ready) {
    note.hidden = true;
    text('capability-note', '');
  } else {
    const gaps: string[] = [];
    if (connection.messageBlockReason) gaps.push('messaging');
    if (connection.radioBlockReason) gaps.push('radio');
    if (!connection.supportsDiscovery) gaps.push('discovery');
    if (!connection.supportsPosition) gaps.push('position');
    note.hidden = gaps.length === 0;
    text(
      'capability-note',
      gaps.length
        ? mode.value === 'demo'
          ? `Simulator identity only — ${gaps.join(', ')} need a USB firmware device.`
          : `This firmware does not expose: ${gaps.join(', ')}.`
        : '',
    );
  }
  if (document.activeElement !== label && label.value !== model.draft.label)
    label.value = model.draft.label;
  if (document.activeElement !== region) region.value = model.draft.region;
  label.disabled = !writable || model.pending;
  region.disabled = !writable || model.pending;
  for (const option of region.options) {
    const mask = { UNSET: 1, US: 2, EU: 4 }[option.value];
    option.disabled = !mask || !((capabilities?.regions ?? 0) & mask);
  }
  const bytes = new TextEncoder().encode(model.draft.label).length;
  const max = capabilities?.maxLabelBytes ?? 64;
  text('byte-count', `${bytes} / ${capabilities ? max : '—'} bytes`);
  save.disabled =
    !writable ||
    !model.dirty ||
    model.stale ||
    model.pending ||
    bytes > max ||
    model.history.length >= 32;
  reset.disabled = !ready || model.pending;
  element<HTMLButtonElement>('export-settings').disabled = !ready;
  element('draft-warning').hidden = !ready || !model.dirty || !model.stale;
  text('device', connection.device ?? '—');
  text('firmware', capabilities?.firmware ?? '—');
  text('schema', capabilities?.configSchema ?? '—');
  text(
    'capacity',
    capabilities
      ? `${capabilities.receiptCapacity} receipts / ${capabilities.ownerCapacity} owners`
      : '—',
  );
  text(
    'admission',
    capabilities
      ? capabilities.ownerAdmitted === 1
        ? 'Admitted'
        : 'Not admitted · read-only'
      : '—',
  );
  text(
    'radio-hardware',
    connection.radioInfo
      ? `${connection.radioInfo.probe === 1 ? 'Probe OK' : 'Probe failed'} · ${connection.radioInfo.state} · ${connection.radioInfo.reason}`
      : (connection.radioError ?? 'Waiting for diagnostics'),
  );
  text(
    'radio-packets',
    connection.radioInfo
      ? `RX ${connection.radioInfo.received} / TX ${connection.radioInfo.transmitted}`
      : '—',
  );
  text(
    'resource-status',
    connection.radioInfo
      ? `${connection.radioInfo.heapFree} bytes free heap · ${connection.radioInfo.stackFree} bytes minimum free main stack`
      : (connection.radioError ?? 'Connect to read diagnostics.'),
  );
  text(
    'radio',
    capabilities
      ? capabilities.radioVersion === 0
        ? 'Not implemented'
        : capabilities.radioVersion
      : '—',
  );
  const message = cleanupError || currentError() || connection.error || '';
  text('error', message);
  element('error').hidden = !message;
  text(
    'recovery-status',
    recovery.connection.recoveryError ??
      'USB history is saved in this browser before commands are sent.',
  );
  element<HTMLButtonElement>('recovery-reset').disabled = busy || models.usb.adapter.active;
  element('simulation').hidden = mode.value !== 'demo';
  element<HTMLButtonElement>('reboot').disabled = busy;
  readOnly.disabled = active || busy;
}

export function initConnection() {
  connect.addEventListener('click', async () => {
    const token = ++attempt;
    const model = current();
    busy = true;
    clearError();
    render();
    try {
      const port = mode.value === 'demo' ? demo.createPort() : await serial!.requestPort();
      if (token !== attempt) return;
      demo.readOnly = readOnly.checked;
      await model.adapter.connect(port, crypto.randomUUID());
    } catch (e) {
      if (token === attempt) showError(e);
    } finally {
      if (token === attempt) {
        busy = false;
        if (model.adapter.connection.sync.state === 'ready') {
          setView('messages');
          setPanelOpen(true);
        }
        render();
        fieldMap.invalidate();
      }
    }
  });
  disconnect.addEventListener('click', async () => {
    ++attempt;
    busy = false;
    clearError();
    const model = current();
    try {
      await model.adapter.disconnect();
    } catch (e) {
      showError(e);
    }
    setSelectedNode('');
    render();
  });
  mode.addEventListener('change', () => {
    messagesModeChanged();
    clearError();
    invalidateHistory();
    setSelectedNode('');
    render();
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
      if (mode.value === 'demo') demo.nextFault = fault.value as SimulatedDevice['nextFault'];
      current().save();
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
}
