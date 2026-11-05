// The Map tab: positions and floating controls. Map items and tools live in map-workspace.ts.
import {
  DEFAULT_CHANNEL_IDS,
  DEFAULT_CHANNELS,
  channelList,
} from '../../packages/protocol/radio-config.ts';
import { degrees } from '../../packages/protocol/position-config.ts';
import { MapWorkspace } from './map-workspace.ts';
import { BASEMAPS, FieldMap, type MapPoint } from './map.ts';
import { canonicalNode } from './conversations.ts';
import {
  app,
  current,
  encryption,
  encryptionError,
  knownConfig,
  mode,
  nodeCache,
  preferences,
  recovery,
  render,
  setPreference,
} from './app-state.ts';
import { element, text } from './dom.ts';
import { isAppStopped, onLocalAppStop } from './access-ui.ts';
import { hexBytes } from './message-state.ts';
import { chooseConversation, lastDeviceId, shareTargets, shortNode } from './messages-ui.ts';
import { STALE_NODE_MS } from './node-cache.ts';
import {
  bearingDegrees,
  distanceMeters,
  formatAgo,
  formatBearing,
  formatCoordinate,
  formatDistance,
  fromWire,
  type LngLat,
} from './geo.ts';
import { currentView, onViewChange, setView } from './nav.ts';
import { setIcon } from './ui.ts';

let selectedNode = '';
let me: LngLat | undefined;
let watchId: number | undefined;
export const selectedNodeId = () => selectedNode;
export function setSelectedNode(id: string) {
  selectedNode = id;
}

function devicePosition(): LngLat | undefined {
  const position = knownConfig()?.position;
  return position?.source === 1
    ? [fromWire(position.longitude, 180), fromWire(position.latitude, 90)]
    : undefined;
}
/** Where distances are measured from: this browser if known, otherwise the device's position. */
export const distanceOrigin = () => me ?? devicePosition();
export function rangeTo(target: LngLat) {
  const origin = distanceOrigin();
  return origin
    ? `${formatDistance(distanceMeters(origin, target), preferences.units)} · ${formatBearing(
        bearingDegrees(origin, target),
      )}`
    : undefined;
}

export const fieldMap = new FieldMap(element('map'));
export const mapWorkspace = new MapWorkspace(fieldMap, {
  openMap: () => setView('map'),
  writable: () => recovery.writable && !isAppStopped(),
  stopped: () => isAppStopped() || app.inert,
  context: () => {
    const c = current().adapter.connection;
    const radio = knownConfig()?.radio;
    return {
      channels: channelList({
        channels: radio?.channels ?? DEFAULT_CHANNELS,
        channelIds: radio?.channelIds ?? DEFAULT_CHANNEL_IDS,
      }),
      ready: c.sync.state === 'ready',
      device: c.device,
      source: mode.value,
      messages: c.inbox.history,
      sent: c.messaging.history,
      block: c.messageBlockReason ?? c.messaging.sendBlockReason,
    };
  },
  decode: (payload, identity) => {
    if (payload.ciphertext) {
      const result = encryption?.decrypt(
        hexBytes(payload.ciphertext),
        payload.channel,
        payload.origin,
        payload.destination,
        identity,
      );
      return result?.state === 'decrypted' ? result.text : undefined;
    }
    return encryption?.isRequired(payload.channel) ? undefined : payload.text;
  },
  budget: channel => (encryption?.isRequired(channel) ? 950 : 1024),
  send: (body, destination, channel) => {
    if (encryptionError) throw Error(encryptionError);
    const adapter = current().adapter;
    return encryption?.isRequired(channel)
      ? adapter.sendMessagePayload(
          encryption.encrypt(body, channel, adapter.connection.device!, destination),
          destination,
          channel,
        )
      : adapter.sendMessage(body, destination, channel);
  },
  shareTargets: () => {
    const device = lastDeviceId();
    return shareTargets().filter(
      row => canonicalNode(row.destination) !== canonicalNode(device ?? ''),
    );
  },
  range: rangeTo,
  coordinate: at => formatCoordinate(at, preferences.coordinates),
  distance: meters => formatDistance(meters, preferences.units),
  notify: showMessage,
  selectedItem: () => {
    selectedNode = '';
    fieldMap.select(undefined);
  },
});

function showMessage(message: string | undefined) {
  element('map-message').hidden = !message;
  text('map-message-text', message ?? '');
}

export function selectNode(id: string, options: { message?: boolean; focusMap?: boolean } = {}) {
  selectedNode = id;
  if (options.message) {
    chooseConversation(id);
    setView('comms');
    element('message-body').focus();
  } else {
    setView('map');
    mapWorkspace.clearSelection();
    fieldMap.map.invalidateSize();
    if (options.focusMap) fieldMap.focus(id);
    else fieldMap.select(id);
  }
  render();
}

