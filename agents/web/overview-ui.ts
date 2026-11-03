// Read-only overview of the selected source. Transport and recovery stay in agent-core.
import { current, messageState, mode } from './app-state.ts';
import { deliveryLabel } from './conversations.ts';
import { element, text } from './dom.ts';
import { openManage } from './settings-ui.ts';

const signatures = new Map<string, string>();
function renderRows(id: string, rows: { title: string; detail: string }[], empty: string) {
  const signature = JSON.stringify([rows, empty]);
  if (signatures.get(id) === signature) return;
  signatures.set(id, signature);
  const list = element(id);
  list.replaceChildren();
  if (!rows.length) {
    const message = document.createElement('p');
    message.className = 'overview-empty';
    message.textContent = empty;
    list.append(message);
  }
  for (const row of rows) {
    const item = document.createElement('div');
    item.className = 'overview-row';
    const title = document.createElement('strong');
    const detail = document.createElement('span');
    title.textContent = row.title;
    detail.textContent = row.detail;
    item.append(title, detail);
    list.append(item);
  }
}

export function initOverview() {
  for (const button of document.querySelectorAll<HTMLElement>('[data-settings-target]')) {
    button.addEventListener('click', () => openManage(button.dataset.settingsTarget));
  }
}

export function renderOverview() {
  const { connection, active } = current().adapter;
  const { sync, device, capabilities } = connection;
  const ready = sync.state === 'ready';
  const config = ready ? sync.config : undefined;
  const incoming = connection.inbox.history.filter(m => m.device === device);
  const outgoing = connection.messaging.history.filter(m => m.device === device);
  const nodes = connection.discovery.nodes;
  // Use the connection renderer's label, including opening and read-only states.
  text('overview-connection', element('status').textContent ?? sync.state);
  text('overview-source', mode.value === 'demo' ? 'Simulator · no radio traffic' : 'USB device');
  text('overview-nodes', ready && connection.supportsDiscovery ? nodes.length : '—');
  text(
    'overview-unread',
    device && messageState ? messageState.unread(mode.value, incoming).length : '—',
  );
  text('overview-messages', device ? incoming.length + outgoing.length : '—');
  text(
    'overview-device-name',
    config?.label || (active ? 'Device session' : 'No device connected'),
  );
  text(
    'overview-device-help',
    ready
      ? 'Configuration synchronized with this device.'
      : 'Connect over USB to see your network.',
  );
  text('overview-device', device ?? '—');
  text('overview-firmware', capabilities?.firmware ?? '—');
  text(
    'overview-radio',
    config?.radio
      ? ({ off: 'Off', receive: 'Receive only', mesh: 'Mesh' }[config.radio.mode] ?? 'Unknown')
      : '—',
  );
  text('overview-position', config?.position ? (config.position.share ? 'On' : 'Off') : '—');
  text('overview-support', element('support').textContent ?? '');
  renderRows(
    'overview-node-list',
    ready && connection.supportsDiscovery
      ? nodes.slice(0, 4).map(node => ({
          title: node.name || node.node,
          detail: `Heard ${Math.floor((node.ageMs + Math.max(0, performance.now() - node.receivedAt)) / 60000)}m ago · ${node.position ? 'Position reported' : 'No position'}`,
        }))
      : [],
    ready
      ? connection.supportsDiscovery
        ? 'No devices heard yet. Open the map to find nearby devices.'
        : 'Discovery is unavailable on this device.'
      : 'Connect a device to view discovery observations.',
  );
  renderRows(
    'overview-deliveries',
    outgoing
      .slice(-4)
      .reverse()
      .map(message => ({
        title:
          message.destination === 'broadcast'
            ? `Channel ${message.channel} · broadcast`
            : message.destination,
        detail: deliveryLabel(message),
      })),
    device
      ? 'No outgoing messages saved for this device.'
      : 'Connect a device to view its outgoing message history.',
  );
}
