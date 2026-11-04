// Channel editor, invites and per-channel encryption keys in Settings. Channels are identified by
// their on-air ID (D45); slots are only where the device stores them.
import {
  DEFAULT_CHANNEL_IDS,
  DEFAULT_CHANNELS,
  channelList,
  formatChannelId,
  newChannelId,
  validRadio,
  withChannel,
  type RadioConfig,
} from '../../packages/protocol/radio-config.ts';
import { formatInvite, parseInvite } from './channel-invite.ts';
import {
  clearError,
  current,
  encryption,
  encryptionError,
  manage,
  recovery,
  render,
  showError,
} from './app-state.ts';
import { element, text } from './dom.ts';

let editingChannel = 0;
export const editingChannelSlot = () => editingChannel;

function radioConfig() {
  return current().adapter.connection.sync.config?.radio;
}
function table() {
  const radio = radioConfig();
  return channelList({
    channels: radio?.channels ?? DEFAULT_CHANNELS,
    channelIds: radio?.channelIds ?? DEFAULT_CHANNEL_IDS,
  });
}
/** The channel ID stored in `slot`, or undefined while the slot is still empty. */
function slotId(slot: number) {
  return table().find(channel => channel.slot === slot)?.id;
}
function freeSlot() {
  const used = new Set(table().map(channel => channel.slot));
  return Array.from({ length: 7 }, (_, i) => i + 1).find(slot => !used.has(slot));
}
function writable() {
  const model = current(),
    config = model.adapter.connection.sync.config;
  if (!config?.radio || model.pending || model.adapter.connection.radioBlockReason)
    throw Error(model.adapter.connection.radioBlockReason ?? 'Connect a device before saving.');
  return { model, config, radio: config.radio };
}
function save(radio: RadioConfig, status: string) {
  const { model, config } = writable();
  if (!validRadio(radio, config.region)) throw Error('Those channel settings are not valid.');
  model.adapter.configure({ ...config, radio });
  text('channel-editor-status', status);
  render();
}

export function editChannel(slot: number) {
  if (editingChannel !== slot) {
    element<HTMLTextAreaElement>('channel-key-transfer').value = '';
    element<HTMLTextAreaElement>('channel-invite-output').value = '';
  }
  editingChannel = slot;
  const channel = table().find(item => item.slot === slot);
  text('channel-editor-title', channel?.name ?? 'Create channel');
  element<HTMLInputElement>('channel-name').value = channel?.name ?? '';
  element<HTMLInputElement>('channel-name').disabled =
    slot === 0 || current().adapter.connection.sync.state !== 'ready';
  element('channel-name-save').hidden = slot === 0;
  element('channel-name').hidden = slot === 0;
  document.querySelector<HTMLLabelElement>('label[for="channel-name"]')!.hidden = slot === 0;
  text(
    'channel-name-help',
    slot === 0
      ? 'Public is the default channel and cannot be renamed.'
      : 'Up to 8 letters, numbers, underscores or hyphens.',
  );
  text('channel-editor-status', channel && slot ? `Channel ID ${formatChannelId(channel.id)}` : '');
  element('channel-invite').hidden = !channel || slot === 0;
  renderEncryption();
  const links = element('managed-channels');
  if (!links.querySelector(`[data-slot="${slot}"]`)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.slot = String(slot);
    button.textContent = 'New channel';
    button.addEventListener('click', () => editChannel(slot));
    links.append(button);
  }
  for (const button of links.querySelectorAll<HTMLButtonElement>('button')) {
    const active = button.dataset.slot === String(slot);
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-current', active ? 'page' : 'false');
  }
}

export function renderEncryption() {
  const id = slotId(editingChannel);
  const configured = id !== undefined;
  const tools = document.querySelector<HTMLElement>('.encryption-tools')!;
  tools.hidden = !configured;
  tools.style.display = configured ? '' : 'none';
  if (!configured) return;
  const policy = element<HTMLSelectElement>('encryption-policy');
  if (document.activeElement !== policy)
    policy.value = encryption?.isRequired(id) ? 'required' : 'plaintext';
  const unlocked = !!encryption?.unlocked;
  element<HTMLButtonElement>('channel-key-generate').textContent = encryption?.hasKey(id)
    ? 'Replace key'
    : 'Create key';
  text(
    'encryption-status',
    encryptionError || (encryption?.isRequired(id) ? 'Encrypted' : 'Unencrypted'),
  );
  element<HTMLButtonElement>('channel-key-generate').disabled = !unlocked || !recovery.writable;
  element<HTMLButtonElement>('channel-key-export').disabled = !unlocked || !encryption?.hasKey(id);
  element<HTMLButtonElement>('channel-key-import').disabled = !unlocked || !recovery.writable;
  policy.options[1].disabled = !unlocked || !encryption?.hasKey(id);
  policy.disabled = !encryption || !recovery.writable;
}

/** The channel being edited; throws when it has not been saved to the device yet. */
function editingId() {
  const id = slotId(editingChannel);
  if (id === undefined) throw new Error('Save the channel before managing its keys.');
  return id;
}

