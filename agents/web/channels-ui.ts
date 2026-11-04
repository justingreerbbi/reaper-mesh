// Channels: the list, one channel's privacy and sharing, QR creation and scanning. Channels are
// identified by their on-air ID (D45); slots are only where the device stores them. Keys live in
// this browser; the codes are the same RMCH1 and RMKEY1 text the mobile app reads and writes.
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
import { parseChannelCode, planJoin, shareCodeFor, type ChannelCode } from './channel-codes.ts';
import {
  current,
  encryption,
  encryptionError,
  knownConfig,
  recovery,
  render,
  writableConfig,
} from './app-state.ts';
import { element, text } from './dom.ts';
import { preparePublicClear, publicHistoryCount } from './messages-ui.ts';
import { currentPage, isShowing, onPageChange, openPage, backPage } from './nav.ts';
import { saveConfig, type SaveOutcome } from './config-save.ts';
import { confirmSheet, downloadBlob, icon, setNotice } from './ui.ts';
import { qrPath, qrPixels, readQr } from './qr.ts';

const CHANNEL_NAME = /^[A-Za-z0-9_-]{1,8}$/;
const SCAN_INTERVAL_MS = 250;
const SCAN_WIDTH = 640;

const OUTCOME_ERRORS: Partial<Record<SaveOutcome, string>> = {
  conflict: 'The device changed first. Try again.',
  rejected: 'The device rejected this change.',
  unknown: "No confirmation arrived, so this may not have applied. It won't be resent.",
};

let selected: number | undefined;
let listSignature = '';
let qrCode = '';
let found: ChannelCode | undefined;
let scanStream: MediaStream | undefined;
let scanTimer: ReturnType<typeof setInterval> | undefined;
/** A camera reports the same code many times a second, so only the first one counts. */
let lastRead: string | undefined;
let committing = false;

function table() {
  const radio = knownConfig()?.radio;
  return channelList({
    channels: radio?.channels ?? DEFAULT_CHANNELS,
    channelIds: radio?.channelIds ?? DEFAULT_CHANNEL_IDS,
  });
}
const selectedChannel = () => table().find(channel => channel.id === selected);
function blockedReason() {
  const { connection } = current().adapter;
  if (connection.sync.state !== 'ready') return 'Connect a device to change its channels.';
  return connection.radioBlockReason;
}
const showError = (id: string, error: unknown) =>
  setNotice(id, error instanceof Error ? error.message : String(error), 'bad');

/** Channel changes go to the device straight away, since a code or key depends on them. */
async function commit(next: (radio: RadioConfig) => RadioConfig) {
  const model = current();
  const { connection } = model.adapter;
  const config = connection.sync.config;
  if (!config?.radio || model.pending || connection.radioBlockReason)
    throw new Error(connection.radioBlockReason ?? 'Connect a device before saving.');
  const radio = next(config.radio);
  if (!validRadio(radio, config.region)) throw new Error('Those channel settings are not valid.');
  committing = true;
  render();
  try {
    const outcome = await saveConfig(model, { ...writableConfig(connection), radio });
    if (outcome !== 'committed') throw new Error(OUTCOME_ERRORS[outcome] ?? OUTCOME_ERRORS.unknown);
  } finally {
    committing = false;
    render();
  }
}

/** Why a channel can't be removed right now, for asking before trying. */
export const channelBlockReason = blockedReason;

/** Removes a channel from the device by its ID. Already gone counts, in case a confirmation was lost. */
export async function removeChannelFromDevice(id: number) {
  const channel = table().find(row => row.id === id);
  if (channel) await commit(radio => withChannel(radio, channel.slot, '', 0));
}

function vault() {
  if (!encryption) throw new Error(encryptionError || 'Encryption state unavailable.');
  return encryption;
}

/** Clears anything secret on screen, for leaving the page or locking the app. */
export function closeSecrets() {
  stopCamera();
  qrCode = '';
  element('share-qr').replaceChildren();
  text('share-status', '');
  found = undefined;
  lastRead = undefined;
  const join = element<HTMLDialogElement>('join-sheet');
  if (join.open) join.close();
  element<HTMLInputElement>('scan-paste').value = '';
  element<HTMLInputElement>('scan-image').value = '';
  setNotice('scan-error', undefined);
  element('scan-done').hidden = true;
  element('scan-content').hidden = false;
  if (currentPage() === 'channel-share' || currentPage() === 'channel-scan') {
    if (isShowing(currentPage())) backPage();
  }
}

