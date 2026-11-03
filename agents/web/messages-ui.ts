// Conversations, the message thread, drafts, local deletion and unread state.
import { MAP_PREFIX } from '../../packages/protocol/map-item.ts';
import { DEFAULT_CHANNELS } from '../../packages/protocol/radio-config.ts';
import {
  ENCRYPTED_HEADER_BYTES,
  ENCRYPTED_TAG_BYTES,
} from '../../packages/protocol/encrypted-message.ts';
import type { SerialAdapter } from '../../packages/agent-core/serial.ts';
import { receivedKey, sentKey, messageScope, inConversation } from './message-state.ts';
import {
  conversations,
  threadMessages,
  conversationKey,
  canonicalNode,
  ConversationDrafts,
} from './conversations.ts';
import {
  app,
  clearError,
  current,
  disposeMessageState,
  encryption,
  encryptionError,
  manage,
  messageState,
  messageStateError,
  mode,
  models,
  recovery,
  render,
  setMessageStateError,
  showError,
} from './app-state.ts';
import { element, text } from './dom.ts';
import { accessDialog, onLocalAppStop } from './access-ui.ts';
import { connectDevice } from './connection-ui.ts';
import { mapWorkspace, setSelectedNode, setView } from './map-ui.ts';

const deleteDialog = element<HTMLDialogElement>('delete-history');
let deletePlan:
  | {
      source: string;
      device: string;
      connection: SerialAdapter['connection'];
      keys: string[];
      outgoing: string[];
      conversation?: { scope: string; key: string };
      clearDraft?: string;
    }
  | undefined;
let messageSignature = '';
const recentConversations = new Map<string, { destination: string; channel: number }>();
const drafts = new ConversationDrafts();
let draftKey = '';
let lastDevice: string | undefined =
  recovery.connection.messaging.history.at(-1)?.device ??
  recovery.connection.inbox.history.at(-1)?.device;
let lastScope = '';
const observedOrder = new Map<string, number>();
let nextOrder = 0;
let conversationFilter: 'all' | 'channel' | 'direct' = 'all';

/** Forces the thread to re-render on the next pass. */
export function invalidateThread() {
  messageSignature = '';
}
export function messagesModeChanged() {
  if (draftKey) drafts.save(draftKey, element<HTMLTextAreaElement>('message-body').value);
  lastDevice =
    current().adapter.connection.device ??
    current().adapter.connection.messaging.history.at(-1)?.device ??
    current().adapter.connection.inbox.history.at(-1)?.device;
  lastScope = '';
}

function requestDelete(
  keys: string[],
  outgoing: string[],
  description: string,
  conversation?: { scope: string; key: string },
) {
  const connection = current().adapter.connection;
  if (!messageState || !recovery.writable || !lastDevice) return;
  if (
    outgoing.some(id => connection.messaging.history.find(m => m.id === id)?.state === 'receiving')
  ) {
    showError('Wait for the current upload before deleting.');
    return;
  }
  deletePlan = {
    source: mode.value,
    device: lastDevice,
    connection,
    keys,
    outgoing,
    conversation,
    ...(conversation ? { clearDraft: draftKey } : {}),
  };
  text('delete-description', description);
  deleteDialog.showModal();
}

