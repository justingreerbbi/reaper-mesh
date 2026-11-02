import { conversations, threadMessages, conversationKey, canonicalNode, ConversationDrafts } from './conversations.ts';
import { coordinate, degrees } from '../../packages/protocol/position-config.ts';
import './style.css';
import { DEFAULT_CHANNELS, validRadio, type RadioConfig } from '../../packages/protocol/radio-config.ts';
import { ConfigModel } from './model.ts';
import { FieldMap, type MapPoint } from './map.ts';
import { SimulatedDevice } from '../../packages/simulator/serial-device.ts';
import { BrowserRecovery } from './recovery.ts';
import { SerialAdapter } from '../../packages/client-core/serial.ts';
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
const app = document.querySelector('.app') as HTMLElement;
const manage = element<HTMLDialogElement>('manage');

const demo = new SimulatedDevice();
let recovery: BrowserRecovery;
try { recovery = await BrowserRecovery.open(localStorage, navigator.locks); }
catch (error) { recovery = BrowserRecovery.unavailable(`Recovery storage unavailable: ${String(error)}`); }
const models = { demo: new ConfigModel(), usb: new ConfigModel(new SerialAdapter(recovery.connection)) };
const serial = (navigator as Navigator & { serial?: { requestPort(): Promise<SerialPortLike> } }).serial;
let busy = false;
let attempt = 0;
let error = '';
let historySignature = '';
let messageSignature = '';
const recentConversations = new Map<string, { destination: string; channel: number }>();
const drafts = new ConversationDrafts();
let draftKey = '';
let lastDevice: string | undefined = recovery.connection.messaging.history.at(-1)?.device ?? recovery.connection.inbox.history.at(-1)?.device;
let lastScope = '';
const observedOrder = new Map<string, number>();
let nextOrder = 0;
let positionDirty = false, positionBase = '';
let discoveryDirty = false, discoveryBase = '', nodeSignature = '';
let radioDirty = false;
let radioBase = '';
let selectedNode = '';
const fieldMap = new FieldMap(element('map'));
fieldMap.onSelect = id => { selectedNode = id ?? ''; render(); };

for (let slot = 1; slot < 8; slot++) {
  const wrapper = document.createElement('div'); const title = document.createElement('label');
  title.htmlFor = `channel-${slot}`; title.textContent = `Named channel ${slot}`;
  const input = document.createElement('input'); input.id = `channel-${slot}`; input.type = 'text'; input.maxLength = 8; input.autocomplete = 'off';
  wrapper.append(title, input); element('channel-settings').append(wrapper);
}

const current = () => models[mode.value as keyof typeof models];
const showError = (value: unknown) => { error = value instanceof Error ? value.message : String(value); render(); };

type Panel = 'device' | 'nodes' | 'messages';
function setPanelOpen(_open: boolean) { fieldMap.invalidate(); }
function setView(view: 'map' | Panel) {
  if (view === 'device') { openManage('device'); return; }
  app.dataset.view = view === 'nodes' ? 'map' : view;
  for (const button of document.querySelectorAll<HTMLElement>('[data-view-target]')) {
    const active = button.dataset.viewTarget === app.dataset.view;
    button.classList.toggle('is-active', active); button.setAttribute('aria-current', active ? 'page' : 'false');
  }
  fieldMap.invalidate();
}
function setDock(panel: Panel) { setView(panel); }
function chooseConversation(destination: string, channel = 0) {
  if (draftKey) drafts.save(draftKey, element<HTMLTextAreaElement>('message-body').value);
  element<HTMLInputElement>('message-destination').value = destination;
  const select = element<HTMLSelectElement>('message-channel');
  if (![...select.options].some(o => o.value === String(channel))) select.add(new Option(`Channel ${channel}`, String(channel)));
  select.value = String(channel);
  draftKey = `${mode.value}:${lastDevice ?? ''}:${conversationKey(destination, channel)}`;
  recentConversations.set(draftKey, { destination, channel });
  while (recentConversations.size > 64) recentConversations.delete(recentConversations.keys().next().value!);
  element<HTMLTextAreaElement>('message-body').value = drafts.get(draftKey);
  app.classList.add('has-conversation'); messageSignature = ''; renderMessages();
}
function setManage(panel: string) {
  for (const tab of document.querySelectorAll<HTMLElement>('.manage-tab')) {
    tab.classList.toggle('is-active', tab.dataset.manage === panel);
  }
  for (const section of document.querySelectorAll<HTMLElement>('[data-manage-panel]')) {
    const active = section.dataset.managePanel === panel;
    section.classList.toggle('is-active', active);
    section.hidden = !active;
  }
}