export function openChannel(id: number) {
  selected = id;
  setNotice('channel-error', undefined);
  text('channel-remove-status', '');
  element<HTMLInputElement>('channel-name').value = selectedChannel()?.name ?? '';
  openPage('channel');
}

function renderList() {
  const channels = table();
  const free = channels.length < 8;
  const blocked = blockedReason();
  text('channels-status', `${channels.length} of 8 in use`);
  text(
    'channel-new-help',
    free
      ? 'Up to 8 letters, digits, - or _.'
      : 'All 8 channel slots are in use. Remove one to add another.',
  );
  setNotice('channels-blocked', blocked, 'warn');
  const required = channels.map(channel => !!encryption?.isRequired(channel.id));
  const signature = JSON.stringify([channels, required]);
  if (signature !== listSignature) {
    listSignature = signature;
    element('managed-channels').replaceChildren(
      ...channels.map((channel, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'channel-row';
        const locked = required[index];
        button.setAttribute(
          'aria-label',
          `${channel.name}, ${locked ? 'encrypted' : 'not encrypted'}`,
        );
        const textBox = document.createElement('span');
        textBox.className = 'channel-text';
        const name = document.createElement('strong');
        name.textContent = channel.name;
        const detail = document.createElement('small');
        detail.textContent = locked
          ? 'Encrypted'
          : channel.slot === 0
            ? 'Open to everyone'
            : 'Not encrypted';
        textBox.append(name, detail);
        button.append(
          icon(locked ? 'lock' : 'lock-open', { className: locked ? 'is-locked' : 'is-open' }),
          textBox,
          icon('chevron-right', { className: 'row-chevron' }),
        );
        button.addEventListener('click', () => openChannel(channel.id));
        return button;
      }),
    );
  }
  const name = element<HTMLInputElement>('channel-new-name').value;
  const valid = CHANNEL_NAME.test(name) && !channels.some(channel => channel.name === name);
  const add = element<HTMLButtonElement>('channel-new-add');
  add.disabled = !valid || !free || !!blocked || committing || current().pending;
  element<HTMLButtonElement>('channel-scan-open').disabled = !!blocked;
}

function renderDetail() {
  const channel = selectedChannel();
  element('channel-gone').hidden = !!channel;
  element('channel-content').hidden = !channel;
  if (!channel) return;
  text('channel-title', channel.name);
  const required = !!encryption?.isRequired(channel.id);
  const hasKey = !!encryption?.hasKey(channel.id);
  const unlocked = !!encryption?.unlocked && recovery.writable;
  element('channel-lock-on').hidden = !required;
  element('channel-lock-off').hidden = required;
  text(
    'channel-status',
    encryptionError ||
      (required && hasKey
        ? `Encrypted, key ${encryption!.epoch(channel.id)}`
        : required
          ? 'Encrypted, but this browser has no key'
          : hasKey
            ? 'Has a key, but allows unencrypted'
            : 'Not encrypted'),
  );
  element('channel-keyed').hidden = !hasKey;
  element('channel-unkeyed').hidden = hasKey;
  const requiredToggle = element<HTMLInputElement>('channel-required');
  requiredToggle.checked = required;
  requiredToggle.disabled = !unlocked;
  for (const id of ['channel-rotate', 'channel-forget', 'channel-create-key'])
    element<HTMLButtonElement>(id).disabled = !unlocked;

  // Public can't be invited to, since every device already has it. Only its key can be shared.
  const code = channel.id !== 0 || hasKey;
  element('channel-share-open').hidden = !code;
  element('channel-share-none').hidden = code;
  text('channel-share-label', hasKey ? 'Share channel and key' : 'Share channel');

  const isPublic = channel.slot === 0;
  const blocked = blockedReason();
  element('channel-name-form').hidden = isPublic;
  element<HTMLButtonElement>('channel-name-save').disabled =
    !!blocked || committing || current().pending;
  text('channel-id', isPublic ? '' : `Channel ID ${formatChannelId(channel.id)}`);
  text('channel-remove-label', isPublic ? 'Reset Public' : 'Remove channel from device');
  const hasKeys = hasKey || required;
  element<HTMLButtonElement>('channel-remove').disabled = isPublic
    ? !recovery.writable ||
      (hasKeys && !encryption?.unlocked) ||
      (!hasKeys && publicHistoryCount() === 0)
    : !!blocked || committing || current().pending;
}

