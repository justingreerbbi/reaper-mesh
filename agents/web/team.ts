/**
 * Team networks (D50): the keys a team shares, and the invite text behind a team QR code. The code
 * holds both chains, so anyone who gets it joins the team. Versioned JSON that ignores unknown
 * fields, so later fields can be added.
 */
import sodium from 'libsodium-wrappers-sumo';

await sodium.ready;

export const TEAM_PREFIX = 'RMTEAM1.';
const NAME = /^[A-Za-z0-9 _-]{1,24}$/;
const CHAIN = /^[0-9a-f]{64}$/;

export type TeamKeys = Readonly<{
  name: string;
  generation: number;
  epoch: number;
  relayChain: string;
  teamChain: string;
}>;

export const validTeamName = (name: string) => NAME.test(name) && name.trim() === name;

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
    !/^0+$/.test(keys.teamChain)
  );
}

export const newChain = () => sodium.to_hex(sodium.randombytes_buf(32));

export function newTeam(name: string): TeamKeys {
  if (!validTeamName(name))
    throw new Error('Use up to 24 letters, numbers, spaces, - or _, with no space at either end.');
  return { name, generation: 1, epoch: 0, relayChain: newChain(), teamChain: newChain() };
}

export function formatTeamInvite(keys: TeamKeys) {
  if (!validTeamKeys(keys)) throw new Error('This team is invalid.');
  const json = JSON.stringify({
    format: 'RMTEAM1',
    name: keys.name,
    generation: keys.generation,
    epoch: keys.epoch,
    relay: keys.relayChain,
    team: keys.teamChain,
  });
  return (
    TEAM_PREFIX +
    sodium.to_base64(new TextEncoder().encode(json), sodium.base64_variants.URLSAFE_NO_PADDING)
  );
}

/** Reads a scanned or pasted code. Throws with a message fit to show the user. */
export function parseTeamInvite(text: string): TeamKeys {
  const value = text.trim();
  if (!value.startsWith(TEAM_PREFIX)) throw new Error('A team code starts with RMTEAM1.');
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
  } as TeamKeys;
  if (raw?.format !== 'RMTEAM1' || !validTeamKeys(keys))
    throw new Error('This team code is invalid.');
  return keys;
}

/** The same fingerprint firmware reports, so the two can be compared without sending a key. */
export function chainFingerprint(chain: string) {
  return sodium
    .to_hex(sodium.crypto_auth_hmacsha256('reaper-v2 fingerprint', sodium.from_hex(chain)))
    .slice(0, 16);
}