function openManage(panel = 'radio') {
  setManage(panel);
  if (!manage.open) manage.showModal();
  const tab = manage.querySelector<HTMLButtonElement>(`[data-manage="${panel}"]`); tab?.focus();
}

function selectNode(id: string, options: { message?: boolean; focusMap?: boolean } = {}) {
  selectedNode = id;
  if (options.message) { chooseConversation(id); setView('messages'); element('message-body').focus(); }
  else { setView('map'); if (options.focusMap) fieldMap.focus(id); else fieldMap.select(id); }
  render();
}
function render() {
  const model = current();
  model.refresh();
  const { connection, active, cleanupError } = model.adapter;
  const { sync, capabilities } = connection;
  const ready = sync.state === 'ready';
  const writable = ready && !connection.writeBlockReason;
  mode.disabled = busy || active;
  connect.disabled = busy || active || (mode.value === 'usb' && (!serial || !isSecureContext));
  connect.textContent = busy ? 'Opening…' : mode.value === 'demo' ? 'Connect simulator' : 'Connect USB';
  disconnect.disabled = !busy && !active;
  text('support', mode.value === 'demo' ? 'An in-memory device. No USB access or radio traffic.' :
    !isSecureContext ? 'USB requires HTTPS or localhost.' : !serial ? 'Use a desktop browser with Web Serial support.' :
    'Choose Heltec (usbserial-0001) or T-Beam (wchusbserial…) in the browser port chooser. One device at a time.');
  text('status', busy ? 'Opening' : sync.state === 'ready' ? (writable ? 'Connected' : 'Read-only') : sync.state);
  element('status').dataset.state = sync.state;
  element('rail-status').dataset.state = busy ? 'opening' : sync.state;
  text('source-caption', connection.device ? connection.device : 'No device');
  text('revision', ready ? `REV ${sync.revision}` : 'REV —');
  text('write-reason', ready ? connection.writeBlockReason ?? 'Settings are synchronized with the device.' : 'Connect and synchronize to edit settings.');
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
    text('capability-note', gaps.length
      ? mode.value === 'demo'
        ? `Simulator identity only — ${gaps.join(', ')} need a USB firmware device.`
        : `This firmware does not expose: ${gaps.join(', ')}.`
      : '');
  }
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
  element<HTMLButtonElement>('export-settings').disabled = !ready;
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
  text('recovery-status', recovery.connection.recoveryError ?? 'USB history is saved in this browser before commands are sent.');
  element<HTMLButtonElement>('recovery-reset').disabled = busy || models.usb.adapter.active;
  renderPosition();
  renderDiscovery();
  renderRadio();
  renderMessages();
  renderInbox();
  renderMap();
  element('simulation').hidden = mode.value !== 'demo';
  element<HTMLButtonElement>('reboot').disabled = busy;
  readOnly.disabled = active || busy;
  const signature = mode.value + ':' + sync.state + ':' + model.history.map(entry => entry.id + model.adapter.connection.commands.status(entry.id).outcome).join('|');
  if (signature !== historySignature) {
    historySignature = signature;
    renderHistory(model, ready);
  }
}