function renderShare() {
  const channel = selectedChannel();
  // Depends on the key, so a rotated key can't leave an old code on screen.
  const code = channel && encryption ? shareCodeFor(channel, encryption) : null;
  element('share-none').hidden = !!code;
  element('share-content').hidden = !code;
  if (!channel || !code) return;
  const hasKey = !!encryption?.hasKey(channel.id);
  text('share-title', `Share ${channel.name}`);
  text('share-heading', hasKey ? 'Scan to join, with the key' : 'Scan to join');
  setNotice(
    'share-warning',
    hasKey
      ? 'This code contains the channel key. Anyone who gets it, including from a photo or a shared image, can read this channel.'
      : "This channel isn't encrypted, so anyone with this code can join and read it.",
    hasKey ? 'warn' : 'good',
  );
  text('share-copy-label', hasKey ? 'Copy key as text' : 'Copy as text');
  if (code === qrCode) return;
  qrCode = code;
  const { path, total } = qrPath(code);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${total} ${total}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `QR code for ${channel.name}`);
  svg.setAttribute('shape-rendering', 'crispEdges');
  const paper = document.createElementNS(svg.namespaceURI, 'rect');
  paper.setAttribute('width', String(total));
  paper.setAttribute('height', String(total));
  paper.setAttribute('fill', '#FFFFFF');
  const modules = document.createElementNS(svg.namespaceURI, 'path');
  modules.setAttribute('d', path);
  modules.setAttribute('fill', '#050505');
  svg.append(paper, modules);
  element('share-qr').replaceChildren(svg);
}

function renderScan() {
  element<HTMLButtonElement>('scan-use').disabled =
    !element<HTMLInputElement>('scan-paste').value.trim();
}

export function renderChannels() {
  if (isShowing('channels')) renderList();
  if (isShowing('channel')) renderDetail();
  if (isShowing('channel-share')) renderShare();
  if (isShowing('channel-scan')) renderScan();
}

async function qrBlob() {
  const { data, width } = qrPixels(qrCode, 12);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = width;
  canvas
    .getContext('2d')!
    .putImageData(new ImageData(new Uint8ClampedArray(data), width, width), 0, 0);
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('Could not draw the code.')))),
  );
}
const qrFileName = () => `reaper-channel-${selectedChannel()?.name ?? 'code'}.png`;

function stopCamera() {
  clearInterval(scanTimer);
  scanTimer = undefined;
  for (const track of scanStream?.getTracks() ?? []) track.stop();
  scanStream = undefined;
  const video = element<HTMLVideoElement>('scan-video');
  video.srcObject = null;
  video.hidden = true;
  element('scan-idle').hidden = false;
}

function readCode(value: string | undefined) {
  if (!value || value === lastRead || found) return;
  lastRead = value;
  try {
    const code = parseChannelCode(value);
    setNotice('scan-error', undefined);
    askJoin(code);
  } catch (error) {
    showError('scan-error', error);
  }
}

function askJoin(code: ChannelCode) {
  found = code;
  stopCamera();
  text('join-title', code.keyOnly ? 'Add this channel key?' : `Join ${code.name}?`);
  setNotice(
    'join-notice',
    code.key
      ? 'Encrypted. The key will be saved in this browser.'
      : 'Not encrypted. Anyone in range with a Reaper device can read this channel.',
    code.key ? 'good' : 'warn',
  );
  text(
    'join-detail',
    code.keyOnly ? '' : 'Your device stops any messages waiting to send when its channels change.',
  );
  text('join-confirm', code.keyOnly ? 'Add key' : 'Join');
  element<HTMLButtonElement>('join-confirm').disabled = false;
  element<HTMLDialogElement>('join-sheet').showModal();
}