export function renderMap() {
  const connection = current().adapter.connection;
  const device = lastDeviceId();
  const nodes = nodeCache.nodes;
  const now = Date.now();
  const selected = nodes.find(n => n.node === selectedNode);
  element('selected-asset').hidden = !selected;
  if (selected) {
    const at: LngLat | undefined = selected.position
      ? [selected.position.longitude, selected.position.latitude]
      : undefined;
    const range = at && rangeTo(at);
    text('asset-name', selected.name || `Node ${shortNode(selected.node)}`);
    text(
      'asset-detail',
      `Reported ${formatAgo(selected.heardAt, now)}${range ? ` · ${range}` : ''}`,
    );
  }

  const points: MapPoint[] = [];
  const config = knownConfig();
  const position = config?.position;
  if (device && position?.source === 1) {
    points.push({
      id: device,
      name: config?.label || device,
      latitude: Number(degrees(position.latitude, 90)),
      longitude: Number(degrees(position.longitude, 180)),
      kind: 'self',
      detail: position.share ? 'sharing' : 'not shared',
    });
  }
  for (const node of nodes) {
    if (!node.position || canonicalNode(node.node) === canonicalNode(device ?? '')) continue;
    points.push({
      id: node.node,
      name: node.name || `Node ${shortNode(node.node)}`,
      latitude: node.position.latitude,
      longitude: node.position.longitude,
      kind: 'peer',
      stale: now - node.heardAt > STALE_NODE_MS,
      detail: String(node.heardAt),
    });
  }
  element('map-empty').hidden =
    points.length > 0 ||
    mapWorkspace.hasItems ||
    mapWorkspace.toolActive ||
    (connection.sync.state === 'ready' && nodes.length > 0);
  fieldMap.setPoints(points);
  fieldMap.select(selectedNode || undefined);
  fieldMap.setBasemap(preferences.basemap);
  fieldMap.setMe(me);
  document.querySelector<HTMLElement>('.map-view')!.dataset.basemap = preferences.basemap;
  for (const button of element('map-basemaps').querySelectorAll<HTMLButtonElement>('button')) {
    const active = button.dataset.basemap === preferences.basemap;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-checked', String(active));
  }
  element('map-locate').classList.toggle('is-active', !!me);
  renderCoordinate();
  if (currentView() === 'map') {
    fieldMap.map.invalidateSize({ animate: false });
    fieldMap.frame();
  }
}

function renderCoordinate() {
  const value = formatCoordinate(fieldMap.center(), preferences.coordinates);
  const button = element('map-coordinate');
  if (button.textContent !== value) button.textContent = value;
}

function togglePopover(id: string) {
  const panel = element(id);
  const open = !!panel.hidden;
  element('map-layers-panel').hidden = true;
  element('map-items-panel').hidden = true;
  panel.hidden = !open;
  element('map-layers').classList.toggle('is-active', id === 'map-layers-panel' && open);
  element('map-items').classList.toggle('is-active', id === 'map-items-panel' && open);
}

function locate() {
  if (!navigator.geolocation) {
    showMessage('This browser has no location access.');
    return;
  }
  if (watchId === undefined)
    watchId = navigator.geolocation.watchPosition(
      position => {
        const first = !me;
        me = [position.coords.longitude, position.coords.latitude];
        if (first) fieldMap.flyTo(me[0], me[1]);
        render();
      },
      () => {
        navigator.geolocation.clearWatch(watchId!);
        watchId = undefined;
        me = undefined;
        showMessage('Location permission is off. Allow it in your browser to show your position.');
        render();
      },
      { enableHighAccuracy: true, maximumAge: 10000 },
    );
  if (me) fieldMap.flyTo(me[0], me[1]);
  else showMessage('Waiting for a location fix.');
}

function setExpanded(expanded: boolean) {
  app.classList.toggle('map-expanded', expanded);
  const button = element('map-full');
  button.setAttribute('aria-pressed', String(expanded));
  button.setAttribute('aria-label', expanded ? 'Exit full screen' : 'Full screen');
  button.title = button.getAttribute('aria-label')!;
  setIcon(button, expanded ? 'minimize' : 'fullscreen');
  fieldMap.invalidate();
}

export function initMap() {
  fieldMap.onSelect = id => {
    selectedNode = id ?? '';
    if (id) mapWorkspace.clearSelection();
    render();
  };
  fieldMap.onMove = renderCoordinate;
  onViewChange(() => {
    fieldMap.invalidate();
    if (currentView() !== 'map' && app.classList.contains('map-expanded')) setExpanded(false);
  });
  onLocalAppStop(() => {
    if (watchId !== undefined) navigator.geolocation.clearWatch(watchId);
    watchId = undefined;
  });
  element('map-basemaps').replaceChildren(
    ...BASEMAPS.map(row => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = row.label;
      button.dataset.basemap = row.id;
      button.setAttribute('role', 'radio');
      button.addEventListener('click', () => setPreference('basemap', row.id));
      return button;
    }),
  );
  element('map-zoom-in').addEventListener('click', () => fieldMap.zoom(1));
  element('map-zoom-out').addEventListener('click', () => fieldMap.zoom(-1));
  element('map-locate').addEventListener('click', locate);
  element('map-layers').addEventListener('click', () => togglePopover('map-layers-panel'));
  element('map-items').addEventListener('click', () => togglePopover('map-items-panel'));
  element('map-full').addEventListener('click', () =>
    setExpanded(!app.classList.contains('map-expanded')),
  );
  document.addEventListener('keydown', event => {
    if (
      event.key === 'Escape' &&
      !document.querySelector('dialog[open]') &&
      app.classList.contains('map-expanded')
    )
      setExpanded(false);
  });
  element('map-coordinate').addEventListener('click', () =>
    setPreference('coordinates', preferences.coordinates === 'mgrs' ? 'dd' : 'mgrs'),
  );
  element('fit-map').addEventListener('click', () => {
    if (!fieldMap.fit()) showMessage('Nothing to show yet. No node has reported a position.');
  });
  element('map-message-close').addEventListener('click', () => showMessage(undefined));
  element('asset-message').addEventListener('click', () => {
    if (selectedNode) selectNode(selectedNode, { message: true });
  });
  element('asset-close').addEventListener('click', () => {
    selectedNode = '';
    render();
  });
}
