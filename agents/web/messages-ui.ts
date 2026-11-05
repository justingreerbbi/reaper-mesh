// Conversations, the message thread, drafts, local deletion and unread state.
import { MAP_PREFIX } from '../../packages/protocol/map-item.ts';
import {
  DEFAULT_CHANNEL_IDS,
  DEFAULT_CHANNELS,
  channelList as deviceChannels,
} from '../../packages/protocol/radio-config.ts';
import {
  ENCRYPTED_HEADER_BYTES,
  ENCRYPTED_TAG_BYTES,
} from '../../packages/protocol/encrypted-message.ts';
import type { SerialAdapter } from '../../packages/agent-core/serial.ts';
import {
  channelIdentities,
  hasEncryptedTraffic,
  hexBytes,
  receivedKey,
  sentKey,
  messageScope,
  inConversation,
} from './message-state.ts';
import {
  canDeleteConversation,
  conversations,
  threadMessages,
  conversationKey,
  canonicalNode,
  ConversationDrafts,
  channelLabel,
  deliveryOf,
  type Conversation,
  type Outgoing,
} from './conversations.ts';
import {
  app,
  clearError,
  current,
  currentError,
  disposeMessageState,
  encryption,
  encryptionError,
  knownConfig,
  messageState,
  messageStateError,
  mode,
  models,
  nodeCache,
  recovery,
  render,
  setMessageStateError,
  showError,
} from './app-state.ts';
import { element, text } from './dom.ts';
import { accessDialog, onLocalAppStop } from './access-ui.ts';
import { channelBlockReason, openChannel, removeChannelFromDevice } from './channels-ui.ts';
import { mapWorkspace, selectNode, setSelectedNode } from './map-ui.ts';
import { currentView } from './nav.ts';
import { confirmSheet, icon } from './ui.ts';

const deleteDialog = element<HTMLDialogElement>('delete-history');
const linkLost = () => !!document.querySelector('#link-banner:not([hidden])');
/** Grows the message box with what's typed, up to the limit in the stylesheet. */
function autosizeComposer() {
  const box = element<HTMLTextAreaElement>('message-body');
  box.addEventListener('input', () => {
    box.style.height = 'auto';
    box.style.height = `${box.scrollHeight}px`;
  });
}
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
let conversationRows: Conversation[] = [];
/** Sent messages with their delivery details open. */
const openDelivery = new Set<string>();
let armedPhrase: string | undefined;
let armTimer: ReturnType<typeof setTimeout> | undefined;
let connectAction = () => {};
/** The last failed send. It belongs to its conversation, so it goes when another is opened. */
let sendError = '';

/** Brevity phrases for gloved hands. Tapping arms one; a second tap sends it. */
const QUICK_PHRASES = ['Copy', 'Moving', 'Holding', 'At rally', 'Need assist', 'All clear'];
const ARM_MS = 3000;

/** Why an encrypted message can't be shown. Its text is never displayed unless it authenticated. */
const CRYPTO_NOTES: Record<string, string> = {
  'key-needed': "Encrypted message. This browser doesn't have the key.",
  invalid: 'Encrypted message that failed its security check. Not shown.',
  replay: 'Duplicate of an earlier encrypted message. Not shown.',
  unsupported: "In a format this app doesn't support. Not shown.",
  'plaintext-rejected': 'Unencrypted message rejected. This channel requires encryption.',
  locked: 'Encrypted message. Unlock the app to read it.',
};

export function setConnectAction(action: () => void) {
  connectAction = action;
}
export const lastDeviceId = () => lastDevice;
/** The conversations on show, for choosing where to share something. */
export const shareTargets = () => conversationRows;
export function shortNode(node: string) {
  const match = /^node-[0-9a-f]{12}([0-9a-f]{4})$/.exec(node);
  return match ? match[1].toUpperCase() : node;
}
const nodeLabel = (name: string | undefined, node: string) => name || `Node ${shortNode(node)}`;

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
    ...(conversation ? { clearDraft: `${mode.value}:${lastDevice}:${conversation.key}` } : {}),
  };
  text('delete-description', description);
  deleteDialog.showModal();
}