async function confirmJoin() {
  const code = found!;
  const button = element<HTMLButtonElement>('join-confirm');
  button.disabled = true;
  try {
    const plan = planJoin(code, table());
    // Keys live in this browser only, so importing first cannot leave the device half-joined.
    if (code.key) vault().importBundle(code.key, code.id);
    if (!plan.existing) await commit(radio => withChannel(radio, plan.slot, code.name!, code.id));
    const name = plan.existing?.name ?? code.name;
    element<HTMLDialogElement>('join-sheet').close();
    found = undefined;
    text(
      'scan-done-text',
      plan.existing && code.key
        ? `Key added to ${name}.`
        : plan.existing
          ? `Already joined ${name}.`
          : `Joined ${name}${code.key ? ', encrypted' : ''}.`,
    );
    element('scan-content').hidden = true;
    element('scan-done').hidden = false;
    element<HTMLInputElement>('scan-paste').value = '';
  } catch (error) {
    element<HTMLDialogElement>('join-sheet').close();
    found = undefined;
    lastRead = undefined;
    showError('scan-error', error);
  }
  render();
}

function scanFrame(video: HTMLVideoElement, canvas: HTMLCanvasElement) {
  if (video.readyState < 2 || !video.videoWidth) return;
  const scale = Math.min(1, SCAN_WIDTH / video.videoWidth);
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  readCode(readQr(data, canvas.width, canvas.height));
}

async function startCamera() {
  setNotice('scan-error', undefined);
  try {
    if (!navigator.mediaDevices?.getUserMedia)
      throw new Error('This browser has no camera access. Choose an image or paste a code.');
    scanStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
      audio: false,
    });
    if (currentPage() !== 'channel-scan') return stopCamera();
    const video = element<HTMLVideoElement>('scan-video');
    video.srcObject = scanStream;
    video.hidden = false;
    element('scan-idle').hidden = true;
    await video.play();
    const canvas = document.createElement('canvas');
    scanTimer = setInterval(() => scanFrame(video, canvas), SCAN_INTERVAL_MS);
  } catch (error) {
    stopCamera();
    showError(
      'scan-error',
      error instanceof DOMException && error.name === 'NotAllowedError'
        ? 'Camera access is off. Allow it in your browser, or choose an image or paste a code.'
        : error,
    );
  }
}

async function readImage(file: File) {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext('2d')!;
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    const value = readQr(data, canvas.width, canvas.height);
    if (!value) throw new Error('No QR code found in that image.');
    lastRead = undefined;
    readCode(value);
  } catch (error) {
    showError('scan-error', error);
  }
}