export function hexBytes(value: string) {
  if (!/^(?:[0-9a-f]{2})+$/u.test(value)) throw new Error('Saved encrypted message is malformed.');
  return Uint8Array.from(value.match(/../g)!, byte => Number.parseInt(byte, 16));
}
function encryptionLabel(state: string | undefined) {
  return (
    (
      {
        decrypted: 'Encrypted',
        'key-needed': 'Key needed',
        invalid: 'Authentication failed',
        replay: 'Duplicate suppressed',
        'plaintext-rejected': 'Plaintext rejected',
        locked: 'App locked',
        unsupported: 'Unsupported envelope',
      } as Record<string, string>
    )[state ?? ''] ?? 'Encrypted'
  );
}
export function chooseConversation(destination: string, channel = 0) {
  const kind = destination === 'broadcast' ? 'channel' : 'direct';
  if (conversationFilter !== 'all' && conversationFilter !== kind) conversationFilter = kind;
  try {
    if (lastDevice)
      messageState?.reopen(
        messageScope(mode.value, lastDevice),
        conversationKey(destination, channel),
      );
  } catch (e) {
    setMessageStateError(String(e));
  }
  if (draftKey) drafts.save(draftKey, element<HTMLTextAreaElement>('message-body').value);
  element<HTMLInputElement>('message-destination').value = destination;
  const select = element<HTMLSelectElement>('message-channel');
  if (![...select.options].some(o => o.value === String(channel)))
    select.add(new Option(`Channel ${channel}`, String(channel)));
  select.value = String(channel);
  draftKey = `${mode.value}:${lastDevice ?? ''}:${conversationKey(destination, channel)}`;
  recentConversations.set(draftKey, { destination, channel });
  while (recentConversations.size > 64)
    recentConversations.delete(recentConversations.keys().next().value!);
  element<HTMLTextAreaElement>('message-body').value = drafts.get(draftKey);
  app.classList.add('has-conversation');
  messageSignature = '';
  renderMessages();
}

