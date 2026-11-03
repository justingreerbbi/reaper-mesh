// Channel editor and per-channel encryption keys in Settings.
import { DEFAULT_CHANNELS, validRadio } from '../../packages/protocol/radio-config.ts';
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
export function editChannel(slot: number) {
  if (editingChannel !== slot) element<HTMLTextAreaElement>('channel-key-transfer').value = '';
  editingChannel = slot;
  const names = (
    current().adapter.connection.sync.config?.radio?.channels ?? DEFAULT_CHANNELS
  ).split('|');
  text('channel-editor-title', names[slot] || 'Create channel');
  element<HTMLInputElement>('channel-name').value = names[slot] || '';
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
  text('channel-editor-status', `Channel ${slot} · use this number on every device`);
  element<HTMLSelectElement>('encryption-channel').dataset.names = '';
  renderEncryption();
  element<HTMLSelectElement>('encryption-channel').value = String(slot);
  renderEncryption();
  const links = element('managed-channels');
  if (!links.querySelector(`[data-slot="${slot}"]`)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.slot = String(slot);
    button.textContent = `${slot} · New channel`;
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
  const channel = element<HTMLSelectElement>('encryption-channel');
  channel.hidden = true;
  document.querySelector<HTMLLabelElement>('label[for="encryption-channel"]')!.hidden = true;
  const names = (
    current().adapter.connection.sync.config?.radio?.channels ?? DEFAULT_CHANNELS
  ).split('|');
  if (channel.dataset.names !== JSON.stringify(names)) {
    const selected = channel.value;
    channel.replaceChildren();
    names.forEach((name, slot) => {
      if (name || slot === editingChannel)
        channel.add(new Option(`${name || 'New channel'} · ${slot}`, String(slot)));
    });
    if ([...channel.options].some(option => option.value === selected)) channel.value = selected;
    channel.dataset.names = JSON.stringify(names);
  }
  const configured = !!names[editingChannel];
  const tools = document.querySelector<HTMLElement>('.encryption-tools')!;
  tools.hidden = !configured;
  tools.style.display = configured ? '' : 'none';
  const slot = Number(channel.value),
    policy = element<HTMLSelectElement>('encryption-policy');
  if (document.activeElement !== policy)
    policy.value = encryption?.isRequired(slot) ? 'required' : 'plaintext';
  const unlocked = !!encryption?.unlocked;
  element<HTMLButtonElement>('channel-key-generate').textContent = encryption?.hasKey(slot)
    ? 'Replace key'
    : 'Create key';
  text(
    'encryption-status',
    encryptionError || (encryption?.isRequired(slot) ? 'Encrypted' : 'Unencrypted'),
  );
  element<HTMLButtonElement>('channel-key-generate').disabled = !unlocked || !recovery.writable;
  element<HTMLButtonElement>('channel-key-export').disabled =
    !unlocked || !encryption?.hasKey(slot);
  element<HTMLButtonElement>('channel-key-import').disabled = !unlocked || !recovery.writable;
  policy.options[1].disabled = !unlocked || !encryption?.hasKey(slot);
  policy.disabled = !encryption || !recovery.writable;
}

export function initChannels() {
  element('create-channel').addEventListener('click', () => {
    const names = current().adapter.connection.sync.config?.radio?.channels.split('|') ?? [];
    const slot = Array.from({ length: 7 }, (_, i) => i + 1).find(i => !names[i]);
    if (slot !== undefined) {
      editChannel(slot);
      element<HTMLInputElement>('channel-name').focus();
    }
  });
  element('channel-name-form').addEventListener('submit', event => {
    event.preventDefault();
    try {
      const model = current(),
        config = model.adapter.connection.sync.config;
      if (!config?.radio || model.pending || model.adapter.connection.radioBlockReason)
        throw Error('Connect a device before saving.');
      const names = config.radio.channels.split('|');
      if (editingChannel !== 0)
        names[editingChannel] = element<HTMLInputElement>('channel-name').value.trim();
      const radio = { ...config.radio, channels: names.join('|') };
      if (!validRadio(radio, config.region))
        throw Error('Use up to 8 letters, numbers, underscores or hyphens.');
      model.adapter.configure({ ...config, radio });
      text('channel-editor-status', 'Saving to device…');
      render();
    } catch (e) {
      text('channel-editor-status', e instanceof Error ? e.message : 'Could not save channel.');
    }
  });
  manage.addEventListener('close', () => {
    element<HTMLTextAreaElement>('channel-key-transfer').value = '';
  });
  element('encryption-channel').addEventListener('change', render);
  element('encryption-policy').addEventListener('change', () => {
    try {
      if (!encryption) throw new Error(encryptionError || 'Encryption state unavailable.');
      encryption.setRequired(
        Number(element<HTMLSelectElement>('encryption-channel').value),
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
      const channel = Number(element<HTMLSelectElement>('encryption-channel').value);
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
        `Key epoch ${created.epoch} generated. Export and securely share the key bundle with other agents.`,
      );
      render();
    } catch (e) {
      showError(e);
    }
  });
  element('channel-key-export').addEventListener('click', () => {
    try {
      if (!encryption) throw new Error(encryptionError || 'Encryption state unavailable.');
      element<HTMLTextAreaElement>('channel-key-transfer').value = encryption.exportBundle(
        Number(element<HTMLSelectElement>('encryption-channel').value),
      );
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
        Number(element<HTMLSelectElement>('encryption-channel').value),
      );
      element<HTMLSelectElement>('encryption-policy').value = 'required';
      clearError();
      render();
    } catch (e) {
      showError(e);
    }
  });
}
