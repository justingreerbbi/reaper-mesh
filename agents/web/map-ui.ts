// The Map tab: positions and floating controls. Map items and tools live in map-workspace.ts.
import {
  DEFAULT_CHANNEL_IDS,
  DEFAULT_CHANNELS,
  channelList,
} from '../../packages/protocol/radio-config.ts';
import { degrees } from '../../packages/protocol/position-config.ts';
import { MapWorkspace } from './map-workspace.ts';
import { BASEMAPS, FieldMap, type MapPoint, type TrailStep } from './map.ts';
import { trailSteps } from './trail.ts';
import {
  currentFix,
  locationProblem,
  onFix,
  stopLocation,
  wantLocation,
  type Fix,
} from './location.ts';
import { compassReading, startCompass, stopCompass } from './compass.ts';
import { declination, decimalYear, turnHeading } from './declination.ts';
import { keepAwake, setKeepAwakeAllowed } from './keep-awake.ts';
import { initTrack, renderTrack, trackLinesToDraw } from './track-ui.ts';
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
  formatHeight,
  formatSpeed,
  fromWire,
  type LngLat,
} from './geo.ts';
import { currentView, onViewChange, setView } from './nav.ts';
import { setIcon } from './ui.ts';

let selectedNode = '';
let me: LngLat | undefined;
/** The map keeps this computer in the middle until the user drags it or turns it off. */
let following = false;
/** Following is on but no fix has arrived yet; the first one centres and zooms in. */
let awaitingFirst = false;
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
        preferences.angles,
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
  bearing: degrees => formatBearing(degrees, preferences.angles),
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
    fieldMap.hasLog ||
    (connection.sync.state === 'ready' && nodes.length > 0);
  fieldMap.setPoints(points);
  fieldMap.select(selectedNode || undefined);
  fieldMap.setBasemap(preferences.basemap);
  const fix = currentFix(60000);
  me = fix?.lngLat ?? me;
  fieldMap.setMe(me, fix ? heading(currentFix())?.trueDegrees : undefined);
  const showDevices = element<HTMLInputElement>('map-show-devices').checked;
  const steps: TrailStep[] = showDevices
    ? nodes
        .filter(node => canonicalNode(node.node) !== canonicalNode(device ?? ''))
        .flatMap(node => trailSteps(node.trail, now))
    : [];
  fieldMap.setTrails(
    steps,
    trackLinesToDraw(),
    getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#9fd18b',
  );
  setKeepAwakeAllowed(preferences.keepAwake);
  renderTrack();
  document.querySelector<HTMLElement>('.map-view')!.dataset.basemap = preferences.basemap;
  for (const button of element('map-basemaps').querySelectorAll<HTMLButtonElement>('button')) {
    const active = button.dataset.basemap === preferences.basemap;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-checked', String(active));
  }
  const locate = element('map-locate');
  locate.classList.toggle('is-active', following);
  locate.setAttribute('aria-pressed', String(following));
  const label = following ? 'Stop following my position' : 'Follow my position';
  locate.setAttribute('aria-label', label);
  locate.title = label;
  document.querySelector<HTMLElement>('.map-view')!.classList.toggle('is-following', following);
  renderCoordinate();
  if (currentView() === 'map') {
    fieldMap.map.invalidateSize({ animate: false });
    fieldMap.frame();
  }
}

function renderCoordinate() {
  const value = formatCoordinate(fieldMap.center(), preferences.coordinates);
  const coordinate = element('map-coordinate-text');
  if (coordinate.textContent !== value) coordinate.textContent = value;
  const line = element('map-readout');
  line.hidden = !following;
  if (!following) return;
  const { text: reading, rough } = readout(currentFix());
  if (line.textContent !== reading) line.textContent = reading;
  line.classList.toggle('is-rough', rough);
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

/** Below this the direction of travel is mostly noise. About a slow walk. */
const MOVING_MS = 0.7;
/** A compass worse than this needs calibrating before its reading is worth trusting. */
const ROUGH_DEGREES = 30;

type Heading = { degrees: number; trueDegrees: number; magnetic: boolean; rough: boolean };

/**
 * Which way this computer faces or travels: the compass on a phone or tablet, otherwise the GPS
 * direction of travel while moving. `degrees` is in the user's chosen north; `trueDegrees` is for
 * the arrow on the (true north up) map.
 */
function heading(fix: Fix | undefined): Heading | undefined {
  const compass = compassReading(fix?.lngLat);
  const wantMagnetic = preferences.north === 'magnetic';
  if (compass) {
    const magnetic = wantMagnetic || !compass.trueNorth;
    return {
      degrees: wantMagnetic ? compass.magnetic : compass.heading,
      trueDegrees: compass.heading,
      magnetic,
      rough: compass.accuracy === null ? false : compass.accuracy > ROUGH_DEGREES,
    };
  }
  if (!fix || fix.speed === null || fix.speed < MOVING_MS || fix.course === null) return undefined;
  const offset = wantMagnetic ? declination(fix.lngLat[1], fix.lngLat[0], decimalYear(fix.at)) : 0;
  return {
    degrees: turnHeading(fix.course, -offset),
    trueDegrees: fix.course,
    magnetic: wantMagnetic,
    rough: false,
  };
}

/** One line while following: heading, speed and height, as in "047° NE · 42 km/h · 1,610 m". */
function readout(fix: Fix | undefined) {
  if (!fix) return { text: locationProblem() || 'Following · waiting for location', rough: false };
  const facing = heading(fix);
  const parts = [
    facing ? formatBearing(facing.degrees, preferences.angles, facing.magnetic) : undefined,
    fix.speed !== null ? formatSpeed(fix.speed, preferences.units) : undefined,
    fix.altitude !== null ? formatHeight(fix.altitude, preferences.units) : undefined,
  ].filter(Boolean);
  return {
    text: parts.length ? parts.join('  ·  ') : 'Following',
    rough: !!facing?.rough,
  };
}

function setFollowing(on: boolean) {
  following = on;
  awaitingFirst = on && !currentFix();
  fieldMap.setFollowing(on);
  keepAwake('follow', on);
  if (on) {
    wantLocation('map', true);
    void startCompass(render);
    const fix = currentFix();
    if (fix) fieldMap.followTo(fix.lngLat, true);
    else showMessage(locationProblem() || 'Waiting for a location fix.');
  } else stopCompass();
  render();
}

/** Each fix moves the dot, and the map with it while following. */
function onLocation(fix: Fix) {
  me = fix.lngLat;
  if (!following) return;
  fieldMap.followTo(fix.lngLat, awaitingFirst);
  if (awaitingFirst) {
    awaitingFirst = false;
    showMessage(undefined);
  }
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
    following = false;
    keepAwake('follow', false);
    stopCompass();
    stopLocation();
  });
  fieldMap.onUserDrag = () => setFollowing(false);
  onFix(onLocation);
  initTrack(showMessage);
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
  element('map-locate').addEventListener('click', () => setFollowing(!following));
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