const DELIVERY_ICONS = {
  pending: 'circle-dashed',
  sent: 'circle-check',
  done: 'check-check',
  failed: 'circle-alert',
  unknown: 'circle-help',
};
function deliveryIcon(m: Outgoing) {
  const delivery = deliveryOf(m);
  const svg = icon(DELIVERY_ICONS[delivery.icon], {
    label: delivery.label,
    className: 'delivery-icon',
  });
  svg.dataset.tone = delivery.tone;
  return svg;
}
function messageTime(at: number) {
  const date = new Date(at);
  const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return date.toDateString() === new Date().toDateString()
    ? time
    : `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`;
}

/** Local identities of a thread's retained messages on the current device. */
function threadIdentities(destination: string, channel: number) {
  const connection = current().adapter.connection;
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
  return { messages, keys, outgoing: messages.flatMap(m => (m.entry ? [m.entry.id] : [])) };
}
function forgetMessages(
  connection: SerialAdapter['connection'],
  source: string,
  keys: string[],
  outgoing: string[],
  conversation?: { scope: string; key: string },
) {
  messageState!.remove(keys, conversation);
  for (const message of connection.inbox.history)
    if (keys.includes(receivedKey(source, message)))
      connection.forgetReceived(message.device, message.origin, message.messageId);
  for (const id of outgoing)
    if (connection.messaging.history.some(m => m.id === id)) connection.forgetMessage(id);
}
/** Back to the list with Public behind it, instead of opening some other conversation. */
function leaveConversation() {
  element<HTMLTextAreaElement>('message-body').value = '';
  chooseConversation('broadcast', 0);
  app.classList.remove('has-conversation');
}

/** Deletes one sent message's record. It may still go out: this only removes it from here. */
function deleteSent(entry: Outgoing) {
  try {
    forgetMessages(
      current().adapter.connection,
      mode.value,
      [sentKey(mode.value, entry.device, entry.id)],
      [entry.id],
    );
    openDelivery.delete(entry.id);
    messageSignature = '';
    clearError();
    render();
  } catch (e) {
    showError(e);
  }
}

/**
 * A channel lives on the device, so it is removed there first and nothing changes here unless the
 * device commits. Its key stays, so it can be rejoined. Its other messages stop waiting to send.
 */
async function deleteChannel(row: Conversation) {
  const connection = current().adapter.connection,
    source = mode.value,
    device = lastDevice;
  if (!messageState || !recovery.writable || !device)
    throw Error('This tab cannot change message history.');
  const identities = () =>
    channelIdentities(
      source,
      device,
      row.channel,
      connection.messaging.history,
      connection.inbox.history,
    );
  if (identities().uploading) throw Error('Wait for the current upload before deleting.');
  await removeChannelFromDevice(row.channel);
  const { keys, outgoing } = identities();
  forgetMessages(connection, source, keys, outgoing);
  for (const [savedKey, target] of recentConversations)
    if (target.channel === row.channel) {
      drafts.save(savedKey, '');
      recentConversations.delete(savedKey);
    }
  if (Number(element<HTMLSelectElement>('message-channel').value) === row.channel)
    leaveConversation();
  messageSignature = '';
  clearError();
  render();
}

function askDelete(row: Conversation) {
  if (row.kind === 'channel') {
    const key = encryption?.hasKey(row.channel)
      ? ' Its key stays in this browser, so you can rejoin later.'
      : '';
    void confirmSheet({
      title: `Delete ${row.name}?`,
      body: `Removes this channel from your device, which stops any of its messages waiting to send, and deletes its messages from this browser. Other people keep their copies.${key}`,
      confirm: 'Delete',
      danger: true,
      blocked: channelBlockReason(),
      run: () => deleteChannel(row),
    });
    return;
  }
  const { keys, outgoing } = threadIdentities(row.destination, row.channel);
  requestDelete(
    keys,
    outgoing,
    `Deletes the conversation with ${row.name} from this browser only. It comes back if ${row.name} messages you.`,
    { scope: messageScope(mode.value, lastDevice!), key: row.key },
  );
}

export function publicHistoryCount() {
  return threadIdentities('broadcast', 0).keys.filter(key => !messageState?.deleted(key)).length;
}
/**
 * Checks that the Public chat can be cleared and returns the step that clears it, so a caller
 * can do its other work only once clearing cannot be refused.
 */
