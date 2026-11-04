// Map workspace, node selection and navigation between the portal workspaces.
import {
  DEFAULT_CHANNEL_IDS,
  DEFAULT_CHANNELS,
  channelList,
} from '../../packages/protocol/radio-config.ts';
import { degrees } from '../../packages/protocol/position-config.ts';
import { MapWorkspace } from './map-workspace.ts';
import { FieldMap, type MapPoint } from './map.ts';
import { canonicalNode } from './conversations.ts';
import { app, current, encryption, encryptionError, mode, recovery, render } from './app-state.ts';
import { element, text } from './dom.ts';
import { isAppStopped } from './access-ui.ts';
import { chooseConversation, hexBytes } from './messages-ui.ts';
import { openManage } from './settings-ui.ts';

let selectedNode = '';
export const selectedNodeId = () => selectedNode;
export function setSelectedNode(id: string) {
  selectedNode = id;
}
export const fieldMap = new FieldMap(element('map'));
export const mapWorkspace = new MapWorkspace(fieldMap, {
  openMap: () => setView('map'),
  writable: () => recovery.writable && !isAppStopped(),
  stopped: () => isAppStopped() || app.inert,
  context: () => {
    const c = current().adapter.connection;
    return {
      channels: channelList({
        channels: c.sync.config?.radio?.channels ?? DEFAULT_CHANNELS,
        channelIds: c.sync.config?.radio?.channelIds ?? DEFAULT_CHANNEL_IDS,
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
});

export type Panel = 'device' | 'nodes' | 'messages';
export function setPanelOpen(_open: boolean) {
  fieldMap.invalidate();
}
export function setView(view: 'overview' | 'map' | Panel) {
  if (view === 'device') {
    openManage('device');
    return;
  }
  app.dataset.view = view === 'nodes' ? 'map' : view;
  text(
    'workspace-title',
    app.dataset.view === 'overview'
      ? 'Overview'
      : app.dataset.view === 'map'
        ? 'Map & devices'
        : 'Messages',
  );
  for (const button of document.querySelectorAll<HTMLElement>('.nav-rail [data-view-target]')) {
    const active = button.dataset.viewTarget === app.dataset.view;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-current', active ? 'page' : 'false');
  }
  fieldMap.invalidate();
}
function setDock(panel: Panel) {
  setView(panel);
}

export function selectNode(id: string, options: { message?: boolean; focusMap?: boolean } = {}) {
  selectedNode = id;
  if (options.message) {
    chooseConversation(id);
    setView('messages');
    element('message-body').focus();
  } else {
    setView('map');
    if (options.focusMap) fieldMap.focus(id);
    else fieldMap.select(id);
  }
  render();
}

export function renderMap() {
  const selected = current().adapter.connection.discovery.nodes.find(n => n.node === selectedNode);
  element('selected-asset').hidden = !selected;
  if (selected) {
    text('asset-name', selected.name || selected.node);
    text(
      'asset-detail',
      selected.position
        ? `${selected.node} · fixed ${degrees(selected.position.latitude, 90)}, ${degrees(selected.position.longitude, 180)}`
        : `${selected.node} · no reported position`,
    );
  }

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
    if (!node.position || canonicalNode(node.node) === canonicalNode(connection.device ?? ''))
      continue;
    points.push({
      id: node.node,
      name: node.name || node.node,
      latitude: Number(degrees(node.position.latitude, 90)),
      longitude: Number(degrees(node.position.longitude, 180)),
      kind: 'peer',
      detail: `Heard ${Math.floor((node.ageMs + Math.max(0, performance.now() - node.receivedAt)) / 1000)}s ago · fixed`,
    });
  }
  element('map-empty').hidden = points.length > 0 || mapWorkspace.hasItems;
  text(
    'map-caption',
    points.length
      ? `${points.length} device positions`
      : mapWorkspace.hasItems
        ? 'Saved map items'
        : 'No shared positions',
  );
  fieldMap.setPoints(points);
  fieldMap.select(selectedNode || undefined);
}

export function initMap() {
  fieldMap.onSelect = id => {
    selectedNode = id ?? '';
    render();
  };
  for (const button of document.querySelectorAll<HTMLElement>('[data-view-target]')) {
    button.addEventListener('click', () =>
      setView(button.dataset.viewTarget as 'overview' | 'map' | Panel),
    );
  }
  for (const tab of document.querySelectorAll<HTMLElement>('.dock-tab')) {
    tab.addEventListener('click', () => {
      setDock(tab.dataset.dock as Panel);
      setPanelOpen(true);
    });
  }
  element('fit-map').addEventListener('click', () => fieldMap.fit());
  element('asset-message').addEventListener('click', () => {
    if (selectedNode) selectNode(selectedNode, { message: true });
  });
  window.addEventListener('resize', () => fieldMap.invalidate());
  setView('overview');
}