function renderMap() {
  const selected = current().adapter.connection.discovery.nodes.find(n => n.node === selectedNode);
  element('selected-asset').hidden = !selected;
  if (selected) { text('asset-name', selected.name || selected.node); text('asset-detail', selected.position ? `${selected.node} · fixed ${degrees(selected.position.latitude, 90)}, ${degrees(selected.position.longitude, 180)}` : `${selected.node} · no reported position`); }

  const connection = current().adapter.connection;
  const points: MapPoint[] = [];
  const position = connection.sync.config?.position;
  if (connection.device && position?.source === 1) {
    points.push({
      id: connection.device,
      name: connection.sync.config?.label || connection.device,
      latitude: Number(degrees(position.latitude, 90)),
      longitude: Number(degrees(position.longitude, 180)),
      kind: 'self',
      detail: position.share ? 'Local fixed · sharing on' : 'Local fixed · not shared over radio',
    });
  }
  for (const node of connection.discovery.nodes) {
    if (!node.position || canonicalNode(node.node) === canonicalNode(connection.device ?? '')) continue;
    points.push({
      id: node.node,
      name: node.name || node.node,
      latitude: Number(degrees(node.position.latitude, 90)),
      longitude: Number(degrees(node.position.longitude, 180)),
      kind: 'peer',
      detail: `Heard ${Math.floor((node.ageMs + Math.max(0, performance.now() - node.receivedAt)) / 1000)}s ago · fixed`,
    });
  }
  element('map-empty').hidden = points.length > 0;
  text('map-caption', points.length
    ? `${points.length} plotted`
    : 'No shared positions');
  fieldMap.setPoints(points);
  fieldMap.select(selectedNode || undefined);
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
    if (token !== attempt) return;
    demo.readOnly = readOnly.checked;
    await model.adapter.connect(port, crypto.randomUUID());
  } catch (e) { if (token === attempt) showError(e); }
  finally {
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
  ++attempt; busy = false; error = '';
  const model = current();
  try { await model.adapter.disconnect(); } catch (e) { showError(e); }
  selectedNode = '';
  render();
});
mode.addEventListener('change', () => { if (draftKey) drafts.save(draftKey, element<HTMLTextAreaElement>('message-body').value); lastDevice = current().adapter.connection.device ?? current().adapter.connection.messaging.history.at(-1)?.device ?? current().adapter.connection.inbox.history.at(-1)?.device; lastScope = ''; error = ''; historySignature = ''; selectedNode = ''; render(); });
const edit = () => { current().edit({ ...current().draft, label: label.value, region: region.value }); render(); };
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

for (const button of document.querySelectorAll<HTMLElement>('[data-view-target]')) {
  button.addEventListener('click', () => setView(button.dataset.viewTarget as 'map' | Panel));
}
for (const tab of document.querySelectorAll<HTMLElement>('.dock-tab')) {
  tab.addEventListener('click', () => {
    setDock(tab.dataset.dock as Panel);
    setPanelOpen(true);
  });
}
for (const tab of document.querySelectorAll<HTMLElement>('.manage-tab')) {
  tab.addEventListener('click', () => setManage(tab.dataset.manage!));
}
for (const button of document.querySelectorAll<HTMLElement>('[data-open-manage]')) {
  button.addEventListener('click', () => openManage(button.dataset.openManage));
}
element('open-manage').addEventListener('click', () => openManage('device'));
element('fit-map').addEventListener('click', () => fieldMap.fit());
setView('messages');
element('new-conversation').addEventListener('click', () => { element('recipient-controls').hidden = false; element('recipient-toggle').setAttribute('aria-expanded', 'true'); app.classList.add('has-conversation'); element('message-destination').focus(); });
element('recipient-toggle').addEventListener('click', () => { const controls = element('recipient-controls'); controls.hidden = !controls.hidden; element('recipient-toggle').setAttribute('aria-expanded', String(!controls.hidden)); });
element('recipient-done').addEventListener('click', () => { chooseConversation(element<HTMLInputElement>('message-destination').value.trim(), Number(element<HTMLSelectElement>('message-channel').value)); element('recipient-controls').hidden = true; element('recipient-toggle').setAttribute('aria-expanded', 'false'); renderMessages(); });
element('back-conversations').addEventListener('click', () => app.classList.remove('has-conversation'));
element('conversation-connect').addEventListener('click', () => connect.click());
element('conversation-search').addEventListener('input', renderMessages);
element('locate-conversation').addEventListener('click', () => selectNode(element<HTMLInputElement>('message-destination').value, { focusMap: true }));
element('asset-message').addEventListener('click', () => { if (selectedNode) selectNode(selectedNode, { message: true }); });
element('message-channel').addEventListener('change', () => chooseConversation(element<HTMLInputElement>('message-destination').value, Number(element<HTMLSelectElement>('message-channel').value)));
element('broadcast-destination').addEventListener('click', () => {
  chooseConversation('broadcast', Number(element<HTMLSelectElement>('message-channel').value));
  selectedNode = '';
  fieldMap.select(undefined);
  renderMessages();
});