export function preparePublicClear() {
  const { messages, keys, outgoing } = threadIdentities('broadcast', 0);
  if (keys.length && (!messageState || !recovery.writable))
    throw Error('This tab cannot change message history.');
  if (messages.some(m => m.entry?.state === 'receiving'))
    throw Error('Wait for the current upload before resetting Public.');
  const connection = current().adapter.connection,
    source = mode.value;
  return () => {
    if (keys.length) forgetMessages(connection, source, keys, outgoing);
    messageSignature = '';
  };
}

export function chooseConversation(destination: string, channel = 0) {
  const kind = destination === 'broadcast' ? 'channel' : 'direct';
  if (sendError && currentError() === sendError) clearError();
  sendError = '';
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
    !accessDialog.open &&
    !deleteDialog.open &&
    currentView() === 'comms' &&
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
    if (lastDevice) messageState?.observeSent(mode.value, lastDevice, connection.messaging.history);
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
          : result?.state === 'decrypted'
            ? result.text
            : 'Encrypted message',
        encryptionState: result?.state ?? 'locked',
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
            : result?.state === 'decrypted'
              ? result.text
              : 'Encrypted message',
          encryptionState: result?.state ?? 'locked',
        };
      }
      if (encryption?.isRequired(m.channel))
        return {
          ...m,
          text: 'Unencrypted message rejected',
          encryptionState: 'plaintext-rejected',
        };
      return {
        ...m,
        mapWire: m.text.startsWith(MAP_PREFIX) ? m.text : undefined,
        text: m.text.startsWith(MAP_PREFIX) ? 'Shared map item' : m.text,
      };
    });
  const knownRadio = knownConfig()?.radio;
  const names = deviceChannels({
    channels: knownRadio?.channels ?? DEFAULT_CHANNELS,
    channelIds: knownRadio?.channelIds ?? DEFAULT_CHANNEL_IDS,
  });
  // A channel removed from the device leaves the list and the counts. Its history stays saved
  // and returns on rejoining. With no device yet the table is unknown, so everything shows.
  const onDevice = (id: number) => !knownRadio || names.some(item => item.id === id);
  const unread = (messageState?.unread(mode.value, connection.inbox.history) ?? []).filter(m =>
    onDevice(m.channel),
  );
  const totalUnread = sources.reduce(
    (n, source) =>
      n +
      (source.source === mode.value
        ? unread.length
        : (messageState?.unread(source.source, source.messages).length ?? 0)),
    0,
  );
  document.title = `${totalUnread ? `(${totalUnread}) ` : ''}Reaper Mesh`;
  text('nav-unread', totalUnread);
  element('nav-unread').hidden = totalUnread === 0;
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
  const count = element('message-bytes');
  count.hidden = bytes <= maxBytes - 200;
  count.toggleAttribute('data-over', bytes > maxBytes);
  count.textContent = String(maxBytes - bytes);
  if (channel.dataset.names !== JSON.stringify(names)) {
    const selected = channel.value;
    channel.replaceChildren();
    for (const { id, name } of names) channel.add(new Option(name, String(id)));
    // Keep a conversation on a channel this device no longer has, so its history stays readable.
    if (![...channel.options].some(o => o.value === selected))
      channel.add(new Option(`Channel ${Number(selected).toString(16)}`, selected));
    channel.value = selected;
    channel.dataset.names = JSON.stringify(names);
  }
  if (!onDevice(selectedChannel)) {
    leaveConversation();
    return;
  }
  const key = conversationKey(destination.value, selectedChannel);
  // Traffic here is encrypted and there's no key, so sending would go out in the clear.
  const needsKey =
    !encryption?.hasKey(selectedChannel) &&
    hasEncryptedTraffic(connection.inbox.history, selectedChannel);
  const sendBlockReason = connection.messaging.sendBlockReason;
  const remoteBlocked =
    destination.value !== connection.device &&
    !!connection.capabilities?.radioVersion &&
    connection.radioInfo?.reason !== 'ready';
  text(
    'message-support',
    encryptionError ||
      (encryptedRequired && !encryption?.unlocked
        ? 'Encryption required. Unlock the app before sending.'
        : needsKey
          ? "This channel is encrypted and this browser doesn't have the key. Sending is off so nothing goes out in the clear. Scan its QR code in Device, Channels."
          : !ready
            ? 'Connect a device to send'
            : (connection.messageBlockReason ??
              (uploading
                ? 'Uploading message…'
                : sendBlockReason
                  ? sendBlockReason
                  : remoteBlocked
                    ? connection.radioInfo?.reason === 'network-not-chosen' ||
                      connection.radioInfo?.reason === 'team-key-needed'
                      ? 'This radio is not on a network yet. Check Device, Radio network.'
                      : 'Radio unavailable. Check Device, Radio.'
                    : ''))),
  );
  const sendBlocked =
    !ready ||
    !!encryptionError ||
    needsKey ||
    (encryptedRequired && !encryption?.unlocked) ||
    !!connection.messageBlockReason ||
    uploading ||
    !destination.value.trim() ||
    !!sendBlockReason ||
    remoteBlocked;
  element<HTMLButtonElement>('message-send').disabled = sendBlocked || !bytes || bytes > maxBytes;
  renderQuickPhrases(sendBlocked);
  const self = canonicalNode(destination.value) === canonicalNode(lastDevice ?? '');
  body.placeholder = self
    ? 'Note to this device'
    : `${encryptedRequired ? 'Encrypted message to' : 'Message'} ${
        conversationRows.find(row => row.key === key)?.name ?? 'this conversation'
      }`;
  const uiScope = messageScope(mode.value, lastDevice ?? '');
  const visibleThread = (row: { key: string; destination: string; channel: number }) => {
    if (!messageState?.hidden(uiScope, row.key)) return true;
    if (!threadMessages(lastDevice, row.destination, row.channel, history, incoming).length)
      return false;
    // Something new arrived, so it's back for good, even if that message is later deleted.
    if (recovery.writable) {
      try {
        messageState.reopen(uiScope, row.key);
      } catch (e) {
        setMessageStateError(`Message history: ${String(e)}`);
      }
    }
    return true;
  };
  nodeCache.use(lastDevice);
  const rows = conversations(lastDevice, names, nodeCache.nodes, history, incoming)
    .filter(visibleThread)
    .filter(row => onDevice(row.channel))
    .map(row =>
      row.kind === 'direct' && row.name === row.destination
        ? { ...row, name: nodeLabel(undefined, row.destination) }
        : row,
    );
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
      onDevice(target.channel) &&
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
  conversationRows = rows;
  const currentRow = rows.find(row => row.key === key);
  text('conversation-title', currentRow?.name ?? (destination.value || 'New conversation'));
  // An SVG element has no `hidden` property, so toggle the attribute.
  element('conversation-lock').toggleAttribute('hidden', !encryptedRequired);
  const isChannel = destination.value === 'broadcast';
  element('conversation-channel-settings').hidden = !isChannel;
  element('conversation-show-map').hidden =
    isChannel ||
    !nodeCache.nodes.find(n => canonicalNode(n.node) === canonicalNode(destination.value))
      ?.position;
  text(
    'conversation-subtitle',
    encryptedRequired
      ? 'Encrypted'
      : isChannel
        ? 'Channel broadcast'
        : self
          ? 'This device'
          : `Direct, on ${channelLabel(names, selectedChannel)}`,
  );
  text(
    'conversation-empty-text',
    isChannel ? 'Anything sent on this channel appears here.' : 'Send the first message.',
  );
  element('conversation-connect').hidden = ready || linkLost();
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
  const locked = rows.map(row => !!encryption?.isRequired(row.channel));
  const listSignature =
    JSON.stringify(rows) +
    key +
    filter +
    conversationFilter +
    JSON.stringify(unread) +
    JSON.stringify(locked) +
    recovery.writable;
  const channelList = element('channel-list'),
    directList = element('direct-list');
  if (channelList.dataset.signature !== listSignature) {
    channelList.dataset.signature = directList.dataset.signature = listSignature;
    channelList.replaceChildren();
    directList.replaceChildren();
    const visible = rows.filter(
      row =>
        (conversationFilter === 'all' || row.kind === conversationFilter) &&
        `${row.name} ${row.destination} ${channelLabel(names, row.channel)}`
          .toLowerCase()
          .includes(filter),
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
          ? 'No direct conversations yet. Find a device in Map to start one.'
          : 'No conversations to show.',
    );
    element('conversation-search-empty').hidden = visible.length !== 0;
    const renderRow = (row: (typeof rows)[number], list: HTMLElement) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'conversation-row';
      button.classList.toggle('is-selected', row.key === key);
      button.setAttribute('aria-pressed', String(row.key === key));
      const content = document.createElement('span');
      content.className = 'conversation-summary';
      const name = document.createElement('strong');
      name.textContent = row.name;
      name.title = row.name;
      const preview = document.createElement('span');
      preview.textContent =
        row.kind === 'direct' && row.channel !== 0
          ? `${channelLabel(names, row.channel)} · ${row.preview}`
          : row.preview;
      content.append(name, preview);
      button.append(icon(row.kind === 'channel' ? 'hash' : 'user'), content);
      if (encryption?.isRequired(row.channel))
        button.append(icon('lock', { label: 'Encrypted', className: 'row-lock' }));
      const count = lastDevice
        ? unread.filter(m => inConversation(m, lastDevice!, row.destination, row.channel)).length
        : 0;
      if (count) {
        const badge = document.createElement('span');
        badge.className = 'badge';
        badge.textContent = String(count);
        badge.setAttribute('aria-label', `${count} unread ${count === 1 ? 'message' : 'messages'}`);
        button.append(badge);
      }
      button.addEventListener('click', () => chooseConversation(row.destination, row.channel));
      const item = document.createElement('div');
      item.className = 'conversation-item';
      item.append(button);
      if (canDeleteConversation(row) && messageState && recovery.writable) {
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'round compact row-delete';
        remove.setAttribute('aria-label', `Delete ${row.name}`);
        remove.title = `Delete ${row.name}`;
        remove.append(icon('trash-2'));
        remove.addEventListener('click', () => askDelete(row));
        item.append(remove);
      }
      list.append(item);
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
  const signature =
    scope +
    key +
    ready +
    JSON.stringify(messages) +
    mapWorkspace.messageVersion +
    [...openDelivery].join();
  element('conversation-empty').hidden = messages.length > 0;
  if (signature === messageSignature) return;
  messageSignature = signature;
  const stick = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80;
  const thread = element('message-history');
  thread.replaceChildren();
  for (const m of messages) {
    const row = document.createElement('li');
    row.className = `message-row ${m.direction}`;
    if (m.direction === 'incoming' && destination.value === 'broadcast') {
      const sender = document.createElement('span');
      sender.className = 'message-sender';
      sender.textContent = nodeLabel(
        nodeCache.nodes.find(n => canonicalNode(n.node) === canonicalNode(m.origin))?.name,
        m.origin,
      );
      row.append(sender);
    }
    const state = (m.received ?? m.entry)?.encryptionState;
    const note = state && state !== 'decrypted' ? CRYPTO_NOTES[state] : undefined;
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
    // A sent message opens its delivery details. A map card has its own buttons, so it stays a div.
    const entry = m.entry;
    const bubble = document.createElement(entry && !mapCard ? 'button' : 'div');
    bubble.className = 'message-bubble';
    if (bubble instanceof HTMLButtonElement) bubble.type = 'button';
    if (note) {
      const line = document.createElement('p');
      line.className = 'message-note';
      line.append(icon('lock'), note);
      bubble.append(line);
    } else if (mapCard) bubble.append(mapCard);
    else {
      const content = document.createElement('p');
      content.className = 'message-text';
      content.textContent = m.text;
      bubble.append(content);
    }
    const meta = document.createElement('div');
    meta.className = 'message-meta';
    if (state === 'decrypted')
      meta.append(icon('lock', { label: 'Encrypted', className: 'meta-lock' }));
    const at = messageState?.time(
      m.received
        ? receivedKey(mode.value, m.received)
        : sentKey(mode.value, lastDevice!, m.entry!.id),
    );
    if (at !== undefined) {
      const time = document.createElement('time');
      time.dateTime = new Date(at).toISOString();
      time.textContent = messageTime(at);
      time.title = new Date(at).toLocaleString();
      meta.append(time);
    }
    if (entry) {
      meta.append(deliveryIcon(entry));
      (bubble instanceof HTMLButtonElement ? bubble : meta).addEventListener('click', () => {
        if (openDelivery.has(entry.id)) openDelivery.delete(entry.id);
        else openDelivery.add(entry.id);
        renderMessages();
      });
    }
    bubble.append(meta);
    row.append(bubble);
    if (entry && openDelivery.has(entry.id)) {
      const detail = document.createElement('div');
      detail.className = 'delivery-detail';
      const label = document.createElement('span');
      label.textContent = deliveryOf(entry).label;
      detail.append(label);
      if (entry.state === 'unknown') {
        const check = document.createElement('button');
        check.type = 'button';
        check.className = 'compact';
        check.textContent = 'Check';
        check.disabled = !ready;
        // This can only read: it asks the device about the message and never sends it again.
        check.addEventListener('click', () => {
          try {
            current().adapter.recoverMessage(entry.id);
          } catch (e) {
            showError(e);
          }
        });
        detail.append(check);
      }
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'compact';
      remove.textContent = 'Delete';
      remove.disabled = entry.state === 'receiving' || !messageState || !recovery.writable;
      remove.addEventListener('click', () => deleteSent(entry));
      detail.append(remove);
      row.append(detail);
    }
    thread.append(row);
  }
  if (stick)
    requestAnimationFrame(() => {
      scroller.scrollTop = scroller.scrollHeight;
    });
}