export function renderMessages() {
  const { connection } = current().adapter;
  if (connection.device) lastDevice = connection.device;
  const scope = `${mode.value}:${lastDevice ?? ''}`;
  const unboundDraft =
    lastScope === `${mode.value}:` ? element<HTMLTextAreaElement>('message-body').value : '';
  if (scope !== lastScope) {
    if (draftKey) drafts.save(draftKey, element<HTMLTextAreaElement>('message-body').value);
    lastScope = scope;
    setSelectedNode('');
    element<HTMLInputElement>('message-destination').value = 'broadcast';
    element<HTMLSelectElement>('message-channel').value = '0';
    draftKey = `${scope}:0:broadcast`;
    element<HTMLTextAreaElement>('message-body').value = drafts.get(draftKey) || unboundDraft;
    messageSignature = '';
  }
  const body = element<HTMLTextAreaElement>('message-body'),
    destination = element<HTMLInputElement>('message-destination');
  const channel = element<HTMLSelectElement>('message-channel');
  const bytes = new TextEncoder().encode(body.value).length,
    ready = connection.sync.state === 'ready';
  // Complete previously persisted local removals after a reload; never replay uploads.
  if (messageState && recovery.writable)
    for (const m of connection.messaging.history) {
      if (m.state !== 'receiving' && messageState.deleted(sentKey(mode.value, m.device, m.id)))
        connection.forgetMessage(m.id);
    }
  if (messageState && recovery.writable)
    for (const m of connection.inbox.history) {
      if (messageState.deleted(receivedKey(mode.value, m)))
        connection.forgetReceived(m.device, m.origin, m.messageId);
    }
  const scroller = element('thread-scroll');
  const attended =
    document.visibilityState === 'visible' &&
    document.hasFocus() &&
    !manage.open &&
    !accessDialog.open &&
    !deleteDialog.open &&
    app.dataset.view === 'messages' &&
    (innerWidth > 720 || app.classList.contains('has-conversation')) &&
    scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80;
  const sources = (['usb', 'demo'] as const).map(source => ({
    source,
    messages: models[source].adapter.connection.inbox.history,
  }));
  try {
    messageState?.observe(
      sources,
      attended && lastDevice
        ? {
            source: mode.value,
            device: lastDevice,
            destination: destination.value,
            channel: Number(channel.value),
          }
        : undefined,
    );
    if (messageState) setMessageStateError('');
  } catch (e) {
    setMessageStateError(`Message history: ${String(e)}`);
  }
  const history = connection.messaging.history
    .filter(m => !messageState?.deleted(sentKey(mode.value, m.device, m.id)))
    .map(m => {
      if (!m.payloadHex)
        return {
          ...m,
          mapWire: m.text.startsWith(MAP_PREFIX) ? m.text : undefined,
          text: m.text.startsWith(MAP_PREFIX) ? 'Shared map item' : m.text,
        };
      const result = encryption?.decrypt(
        hexBytes(m.payloadHex),
        m.channel,
        connection.device ?? m.device,
        m.destination,
      );
      return {
        ...m,
        mapWire:
          result?.state === 'decrypted' && result.text?.startsWith(MAP_PREFIX)
            ? result.text
            : undefined,
        text: result?.text?.startsWith(MAP_PREFIX)
          ? 'Shared map item'
          : (result?.text ?? 'Encrypted message · app locked'),
        encryptionState: encryptionLabel(result?.state),
      };
    });
  const incoming = connection.inbox.history
    .filter(m => !messageState?.deleted(receivedKey(mode.value, m)))
    .map(m => {
      if (m.payloadHex) {
        const identity = `${mode.value}:${m.device}:${canonicalNode(m.origin)}:${m.messageId}`;
        const result = encryption?.decrypt(
          hexBytes(m.payloadHex),
          m.channel,
          m.origin,
          m.destination ?? 'broadcast',
          identity,
        );
        return {
          ...m,
          mapWire:
            result?.state === 'decrypted' && result.text?.startsWith(MAP_PREFIX)
              ? result.text
              : undefined,
          text: result?.text?.startsWith(MAP_PREFIX)
            ? 'Shared map item'
            : (result?.text ?? 'Encrypted message · app locked'),
          encryptionState: encryptionLabel(result?.state),
        };
      }
      if (encryption?.isRequired(m.channel))
        return {
          ...m,
          text: 'Plaintext rejected · channel requires encryption',
          encryptionState: 'Plaintext rejected',
        };
      return {
        ...m,
        mapWire: m.text.startsWith(MAP_PREFIX) ? m.text : undefined,
        text: m.text.startsWith(MAP_PREFIX) ? 'Shared map item' : m.text,
      };
    });
  const unread = messageState?.unread(mode.value, connection.inbox.history) ?? [];
  const totalUnread = sources.reduce(
    (n, source) => n + (messageState?.unread(source.source, source.messages).length ?? 0),
    0,
  );
  document.title = `${totalUnread ? `(${totalUnread}) ` : ''}Reaper Mesh`;
  text('nav-unread', totalUnread);
  element('nav-unread').hidden = totalUnread === 0;
  element<HTMLButtonElement>('mark-all-read').disabled =
    !unread.length || !recovery.writable || !messageState;
  const threadUnread = lastDevice
    ? unread.filter(m => inConversation(m, lastDevice!, destination.value, Number(channel.value)))
        .length
    : 0;
  text('jump-new-messages', `${threadUnread} new ${threadUnread === 1 ? 'message' : 'messages'} ↓`);
  element('jump-new-messages').hidden = !threadUnread;
  text('message-management-status', messageStateError);
  element('message-management-status').hidden = !messageStateError;
  const uploading = history.some(entry => entry.state === 'receiving');
  // Read-only rather than disabled, so the box keeps focus while the device takes the message.
  body.readOnly = uploading;
  destination.disabled = channel.disabled = uploading;
  const selectedChannel = Number(channel.value),
    encryptedRequired = encryption?.isRequired(selectedChannel) ?? false;
  const maxBytes = encryptedRequired ? 1024 - ENCRYPTED_HEADER_BYTES - ENCRYPTED_TAG_BYTES : 1024;
  text('message-bytes', `${bytes} / ${maxBytes} bytes`);
  const names = (connection.sync.config?.radio?.channels ?? DEFAULT_CHANNELS).split('|');
  if (channel.dataset.names !== JSON.stringify(names)) {
    const selected = channel.value;
    channel.replaceChildren();
    names.forEach((name, slot) => {
      if (name) channel.add(new Option(name, String(slot)));
    });
    if ([...channel.options].some(o => o.value === selected)) channel.value = selected;
    channel.dataset.names = JSON.stringify(names);
  }
  const key = conversationKey(destination.value, selectedChannel);
  const sendBlockReason = connection.messaging.sendBlockReason;
  const remoteBlocked =
    destination.value !== connection.device &&
    connection.capabilities?.radioVersion === 1 &&
    connection.radioInfo?.reason !== 'ready';
  text(
    'message-support',
    encryptionError ||
      (encryptedRequired && !encryption?.unlocked
        ? 'Encryption required · unlock the app before sending'
        : !ready
          ? 'Connect a device to send · your draft stays here'
          : (connection.messageBlockReason ??
            (uploading
              ? 'Uploading message…'
              : sendBlockReason
                ? sendBlockReason
                : remoteBlocked
                  ? 'Radio unavailable · check Settings → Radio'
                  : encryptedRequired
                    ? destination.value === 'broadcast'
                      ? 'Encrypted channel · device ACK confirms ciphertext delivery only'
                      : "Encrypted with the channel key · anyone with this channel's key can read this direct message"
                    : destination.value === 'broadcast'
                      ? 'Broadcast · no recipient ACK'
                      : 'Destination ACK confirms delivery, not reading'))),
  );
  element<HTMLButtonElement>('message-send').disabled =
    !ready ||
    !!encryptionError ||
    (encryptedRequired && !encryption?.unlocked) ||
    !!connection.messageBlockReason ||
    uploading ||
    !destination.value.trim() ||
    !bytes ||
    bytes > maxBytes ||
    !!sendBlockReason ||
    remoteBlocked;
  const uiScope = messageScope(mode.value, lastDevice ?? '');
  const visibleThread = (row: { key: string; destination: string; channel: number }) =>
    !messageState?.hidden(uiScope, row.key) ||
    !!threadMessages(lastDevice, row.destination, row.channel, history, incoming).length;
  const rows = conversations(
    lastDevice,
    names,
    connection.discovery.nodes,
    history,
    incoming,
  ).filter(visibleThread);
  if (
    !rows.some(row => row.key === key) &&
    destination.value.trim() &&
    !messageState?.hidden(uiScope, key)
  )
    rows.push({
      key,
      destination: destination.value,
      channel: selectedChannel,
      name: destination.value,
      preview: 'New conversation',
      kind: destination.value === 'broadcast' ? 'channel' : 'direct',
    });
  for (const [savedKey, target] of recentConversations) {
    const draft = drafts.get(savedKey);
    if (
      savedKey.startsWith(scope + ':') &&
      draft &&
      !rows.some(row => row.key === conversationKey(target.destination, target.channel))
    )
      rows.push({
        key: conversationKey(target.destination, target.channel),
        ...target,
        name: target.destination,
        preview: `Draft: ${draft}`,
        kind: target.destination === 'broadcast' ? 'channel' : 'direct',
      });
  }
  for (let i = 0; i < rows.length; i++) {
    const draft = drafts.get(`${scope}:${rows[i].key}`);
    if (draft) rows[i] = { ...rows[i], preview: `Draft: ${draft}` };
  }
  const currentRow = rows.find(row => row.key === key);
  text('conversation-title', currentRow?.name ?? (destination.value || 'New conversation'));
  text(
    'conversation-avatar',
    destination.value === 'broadcast'
      ? '#'
      : (currentRow?.name ?? destination.value).slice(0, 2).toUpperCase(),
  );
  text(
    'conversation-subtitle',
    destination.value === 'broadcast'
      ? `${names[selectedChannel] || 'Channel ' + selectedChannel} · traffic received by this device`
      : `${destination.value} · ${names[selectedChannel] || 'Channel ' + selectedChannel}`,
  );
  element('conversation-connect').hidden = ready;
  const filter = element<HTMLInputElement>('conversation-search').value.trim().toLowerCase();
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-conversation-filter]')) {
    const selected = button.dataset.conversationFilter === conversationFilter;
    button.classList.toggle('is-active', selected);
    button.setAttribute('aria-pressed', String(selected));
    const kind = button.dataset.conversationFilter!;
    const count = rows
      .filter(row => kind === 'all' || row.kind === kind)
      .reduce(
        (sum, row) =>
          sum +
          (lastDevice
            ? unread.filter(m => inConversation(m, lastDevice!, row.destination, row.channel))
                .length
            : 0),
        0,
      );
    const badge = element(`filter-unread-${kind}`);
    badge.textContent = String(count);
    badge.hidden = !count;
    badge.setAttribute('aria-label', `${count} unread messages`);
  }
  const listSignature =
    JSON.stringify(rows) + key + filter + conversationFilter + JSON.stringify(unread);
  const channelList = element('channel-list'),
    directList = element('direct-list');
  if (channelList.dataset.signature !== listSignature) {
    channelList.dataset.signature = directList.dataset.signature = listSignature;
    channelList.replaceChildren();
    directList.replaceChildren();
    const visible = rows.filter(
      row =>
        (conversationFilter === 'all' || row.kind === conversationFilter) &&
        `${row.name} ${row.destination} ${names[row.channel] ?? ''}`.toLowerCase().includes(filter),
    );
    const hasChannels = visible.some(row => row.kind === 'channel'),
      hasDirect = visible.some(row => row.kind === 'direct');
    element('channel-list-heading').hidden = !hasChannels || conversationFilter !== 'all';
    element('direct-list-heading').hidden = !hasDirect || conversationFilter !== 'all';
    text(
      'conversation-search-empty',
      filter
        ? 'No matching conversations. Try another name, channel or node ID.'
        : conversationFilter === 'direct'
          ? 'No direct conversations yet. Find a device in Map or use + to start one.'
          : 'No conversations to show.',
    );
    element('conversation-search-empty').hidden = visible.length !== 0;
    const renderRow = (row: (typeof rows)[number], list: HTMLElement) => {
      const button = document.createElement('button');
      button.className = 'conversation-row';
      button.classList.toggle('is-selected', row.key === key);
      button.setAttribute('aria-pressed', String(row.key === key));
      const avatar = document.createElement('span');
      avatar.className = 'avatar';
      avatar.textContent = row.kind === 'channel' ? '#' : row.name.slice(0, 2).toUpperCase();
      const content = document.createElement('span');
      content.className = 'conversation-summary';
      const name = document.createElement('strong');
      name.textContent = row.name;
      name.title = row.name;
      const preview = document.createElement('span');
      preview.textContent =
        row.kind === 'direct'
          ? `${names[row.channel] || `Channel ${row.channel}`} · ${row.preview}`
          : row.preview;
      content.append(name, preview);
      const badge = document.createElement('span');
      badge.className = 'thread-kind';
      const count = lastDevice
        ? unread.filter(m => inConversation(m, lastDevice!, row.destination, row.channel)).length
        : 0;
      badge.textContent = String(count);
      badge.hidden = count === 0;
      badge.classList.toggle('unread-badge', count > 0);
      if (count)
        badge.setAttribute('aria-label', `${count} unread ${count === 1 ? 'message' : 'messages'}`);
      button.append(avatar, content, badge);
      button.addEventListener('click', () => chooseConversation(row.destination, row.channel));
      list.append(button);
    };
    for (const row of visible) renderRow(row, row.kind === 'channel' ? channelList : directList);
  }
  const messages = threadMessages(
    lastDevice,
    destination.value,
    selectedChannel,
    history,
    incoming,
  );
  element<HTMLButtonElement>('clear-conversation').disabled =
    !messageState ||
    !recovery.writable ||
    !lastDevice ||
    messages.length === 0 ||
    messages.some(m => m.entry?.state === 'receiving');
  const orderScope = scope + ':';
  for (const m of messages)
    if (!observedOrder.has(orderScope + m.key)) observedOrder.set(orderScope + m.key, ++nextOrder);
  while (observedOrder.size > 256) observedOrder.delete(observedOrder.keys().next().value!);
  messages.sort(
    (a, b) => observedOrder.get(orderScope + a.key)! - observedOrder.get(orderScope + b.key)!,
  );
  const signature = scope + key + ready + JSON.stringify(messages) + mapWorkspace.messageVersion;
  element('conversation-empty').hidden = messages.length > 0;
  if (signature === messageSignature) return;
  messageSignature = signature;
  const stick = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80;
  const thread = element('message-history');
  thread.replaceChildren();
  for (const m of messages) {
    const row = document.createElement('li');
    row.className = `message-row ${m.direction}`;
    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';
    if (m.direction === 'incoming') {
      const sender = document.createElement('span');
      sender.className = 'message-sender';
      sender.textContent =
        connection.discovery.nodes.find(n => canonicalNode(n.node) === canonicalNode(m.origin))
          ?.name || m.origin;
      bubble.append(sender);
    }
    const content = document.createElement('p');
    content.className = 'message-text';
    content.textContent = m.text;
    const status = document.createElement('span');
    status.className = 'message-state';
    status.textContent = m.status;
    status.dataset.state = m.entry?.state ?? 'received';
    const mapCard = m.mapWire
      ? mapWorkspace.messageCard(
          m.mapWire,
          m.received
            ? {
                origin: canonicalNode(m.received.origin),
                channel: m.received.channel,
                destination: m.received.destination ?? 'broadcast',
                ...(m.received.payloadHex
                  ? { ciphertext: m.received.payloadHex }
                  : { text: m.mapWire }),
              }
            : undefined,
        )
      : undefined;
    bubble.append(mapCard ?? content, status);
    const remove = document.createElement('button');
    remove.className = 'message-delete';
    remove.textContent = 'Delete';
    remove.setAttribute(
      'aria-label',
      `Delete ${m.direction === 'incoming' ? 'received' : 'sent'} message`,
    );
    remove.disabled = !messageState || !recovery.writable || m.entry?.state === 'receiving';
    remove.addEventListener('click', () =>
      requestDelete(
        [
          m.received
            ? receivedKey(mode.value, m.received)
            : sentKey(mode.value, lastDevice!, m.entry!.id),
        ],
        m.entry ? [m.entry.id] : [],
        'Delete this message from local history? It will also disappear from other local views of the same message.',
      ),
    );
    bubble.append(remove);
    row.append(bubble);
    thread.append(row);
  }
  if (stick)
    requestAnimationFrame(() => {
      scroller.scrollTop = scroller.scrollHeight;
    });
}

