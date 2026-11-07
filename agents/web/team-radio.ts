// Joining a team and moving a radio onto it, apart from the pages that drive them (D50, D51, D52).
import type { EncryptionVault, TeamRole } from './encryption.ts';
import type { TeamKeys } from './team.ts';

/**
 * Saves a scanned team. A team's chains change every epoch and its proof seed doesn't, so a code for
 * the team this browser already has can only move it forward: it keeps its radios and its interval,
 * and only a different team needs the operator's approval, because saving one forgets those radios.
 */
export async function joinTeam(
  vault: Pick<EncryptionVault, 'team' | 'setTeam' | 'advanceTeam'>,
  keys: TeamKeys,
  approve: (existing: TeamKeys | undefined) => Promise<boolean>,
  now = Date.now(),
) {
  const existing = vault.team;
  if (existing?.proofSeed === keys.proofSeed && existing.generation === keys.generation) {
    if (keys.epoch > existing.epoch)
      vault.advanceTeam({ ...keys, rotationHours: existing.rotationHours }, now);
    return 'same-team';
  }
  if (!(await approve(existing))) return 'declined';
  vault.setTeam(keys, now);
  return 'joined';
}

export type TeamRadioLink = Readonly<{
  /** Whether the radio now shows this browser's team. */
  onTeam: () => boolean;
  /** Whether the radio now holds the team key in memory. */
  teamLoaded: () => boolean;
  /** Each of these resolves once the radio confirms, and throws if it refuses or doesn't answer. */
  erase: () => Promise<void>;
  fill: (deviceKey: string) => Promise<void>;
}>;

/** Adds a radio to the team in the given role. A relay never gets the team key. */
export async function addRadioToTeam(
  vault: Pick<EncryptionVault, 'teamRadioRole' | 'enrollTeamRadio'>,
  device: string,
  role: TeamRole,
  radio: TeamRadioLink,
) {
  const prior = vault.teamRadioRole(device);
  const { deviceKey } = vault.enrollTeamRadio(device, role);
  try {
    if (radio.onTeam()) {
      // A relay must not hold the team key, and only erasing clears it from the radio's memory.
      if (role === 'member' || !radio.teamLoaded()) return;
      await radio.erase();
    }
    await radio.fill(deviceKey);
  } catch (error) {
    // It refused before anything changed and still holds the team key, so it didn't take the new
    // role. A radio with no role recorded here counts as a member, and holding the key makes it one.
    if (radio.onTeam() && radio.teamLoaded()) vault.enrollTeamRadio(device, prior ?? 'member');
    throw error;
  }
}
