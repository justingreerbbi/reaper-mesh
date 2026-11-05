// The radio network page (D50): creating or joining a team, adding this radio, and sharing the
// team's QR code. Keys live in this browser's vault. They go to the radio only when the operator
// adds it, and the team key is reloaded whenever a radio needs it, because it lives in memory there.
import { current, demo, encryption, encryptionError, mode, render } from './app-state.ts';
import { element, text } from './dom.ts';
import { backPage, currentPage, isShowing, onPageChange, openPage } from './nav.ts';
import { qrSvg } from './qr.ts';
import { setTeamCodeHandler } from './channels-ui.ts';
import {
  chainFingerprint,
  formatTeamInvite,
  newTeam,
  parseTeamInvite,
  validTeamName,
  type TeamKeys,
} from './team.ts';
import { confirmSheet, setNotice } from './ui.ts';

const REFUSALS: Record<string, string> = {
  refused:
    "The radio refused. Changing its network needs a USB cable, or hold the device's main button for 5 seconds to allow it over Bluetooth.",
  'storage-failed': "The radio could not save this, so its network didn't change.",
  invalid: 'The radio rejected these keys.',
  mismatch: "The radio's keys are a different version from this team's.",
  'not-team': 'This radio is not on a team.',
};
const COMMAND_WAIT_MS = 4000;
const RETRY_MS = 3000;
const MAX_LOAD_TRIES = 3;

let working = false;
let shareCode = '';
let loadTarget = '';
let loadTries = 0;
let nextLoad = 0;

const adapter = () => current().adapter;
const connection = () => adapter().connection;
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const showError = (error: unknown) =>
  setNotice('network-error', error instanceof Error ? error.message : String(error), 'bad');

function vault() {
  if (!encryption) throw new Error(encryptionError || 'Key storage is unavailable.');
  return encryption;
}
const team = () => (encryption?.unlocked ? encryption.team : undefined);

/** Whether the radio holds this browser's team, judged by fingerprint so no key is sent to check. */
function onThisTeam(keys: TeamKeys | undefined) {
  const status = connection().network;
  return (
    !!keys &&
    status?.networkMode === 2 &&
    status.generation === keys.generation &&
    status.epoch === keys.epoch &&
    status.relayFingerprint === chainFingerprint(keys.relayChain)
  );
}

async function waitFree() {
  const until = performance.now() + COMMAND_WAIT_MS;
  while (connection().networkBusy) {
    if (performance.now() > until) throw new Error('The radio is not answering.');
    await pause(25);
  }
}

/** Sends one network command and confirms the radio now shows the result. */
async function command(send: () => void, done: () => boolean) {
  await waitFree();
  send();
  await waitFree();
  if (done()) return;
  const state = connection().network?.state ?? '';
  throw new Error(REFUSALS[state] ?? 'No confirmation arrived. Check the radio status above.');
}

async function run(action: () => Promise<void>) {
  if (working) return;
  working = true;
  setNotice('network-error', undefined);
  render();
  try {
    await action();
  } catch (error) {
    showError(error);
  } finally {
    working = false;
    render();
  }
}

/** Adds the connected radio to this browser's team. A relay never gets the team key. */
function addRadio(role: 'member' | 'relay') {
  return run(async () => {
    const keys = team();
    const device = connection().device;
    if (!keys || !device) throw new Error('Connect a radio first.');
    const { deviceKey } = vault().enrollTeamRadio(device, role);
    loadTarget = '';
    if (onThisTeam(keys)) {
      // A relay must not hold the team key, and only erasing clears it from the radio's memory.
      if (role === 'member' || !connection().network?.teamLoaded) return;
      await command(
        () => adapter().eraseNetwork(),
        () => connection().network?.networkMode === 0,
      );
    }
    await command(
      () =>
        adapter().fillTeam({
          generation: keys.generation,
          epoch: keys.epoch,
          relayChain: keys.relayChain,
          deviceKey,
        }),
      () => onThisTeam(keys),
    );
  });
}

