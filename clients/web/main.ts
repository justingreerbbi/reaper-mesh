import './style.css';
import { DEFAULT_CHANNELS, validRadio, type RadioConfig } from '../../packages/protocol/radio-config.ts';
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
let messageSignature = '';
let inboxSignature = '';
let radioDirty = false;
let radioBase = '';
for (let slot = 1; slot < 8; slot++) {
  const wrapper = document.createElement('div'); const title = document.createElement('label');
  title.htmlFor = `channel-${slot}`; title.textContent = `Named channel ${slot}`;
  const input = document.createElement('input'); input.id = `channel-${slot}`; input.type = 'text'; input.maxLength = 8; input.autocomplete = 'off';
  wrapper.append(title, input); element('channel-settings').append(wrapper);
}
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
    'Choose the Heltec USB serial port. Reaper Mesh firmware must already be installed; browser installation is not implemented.');
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
  text('radio-hardware', connection.radioInfo ? `${connection.radioInfo.probe === 1 ? 'Probe OK' : 'Probe failed'} · ${connection.radioInfo.state} · ${connection.radioInfo.reason}` : connection.radioError ?? 'Waiting for diagnostics');
  text('radio-packets', connection.radioInfo ? `RX ${connection.radioInfo.received} / TX ${connection.radioInfo.transmitted}` : '—');
  text('resource-status', connection.radioInfo ? `${connection.radioInfo.heapFree} bytes free heap · ${connection.radioInfo.stackFree} bytes minimum free main stack` : connection.radioError ?? 'Connect to read diagnostics.');
  text('radio', capabilities ? capabilities.radioVersion === 0 ? 'Not implemented' : capabilities.radioVersion : '—');
  const message = cleanupError || error || connection.error || '';
  text('error', message);
  element('error').hidden = !message;
  renderRadio();
  renderMessages();
  renderInbox();
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

function renderMessages() {
  const { connection } = current().adapter;
  const body = element<HTMLTextAreaElement>('message-body');
  const destination = element<HTMLInputElement>('message-destination');
  const bytes = new TextEncoder().encode(body.value).length;
  const ready = connection.sync.state === 'ready';
  const blocked = connection.messageBlockReason;
  const history = connection.messaging.history;
  const uploading = history.some(entry => entry.state === 'receiving');
  text('message-bytes', `${bytes} / 1024 bytes`);
  text('message-support', !ready ? 'Connect and synchronize to queue messages.' : blocked ??
    (destination.value === connection.device ? 'Local delivery stays on this device and does not transmit by radio.' : connection.radioInfo?.reason === 'ready' ? 'Queued and transmitted do not prove destination acceptance. Broadcast has no recipient ACK.' : `Remote transmission is blocked: ${connection.radioInfo?.reason ?? 'waiting for radio status'}. Use this device for a local test.`));
  body.disabled = destination.disabled = !ready || !!blocked || uploading;
  const channel = element<HTMLSelectElement>('message-channel');
  channel.disabled = body.disabled;
  const names = (connection.sync.config?.radio?.channels ?? DEFAULT_CHANNELS).split('|');
  const channelSignature = JSON.stringify(names);
  if (channel.dataset.names !== channelSignature) {
    const selected = channel.value; channel.replaceChildren();
    names.forEach((name, slot) => { if (name) { const option = document.createElement('option'); option.value = String(slot); option.textContent = `${slot} · ${name}`; channel.append(option); } });
    if (Array.from(channel.options).some(option => option.value === selected)) channel.value = selected;
    channel.dataset.names = channelSignature;
  }
  const remoteBlocked = destination.value !== connection.device && connection.capabilities?.radioVersion === 1 && connection.radioInfo?.reason !== 'ready';
  element<HTMLButtonElement>('self-destination').disabled = !ready || !!blocked || uploading;
  element<HTMLButtonElement>('message-send').disabled = !ready || !!blocked || uploading || bytes === 0 || bytes > 1024 || history.length >= 32 || remoteBlocked;
  const signature = mode.value + ':' + ready + ':' + JSON.stringify(history);
  if (signature === messageSignature) return;
  messageSignature = signature;
  const list = element('message-history'); list.replaceChildren();
  for (const entry of [...history].reverse()) {
    const row = document.createElement('li'); const content = document.createElement('div');
    const body = document.createElement('strong'); body.className = 'message-text'; body.textContent = entry.text;
    const status = document.createElement('p');
    const labels = { receiving: 'Uploading to device', queued: 'Queued on device · not transmitted', transmitted: 'Transmitted · recipient delivery unconfirmed', acknowledged: 'Accepted by destination · not read status', failed: 'Failed', rejected: 'Rejected by device', unknown: 'Unknown · never automatically resent' };
    status.textContent = entry.reason === 'local-delivery' ? 'Delivered locally · no radio transmission' : `${labels[entry.state]}${entry.reason ? ' · ' + entry.reason : ''}`;
    const id = document.createElement('span'); id.className = 'mono'; id.textContent = `${entry.destination} / ${entry.messageId ?? entry.id}`;
    content.append(body, status, id); const actions = document.createElement('div'); actions.className = 'actions';
    if (entry.state !== 'receiving') {
      const query = document.createElement('button'); query.textContent = 'Query status'; query.disabled = !ready || !!blocked;
      query.addEventListener('click', () => { try { if (!current().adapter.recoverMessage(entry.id)) throw new Error('Previous-boot result is unknown; message will not be resent.'); } catch (e) { showError(e); } });
      const clear = document.createElement('button'); clear.textContent = 'Forget message';
      clear.addEventListener('click', () => { if (['unknown', 'queued', 'transmitted'].includes(entry.state) && !confirm('Forget recovery history? This does not cancel or undo device work.')) return; connection.messaging.forget(entry.id); render(); });
      actions.append(query, clear);
    }
    row.append(content, actions); list.append(row);
  }
}
element('message-body').addEventListener('input', renderMessages);
element('message-form').addEventListener('submit', event => {
  event.preventDefault();
  try {
    current().adapter.sendMessage(element<HTMLTextAreaElement>('message-body').value, element<HTMLInputElement>('message-destination').value, Number(element<HTMLSelectElement>('message-channel').value));
    element<HTMLTextAreaElement>('message-body').value = ''; error = ''; render();
  } catch (e) { showError(e); }
});

