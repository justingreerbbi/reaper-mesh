/**
 * Automatic key rotation (D50, D52): the chains and epoch proofs an agent keeps. Shared with mobile
 * agents, so it takes HMAC-SHA-256 as an argument rather than depending on a crypto library, and
 * packages/protocol/fixtures/frame-v2.json pins the results. All of it is pure.
 *
 * Both chains move forward one way: today's key gives every later one and no earlier one. The proof
 * chain runs the other way: a later proof gives every earlier one, so revealing a proof shows that
 * someone holding the seed has started that epoch. A relay key alone can never produce one.
 */
export type Hmac = (key: Uint8Array, message: Uint8Array) => Uint8Array;

/** How many epochs one proof chain covers. Running out needs a new generation. */
export const PROOF_CHAIN_EPOCHS = 4096;
/** How far ahead of its floor a radio can follow. A radio further behind needs filling again. */
export const EPOCH_LOOK_AHEAD = 1024;
export const MIN_ROTATION_HOURS = 6;
export const MAX_ROTATION_HOURS = 168;
const HOUR_MS = 3_600_000;

const encoder = new TextEncoder();
const RATCHET = encoder.encode('reaper-v2 ratchet');
const PROOF = encoder.encode('reaper-v2 epoch proof');
const fromHex = (hex: string) =>
  Uint8Array.from(hex.match(/../g) ?? [], byte => parseInt(byte, 16));
const toHex = (bytes: Uint8Array) =>
  Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');

/** The chain this many epochs later. */
export function ratchetChain(hmac: Hmac, chain: string, steps: number) {
  let key: Uint8Array = fromHex(chain);
  for (let i = 0; i < steps; i++) key = hmac(key, RATCHET);
  return toHex(key);
}

export const lastProofEpoch = (start: number) => start + PROOF_CHAIN_EPOCHS - 1;

/** The proof for an epoch. The seed is the proof for the chain's last epoch. */
export function proofAt(hmac: Hmac, seed: string, start: number, epoch: number) {
  if (!Number.isInteger(epoch) || epoch < start || epoch > lastProofEpoch(start))
    throw new Error('This epoch is outside the proof chain.');
  let proof: Uint8Array = fromHex(seed);
  for (let at = lastProofEpoch(start); at > epoch; at--) proof = hmac(proof, PROOF);
  return toHex(proof);
}

export type RotationKeys = Readonly<{
  epoch: number;
  proofStart: number;
  rotationHours: number;
}>;
export type RadioEpochs = Readonly<{
  /** What the radio sends with if it holds the team key, and its floor otherwise. */
  epoch: number;
  provenEpoch: number;
}>;
export type RotationStep =
  /** The radio is ahead of this agent, which should follow it. */
  | Readonly<{ kind: 'follow'; epoch: number }>
  /** The radio is behind this agent, which should send it the proof it is missing. */
  | Readonly<{ kind: 'catch-up'; epoch: number }>
  /** This agent's schedule says it is time for the next epoch. */
  | Readonly<{ kind: 'advance'; epoch: number }>
  /** The radio has been off for too long to follow, and needs filling again. */
  | Readonly<{ kind: 'locked-out' }>
  /** Nothing to do yet. */
  | undefined;

/**
 * What an agent should do next. It moves one epoch at a time on its own schedule, so a wrong clock
 * can cost at most one early advance per session rather than a jump. `force` is the operator asking
 * for a rotation now.
 */
export function rotationStep(
  keys: RotationKeys,
  radio: RadioEpochs,
  advancedAt: number,
  now: number,
  force = false,
): RotationStep {
  const ahead = Math.max(radio.epoch, radio.provenEpoch);
  // An epoch past the end of the chain cannot be this team's, so it is not followed.
  if (ahead > keys.epoch && ahead <= lastProofEpoch(keys.proofStart))
    return { kind: 'follow', epoch: ahead };
  if (keys.epoch - radio.provenEpoch > EPOCH_LOOK_AHEAD) return { kind: 'locked-out' };
  if (radio.provenEpoch < keys.epoch) return { kind: 'catch-up', epoch: keys.epoch };
  if (keys.epoch >= lastProofEpoch(keys.proofStart)) return undefined;
  return force || now - advancedAt >= keys.rotationHours * HOUR_MS
    ? { kind: 'advance', epoch: keys.epoch + 1 }
    : undefined;
}

/**
 * How many rotations a follow moves past what this agent's schedule expected. Above two it suggests
 * a misbehaving member or a stolen team key, because honest agents all keep to about the same pace.
 */
export function epochsAheadOfSchedule(
  keys: RotationKeys,
  epoch: number,
  advancedAt: number,
  now: number,
) {
  const expected = Math.max(0, now - advancedAt) / (keys.rotationHours * HOUR_MS);
  return Math.max(0, Math.floor(epoch - keys.epoch - expected));
}
