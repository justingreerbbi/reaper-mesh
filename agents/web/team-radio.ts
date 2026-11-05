// Moving a radio onto this browser's team, apart from the page that drives it (D50, D51).
import type { EncryptionVault, TeamRole } from './encryption.ts';

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
