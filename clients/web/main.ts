import './style.css';
import { ConfigModel } from './model.ts';
import { SimulatedDevice } from '../../packages/simulator/serial-device.ts';
import type { SerialPortLike } from '../../packages/client-core/serial.ts';

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const text = (id: string, value: string | number) => { element(id).textContent = String(value); };
const mode = element<HTMLSelectElement>('mode');
const label = element<HTMLInputElement>('label');
const region = element<HTMLSelectElement>('region');
const fault = element<HTMLSelectElement>('fault');
const readOnly = element<HTMLInputElement>('read-only');
const connect = element<HTMLButtonElement>('connect');
const disconnect = element<HTMLButtonElement>('disconnect');
const save = element<HTMLButtonElement>('save');
const reset = element<HTMLButtonElement>('reset');
const demo = new SimulatedDevice();
const models = { demo: new ConfigModel(), usb: new ConfigModel() };
const serial = (navigator as Navigator & { serial?: { requestPort(): Promise<SerialPortLike> } }).serial;
let busy = false;
let attempt = 0;
let error = '';
let historySignature = '';
const current = () => models[mode.value as keyof typeof models];
const showError = (value: unknown) => { error = value instanceof Error ? value.message : String(value); render(); };

function render() {
  const model = current();
  model.refresh();
  const { connection, active, cleanupError } = model.adapter;
  const { sync, capabilities } = connection;
  const ready = sync.state === 'ready';
  const writable = ready && !connection.writeBlockReason;
  mode.disabled = busy || active;
  connect.disabled = busy || active || (mode.value === 'usb' && (!serial || !isSecureContext));
  connect.textContent = busy ? 'Opening connection…' : mode.value === 'demo' ? 'Connect simulator' : 'Choose USB device';
  disconnect.disabled = !busy && !active;
  text('support', mode.value === 'demo' ? 'An in-memory device. No USB access or radio traffic.' :
    !isSecureContext ? 'USB requires HTTPS or localhost.' : !serial ? 'Use a desktop browser with Web Serial support.' :
    'Choose a USB serial port. Reaper Mesh firmware is required; installation is not available yet.');
  text('status', busy ? 'Opening' : sync.state === 'ready' ? (writable ? 'Connected · synchronized' : 'Connected · read-only') : sync.state);
  element('status').dataset.state = sync.state;
  text('source-caption', connection.device ? `${mode.value === 'demo' ? 'SIMULATION / ' : ''}${connection.device}` : 'No device connected');
  text('revision', ready ? `REV ${sync.revision}` : 'REV —');
  text('write-reason', ready ? connection.writeBlockReason ?? 'Settings are synchronized with the device.' : 'Connect and synchronize to edit settings.');
  if (document.activeElement !== label && label.value !== model.draft.label) label.value = model.draft.label;
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
  save.disabled = !writable || !model.dirty || model.stale || model.pending || bytes > max || model.history.length >= 32;
  reset.disabled = !ready || model.pending;
  element('draft-warning').hidden = !ready || !model.dirty || !model.stale;
  text('device', connection.device ?? '—');
  text('firmware', capabilities?.firmware ?? '—');
  text('schema', capabilities?.configSchema ?? '—');
  text('capacity', capabilities ? `${capabilities.receiptCapacity} receipts / ${capabilities.ownerCapacity} owners` : '—');
  text('admission', capabilities ? capabilities.ownerAdmitted === 1 ? 'Admitted' : 'Not admitted · read-only' : '—');
  text('radio', capabilities ? capabilities.radioVersion === 0 ? 'Not implemented' : capabilities.radioVersion : '—');
  const message = cleanupError || error || connection.error || '';
  text('error', message);
  element('error').hidden = !message;
  element('simulation').hidden = mode.value !== 'demo';
  element<HTMLButtonElement>('reboot').disabled = busy;
  readOnly.disabled = active || busy;
  const signature = mode.value + ':' + sync.state + ':' + model.history.map(entry => entry.id + model.adapter.connection.commands.status(entry.id).outcome).join('|');
  if (signature !== historySignature) {
    historySignature = signature;
    renderHistory(model, ready);
  }
}

function renderHistory(model: ConfigModel, ready: boolean) {
  const list = element('history');
  list.replaceChildren();
  text('history-count', `${model.history.length} / 32`);
  element('history-empty').hidden = !!model.history.length;
  for (const entry of [...model.history].reverse()) {
    const { outcome } = model.adapter.connection.commands.status(entry.id);
    const row = document.createElement('li');
    const content = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = entry.label || '(empty label)';
    const id = document.createElement('span'); id.className = 'mono'; id.textContent = entry.id;
    const status = document.createElement('span'); status.className = 'outcome'; status.dataset.outcome = outcome;
    status.textContent = { pending: 'Awaiting device result', committed: 'Committed on device', conflict: 'Conflict · latest state loaded',
      rejected: 'Rejected by device', unknown: 'Unknown · may have applied' }[outcome];
    content.append(title, id, status);
    const actions = document.createElement('div'); actions.className = 'actions';
    if (outcome === 'unknown') {
      const query = document.createElement('button'); query.textContent = 'Query result'; query.disabled = !ready;
      query.addEventListener('click', () => {
        try {
          error = '';
          if (!model.adapter.recover(entry.id)) error = 'The device rebooted. Its old receipt is unavailable; the outcome stays unknown.';
          // The row itself shows the returned outcome; query success is not an error.
        } catch (e) { showError(e); }
        render();
      });
      actions.append(query);
    }
    const forget = document.createElement('button'); forget.textContent = outcome === 'unknown' ? 'Forget uncertain command' : 'Clear';
    forget.disabled = outcome === 'pending';
    forget.addEventListener('click', () => {
      if (outcome === 'unknown' && !confirm('Forget this uncertain command? This removes result recovery from this page. It does not undo or cancel the device change.')) return;
      try { model.forget(entry.id); error = ''; render(); } catch (e) { showError(e); }
    });
    actions.append(forget); row.append(content, actions); list.append(row);
  }
}

connect.addEventListener('click', async () => {
  const token = ++attempt;
  const model = current();
  busy = true; error = ''; render();
  try {
    const port = mode.value === 'demo' ? demo.createPort() : await serial!.requestPort();
    if (token !== attempt) return; // Ignore a chooser result after cancellation.
    demo.readOnly = readOnly.checked;
    await model.adapter.connect(port, crypto.randomUUID());
  } catch (e) { if (token === attempt) showError(e); }
  finally { if (token === attempt) { busy = false; render(); } }
});
disconnect.addEventListener('click', async () => {
  ++attempt; busy = false; error = '';
  const model = current();
  try { await model.adapter.disconnect(); } catch (e) { showError(e); }
  render();
});
mode.addEventListener('change', () => { error = ''; historySignature = ''; render(); });
const edit = () => { current().edit({ label: label.value, region: region.value }); render(); };
label.addEventListener('input', edit); region.addEventListener('change', edit);
element('configuration').addEventListener('submit', event => {
  event.preventDefault();
  try {
    error = '';
    if (mode.value === 'demo') demo.nextFault = fault.value as SimulatedDevice['nextFault'];
    current().save(); fault.value = 'none'; render();
  } catch (e) { showError(e); }
});
reset.addEventListener('click', () => { try { current().reset(); error = ''; render(); } catch (e) { showError(e); } });
element('reboot').addEventListener('click', () => { demo.reboot(); render(); });
const timer = setInterval(render, 100);
window.addEventListener('pagehide', () => { clearInterval(timer); void models.demo.adapter.disconnect(); void models.usb.adapter.disconnect(); });
render();