function renderRadio() {
  const model = current(); const { connection } = model.adapter; const { sync } = connection;
  const context = `${mode.value}:${connection.device}:${sync.boot}:${sync.revision}`;
  const controls: (HTMLInputElement | HTMLSelectElement)[] = [element('radio-mode'), element('radio-power'), element('radio-relay'), ...Array.from({ length: 7 }, (_, i) => element<HTMLInputElement>(`channel-${i + 1}`))];
  const ready = sync.state === 'ready';
  const supported = ready && !connection.radioBlockReason && !!sync.config?.radio;
  if (!radioDirty && supported) {
    const radio = sync.config!.radio!; radioBase = context;
    element<HTMLSelectElement>('radio-mode').value = radio.mode;
    element<HTMLInputElement>('radio-power').value = String(radio.power);
    element<HTMLInputElement>('radio-relay').checked = radio.relay;
    const names = radio.channels.split('|');
    for (let slot = 1; slot < 8; slot++) element<HTMLInputElement>(`channel-${slot}`).value = names[slot];
  }
  const stale = radioDirty && radioBase !== context;
  text('radio-support', !ready ? 'Connect and synchronize to configure radio settings.' : connection.radioBlockReason ??
    (stale ? 'Device state changed. Load its latest radio settings before saving.' : connection.radioInfo ? `Radio ${connection.radioInfo.state} · ${connection.radioInfo.reason}` : 'Settings are synchronized. Waiting for live radio status.'));
  for (const control of controls) control.disabled = !supported || model.pending;
  element<HTMLButtonElement>('radio-save').disabled = !supported || !radioDirty || stale || model.pending || model.history.length >= 32;
  element<HTMLButtonElement>('radio-reset').disabled = !supported || model.pending;
}
element('radio-form').addEventListener('input', () => { radioDirty = true; render(); });
element('radio-reset').addEventListener('click', () => { radioDirty = false; render(); });
element('radio-form').addEventListener('submit', event => {
  event.preventDefault();
  try {
    const model = current(); const currentConfig = model.adapter.connection.sync.config!;
    const radio: RadioConfig = { mode: element<HTMLSelectElement>('radio-mode').value as RadioConfig['mode'],
      power: Number(element<HTMLInputElement>('radio-power').value), relay: element<HTMLInputElement>('radio-relay').checked,
      channels: ['Public', ...Array.from({ length: 7 }, (_, i) => element<HTMLInputElement>(`channel-${i + 1}`).value)].join('|'), preset: 'US915_LAB1' };
    if (!validRadio(radio, currentConfig.region)) throw new Error('Use US region, power 0–10 dBm, and channel names of up to 8 letters, numbers, underscores or hyphens.');
    const id = model.adapter.configure({ ...currentConfig, radio }); model.history.push({ id, label: 'Radio/channel settings' });
    radioDirty = false; error = ''; render();
  } catch (e) { showError(e); }
});

element('self-destination').addEventListener('click', () => { const device = current().adapter.connection.device; if (device) element<HTMLInputElement>('message-destination').value = device; renderMessages(); });
element('message-destination').addEventListener('input', renderMessages);
function renderInbox() {
  const connection = current().adapter.connection;
  const history = connection.inbox.history;
  const supported = connection.capabilities?.inboxVersion === 1;
  text('inbox-status', connection.inbox.error ?? (connection.inbox.gap ? 'Some earlier messages are no longer retained on the device.' :
    !supported ? 'Connect to firmware with inbox support.' : history.length ? 'Received by this device · not a human-read receipt. History is retained for this page session.' : 'No received messages yet.'));
  const signature = mode.value + ':' + JSON.stringify(history);
  if (signature === inboxSignature) return; inboxSignature = signature;
  const list = element('inbox-history'); list.replaceChildren();
  for (const item of [...history].reverse()) {
    const row = document.createElement('li'); const content = document.createElement('div');
    const body = document.createElement('strong'); body.className = 'message-text'; body.textContent = item.text;
    const metadata = document.createElement('span'); metadata.className = 'mono'; metadata.textContent = `${item.origin} · channel ${item.channel} · ${item.messageId}`;
    content.append(body, metadata); row.append(content); list.append(row);
  }
}
