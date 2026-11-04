// Settings dialog: navigation, radio, position, discovery, screen and recovery.
import { degrees, coordinate } from '../../packages/protocol/position-config.ts';
import {
  DEFAULT_CHANNELS,
  validRadio,
  type RadioConfig,
} from '../../packages/protocol/radio-config.ts';
import { SerialAdapter } from '../../packages/agent-core/serial.ts';
import { ConfigModel } from './model.ts';
import {
  clearError,
  current,
  manage,
  mode,
  models,
  recovery,
  render,
  setError,
  showError,
} from './app-state.ts';
import { element, text } from './dom.ts';
import { editChannel, editingChannelSlot } from './channels-ui.ts';
import { invalidateThread } from './messages-ui.ts';
import { selectNode, selectedNodeId } from './map-ui.ts';

const queried = new Set<string>();
let positionDirty = false,
  positionBase = '';
let discoveryDirty = false,
  discoveryBase = '',
  nodeSignature = '';
let screenDirty = false,
  screenBase = '';
let radioDirty = false;
let radioBase = '';

export function setManage(panel: string) {
  manage.querySelector<HTMLElement>('.manage-body')!.scrollTop = 0;
  if (panel === 'channels') editChannel(0);
  for (const tab of document.querySelectorAll<HTMLElement>('.manage-tab')) {
    const active = tab.dataset.manage === panel;
    tab.classList.toggle('is-active', active);
    if (active) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  }
  for (const section of document.querySelectorAll<HTMLElement>('[data-manage-panel]')) {
    const active = section.dataset.managePanel === panel;
    section.classList.toggle('is-active', active);
    section.hidden = !active;
  }
}

export function openManage(panel = 'device') {
  setManage(panel);
  if (!manage.open) manage.showModal();
  const tab = manage.querySelector<HTMLButtonElement>(`[data-manage="${panel}"]`);
  tab?.focus();
}

/**
 * Releases settled configuration commands so the agent's bounded history never fills up.
 * A command with an unknown outcome is queried once per connection (never resent). It is
 * released once its result arrives, or once the device has rebooted and its receipt is gone;
 * the device snapshot already shows what actually applied.
 */
export function settleCommands(model: ConfigModel, ready: boolean) {
  const { connection } = model.adapter;
  for (const entry of model.history) {
    const { outcome, result } = connection.commands.status(entry.id);
    if (outcome === 'pending') continue;
    if (outcome !== 'unknown' || result) {
      model.forget(entry.id);
      if (outcome !== 'committed') setError(settledMessage[outcome]);
      continue;
    }
    const attempt = `${entry.id}:${connection.sync.session}`;
    if (!ready || queried.has(attempt)) continue;
    queried.add(attempt);
    try {
      if (!model.adapter.recover(entry.id)) {
        model.forget(entry.id);
        setError(settledMessage.unknown);
      }
    } catch {
      // Another device, or firmware without result queries: keep it for the original device.
    }
  }
}

const settledMessage = {
  conflict: 'The device settings changed before your save arrived. The latest settings are shown.',
  rejected: 'The device rejected the settings change. Nothing was changed.',
  unknown:
    'A settings change may not have applied before the device restarted. The settings shown are what the device reports.',
};

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
  }
  element('radio-boost-row').hidden = !connection.supportsTxBoost;
  const channelNames = (sync.config?.radio?.channels ?? DEFAULT_CHANNELS).split('|');
  const list = element('managed-channels');
  const signature = JSON.stringify(channelNames);
  if (list.dataset.signature !== signature) {
    list.dataset.signature = signature;
    list.replaceChildren();
    channelNames.forEach((name, slot) => {
      if (!name) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = name;
      button.dataset.slot = String(slot);
      button.classList.toggle('is-active', slot === editingChannelSlot());
      button.setAttribute('aria-current', slot === editingChannelSlot() ? 'page' : 'false');
      button.addEventListener('click', () => editChannel(slot));
      list.append(button);
    });
  }
  element<HTMLButtonElement>('create-channel').disabled =
    !supported || model.pending || channelNames.filter(Boolean).length >= 8;
  text(
    'channels-status',
    !supported
      ? 'Connect a device to manage channels.'
      : `${channelNames.filter(Boolean).length} of 8 channels in use`,
  );
  element<HTMLButtonElement>('channel-name-save').disabled =
    !supported || model.pending || editingChannelSlot() === 0;
  const stale = radioDirty && radioBase !== context;
  text(
    'radio-support',
    !ready
      ? 'Connect and synchronize to configure radio settings.'
      : (connection.radioBlockReason ??
          (stale
            ? 'Device state changed. Load its latest radio settings before saving.'
            : connection.radioInfo
              ? `Radio ${connection.radioInfo.state} · ${connection.radioInfo.reason}`
              : 'Settings are synchronized. Waiting for live radio status.')),
  );
  for (const control of controls) control.disabled = !supported || model.pending;
  element<HTMLButtonElement>('radio-save').disabled =
    !supported || !radioDirty || stale || model.pending || model.history.length >= 32;
  element<HTMLButtonElement>('radio-reset').disabled = !supported || model.pending;
}