export function renderInbox() {
  const connection = current().adapter.connection;
  text(
    'inbox-status',
    connection.inbox.error ??
      (connection.inbox.gap
        ? 'Earlier messages are no longer retained on the device.'
        : connection.sync.state !== 'ready'
          ? 'History stays available while disconnected.'
          : 'Device history · received does not mean read'),
  );
}

export function initMessages() {
  onLocalAppStop(() => {
    disposeMessageState();
    deletePlan = undefined;
    recentConversations.clear();
  });
  deleteDialog.addEventListener('close', () => {
    const plan = deletePlan;
    deletePlan = undefined;
    if (deleteDialog.returnValue !== 'delete' || !plan) return;
    try {
      if (
        mode.value !== plan.source ||
        lastDevice !== plan.device ||
        current().adapter.connection !== plan.connection
      )
        throw Error('The device changed. Select the conversation again before deleting.');
      if (
        plan.outgoing.some(
          id => plan.connection.messaging.history.find(m => m.id === id)?.state === 'receiving',
        )
      )
        throw Error('Wait for the current upload before deleting.');
      messageState!.remove(plan.keys, plan.conversation);
      for (const message of plan.connection.inbox.history)
        if (plan.keys.includes(receivedKey(plan.source, message)))
          plan.connection.forgetReceived(message.device, message.origin, message.messageId);
      for (const id of plan.outgoing)
        if (plan.connection.messaging.history.some(m => m.id === id))
          plan.connection.forgetMessage(id);
      if (plan.conversation) {
        if (plan.clearDraft) {
          drafts.save(plan.clearDraft, '');
          recentConversations.delete(plan.clearDraft);
        }
        element<HTMLTextAreaElement>('message-body').value = '';
        app.classList.remove('has-conversation');
      }
      messageSignature = '';
      clearError();
      render();
    } catch (e) {
      showError(e);
    }
  });
  element('back-conversations').addEventListener('click', () =>
    app.classList.remove('has-conversation'),
  );
  element('conversation-connect').addEventListener('click', () => void connectDevice());
  element('conversation-search').addEventListener('input', renderMessages);
  document.addEventListener('map-message-change', renderMessages);
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-conversation-filter]')) {
    button.addEventListener('click', () => {
      conversationFilter = button.dataset.conversationFilter as typeof conversationFilter;
      element('conversation-results').scrollTop = 0;
      renderMessages();
    });
  }
  const options = element<HTMLButtonElement>('conversation-options'),
    menu = element('conversation-options-menu');
  const showMenu = (open: boolean) => {
    menu.hidden = !open;
    options.setAttribute('aria-expanded', String(open));
  };
  options.addEventListener('click', () => {
    const open = options.getAttribute('aria-expanded') !== 'true';
    showMenu(open);
    if (open) menu.querySelector<HTMLButtonElement>('button:enabled')?.focus();
  });
  document.addEventListener('click', event => {
    if (!menu.hidden && !(event.target as Element).closest('.conversation-menu')) showMenu(false);
  });
  options.parentElement!.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || menu.hidden) return;
    showMenu(false);
    options.focus();
  });
  element('clear-conversation').addEventListener('click', () => {
    showMenu(false);
    if (!lastDevice) return;
    const connection = current().adapter.connection,
      destination = element<HTMLInputElement>('message-destination').value,
      channel = Number(element<HTMLSelectElement>('message-channel').value);
    const messages = threadMessages(
      lastDevice,
      destination,
      channel,
      connection.messaging.history,
      connection.inbox.history,
    );
    const keys = messages.map(m =>
      m.received
        ? receivedKey(mode.value, m.received)
        : sentKey(mode.value, lastDevice!, m.entry!.id),
    );
    requestDelete(
      keys,
      messages.flatMap(m => (m.entry ? [m.entry.id] : [])),
      `Clear the ${messages.length} messages in this chat from this browser? The chat stays in your list.`,
    );
  });
  element('mark-all-read').addEventListener('click', () => {
    try {
      messageState?.markRead(mode.value, current().adapter.connection.inbox.history);
      render();
    } catch (e) {
      showError(e);
    }
  });
  element('jump-new-messages').addEventListener('click', () => {
    const node = element('thread-scroll');
    node.scrollTop = node.scrollHeight;
    render();
  });
  element('message-body').addEventListener('input', () => {
    drafts.save(draftKey, element<HTMLTextAreaElement>('message-body').value);
    renderMessages();
  });
  element('message-body').addEventListener('keydown', event => {
    const e = event as KeyboardEvent;
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      if (!element<HTMLButtonElement>('message-send').disabled)
        element<HTMLFormElement>('message-form').requestSubmit();
    }
  });
  element('message-form').addEventListener('submit', event => {
    event.preventDefault();
    try {
      const body = element<HTMLTextAreaElement>('message-body').value;
      const destination = element<HTMLInputElement>('message-destination').value,
        channel = Number(element<HTMLSelectElement>('message-channel').value);
      if (encryptionError) throw new Error(encryptionError);
      if (encryption?.isRequired(channel))
        current().adapter.sendMessagePayload(
          encryption.encrypt(body, channel, current().adapter.connection.device!, destination),
          destination,
          channel,
        );
      else current().adapter.sendMessage(body, destination, channel);
      element<HTMLTextAreaElement>('message-body').value = '';
      drafts.save(draftKey, '');
      clearError();
      render();
    } catch (e) {
      showError(e);
    }
  });
}