function chooseOpen() {
  return run(async () => {
    if (connection().network?.networkMode === 2) {
      const yes = await confirmSheet({
        title: 'Move this radio to Open mode?',
        body: 'It leaves its team, and anyone in range can read what it sends, including positions and who is talking to whom. Messages waiting to send are cancelled.',
        confirm: 'Use Open mode',
        danger: true,
      });
      if (!yes) return;
    }
    await command(
      () => adapter().chooseOpenMode(),
      () => connection().network?.networkMode === 1,
    );
  });
}

function leaveTeam() {
  return run(async () => {
    const keys = team();
    if (!keys) return;
    const here = onThisTeam(keys);
    const yes = await confirmSheet({
      title: `Leave ${keys.name}?`,
      body: here
        ? 'The team keys are removed from this browser and from this radio, which then sends nothing until you choose a network. You would need the QR code to rejoin.'
        : 'The team keys are removed from this browser. You would need the QR code to rejoin.',
      confirm: 'Leave team',
      danger: true,
    });
    if (!yes) return;
    // The radio goes first: if it refuses, this browser keeps the keys that could still reach it.
    if (here)
      await command(
        () => adapter().eraseNetwork(),
        () => connection().network?.networkMode === 0,
      );
    vault().leaveTeam();
  });
}

async function joinFromCode(value: string) {
  const keys = parseTeamInvite(value);
  const existing = team();
  if (existing?.relayChain === keys.relayChain && existing.teamChain === keys.teamChain) {
    openPage('network');
    return;
  }
  const yes = await confirmSheet({
    title: `Join ${keys.name}?`,
    body: existing
      ? `This replaces ${existing.name} in this browser. The keys are saved here, and your radio changes only when you add it.`
      : 'The team keys are saved in this browser. Your radio changes only when you add it on the next page.',
    confirm: 'Join team',
  });
  if (!yes) return;
  vault().setTeam(keys);
  openPage('network');
}

/** A radio forgets its team key when it restarts, so this reloads it whenever it is missing. */
function loadTeamKey() {
  const keys = team();
  const { network, device, sync } = connection();
  if (
    working ||
    sync.state !== 'ready' ||
    !keys ||
    !device ||
    network?.teamLoaded !== 0 ||
    !onThisTeam(keys) ||
    encryption?.teamRadioRole(device) === 'relay' ||
    connection().networkBusy
  )
    return;
  const target = `${device}:${sync.boot}:${keys.generation}`;
  if (target !== loadTarget) {
    loadTarget = target;
    loadTries = 0;
    nextLoad = 0;
  }
  const now = performance.now();
  if (loadTries >= MAX_LOAD_TRIES || now < nextLoad) return;
  loadTries++;
  nextLoad = now + RETRY_MS;
  try {
    adapter().loadTeamKey({
      generation: keys.generation,
      epoch: keys.epoch,
      teamChain: keys.teamChain,
    });
  } catch {
    // Tried again shortly. If it keeps failing the page says the key is not loaded.
  }
}

function summary() {
  const status = connection().supportsNetwork ? connection().network : undefined;
  if (!status) return undefined;
  const keys = team();
  const device = connection().device;
  if (status.networkMode === 0)
    return { short: 'Not chosen', long: 'Not chosen. This radio sends nothing until you choose.' };
  if (status.networkMode === 1)
    return {
      short: 'Open',
      long: 'Open: anyone in range can read this, including positions and who is talking to whom.',
    };
  if (!onThisTeam(keys))
    return {
      short: 'Other team',
      long: "On a team this browser doesn't have the keys for. It relays that team's traffic, but you can't send or read here.",
    };
  if (device && encryption?.teamRadioRole(device) === 'relay')
    return {
      short: `${keys!.name}, relay`,
      long: `A relay for ${keys!.name}. It forwards team traffic it can't read, and sends nothing of its own.`,
    };
  return status.teamLoaded
    ? { short: keys!.name, long: `On ${keys!.name}. Team traffic is encrypted.` }
    : {
        short: `${keys!.name}, no key`,
        long:
          loadTries >= MAX_LOAD_TRIES
            ? `On ${keys!.name}, but its team key would not load. It relays only.`
            : `On ${keys!.name}. Loading its team key…`,
      };
}