export function renderPosition() {
  const model = current(),
    connection = model.adapter.connection,
    { sync } = connection;
  const ready = connection.supportsPosition && sync.state === 'ready';
  const writable = ready && !connection.writeBlockReason && !!sync.config?.position;
  const context = `${mode.value}:${connection.device}:${sync.boot}:${sync.revision}`;
  const position = sync.config?.position;
  if (!positionDirty && position) {
    element<HTMLSelectElement>('position-source').value = String(position.source);
    element<HTMLInputElement>('position-share').checked = position.share;
    element<HTMLInputElement>('position-latitude').value = degrees(position.latitude, 90);
    element<HTMLInputElement>('position-longitude').value = degrees(position.longitude, 180);
    positionBase = context;
  }
  const stale = positionDirty && positionBase !== context;
  text(
    'position-support',
    !connection.supportsPosition
      ? 'Connect to firmware with fixed-position support.'
      : stale
        ? 'Device state changed. Load the latest position settings.'
        : (connection.writeBlockReason ??
          (position?.share && position.source === 1
            ? 'Fixed-position sharing enabled.'
            : 'No coordinates will be sent with the current settings.')),
  );
  for (const id of ['position-source', 'position-share', 'position-latitude', 'position-longitude'])
    element<HTMLInputElement>(id).disabled = !writable || model.pending;
  element<HTMLButtonElement>('position-save').disabled =
    !writable || !positionDirty || stale || model.pending;
  element<HTMLButtonElement>('position-reset').disabled = !ready;
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
    // Keep a device value set outside this portal selectable instead of silently replacing it.
    const value = String(screen.timeout);
    select.querySelector('option[data-custom]')?.remove();
    if (![...select.options].some(option => option.value === value)) {
      const option = new Option(`${screen.timeout} seconds`, value);
      option.dataset.custom = '';
      select.add(option);
    }
    select.value = value;
    element<HTMLInputElement>('screen-wake').checked = screen.wake;
    screenBase = context;
  }
  const stale = screenDirty && screenBase !== context;
  text(
    'screen-support',
    !connection.supportsScreen
      ? 'Connect to firmware with screen settings support.'
      : stale
        ? 'Device state changed. Load the latest screen settings.'
        : (connection.writeBlockReason ?? ''),
  );
  for (const id of ['screen-timeout', 'screen-wake'])
    element<HTMLInputElement>(id).disabled = !writable || model.pending;
  element<HTMLButtonElement>('screen-save').disabled =
    !writable || !screenDirty || stale || model.pending;
  element<HTMLButtonElement>('screen-reset').disabled = !ready;
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
    element<HTMLInputElement>('beacon-interval').value = String(settings.interval);
    discoveryBase = context;
  }
  const stale = discoveryDirty && discoveryBase !== context;
  const support = !supported
    ? 'Connect to firmware with discovery support.'
    : stale
      ? 'Device state changed. Load the latest discovery settings.'
      : (connection.writeBlockReason ?? 'Beacons and responses are separate, opt-in settings.');
  text('discovery-support', support);
  text(
    'discovery-panel-support',
    !supported
      ? 'Connect a device with discovery support to change these settings.'
      : stale
        ? 'The device changed. Discard changes to load its latest settings.'
        : (connection.writeBlockReason ??
          'Choose how nearby devices can find this device. Announcements and replies are independently optional.'),
  );
  element<HTMLButtonElement>('discover').disabled =
    !writable ||
    connection.radioInfo?.reason !== 'ready' ||
    connection.discovery.last?.state === 'collecting';
  element<HTMLButtonElement>('discovery-query').disabled = !ready || !connection.discovery.last;
  element<HTMLButtonElement>('discovery-save').disabled =
    !writable || !discoveryDirty || stale || model.pending;
  element<HTMLButtonElement>('discovery-reset').disabled = !ready;
  for (const id of ['beacon-enabled', 'respond-enabled', 'beacon-interval'])
    element<HTMLInputElement>(id).disabled = !writable || model.pending;
  const result = connection.discovery.last;
  text(
    'discovery-result',
    connection.discovery.error ?? (result ? `${result.state} · ${result.replies} replies` : ''),
  );
  const nodes = connection.discovery.nodes;
  element('nodes-empty').hidden = nodes.length > 0;
  text('node-count', String(nodes.length));
  const signature =
    mode.value +
    ':' +
    selectedNodeId() +
    ':' +
    JSON.stringify(nodes) +
    ':' +
    Math.floor(performance.now() / 1000);
  if (signature === nodeSignature) return;
  nodeSignature = signature;
  const list = element('nodes');
  list.replaceChildren();
  for (const node of nodes) {
    const row = document.createElement('li');
    row.classList.toggle('is-selected', node.node === selectedNodeId());
    const content = document.createElement('div');
    const name = document.createElement('strong');
    const detail = document.createElement('span');
    name.textContent = node.name || node.node;
    detail.className = 'mono';
    detail.textContent = `${node.node} · last heard ${Math.floor((node.ageMs + Math.max(0, performance.now() - node.receivedAt)) / 1000)}s ago`;
    if (node.position)
      detail.textContent += ` · fixed ${degrees(node.position.latitude, 90)}, ${degrees(node.position.longitude, 180)}`;
    else detail.textContent += ' · no position';
    content.append(name, detail);
    content.style.cursor = 'pointer';
    content.addEventListener('click', () => selectNode(node.node, { focusMap: !!node.position }));
    const actions = document.createElement('div');
    actions.className = 'actions';
    const message = document.createElement('button');
    message.textContent = 'Message';
    message.disabled = sync.state !== 'ready';
    message.addEventListener('click', () =>
      selectNode(node.node, { message: true, focusMap: !!node.position }),
    );
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

export function initSettings() {
  for (const tab of document.querySelectorAll<HTMLElement>('.manage-tab')) {
    tab.addEventListener('click', () => setManage(tab.dataset.manage!));
  }
  for (const button of document.querySelectorAll<HTMLElement>('[data-open-manage]')) {
    button.addEventListener('click', () => openManage(button.dataset.openManage));
  }
  element('open-manage').addEventListener('click', () => openManage('device'));
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
        // Channels are edited in the Channels tab; keep the device's current table here.
        channels: currentConfig.radio!.channels,
        channelIds: currentConfig.radio!.channelIds,
        preset: 'US915_LAB1',
      };
      if (!validRadio(radio, currentConfig.region))
        throw new Error('Use the US region to turn the radio on.');
      model.adapter.configure({ ...currentConfig, radio });
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
    const url = URL.createObjectURL(
      new Blob([recovery.exportText()], { type: 'application/json' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = 'reaper-mesh-recovery.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  element('recovery-reset').addEventListener('click', () => {
    if (
      !confirm(
        'Discard saved USB history and allocate a new agent identity? Unknown device work is not cancelled. Export your history first if you need it. Device owner slots are limited.',
      )
    )
      return;
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
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = 'reaper-mesh-settings.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  element('position-form').addEventListener('input', () => {
    positionDirty = true;
    render();
  });
  element('position-reset').addEventListener('click', () => {
    positionDirty = false;
    render();
  });
  element('position-form').addEventListener('submit', event => {
    event.preventDefault();
    try {
      const config = current().adapter.connection.sync.config!;
      const source = element<HTMLSelectElement>('position-source').value;
      if (source !== '0' && source !== '1') throw new Error('Unsupported position source');
      current().adapter.configure({
        ...config,
        position: {
          source: source === '1' ? 1 : 0,
          share: element<HTMLInputElement>('position-share').checked,
          latitude: coordinate(element<HTMLInputElement>('position-latitude').value, 90),
          longitude: coordinate(element<HTMLInputElement>('position-longitude').value, 180),
        },
      });
      positionDirty = false;
      clearError();
      render();
    } catch (error) {
      showError(error);
    }
  });
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
      const config = current().adapter.connection.sync.config!;
      current().adapter.configure({
        ...config,
        screen: {
          timeout: Number(element<HTMLSelectElement>('screen-timeout').value),
          wake: element<HTMLInputElement>('screen-wake').checked,
        },
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
      const config = current().adapter.connection.sync.config!;
      current().adapter.configure({
        ...config,
        discovery: {
          beacon: element<HTMLInputElement>('beacon-enabled').checked,
          respond: element<HTMLInputElement>('respond-enabled').checked,
          interval: Number(element<HTMLInputElement>('beacon-interval').value),
        },
      });
      discoveryDirty = false;
      clearError();
      render();
    } catch (error) {
      showError(error);
    }
  });
  element('discover').addEventListener('click', () => {
    try {
      current().adapter.discover();
      clearError();
      render();
    } catch (error) {
      showError(error);
    }
  });
  element('discovery-query').addEventListener('click', () => {
    try {
      if (!current().adapter.recoverDiscovery())
        throw new Error('Previous-boot discovery outcome is unavailable; nothing was resent.');
      render();
    } catch (error) {
      showError(error);
    }
  });
}