export function initChannels() {
  onPageChange((left, entered) => {
    const secret = left === 'channel-share' || left === 'channel-scan';
    if (!secret) return;
    stopCamera();
    qrCode = '';
    element('share-qr').replaceChildren();
    text('share-status', '');
    element<HTMLInputElement>('scan-paste').value = '';
    if (entered !== left) {
      element('scan-done').hidden = true;
      element('scan-content').hidden = false;
      lastRead = undefined;
      setNotice('scan-error', undefined);
    }
  });

  element('channel-new-name').addEventListener('input', () => render());
  element('channel-new-form').addEventListener('submit', async event => {
    event.preventDefault();
    const input = element<HTMLInputElement>('channel-new-name');
    if (element<HTMLButtonElement>('channel-new-add').disabled) return;
    setNotice('channels-error', undefined);
    try {
      const name = input.value;
      const channels = table();
      const id = newChannelId(channels.map(channel => channel.id));
      const plan = planJoin({ id, name, keyOnly: false }, channels);
      await commit(radio => withChannel(radio, plan.slot, name, id));
      input.value = '';
      if (element<HTMLInputElement>('channel-new-encrypt').checked) vault().generate(id);
    } catch (error) {
      showError('channels-error', error);
    }
    render();
  });
  element('channel-scan-open').addEventListener('click', () => openPage('channel-scan'));

  element('channel-required').addEventListener('change', () => {
    setNotice('channel-error', undefined);
    try {
      vault().setRequired(selected!, element<HTMLInputElement>('channel-required').checked);
    } catch (error) {
      showError('channel-error', error);
    }
    render();
  });
  element('channel-create-key').addEventListener('click', () => {
    setNotice('channel-error', undefined);
    try {
      vault().generate(selected!);
    } catch (error) {
      showError('channel-error', error);
    }
    render();
  });
  element('channel-rotate').addEventListener('click', async () => {
    const yes = await confirmSheet({
      title: 'Rotate the key?',
      body: "New messages use a new key, so everyone needs the channel's new QR code to read them. Old messages stay readable here.",
      confirm: 'Rotate',
    });
    if (!yes) return;
    try {
      vault().generate(selected!);
    } catch (error) {
      showError('channel-error', error);
    }
    render();
  });
  element('channel-forget').addEventListener('click', async () => {
    const yes = await confirmSheet({
      title: 'Remove the key from this browser?',
      body: "You won't be able to read this channel's encrypted messages here, and anything you send will be unencrypted. Other people keep their copy.",
      confirm: 'Remove',
      danger: true,
    });
    if (!yes) return;
    try {
      vault().reset(selected!);
    } catch (error) {
      showError('channel-error', error);
    }
    render();
  });
  element('channel-share-open').addEventListener('click', () => {
    qrCode = '';
    text('share-status', '');
    const share = element('share-native');
    share.hidden = !navigator.canShare?.({
      files: [new File([new Uint8Array(1)], 'code.png', { type: 'image/png' })],
    });
    openPage('channel-share');
  });
  element('channel-name-form').addEventListener('submit', async event => {
    event.preventDefault();
    setNotice('channel-error', undefined);
    const channel = selectedChannel();
    const name = element<HTMLInputElement>('channel-name').value.trim();
    try {
      if (!channel || channel.slot === 0 || name === channel.name) return;
      if (table().some(row => row.name === name && row.id !== channel.id))
        throw new Error('Another channel already uses that name.');
      await commit(radio => withChannel(radio, channel.slot, name, channel.id));
    } catch (error) {
      showError('channel-error', error);
    }
    render();
  });
  element('channel-remove').addEventListener('click', async () => {
    setNotice('channel-error', undefined);
    const channel = selectedChannel();
    if (!channel) return;
    try {
      if (channel.slot === 0) {
        const yes = await confirmSheet({
          title: 'Reset Public?',
          body: 'Its messages are deleted from this browser and its encryption key is removed, so Public goes back to unencrypted. Direct messages stay, but any encrypted with this key can no longer be read.',
          confirm: 'Reset',
          danger: true,
        });
        if (!yes) return;
        const clearChat = preparePublicClear();
        if (encryption?.hasKey(channel.id) || encryption?.isRequired(channel.id))
          encryption.reset(channel.id);
        clearChat();
        text('channel-remove-status', 'Public was reset.');
        render();
        return;
      }
      const yes = await confirmSheet({
        title: `Remove ${channel.name}?`,
        body: 'This device stops sending and receiving on it, and messages waiting to send are cancelled. Its chat history and key stay in this browser, so you can rejoin later with its QR code.',
        confirm: 'Remove',
        danger: true,
      });
      if (!yes) return;
      await commit(radio => withChannel(radio, channel.slot, '', 0));
      openPage('channels');
    } catch (error) {
      showError('channel-error', error);
    }
    render();
  });

  element('share-download').addEventListener('click', async () => {
    try {
      downloadBlob(qrFileName(), await qrBlob());
    } catch (error) {
      text('share-status', error instanceof Error ? error.message : String(error));
    }
  });
  element('share-native').addEventListener('click', async () => {
    try {
      const file = new File([await qrBlob()], qrFileName(), { type: 'image/png' });
      await navigator.share({ files: [file] });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError'))
        text('share-status', error instanceof Error ? error.message : String(error));
    }
  });
  element('share-copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(qrCode);
      text('share-status', 'Copied.');
    } catch {
      text('share-status', 'This browser blocked copying.');
    }
  });

  element('scan-start').addEventListener('click', () => void startCamera());
  element('scan-image').addEventListener('change', () => {
    const input = element<HTMLInputElement>('scan-image');
    const file = input.files?.[0];
    if (file) void readImage(file);
    input.value = '';
  });
  element('scan-paste').addEventListener('input', () => render());
  element('scan-paste-form').addEventListener('submit', event => {
    event.preventDefault();
    lastRead = undefined;
    readCode(element<HTMLInputElement>('scan-paste').value);
  });
  element('scan-done-close').addEventListener('click', () => openPage('channels'));
  element('join-confirm').addEventListener('click', () => void confirmJoin());
  const cancelJoin = () => {
    found = undefined;
    lastRead = undefined;
    const sheet = element<HTMLDialogElement>('join-sheet');
    if (sheet.open) sheet.close();
  };
  element('join-cancel').addEventListener('click', cancelJoin);
  element('join-sheet').addEventListener('cancel', event => {
    event.preventDefault();
    cancelJoin();
  });
}
