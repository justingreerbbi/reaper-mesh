// The radio network page (D50): creating or joining a team, adding this radio, and sharing the
// team's QR code. Keys live in this browser's vault. They go to the radio only when the operator
// adds it, and the team key is reloaded whenever a radio needs it, because it lives in memory there.
// It also rotates the team's keys on schedule while a radio on the team is connected (D52).
import { current, demo, encryption, encryptionError, mode, render } from './app-state.ts';
import { element, text } from './dom.ts';
import { backPage, currentPage, isShowing, onPageChange, openPage } from './nav.ts';
import { qrSvg } from './qr.ts';
import { setTeamCodeHandler } from './channels-ui.ts';
import { addRadioToTeam } from './team-radio.ts';
import {
  chainFingerprint,
  formatTeamInvite,
  newTeam,
  parseTeamInvite,
  teamAtEpoch,
  teamProof,
  validRotationHours,
  validTeamName,
  type TeamKeys,
} from './team.ts';
import { confirmSheet, setNotice } from './ui.ts';
import {
  EPOCH_LOOK_AHEAD,
  epochsAheadOfSchedule,
  lastProofEpoch,
  rotationStep,
} from '../../packages/agent-core/rotation.ts';

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
const MAX_ADVANCE_TRIES = 3;
/** About two months at the default interval, so there is time to set up a new team. */
const CHAIN_WARNING_EPOCHS = 64;

let working = false;
let shareCode = '';
let loadTarget = '';
let loadTries = 0;
let nextLoad = 0;
let advanceTarget = '';
let advanceTries = 0;
let nextAdvance = 0;
let rotateRequested = false;
let aheadBy = 0;
// Checking a proof can take thousands of hashes, and the page renders ten times a second.
let proofMemo: { seed: string; epoch: number; proof: string } | undefined;

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

function memoProof(keys: TeamKeys, epoch: number) {
  if (proofMemo?.seed !== keys.proofSeed || proofMemo.epoch !== epoch)
    proofMemo = { seed: keys.proofSeed, epoch, proof: teamProof(keys, epoch) };
  return proofMemo.proof;
}

/** Whether the radio's proof comes from this team's chain, at any epoch, with no key sent to check. */
function holdsTeamProof(keys: TeamKeys | undefined) {
  const status = connection().network;
  const epoch = status?.provenEpoch;
  return (
    !!keys &&
    status?.networkMode === 2 &&
    status.generation === keys.generation &&
    epoch !== undefined &&
    epoch >= keys.proofStart &&
    epoch <= lastProofEpoch(keys.proofStart) &&
    status.proof === memoProof(keys, epoch)
  );
}

/** On this team, but too far behind to follow it. Adding it again brings it back. */
function lockedOut(keys: TeamKeys | undefined) {
  return (
    !!keys &&
    holdsTeamProof(keys) &&
    keys.epoch - connection().network!.provenEpoch! > EPOCH_LOOK_AHEAD
  );
}

