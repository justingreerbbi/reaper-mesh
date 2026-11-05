/**
 * Team networks (D50, D52): the keys a team shares, and the invite text behind a team QR code. The
 * code holds both chains at the current epoch and the seed for epoch proofs, so anyone who gets it
 * joins the team, and cannot read recordings from before that epoch. Versioned JSON that ignores
 * unknown fields, so later fields can be added.
 */
import sodium from 'libsodium-wrappers-sumo';
import {
  lastProofEpoch,
  MAX_ROTATION_HOURS,
  MIN_ROTATION_HOURS,
  proofAt,
  ratchetChain,
  type Hmac,
} from '../../packages/agent-core/rotation.ts';

await sodium.ready;

export const TEAM_PREFIX = 'RMTEAM2.';
const hmac: Hmac = (key, message) => sodium.crypto_auth_hmacsha256(message, key);
export const DEFAULT_ROTATION_HOURS = 24;
const NAME = /^[A-Za-z0-9 _-]{1,24}$/;
const CHAIN = /^[0-9a-f]{64}$/;

export type TeamKeys = Readonly<{
  name: string;
  generation: number;
  epoch: number;
  relayChain: string;
  teamChain: string;
  proofSeed: string;
  /** The epoch this generation's proof chain starts at. */
  proofStart: number;
  rotationHours: number;
}>;

export const validTeamName = (name: string) => NAME.test(name) && name.trim() === name;
export const validRotationHours = (hours: number) =>
  Number.isInteger(hours) && hours >= MIN_ROTATION_HOURS && hours <= MAX_ROTATION_HOURS;

export function validTeamKeys(keys: TeamKeys) {
  return (
    typeof keys?.name === 'string' &&
    validTeamName(keys.name) &&
    Number.isInteger(keys.generation) &&
    keys.generation >= 1 &&
    keys.generation <= 0xffff &&
    Number.isInteger(keys.epoch) &&
    keys.epoch >= 0 &&
    keys.epoch <= 0xffff &&
    typeof keys.relayChain === 'string' &&
    CHAIN.test(keys.relayChain) &&
    typeof keys.teamChain === 'string' &&
    CHAIN.test(keys.teamChain) &&
    keys.relayChain !== keys.teamChain &&
    !/^0+$/.test(keys.relayChain) &&
    !/^0+$/.test(keys.teamChain) &&
    typeof keys.proofSeed === 'string' &&
    CHAIN.test(keys.proofSeed) &&
    !/^0+$/.test(keys.proofSeed) &&
    Number.isInteger(keys.proofStart) &&
    keys.proofStart >= 0 &&
    keys.proofStart <= keys.epoch &&
    keys.epoch <= lastProofEpoch(keys.proofStart) &&
    validRotationHours(keys.rotationHours)
  );
}

export const newChain = () => sodium.to_hex(sodium.randombytes_buf(32));

export function newTeam(name: string): TeamKeys {
  if (!validTeamName(name))
    throw new Error('Use up to 24 letters, numbers, spaces, - or _, with no space at either end.');
  return {
    name,
    generation: 1,
    epoch: 0,
    relayChain: newChain(),
    teamChain: newChain(),
    proofSeed: newChain(),
    proofStart: 0,
    rotationHours: DEFAULT_ROTATION_HOURS,
  };
}

/** The proof for an epoch. Public once released, and what a radio checks before erasing old keys. */
export const teamProof = (keys: TeamKeys, epoch: number) =>
  proofAt(hmac, keys.proofSeed, keys.proofStart, epoch);

/** The team's keys at a later epoch. The earlier chains cannot be worked out from these. */
export function teamAtEpoch(keys: TeamKeys, epoch: number): TeamKeys {
  if (!Number.isInteger(epoch) || epoch < keys.epoch || epoch > lastProofEpoch(keys.proofStart))
    throw new Error('This team cannot move to that epoch.');
  const steps = epoch - keys.epoch;
  return {
    ...keys,
    epoch,
    relayChain: ratchetChain(hmac, keys.relayChain, steps),
    teamChain: ratchetChain(hmac, keys.teamChain, steps),
  };
}

export function formatTeamInvite(keys: TeamKeys) {
  if (!validTeamKeys(keys)) throw new Error('This team is invalid.');
  const json = JSON.stringify({
    format: 'RMTEAM2',
    name: keys.name,
    generation: keys.generation,
    epoch: keys.epoch,
    relay: keys.relayChain,
    team: keys.teamChain,
    proof: keys.proofSeed,
    proofStart: keys.proofStart,
    rotationHours: keys.rotationHours,
  });
  return (
    TEAM_PREFIX +
    sodium.to_base64(new TextEncoder().encode(json), sodium.base64_variants.URLSAFE_NO_PADDING)
  );
}

/** Reads a scanned or pasted code. Throws with a message fit to show the user. */
export function parseTeamInvite(text: string): TeamKeys {
  const value = text.trim();
  if (!value.startsWith(TEAM_PREFIX)) throw new Error('A team code starts with RMTEAM2.');
  if (value.length > 2048) throw new Error('This team code is too long.');
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(
        sodium.from_base64(
          value.slice(TEAM_PREFIX.length),
          sodium.base64_variants.URLSAFE_NO_PADDING,
        ),
      ),
    );
  } catch {
    throw new Error('This team code is damaged.');
  }
  const keys = {
    name: raw?.name,
    generation: raw?.generation,
    epoch: raw?.epoch,
    relayChain: raw?.relay,
    teamChain: raw?.team,
    proofSeed: raw?.proof,
    proofStart: raw?.proofStart,
    rotationHours: raw?.rotationHours,
  } as TeamKeys;
  if (raw?.format !== 'RMTEAM2' || !validTeamKeys(keys))
    throw new Error('This team code is invalid.');
  return keys;
}

/** The same fingerprint firmware reports, so the two can be compared without sending a key. */
export function chainFingerprint(chain: string) {
  return sodium
    .to_hex(sodium.crypto_auth_hmacsha256('reaper-v2 fingerprint', sodium.from_hex(chain)))
    .slice(0, 16);
}