function renderPage() {
  const keys = team();
  const status = connection().supportsNetwork ? connection().network : undefined;
  const ready = connection().sync.state === 'ready';
  const unlocked = !!encryption?.unlocked;
  const here = onThisTeam(keys);
  const device = connection().device;
  const role = device ? encryption?.teamRadioRole(device) : undefined;
  setNotice(
    'network-support',
    !ready
      ? 'Connect a radio to change its network.'
      : !status
        ? "Update this radio's firmware to use a team."
        : undefined,
    'warn',
  );
  setNotice(
    'network-pin',
    keys && encryption && !encryption.protected
      ? 'Team keys are saved in this browser without a PIN. Set one in Device, This app, so a copy of this browser can’t be read.'
      : undefined,
    'warn',
  );
  text('network-summary', summary()?.long ?? 'No radio connected.');
  const canChange = ready && !!status && !working;
  const add = element<HTMLButtonElement>('network-add-member');
  const relay = element<HTMLButtonElement>('network-add-relay');
  add.hidden = !keys || (here && role !== 'relay');
  relay.hidden = !keys || (here && role === 'relay');
  add.disabled = relay.disabled = !canChange || !unlocked;
  text('network-add-member', here ? 'Make this radio a team member' : 'Add this radio to the team');
  text('network-add-relay', here ? 'Make this radio a relay only' : 'Add as a relay only');
  const open = element<HTMLButtonElement>('network-open');
  open.hidden = status?.networkMode === 1;
  open.disabled = !canChange;

  element('team-none').hidden = !!keys;
  element('team-joined').hidden = !keys;
  const name = element<HTMLInputElement>('team-name').value;
  element<HTMLButtonElement>('team-create').disabled = !unlocked || !validTeamName(name);
  element<HTMLButtonElement>('team-join').disabled = !unlocked;
  if (keys) text('team-title', keys.name);
  element<HTMLButtonElement>('team-leave').disabled = working;
}

function renderShare() {
  const keys = team();
  if (!keys) {
    if (isShowing('team-share')) backPage();
    return;
  }
  text('team-share-title', `Share ${keys.name}`);
  const code = formatTeamInvite(keys);
  if (code === shareCode) return;
  shareCode = code;
  element('team-qr').replaceChildren(qrSvg(code, `QR code for ${keys.name}`));
}

function clearShare() {
  shareCode = '';
  element('team-qr').replaceChildren();
  text('team-share-status', '');
}

/** Clears the team's QR code from the screen, for locking the app. */
export function closeTeamSecrets() {
  clearShare();
  if (currentPage() === 'team-share' && isShowing('team-share')) backPage();
}

export function renderNetwork() {
  if (mode.value === 'demo') demo.network.fingerprint = chainFingerprint;
  loadTeamKey();
  const row = summary();
  text('row-network', row?.short ?? '');
  if (isShowing('network')) renderPage();
  if (isShowing('team-share')) renderShare();
}

export function initNetwork() {
  setTeamCodeHandler(joinFromCode);
  onPageChange(left => {
    if (left === 'team-share') clearShare();
  });
  element('network-add-member').addEventListener('click', () => void addRadio('member'));
  element('network-add-relay').addEventListener('click', () => void addRadio('relay'));
  element('network-open').addEventListener('click', () => void chooseOpen());
  element('team-name').addEventListener('input', () => render());
  element('team-form').addEventListener('submit', event => {
    event.preventDefault();
    setNotice('network-error', undefined);
    const input = element<HTMLInputElement>('team-name');
    try {
      vault().setTeam(newTeam(input.value));
      input.value = '';
    } catch (error) {
      showError(error);
    }
    render();
  });
  element('team-join').addEventListener('click', () => openPage('channel-scan'));
  element('team-share-open').addEventListener('click', () => {
    clearShare();
    openPage('team-share');
  });
  element('team-leave').addEventListener('click', () => void leaveTeam());
  element('team-share-copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(shareCode);
      text('team-share-status', 'Copied.');
    } catch {
      text('team-share-status', 'This browser blocked copying.');
    }
  });
}