const timer = setInterval(render, 100);
window.addEventListener('pagehide', () => { clearInterval(timer); void models.demo.adapter.disconnect(); void models.usb.adapter.disconnect(); recovery.release(); });
window.addEventListener('resize', () => fieldMap.invalidate());
render();
fieldMap.invalidate();

function renderMessages() {
  const { connection } = current().adapter;
  if (connection.device) lastDevice = connection.device;
  const scope = `${mode.value}:${lastDevice ?? ''}`;
  const unboundDraft = lastScope === `${mode.value}:` ? element<HTMLTextAreaElement>('message-body').value : '';
  if (scope !== lastScope) {
    if (draftKey) drafts.save(draftKey, element<HTMLTextAreaElement>('message-body').value);
    lastScope = scope; selectedNode = ''; element<HTMLInputElement>('message-destination').value = 'broadcast';
    element<HTMLSelectElement>('message-channel').value = '0'; draftKey = `${scope}:0:broadcast`;
    element<HTMLTextAreaElement>('message-body').value = drafts.get(draftKey) || unboundDraft; messageSignature = '';
  }
  const body = element<HTMLTextAreaElement>('message-body'), destination = element<HTMLInputElement>('message-destination');
  const channel = element<HTMLSelectElement>('message-channel');
  const bytes = new TextEncoder().encode(body.value).length, ready = connection.sync.state === 'ready';
  const history = connection.messaging.history, incoming = connection.inbox.history;
  const uploading = history.some(entry => entry.state === 'receiving');
  body.disabled = uploading; destination.disabled = channel.disabled = uploading;
  text('message-bytes', `${bytes} / 1024 bytes`);
  const names = (connection.sync.config?.radio?.channels ?? DEFAULT_CHANNELS).split('|');
  if (channel.dataset.names !== JSON.stringify(names)) {
    const selected = channel.value; channel.replaceChildren(); names.forEach((name, slot) => { if (name) channel.add(new Option(name, String(slot))); });
    if ([...channel.options].some(o => o.value === selected)) channel.value = selected;
    channel.dataset.names = JSON.stringify(names);
  }
  const selectedChannel = Number(channel.value), key = conversationKey(destination.value, selectedChannel);
  const remoteBlocked = destination.value !== connection.device && connection.capabilities?.radioVersion === 1 && connection.radioInfo?.reason !== 'ready';
  text('message-support', !ready ? 'Offline · your draft stays here' : connection.messageBlockReason ?? (uploading ? 'Uploading message…' : remoteBlocked ? 'Radio unavailable · check device settings' : destination.value === 'broadcast' ? 'Broadcast · no recipient ACK' : 'Destination ACK confirms delivery, not reading'));
  element<HTMLButtonElement>('message-send').disabled = !ready || !!connection.messageBlockReason || uploading || !destination.value.trim() || !bytes || bytes > 1024 || history.length >= 32 || remoteBlocked || !element('recipient-controls').hidden;
  element<HTMLButtonElement>('self-destination').disabled = !connection.device || uploading;
  const rows = conversations(lastDevice, names, connection.discovery.nodes, history, incoming);
  if (!rows.some(row => row.key === key) && destination.value.trim()) rows.push({ key, destination: destination.value, channel: selectedChannel, name: destination.value, preview: 'New conversation', kind: destination.value === 'broadcast' ? 'channel' : 'direct' });
  for (const [savedKey, target] of recentConversations) {
    const draft = drafts.get(savedKey);
    if (savedKey.startsWith(scope + ':') && draft && !rows.some(row => row.key === conversationKey(target.destination, target.channel))) rows.push({ key: conversationKey(target.destination, target.channel), ...target, name: target.destination, preview: `Draft: ${draft}`, kind: 'direct' });
  }
  for (let i = 0; i < rows.length; i++) { const draft = drafts.get(`${scope}:${rows[i].key}`); if (draft) rows[i] = { ...rows[i], preview: `Draft: ${draft}` }; }
  const currentRow = rows.find(row => row.key === key);
  text('conversation-title', currentRow?.name ?? (destination.value || 'New conversation'));
  text('conversation-avatar', destination.value === 'broadcast' ? '#' : (currentRow?.name ?? destination.value).slice(0, 2).toUpperCase());
  text('conversation-subtitle', destination.value === 'broadcast' ? `${names[selectedChannel] || 'Channel ' + selectedChannel} · traffic received by this device` : `${destination.value} · ${names[selectedChannel] || 'Channel ' + selectedChannel}`);
  element<HTMLButtonElement>('locate-conversation').disabled = !connection.discovery.nodes.some(n => canonicalNode(n.node) === canonicalNode(destination.value) && n.position);
  element('conversation-connect').hidden = ready;
  const filter = element<HTMLInputElement>('conversation-search').value.trim().toLowerCase();
  const listSignature = JSON.stringify(rows) + key + filter;
  const list = element('conversation-list');
  if (list.dataset.signature !== listSignature) {
    list.dataset.signature = listSignature; list.replaceChildren();
    const visible = rows.filter(row => `${row.name} ${row.destination}`.toLowerCase().includes(filter));
    element('conversation-search-empty').hidden = visible.length !== 0;
    for (const row of visible) {
      const button = document.createElement('button'); button.className = 'conversation-row'; button.classList.toggle('is-selected', row.key === key); button.setAttribute('aria-pressed', String(row.key === key));
      const avatar = document.createElement('span'); avatar.className = 'avatar'; avatar.textContent = row.kind === 'channel' ? '#' : row.name.slice(0, 2).toUpperCase();
      const content = document.createElement('span'); content.className = 'conversation-summary';
      const name = document.createElement('strong'); name.textContent = row.name;
      const preview = document.createElement('span'); preview.textContent = row.preview; content.append(name, preview);
      const badge = document.createElement('span'); badge.className = 'thread-kind'; badge.textContent = row.kind === 'channel' ? 'CH' : 'DM';
      button.append(avatar, content, badge); button.addEventListener('click', () => chooseConversation(row.destination, row.channel)); list.append(button);
    }
  }
  const messages = threadMessages(lastDevice, destination.value, selectedChannel, history, incoming);
  const orderScope = scope + ':';
  for (const m of messages) if (!observedOrder.has(orderScope + m.key)) observedOrder.set(orderScope + m.key, ++nextOrder);
  while (observedOrder.size > 256) observedOrder.delete(observedOrder.keys().next().value!);
  messages.sort((a, b) => observedOrder.get(orderScope + a.key)! - observedOrder.get(orderScope + b.key)!);
  const signature = scope + key + ready + JSON.stringify(messages);
  element('conversation-empty').hidden = messages.length > 0;
  if (signature === messageSignature) return; messageSignature = signature;
  const scroller = element('thread-scroll'), stick = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80;
  const thread = element('message-history'); thread.replaceChildren();
  for (const m of messages) {
    const row = document.createElement('li'); row.className = `message-row ${m.direction}`;
    const bubble = document.createElement('div'); bubble.className = 'message-bubble';
    if (m.direction === 'incoming') { const sender = document.createElement('span'); sender.className = 'message-sender'; sender.textContent = connection.discovery.nodes.find(n => canonicalNode(n.node) === canonicalNode(m.origin))?.name || m.origin; bubble.append(sender); }
    const content = document.createElement('p'); content.className = 'message-text'; content.textContent = m.text;
    const status = document.createElement('span'); status.className = 'message-state'; status.textContent = m.status; status.dataset.state = m.entry?.state ?? 'received'; bubble.append(content, status);
    if (m.entry && m.entry.state !== 'receiving') {
      const entry = m.entry, details = document.createElement('details'), summary = document.createElement('summary'); summary.textContent = 'Message details';
      const identity = document.createElement('span'); identity.className = 'mono'; identity.textContent = `${entry.messageId ?? entry.id}${entry.reason ? ' · ' + entry.reason : ''}`;
      const query = document.createElement('button'); query.textContent = 'Check delivery'; query.disabled = !ready;
      query.addEventListener('click', () => { try { if (!current().adapter.recoverMessage(entry.id)) throw Error('Previous-boot outcome is unknown. Nothing was resent.'); } catch (e) { showError(e); } });
      const clear = document.createElement('button'); clear.textContent = 'Remove from history'; clear.addEventListener('click', () => { if (['unknown', 'queued', 'transmitted'].includes(entry.state) && !confirm('Remove recovery history? Device work is not cancelled.')) return; connection.forgetMessage(entry.id); render(); });
      details.append(summary, identity, query, clear); bubble.append(details);
    }
    row.append(bubble); thread.append(row);
  }
  if (stick) requestAnimationFrame(() => { scroller.scrollTop = scroller.scrollHeight; });
}
element('message-body').addEventListener('input', () => { drafts.save(draftKey, element<HTMLTextAreaElement>('message-body').value); renderMessages(); });
element('message-body').addEventListener('keydown', event => { const e = event as KeyboardEvent; if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); if (!element<HTMLButtonElement>('message-send').disabled) element<HTMLFormElement>('message-form').requestSubmit(); } });
element('message-form').addEventListener('submit', event => {
  event.preventDefault();
  try {
    current().adapter.sendMessage(element<HTMLTextAreaElement>('message-body').value, element<HTMLInputElement>('message-destination').value, Number(element<HTMLSelectElement>('message-channel').value));
    element<HTMLTextAreaElement>('message-body').value = ''; drafts.save(draftKey, ''); error = ''; render();
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
    model.adapter.configure({ ...currentConfig, radio });
    radioDirty = false; error = ''; render();
  } catch (e) { showError(e); }
});