function sendFailed(e: unknown) {
  sendError = e instanceof Error ? e.message : String(e);
  showError(e);
}

function sendText(body: string) {
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
}

let phrasesSignature = '';
function renderQuickPhrases(blocked: boolean) {
  const signature = `${armedPhrase}|${blocked}`;
  if (signature === phrasesSignature) return;
  phrasesSignature = signature;
  element('quick-phrases').replaceChildren(
    ...QUICK_PHRASES.map(phrase => {
      const button = document.createElement('button');
      const armed = armedPhrase === phrase;
      button.type = 'button';
      button.disabled = blocked;
      button.classList.toggle('is-armed', armed);
      button.textContent = armed ? 'Tap to send' : phrase;
      button.setAttribute('aria-label', armed ? `Tap again to send ${phrase}` : phrase);
      button.addEventListener('click', () => {
        clearTimeout(armTimer);
        if (armedPhrase !== phrase) {
          armedPhrase = phrase;
          armTimer = setTimeout(() => {
            armedPhrase = undefined;
            render();
          }, ARM_MS);
          render();
          return;
        }
        armedPhrase = undefined;
        try {
          sendText(phrase);
          clearError();
        } catch (e) {
          sendFailed(e);
        }
        render();
      });
      return button;
    }),
  );
}