export function initChannels() {
  element('create-channel').addEventListener('click', () => {
    const slot = freeSlot();
    if (slot !== undefined) {
      editChannel(slot);
      element<HTMLInputElement>('channel-name').focus();
    }
  });
  element('channel-name-form').addEventListener('submit', event => {
    event.preventDefault();
    try {
      if (editingChannel === 0) return;
      const { radio } = writable();
      const name = element<HTMLInputElement>('channel-name').value.trim();
      // A renamed channel keeps its ID; a new one gets a fresh random ID.
      const id = slotId(editingChannel) ?? newChannelId(table().map(channel => channel.id));
      if (table().some(channel => channel.name === name && channel.slot !== editingChannel))
        throw Error('Another channel already uses that name.');
      save(withChannel(radio, editingChannel, name, id), 'Saving to device…');
    } catch (e) {
      text('channel-editor-status', e instanceof Error ? e.message : 'Could not save channel.');
    }
  });
  element('join-channel').addEventListener('click', () => {
    const form = element('channel-join-form');
    form.hidden = !form.hidden;
    if (!form.hidden) element<HTMLTextAreaElement>('channel-invite-input').focus();
  });
  element('channel-join-cancel').addEventListener('click', () => {
    element('channel-join-form').hidden = true;
    element<HTMLTextAreaElement>('channel-invite-input').value = '';
  });
  element('channel-join-form').addEventListener('submit', event => {
    event.preventDefault();
    try {
      const invite = parseInvite(element<HTMLTextAreaElement>('channel-invite-input').value);
      const { radio } = writable();
      const existing = table().find(channel => channel.id === invite.id);
      if (!existing && table().some(channel => channel.name === invite.name))
        throw Error(`A different channel is already named ${invite.name}. Rename it first.`);
      if (invite.key) {
        if (!encryption) throw new Error(encryptionError || 'Encryption state unavailable.');
        // Keys live in this browser only, so importing first cannot leave the device half-joined.
        encryption.importBundle(invite.key, invite.id);
      }
      const slot = existing?.slot ?? freeSlot();
      if (slot === undefined) throw Error('All 8 channel slots are in use.');
      element<HTMLTextAreaElement>('channel-invite-input').value = '';
      element('channel-join-form').hidden = true;
      editChannel(slot);
      if (existing) text('channel-editor-status', `Already joined ${existing.name}.`);
      else save(withChannel(radio, slot, invite.name, invite.id), `Joining ${invite.name}…`);
      clearError();
    } catch (e) {
      text('channel-join-status', e instanceof Error ? e.message : 'Could not join the channel.');
    }
  });
  element('channel-invite-create').addEventListener('click', () => {
    try {
      const channel = table().find(item => item.slot === editingChannel);
      if (!channel || channel.slot === 0) throw new Error('Save the channel first.');
      const key = encryption?.hasKey(channel.id) ? encryption.exportBundle(channel.id) : undefined;
      element<HTMLTextAreaElement>('channel-invite-output').value = formatInvite({
        id: channel.id,
        name: channel.name,
        ...(key ? { key } : {}),
      });
      text(
        'channel-invite-status',
        key
          ? 'This invite contains the channel key. Share it only privately.'
          : 'This channel is not encrypted; anyone with the invite can join.',
      );
    } catch (e) {
      showError(e);
    }
  });
  manage.addEventListener('close', () => {
    element<HTMLTextAreaElement>('channel-key-transfer').value = '';
    element<HTMLTextAreaElement>('channel-invite-output').value = '';
    element<HTMLTextAreaElement>('channel-invite-input').value = '';
  });
  element('encryption-policy').addEventListener('change', () => {
    try {
      if (!encryption) throw new Error(encryptionError || 'Encryption state unavailable.');
      encryption.setRequired(
        editingId(),
        element<HTMLSelectElement>('encryption-policy').value === 'required',
      );
      render();
    } catch (e) {
      showError(e);
    }
  });
  element('channel-key-generate').addEventListener('click', () => {
    try {
      if (!encryption) throw new Error(encryptionError || 'Encryption state unavailable.');
      const channel = editingId();
      if (
        encryption.hasKey(channel) &&
        !confirm(
          'Rotate this channel key? Existing agents need the exported new key epoch before they can decrypt new messages.',
        )
      )
        return;
      const created = encryption.generate(channel);
      element<HTMLSelectElement>('encryption-policy').value = 'required';
      text(
        'encryption-status',
        `Key epoch ${created.epoch} generated. Share a new invite or key bundle with other agents.`,
      );
      render();
    } catch (e) {
      showError(e);
    }
  });
  element('channel-key-export').addEventListener('click', () => {
    try {
      if (!encryption) throw new Error(encryptionError || 'Encryption state unavailable.');
      element<HTMLTextAreaElement>('channel-key-transfer').value =
        encryption.exportBundle(editingId());
      text(
        'encryption-status',
        'Key bundle shown. It contains the secret; share only through a private transfer.',
      );
    } catch (e) {
      showError(e);
    }
  });
  element('channel-key-import').addEventListener('click', () => {
    try {
      if (!encryption) throw new Error(encryptionError || 'Encryption state unavailable.');
      encryption.importBundle(
        element<HTMLTextAreaElement>('channel-key-transfer').value.trim(),
        editingId(),
      );
      element<HTMLSelectElement>('encryption-policy').value = 'required';
      clearError();
      render();
    } catch (e) {
      showError(e);
    }
  });
}