/** Whether the radio holds this browser's team and can follow it. */
function onThisTeam(keys: TeamKeys | undefined) {
  return holdsTeamProof(keys) && !lockedOut(keys);
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

/** Adds the connected radio to this browser's team. */
function addRadio(role: 'member' | 'relay') {
  return run(async () => {
    const keys = team();
    const device = connection().device;
    if (!keys || !device) throw new Error('Connect a radio first.');
    loadTarget = '';
    await addRadioToTeam(vault(), device, role, {
      onTeam: () => onThisTeam(keys),
      teamLoaded: () => !!connection().network?.teamLoaded,
      erase: () =>
        command(
          () => adapter().eraseNetwork(),
          () => connection().network?.networkMode === 0,
        ),
      fill: deviceKey =>
        command(
          () =>
            adapter().fillTeam({
              generation: keys.generation,
              epoch: keys.epoch,
              relayChain: keys.relayChain,
              deviceKey,
              proof: teamProof(keys, keys.epoch),
            }),
          () => onThisTeam(keys),
        ),
    });
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
    proofMemo = undefined;
    aheadBy = advanceTries = 0;
    rotateRequested = false;
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
  aheadBy = advanceTries = 0;
  openPage('network');
}

/**
 * Keeps this browser and its radio on the same epoch, and starts the next one when it is due. Every
 * browser computes the same keys, so two advancing at once cannot split the team.
 */
function rotate() {
  const keys = team();
  const { network, device, sync, supportsRotation, networkBusy } = connection();
  if (
    working ||
    sync.state !== 'ready' ||
    !keys ||
    !device ||
    !supportsRotation ||
    !network ||
    network.provenEpoch === undefined ||
    networkBusy ||
    !holdsTeamProof(keys)
  )
    return;
  const now = Date.now();
  const advancedAt = encryption?.teamAdvancedAt ?? now;
  const step = rotationStep(
    keys,
    { epoch: network.epoch, provenEpoch: network.provenEpoch },
    advancedAt,
    now,
    rotateRequested,
  );
  try {
    if (step?.kind === 'follow') {
      const ahead = epochsAheadOfSchedule(keys, step.epoch, advancedAt, now);
      if (ahead > 2) aheadBy = ahead;
      vault().advanceTeam(teamAtEpoch(keys, step.epoch), now);
    } else if (step?.kind === 'advance') {
      // Saved first: if the radio doesn't take it, the catch-up below tries again.
      vault().advanceTeam(teamAtEpoch(keys, step.epoch), now);
      rotateRequested = false;
      aheadBy = 0;
    } else if (step?.kind === 'catch-up') {
      const target = `${device}:${sync.boot}:${step.epoch}`;
      if (target !== advanceTarget) {
        advanceTarget = target;
        advanceTries = 0;
        nextAdvance = 0;
      }
      const clock = performance.now();
      if (advanceTries >= MAX_ADVANCE_TRIES || clock < nextAdvance) return;
      advanceTries++;
      nextAdvance = clock + RETRY_MS;
      adapter().advanceNetwork({ epoch: step.epoch, proof: memoProof(keys, step.epoch) });
    } else if (rotateRequested) {
      rotateRequested = false;
    }
  } catch (error) {
    rotateRequested = false;
    showError(error);
  }
}

function plural(count: number, unit: string) {
  return `${count} ${unit}${count === 1 ? '' : 's'}`;
}

function span(ms: number) {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 90) return plural(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  return hours < 48 ? plural(hours, 'hour') : plural(Math.round(hours / 24), 'day');
}

function rotationSummary(keys: TeamKeys) {
  const now = Date.now();
  const at = encryption?.teamAdvancedAt ?? now;
  const age = `Keys last rotated ${span(now - at)} ago, at epoch ${keys.epoch}.`;
  if (keys.epoch >= lastProofEpoch(keys.proofStart)) return `${age} Rotation has stopped.`;
  if (!onThisTeam(keys)) return `${age} The next rotation waits for a radio on this team.`;
  const due = at + keys.rotationHours * 3_600_000 - now;
  return due > 0 ? `${age} Next rotation in about ${span(due)}.` : `${age} Rotating now…`;
}

function rotationNotice(keys: TeamKeys | undefined) {
  if (!keys)
    return encryption?.droppedOldTeam
      ? 'The team saved in this browser was from an older version and has been removed. Create or join a team again, and add your radios to it.'
      : undefined;
  if (lockedOut(keys))
    return 'This radio was off for too long to catch up with the team. Add it to the team again.';
  const left = lastProofEpoch(keys.proofStart) - keys.epoch;
  if (left <= 0) return 'This team has used all of its rotations. Create a new team.';
  if (left <= CHAIN_WARNING_EPOCHS)
    return `This team has ${plural(left, 'rotation')} left. Create a new team before they run out.`;
  if (aheadBy)
    return `The team's keys moved ${plural(aheadBy, 'rotation')} ahead of schedule. This can mean a browser's clock is wrong, or that someone with the team's keys is misusing them.`;
  const status = connection().network;
  if (advanceTries >= MAX_ADVANCE_TRIES && status?.provenEpoch !== keys.epoch && onThisTeam(keys))
    return REFUSALS[status?.state ?? ''] ?? 'This radio has not moved to the current keys yet.';
  return undefined;
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
  if (lockedOut(keys))
    return {
      short: `${keys!.name}, locked out`,
      long: `This radio has the old keys of ${keys!.name}, and can no longer reach the team.`,
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
      : !status || !connection().supportsRotation
        ? "Update this radio's firmware to use a team."
        : undefined,
    'warn',
  );
  setNotice('network-rotation', rotationNotice(keys), 'warn');
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
  if (keys) {
    text('team-title', keys.name);
    text('team-rotation-status', rotationSummary(keys));
    const interval = element<HTMLSelectElement>('team-interval');
    // Not while it is open, or a render would close it.
    if (document.activeElement !== interval) interval.value = String(keys.rotationHours);
    interval.disabled = !unlocked;
    element<HTMLButtonElement>('team-rotate').disabled =
      !unlocked ||
      !here ||
      working ||
      rotateRequested ||
      keys.epoch >= lastProofEpoch(keys.proofStart) ||
      !connection().supportsRotation;
  }
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
  proofMemo = undefined;
  if (currentPage() === 'team-share' && isShowing('team-share')) backPage();
}

export function renderNetwork() {
  if (mode.value === 'demo') demo.network.fingerprint = chainFingerprint;
  rotate();
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
  element('team-rotate').addEventListener('click', () => {
    setNotice('network-error', undefined);
    rotateRequested = true;
    render();
  });
  element('team-interval').addEventListener('change', event => {
    const hours = Number((event.target as HTMLSelectElement).value);
    try {
      if (!validRotationHours(hours)) throw new Error('Choose between 6 hours and 7 days.');
      vault().setTeamRotation(hours);
    } catch (error) {
      showError(error);
    }
    render();
  });
  element('team-share-copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(shareCode);
      text('team-share-status', 'Copied.');
    } catch {
      text('team-share-status', 'This browser blocked copying.');
    }
  });
}