export function renderInbox() {
  // A gap in older messages is reported in Diagnostics, since nothing can be done about it here.
  text('inbox-status', current().adapter.connection.inbox.error ?? '');
}

export function initMessages() {
  autosizeComposer();
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
      forgetMessages(plan.connection, plan.source, plan.keys, plan.outgoing, plan.conversation);
      if (plan.clearDraft) {
        drafts.save(plan.clearDraft, '');
        recentConversations.delete(plan.clearDraft);
        if (plan.clearDraft === draftKey) leaveConversation();
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
  element('conversation-connect').addEventListener('click', () => connectAction());
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
    if (open) menu.querySelector<HTMLButtonElement>('button:enabled:not([hidden])')?.focus();
  });
  document.addEventListener('click', event => {
    if (!menu.hidden && !(event.target as Element).closest('.thread-menu')) showMenu(false);
  });
  options.parentElement!.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || menu.hidden) return;
    showMenu(false);
    options.focus();
  });
  element('clear-conversation').addEventListener('click', () => {
    showMenu(false);
    if (!lastDevice) return;
    const { messages, keys, outgoing } = threadIdentities(
      element<HTMLInputElement>('message-destination').value,
      Number(element<HTMLSelectElement>('message-channel').value),
    );
    requestDelete(
      keys,
      outgoing,
      `Delete the ${messages.length} messages in this conversation from this browser? The conversation stays in your list.`,
    );
  });
  element('conversation-channel-settings').addEventListener('click', () => {
    showMenu(false);
    openChannel(Number(element<HTMLSelectElement>('message-channel').value));
  });
  element('conversation-show-map').addEventListener('click', () => {
    showMenu(false);
    selectNode(element<HTMLInputElement>('message-destination').value, { focusMap: true });
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
    if (element<HTMLButtonElement>('message-send').disabled) return;
    try {
      sendText(element<HTMLTextAreaElement>('message-body').value);
      element<HTMLTextAreaElement>('message-body').value = '';
      drafts.save(draftKey, '');
      clearError();
      render();
    } catch (e) {
      sendFailed(e);
    }
  });
}