element('self-destination').addEventListener('click', () => {
  const device = current().adapter.connection.device;
  if (device) selectNode(device, { message: true });
  else renderMessages();
});
element('message-destination').addEventListener('input', renderMessages);
function renderInbox() {
  const connection = current().adapter.connection;
  text('inbox-status', connection.inbox.error ?? (connection.inbox.gap ? 'Earlier messages are no longer retained on the device.' : connection.sync.state !== 'ready' ? 'History stays available while disconnected.' : 'Device history · received does not mean read'));
}
element('recovery-retry').addEventListener('click', () => { recovery.retry(); render(); });
element('recovery-export').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([recovery.exportText()], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = 'reaper-mesh-recovery.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
element('recovery-reset').addEventListener('click', () => {
  if (!confirm('Discard saved USB history and allocate a new client identity? Unknown device work is not cancelled. Export your history first if you need it. Device owner slots are limited.')) return;
  try {
    recovery.reset(); models.usb = new ConfigModel(new SerialAdapter(recovery.connection));
    historySignature = messageSignature = ''; error = ''; render();
  } catch (error) { showError(error); }
});

element('export-settings').addEventListener('click', () => {
  const { connection } = current().adapter;
  if (connection.sync.state !== 'ready') return;
  const snapshot = { format: 'reaper-mesh-settings-1', device: connection.device, boot: connection.sync.boot,
    revision: connection.sync.revision, config: connection.sync.config };
  const url = URL.createObjectURL(new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = 'reaper-mesh-settings.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

function renderPosition() {
  const model = current(), connection = model.adapter.connection, { sync } = connection;
  const ready = connection.supportsPosition && sync.state === 'ready';
  const writable = ready && !connection.writeBlockReason && !!sync.config?.position;
  const context = `${mode.value}:${connection.device}:${sync.boot}:${sync.revision}`;
  const position = sync.config?.position;
  if (!positionDirty && position) {
    element<HTMLSelectElement>('position-source').value = String(position.source);
    element<HTMLInputElement>('position-share').checked = position.share;
    element<HTMLInputElement>('position-latitude').value = degrees(position.latitude, 90);
    element<HTMLInputElement>('position-longitude').value = degrees(position.longitude, 180); positionBase = context;
  }
  const stale = positionDirty && positionBase !== context;
  text('position-support', !connection.supportsPosition ? 'Connect to firmware with fixed-position support.' : stale ? 'Device state changed. Load the latest position settings.' : connection.writeBlockReason ?? (position?.share && position.source === 1 ? 'Fixed-position sharing enabled.' : 'No coordinates will be sent with the current settings.'));
  for (const id of ['position-source', 'position-share', 'position-latitude', 'position-longitude']) element<HTMLInputElement>(id).disabled = !writable || model.pending;
  element<HTMLButtonElement>('position-save').disabled = !writable || !positionDirty || stale || model.pending;
  element<HTMLButtonElement>('position-reset').disabled = !ready;
}
element('position-form').addEventListener('input', () => { positionDirty = true; render(); });
element('position-reset').addEventListener('click', () => { positionDirty = false; render(); });
element('position-form').addEventListener('submit', event => {
  event.preventDefault();
  try {
    const config = current().adapter.connection.sync.config!;
    const source = element<HTMLSelectElement>('position-source').value;
    if (source !== '0' && source !== '1') throw new Error('Unsupported position source');
    current().adapter.configure({ ...config, position: { source: source === '1' ? 1 : 0, share: element<HTMLInputElement>('position-share').checked,
      latitude: coordinate(element<HTMLInputElement>('position-latitude').value, 90), longitude: coordinate(element<HTMLInputElement>('position-longitude').value, 180) } });
    positionDirty = false; error = ''; render();
  } catch (error) { showError(error); }
});

function renderDiscovery() {
  const model = current(), connection = model.adapter.connection, { sync } = connection;
  const supported = connection.supportsDiscovery;
  const ready = supported && sync.state === 'ready', writable = ready && !connection.writeBlockReason && !!sync.config?.discovery;
  const context = `${mode.value}:${connection.device}:${sync.boot}:${sync.revision}`;
  const settings = sync.config?.discovery;
  if (!discoveryDirty && settings) {
    element<HTMLInputElement>('beacon-enabled').checked = settings.beacon;
    element<HTMLInputElement>('respond-enabled').checked = settings.respond;
    element<HTMLInputElement>('beacon-interval').value = String(settings.interval); discoveryBase = context;
  }
  const stale = discoveryDirty && discoveryBase !== context;
  const support = !supported ? 'Connect to firmware with discovery support.' : stale ? 'Device state changed. Load the latest discovery settings.' : connection.writeBlockReason ?? 'Beacons and responses are separate, opt-in settings.';
  text('discovery-support', support);
  text('discovery-panel-support', support);
  element<HTMLButtonElement>('discover').disabled = !writable || connection.radioInfo?.reason !== 'ready' || connection.discovery.last?.state === 'collecting';
  element<HTMLButtonElement>('discovery-query').disabled = !ready || !connection.discovery.last;
  element<HTMLButtonElement>('discovery-save').disabled = !writable || !discoveryDirty || stale || model.pending;
  element<HTMLButtonElement>('discovery-reset').disabled = !ready;
  for (const id of ['beacon-enabled', 'respond-enabled', 'beacon-interval']) element<HTMLInputElement>(id).disabled = !writable || model.pending;
  const result = connection.discovery.last;
  text('discovery-result', connection.discovery.error ?? (result ? `${result.state} · ${result.replies} replies` : ''));
  const nodes = connection.discovery.nodes;
  element('nodes-empty').hidden = nodes.length > 0;
  text('node-count', String(nodes.length));
  const signature = mode.value + ':' + selectedNode + ':' + JSON.stringify(nodes) + ':' + Math.floor(performance.now() / 1000);
  if (signature === nodeSignature) return; nodeSignature = signature;
  const list = element('nodes'); list.replaceChildren();
  for (const node of nodes) {
    const row = document.createElement('li');
    row.classList.toggle('is-selected', node.node === selectedNode);
    const content = document.createElement('div');
    const name = document.createElement('strong');
    const detail = document.createElement('span');
    name.textContent = node.name || node.node;
    detail.className = 'mono';
    detail.textContent = `${node.node} · last heard ${Math.floor((node.ageMs + Math.max(0, performance.now() - node.receivedAt)) / 1000)}s ago`;
    if (node.position) detail.textContent += ` · fixed ${degrees(node.position.latitude, 90)}, ${degrees(node.position.longitude, 180)}`;
    else detail.textContent += ' · no position';
    content.append(name, detail);
    content.style.cursor = 'pointer';
    content.addEventListener('click', () => selectNode(node.node, { focusMap: !!node.position }));
    const actions = document.createElement('div');
    actions.className = 'actions';
    const message = document.createElement('button');
    message.textContent = 'Message';
    message.disabled = sync.state !== 'ready';
    message.addEventListener('click', () => selectNode(node.node, { message: true, focusMap: !!node.position }));
    actions.append(message);
    if (node.position) {
      const locate = document.createElement('button');
      locate.textContent = 'Locate';
      locate.addEventListener('click', () => selectNode(node.node, { focusMap: true }));
      actions.append(locate);
    }
    row.append(content, actions);
    list.append(row);
  }
}
element('discovery-form').addEventListener('input', () => { discoveryDirty = true; render(); });
element('discovery-reset').addEventListener('click', () => { discoveryDirty = false; render(); });
element('discovery-form').addEventListener('submit', event => {
  event.preventDefault();
  try {
    const config = current().adapter.connection.sync.config!;
    current().adapter.configure({ ...config, discovery: { beacon: element<HTMLInputElement>('beacon-enabled').checked, respond: element<HTMLInputElement>('respond-enabled').checked, interval: Number(element<HTMLInputElement>('beacon-interval').value) } });
    discoveryDirty = false; error = ''; render();
  } catch (error) { showError(error); }
});
element('discover').addEventListener('click', () => { try { current().adapter.discover(); error = ''; render(); } catch (error) { showError(error); } });
element('discovery-query').addEventListener('click', () => { try { if (!current().adapter.recoverDiscovery()) throw new Error('Previous-boot discovery outcome is unavailable; nothing was resent.'); render(); } catch (error) { showError(error); } });
