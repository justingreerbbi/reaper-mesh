// The Nodes tab: everyone heard, when, how far, and discovery.
import { current, nodeCache, preferences, showError, clearError, render } from './app-state.ts';
import { element, text } from './dom.ts';
import { STALE_NODE_MS, type CachedNode } from './node-cache.ts';
import { bearingDegrees, distanceMeters, formatAgo, formatBearing, formatDistance } from './geo.ts';
import { selectNode, selectedNodeId, setSelectedNode, distanceOrigin } from './map-ui.ts';
import { icon } from './ui.ts';
import { lastDeviceId, shortNode } from './messages-ui.ts';

const DISCOVERY_TEXT: Record<string, string> = {
  collecting: 'Listening for replies',
  complete: 'Discovery finished',
  cooldown: 'Wait a moment. The device limits how often it can ask',
  busy: 'The radio is busy. Try again shortly',
  blocked: 'The radio cannot transmit right now',
  failed: 'Discovery failed',
  rejected: 'The device refused the request',
  'owner-capacity': 'The device has too many connected apps this boot',
  unknown: 'Discovery result unknown',
};

let signature = '';

function nodeCard(node: CachedNode, range: string | undefined, now: number) {
  const row = document.createElement('li');
  row.className = 'card node-card';
  const stale = now - node.heardAt > STALE_NODE_MS;

  const head = document.createElement('div');
  head.className = 'node-card-head';
  const dot = document.createElement('span');
  dot.className = 'status-dot';
  dot.dataset.tone = stale ? 'muted' : 'good';
  const name = document.createElement('strong');
  name.textContent = node.name || `Node ${shortNode(node.node)}`;
  const id = document.createElement('small');
  id.className = 'faint';
  id.textContent = shortNode(node.node);
  head.append(dot, name, id);

  const heard = document.createElement('small');
  heard.className = 'muted';
  heard.textContent = `Heard ${formatAgo(node.heardAt, now)}${stale ? ', may have moved' : ''}`;
  const where = document.createElement('small');
  where.className = 'muted';
  where.textContent = node.position ? (range ?? 'Position reported') : 'No position reported';

  const actions = document.createElement('div');
  actions.className = 'node-card-actions';
  const message = document.createElement('button');
  message.type = 'button';
  message.className = 'compact';
  message.append(icon('message-square'), 'Message');
  message.addEventListener('click', () => selectNode(node.node, { message: true }));
  const locate = document.createElement('button');
  locate.type = 'button';
  locate.className = 'round compact';
  locate.disabled = !node.position;
  locate.setAttribute('aria-label', node.position ? 'Show on map' : 'No position to show');
  locate.title = locate.getAttribute('aria-label')!;
  locate.append(icon(node.position ? 'map-pin' : 'map-pin-off'));
  locate.addEventListener('click', () => selectNode(node.node, { focusMap: true }));
  const title = node.name || `Node ${shortNode(node.node)}`;
  const forget = document.createElement('button');
  forget.type = 'button';
  forget.className = 'round compact';
  forget.setAttribute('aria-label', `Forget ${title}`);
  forget.title = 'Forget until heard again';
  forget.append(icon('trash-2'));
  forget.addEventListener('click', () => {
    nodeCache.forget(node.node, current().adapter.connection.discovery.nodes);
    if (selectedNodeId() === node.node) setSelectedNode('');
    render();
  });
  actions.append(message, locate, forget);

  row.append(head, heard, where, actions);
  return row;
}

export function renderNodes() {
  const model = current();
  const { connection } = model.adapter;
  const { sync } = connection;
  const device = lastDeviceId();
  if (device && connection.device === device)
    nodeCache.sync(device, connection.discovery.nodes, Date.now());
  else nodeCache.use(device);

  const supported = connection.supportsDiscovery;
  const ready = supported && sync.state === 'ready';
  const writable = ready && !connection.writeBlockReason && !!sync.config?.discovery;
  const result = connection.discovery.last;
  const collecting = result?.state === 'collecting';
  const discover = element<HTMLButtonElement>('discover');
  discover.disabled = !writable || connection.radioInfo?.reason !== 'ready' || collecting;
  text('discover-label', collecting ? 'Listening' : 'Discover');
  discover.hidden = sync.state === 'ready' && !supported;
  element('discovery-query').hidden = !ready || result?.state !== 'unknown';
  const nodes = nodeCache.nodes;
  text(
    'discovery-result',
    connection.discovery.error ??
      (result
        ? `${DISCOVERY_TEXT[result.state] ?? result.state}${
            result.state === 'complete'
              ? `: ${result.replies} ${result.replies === 1 ? 'reply' : 'replies'}`
              : ''
          }`
        : nodes.length
          ? ''
          : 'A node stays silent unless it is set to reply, so an empty list does not mean nobody is there.'),
  );
  const support = element('discovery-support');
  support.hidden = !(ready && connection.writeBlockReason);
  support.textContent = connection.writeBlockReason ?? '';

  element('nodes-empty').hidden = nodes.length > 0;
  text(
    'nodes-empty',
    sync.state === 'ready' && !supported
      ? 'No nodes heard yet.'
      : 'No nodes heard yet. Press Discover to ask who is in range.',
  );
  const now = Date.now();
  const origin = distanceOrigin();
  const ranges = nodes.map(node =>
    node.position && origin
      ? `${formatDistance(
          distanceMeters(origin, [node.position.longitude, node.position.latitude]),
          preferences.units,
        )} · ${formatBearing(
          bearingDegrees(origin, [node.position.longitude, node.position.latitude]),
        )}`
      : undefined,
  );
  // Ages only need redrawing every few seconds, which also keeps a press from landing on a redraw.
  const next = JSON.stringify([nodes, ranges, Math.floor(now / 5000)]);
  if (next === signature) return;
  signature = next;
  element('nodes').replaceChildren(...nodes.map((node, i) => nodeCard(node, ranges[i], now)));
}

export function initNodes() {
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
