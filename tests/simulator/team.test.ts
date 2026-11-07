import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { EncryptionVault } from '../../agents/web/encryption.ts';
import { qrPixels, readQr } from '../../agents/web/qr.ts';
import { addRadioToTeam, joinTeam } from '../../agents/web/team-radio.ts';
import {
  EPOCH_LOOK_AHEAD,
  epochsAheadOfSchedule,
  lastProofEpoch,
  proofAt,
  ratchetChain,
  rotationStep,
  type Hmac,
} from '../../packages/agent-core/rotation.ts';
import {
  chainFingerprint,
  formatTeamInvite,
  newTeam,
  parseTeamInvite,
  teamAtEpoch,
  teamProof,
  validTeamName,
} from '../../agents/web/team.ts';

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

test('a team code carries the keys and round trips', () => {
  const team = newTeam('Alpha Team');
  assert.equal(team.generation, 1);
  assert.equal(team.epoch, 0);
  assert.notEqual(team.relayChain, team.teamChain);
  assert.notEqual(newTeam('Alpha Team').teamChain, team.teamChain);
  assert.deepEqual(parseTeamInvite(`  ${formatTeamInvite(team)}\n`), team);
});

test('team names are bounded and malformed codes are refused with a message', () => {
  for (const name of ['', ' padded', 'padded ', 'x'.repeat(25), 'emoji🙂', '<b>'])
    assert.equal(validTeamName(name), false, name);
  assert.throws(() => newTeam('<b>'), /letters/);
  assert.throws(() => parseTeamInvite('RMCH1.abc'), /starts with/);
  assert.throws(() => parseTeamInvite('RMTEAM2.!!!'), /damaged/);
  assert.throws(() => parseTeamInvite('RMTEAM1.abc'), /starts with/);
  assert.throws(() => parseTeamInvite(`RMTEAM2.${'a'.repeat(3000)}`), /too long/);
  const encode = (value: object) =>
    `RMTEAM2.${Buffer.from(JSON.stringify(value)).toString('base64url')}`;
  const good = {
    format: 'RMTEAM2',
    name: 'A',
    generation: 1,
    epoch: 0,
    relay: 'ab'.repeat(32),
    team: 'cd'.repeat(32),
    proof: 'ef'.repeat(32),
    proofStart: 0,
    rotationHours: 24,
  };
  assert.equal(parseTeamInvite(encode(good)).name, 'A');
  assert.equal(parseTeamInvite(encode({ ...good, future: 1 })).name, 'A');
  for (const bad of [
    { ...good, format: 'RMTEAM1' },
    { ...good, name: '<script>' },
    { ...good, generation: 0 },
    { ...good, epoch: -1 },
    { ...good, relay: 'ab' },
    { ...good, team: good.relay },
    { ...good, team: '00'.repeat(32) },
    { ...good, proof: 'ef' },
    { ...good, proof: '00'.repeat(32) },
    { ...good, proofStart: 1 },
    { ...good, epoch: 4096 },
    { ...good, rotationHours: 5 },
    { ...good, rotationHours: 169 },
    { ...good, rotationHours: 6.5 },
  ])
    assert.throws(() => parseTeamInvite(encode(bad)), /invalid/);
});

test('fingerprints match an independent calculation and the firmware test vector', () => {
  const independent = (chain: string) =>
    createHmac('sha256', Buffer.from(chain, 'hex'))
      .update('reaper-v2 fingerprint')
      .digest('hex')
      .slice(0, 16);
  const chain = newTeam('A').relayChain;
  assert.equal(chainFingerprint(chain), independent(chain));
  // firmware/tests/network_test.cpp checks the same two values.
  assert.equal(chainFingerprint('11'.repeat(32)), '53bb84e9427aeb94');
  assert.equal(chainFingerprint('33'.repeat(32)), '992f5023c1997e44');
});

test('a team survives a reload and stays encrypted behind a PIN', () => {
  const storage = new MemoryStorage();
  const first = new EncryptionVault(storage);
  const team = newTeam('Alpha');
  assert.equal(first.team, undefined);
  first.setTeam(team);
  const { deviceKey } = first.enrollTeamRadio('node-a', 'member');
  assert.match(deviceKey, /^[0-9a-f]{64}$/);
  // A radio keeps its device key when its role changes, and each radio has its own.
  assert.equal(first.enrollTeamRadio('node-a', 'relay').deviceKey, deviceKey);
  assert.notEqual(first.enrollTeamRadio('node-b', 'member').deviceKey, deviceKey);
  first.setPin('123456', '123456');

  const raw = storage.getItem('reaper-mesh.crypto-vault.v1')!;
  for (const secret of [team.relayChain, team.teamChain, deviceKey, 'Alpha'])
    assert.ok(!raw.includes(secret));

  const second = new EncryptionVault(storage);
  assert.equal(second.unlocked, false);
  assert.throws(() => second.enrollTeamRadio('node-c', 'member'));
  second.unlock('123456');
  assert.deepEqual(second.team, team);
  assert.equal(second.teamRadioRole('node-a'), 'relay');
  assert.equal(second.teamRadioRole('node-b'), 'member');
  second.lock();
  assert.equal(second.team, undefined);
  second.unlock('123456');
  second.leaveTeam();
  assert.equal(second.team, undefined);
  assert.equal(second.teamRadioRole('node-a'), undefined);
  const third = new EncryptionVault(storage);
  third.unlock('123456');
  assert.equal(third.team, undefined);
});

test('a team cannot be saved while locked or damaged, and a failed save keeps the old one', () => {
  const storage = new MemoryStorage();
  const vault = new EncryptionVault(storage);
  const team = newTeam('Alpha');
  assert.throws(() => vault.setTeam({ ...team, relayChain: 'zz' }), /invalid/);
  assert.equal(vault.team, undefined);
  vault.setTeam(team);
  const failing = new EncryptionVault({
    getItem: key => storage.getItem(key),
    setItem: () => {
      throw new Error('full');
    },
  });
  assert.deepEqual(failing.team, team);
  assert.throws(() => failing.leaveTeam(), /full/);
  assert.deepEqual(failing.team, team);
  const stored = JSON.parse(storage.getItem('reaper-mesh.crypto-vault.v1')!);
  const undated = JSON.parse(storage.getItem('reaper-mesh.crypto-vault.v1')!);
  delete undated.record.team.advancedAt;
  storage.setItem('reaper-mesh.crypto-vault.v1', JSON.stringify(undated));
  assert.throws(() => new EncryptionVault(storage), /damaged/);
  stored.record.team.teamChain = 'nope';
  storage.setItem('reaper-mesh.crypto-vault.v1', JSON.stringify(stored));
  assert.throws(() => new EncryptionVault(storage), /damaged/);
});

test('a team QR code reads back exactly', () => {
  const code = formatTeamInvite(newTeam('x'.repeat(24)));
  const { data, width } = qrPixels(code, 6);
  assert.equal(readQr(new Uint8ClampedArray(data), width, width), code);
});

const nodeHmac: Hmac = (key, message) => createHmac('sha256', key).update(message).digest();
const frameVectors = JSON.parse(readFileSync('packages/protocol/fixtures/frame-v2.json', 'utf8'));

test('rotation matches the frozen vectors and the firmware chains', () => {
  const { seed, proofs } = frameVectors.proofChain as { seed: string; proofs: string[] };
  proofs.forEach((proof, index) =>
    assert.equal(proofAt(nodeHmac, seed, 0, lastProofEpoch(0) - index), proof),
  );
  assert.throws(() => proofAt(nodeHmac, seed, 0, lastProofEpoch(0) + 1), /outside/);
  assert.throws(() => proofAt(nodeHmac, seed, 10, 9), /outside/);
  // A proof chain only depends on an epoch's distance from the end, wherever it starts.
  assert.equal(
    proofAt(nodeHmac, seed, 10, lastProofEpoch(10) - 1),
    proofAt(nodeHmac, seed, 0, lastProofEpoch(0) - 1),
  );
  // The same frames firmware makes come from these chains: see frame-cpp.test.ts.
  const vector = frameVectors.vectors[0];
  const ratcheted = ratchetChain(nodeHmac, vector.relayChain, 2);
  assert.equal(ratchetChain(nodeHmac, ratcheted, 1), ratchetChain(nodeHmac, vector.relayChain, 3));
  assert.equal(ratchetChain(nodeHmac, vector.relayChain, 0), vector.relayChain);
});

test('a team moves forward only, and the portal library agrees with an independent HMAC', () => {
  const team = newTeam('Alpha');
  const later = teamAtEpoch(team, 3);
  assert.equal(later.epoch, 3);
  assert.equal(later.relayChain, ratchetChain(nodeHmac, team.relayChain, 3));
  assert.equal(later.teamChain, ratchetChain(nodeHmac, team.teamChain, 3));
  assert.equal(later.proofSeed, team.proofSeed);
  assert.equal(teamProof(team, 7), proofAt(nodeHmac, team.proofSeed, 0, 7));
  // Moving in two steps or one gives the same keys, so agents can't fork.
  assert.deepEqual(teamAtEpoch(teamAtEpoch(team, 1), 3), later);
  assert.throws(() => teamAtEpoch(later, 2), /cannot move/);
  assert.throws(() => teamAtEpoch(team, lastProofEpoch(0) + 1), /cannot move/);
  // A code from later on still works, and carries no earlier chain.
  const code = formatTeamInvite(later);
  assert.deepEqual(parseTeamInvite(code), later);
  assert.ok(!Buffer.from(code.split('.')[1], 'base64url').toString().includes(team.relayChain));
  assert.ok(!Buffer.from(code.split('.')[1], 'base64url').toString().includes(team.teamChain));
});

test('rotation follows the radio, catches it up, and advances only when due', () => {
  const HOUR = 3_600_000;
  const keys = { epoch: 10, proofStart: 0, rotationHours: 24 };
  const at = 1_000_000;
  const radio = (epoch: number, provenEpoch = epoch) => ({ epoch, provenEpoch });
  // On schedule: nothing until the interval has passed, however often it is asked.
  assert.equal(rotationStep(keys, radio(10), at, at + 23 * HOUR), undefined);
  assert.deepEqual(rotationStep(keys, radio(10), at, at + 24 * HOUR), {
    kind: 'advance',
    epoch: 11,
  });
  // A clock far in the future moves one epoch, not many.
  assert.deepEqual(rotationStep(keys, radio(10), at, at + 9000 * HOUR), {
    kind: 'advance',
    epoch: 11,
  });
  assert.equal(rotationStep(keys, radio(10), at, at - HOUR), undefined);
  // Asked for directly.
  assert.deepEqual(rotationStep(keys, radio(10), at, at, true), { kind: 'advance', epoch: 11 });
  // The radio is ahead, by a proof or a verified team tag: this agent follows, ahead of any advance.
  assert.deepEqual(rotationStep(keys, radio(12), at, at + 24 * HOUR), {
    kind: 'follow',
    epoch: 12,
  });
  assert.deepEqual(rotationStep(keys, radio(14, 12), at, at), { kind: 'follow', epoch: 14 });
  assert.deepEqual(rotationStep(keys, radio(9, 12), at, at), { kind: 'follow', epoch: 12 });
  // The radio is behind: send what it is missing, rather than starting another epoch.
  assert.deepEqual(rotationStep(keys, radio(8), at, at + 24 * HOUR), {
    kind: 'catch-up',
    epoch: 10,
  });
  // An unproven radio floor one below is normal, and needs nothing.
  assert.equal(rotationStep(keys, radio(9, 10), at, at), undefined);
  // Too far behind to prove anything to it.
  const far = { ...keys, epoch: 100 + EPOCH_LOOK_AHEAD + 1 };
  assert.deepEqual(rotationStep(far, radio(100), at, at), { kind: 'locked-out' });
  assert.deepEqual(rotationStep({ ...far, epoch: 100 + EPOCH_LOOK_AHEAD }, radio(100), at, at), {
    kind: 'catch-up',
    epoch: 100 + EPOCH_LOOK_AHEAD,
  });
  // The chain's end stops rotation rather than failing, and nothing past it is followed.
  const last = { ...keys, epoch: lastProofEpoch(0) };
  assert.equal(rotationStep(last, radio(last.epoch), at, at + 24 * HOUR, true), undefined);
  assert.equal(rotationStep(keys, radio(lastProofEpoch(0) + 1), at, at), undefined);
  // Being away accounts for a jump. A jump with no time passing is worth a warning.
  assert.equal(epochsAheadOfSchedule(keys, 12, at, at + 72 * HOUR), 0);
  assert.equal(epochsAheadOfSchedule(keys, 13, at, at), 3);
  assert.equal(epochsAheadOfSchedule(keys, 13, at, at - HOUR), 3);
});

test('the vault keeps only the current chains and survives a reload', () => {
  const storage = new MemoryStorage();
  const vault = new EncryptionVault(storage);
  const team = newTeam('Alpha');
  vault.setTeam(team, 1000);
  assert.equal(vault.teamAdvancedAt, 1000);
  const { deviceKey } = vault.enrollTeamRadio('node-a', 'member');
  const later = teamAtEpoch(team, 2);
  vault.advanceTeam(later, 2000);
  assert.deepEqual(vault.team, later);
  assert.equal(vault.teamAdvancedAt, 2000);
  assert.equal(vault.teamRadioRole('node-a'), 'member');
  assert.equal(vault.enrollTeamRadio('node-a', 'member').deviceKey, deviceKey);
  const raw = storage.getItem('reaper-mesh.crypto-vault.v1')!;
  assert.ok(!raw.includes(team.relayChain) && !raw.includes(team.teamChain));
  assert.throws(() => vault.advanceTeam(team, 3000), /invalid/);
  assert.throws(() => vault.advanceTeam({ ...later, relayChain: 'zz' }, 3000), /invalid/);
  assert.equal(vault.teamAdvancedAt, 2000);
  vault.setTeamRotation(6);
  assert.equal(vault.team?.rotationHours, 6);
  assert.throws(() => vault.setTeamRotation(5), /6 hours/);
  assert.throws(() => vault.setTeamRotation(169), /6 hours/);
  const reloaded = new EncryptionVault(storage);
  assert.deepEqual(reloaded.team, { ...later, rotationHours: 6 });
  assert.equal(reloaded.teamAdvancedAt, 2000);
  assert.throws(() => new EncryptionVault(new MemoryStorage()).advanceTeam(later), /Join/);
  assert.throws(() => new EncryptionVault(new MemoryStorage()).setTeamRotation(24), /Join/);
});

test('a team from before rotation is dropped, and the rest of the vault is kept', () => {
  const storage = new MemoryStorage();
  const vault = new EncryptionVault(storage);
  const team = newTeam('Alpha');
  vault.setTeam(team);
  const stored = JSON.parse(storage.getItem('reaper-mesh.crypto-vault.v1')!);
  const { proofSeed, proofStart, rotationHours, advancedAt, ...old } = stored.record.team;
  assert.ok(proofSeed && rotationHours && advancedAt && proofStart === 0);
  stored.record.team = old;
  stored.record.seen = [['kept', 'row']];
  storage.setItem('reaper-mesh.crypto-vault.v1', JSON.stringify(stored));
  const reopened = new EncryptionVault(storage);
  assert.equal(reopened.team, undefined);
  assert.equal(reopened.droppedOldTeam, true);
  // A new team can be saved, and the old one stays gone.
  reopened.setTeam(newTeam('Bravo'));
  const again = new EncryptionVault(storage);
  assert.equal(again.team?.name, 'Bravo');
  assert.equal(again.droppedOldTeam, false);
  const saved = JSON.parse(storage.getItem('reaper-mesh.crypto-vault.v1')!);
  assert.deepEqual(saved.record.seen, [['kept', 'row']]);
  assert.ok(!JSON.stringify(saved).includes(team.relayChain));
  // A current team with a damaged field is still treated as damage, not quietly removed.
  saved.record.team.proofSeed = 'nope';
  storage.setItem('reaper-mesh.crypto-vault.v1', JSON.stringify(saved));
  assert.throws(() => new EncryptionVault(storage), /damaged/);
});

test('a code for the team this browser has never asks, keeps its radios and only moves forward', async () => {
  const storage = new MemoryStorage();
  const vault = new EncryptionVault(storage);
  const team = { ...newTeam('Alpha'), rotationHours: 6 };
  vault.setTeam(team, 1000);
  const { deviceKey } = vault.enrollTeamRadio('node-a', 'relay');
  const asked: unknown[] = [];
  const scan = (keys: typeof team, now: number) =>
    joinTeam(
      vault,
      parseTeamInvite(formatTeamInvite(keys)),
      async existing => {
        asked.push(existing);
        return true;
      },
      now,
    );
  const unchanged = async (keys: typeof team, expected: typeof team, advancedAt: number) => {
    assert.equal(await scan(keys, 9000), 'same-team');
    assert.deepEqual(vault.team, expected);
    assert.equal(vault.teamAdvancedAt, advancedAt);
  };

  // The teammate's own interval travels in the code, and doesn't replace this browser's.
  const theirs = { ...team, rotationHours: 48 };
  await unchanged(theirs, team, 1000);

  // A teammate's code from a later epoch has different chains, and is still this team.
  const later = teamAtEpoch(theirs, 5);
  assert.notEqual(later.relayChain, team.relayChain);
  assert.equal(await scan(later, 2000), 'same-team');
  const moved = { ...later, rotationHours: 6 };
  assert.deepEqual(vault.team, moved);
  assert.equal(vault.teamAdvancedAt, 2000);
  assert.equal(vault.teamRadioRole('node-a'), 'relay');
  assert.equal(vault.enrollTeamRadio('node-a', 'relay').deviceKey, deviceKey);

  // A code from before then changes nothing, so a stale QR code can't undo a rotation.
  await unchanged(teamAtEpoch(theirs, 2), moved, 2000);
  await unchanged(theirs, moved, 2000);
  await unchanged(later, moved, 2000);
  assert.deepEqual(asked, []);

  const reloaded = new EncryptionVault(storage);
  assert.deepEqual(reloaded.team, moved);
  assert.equal(reloaded.teamRadioRole('node-a'), 'relay');
});

test("a code for a different team asks first, and only then forgets this browser's radios", async () => {
  const vault = new EncryptionVault(new MemoryStorage());
  const answer = (yes: boolean, asked: unknown[]) => async (existing: unknown) => {
    asked.push(existing);
    return yes;
  };
  const none: unknown[] = [];
  const team = newTeam('Alpha');
  assert.equal(await joinTeam(vault, team, answer(true, none), 1000), 'joined');
  assert.deepEqual(none, [undefined]);
  assert.deepEqual(vault.team, team);
  vault.enrollTeamRadio('node-a', 'member');

  // A different generation is a different team, even with the same proof seed.
  const others = [newTeam('Bravo'), { ...team, generation: 2 }];
  for (const other of others) {
    const asked: unknown[] = [];
    assert.equal(await joinTeam(vault, other, answer(false, asked), 2000), 'declined');
    assert.deepEqual(asked, [team]);
    assert.deepEqual(vault.team, team);
    assert.equal(vault.teamAdvancedAt, 1000);
    assert.equal(vault.teamRadioRole('node-a'), 'member');
  }

  const asked: unknown[] = [];
  assert.equal(await joinTeam(vault, others[0], answer(true, asked), 3000), 'joined');
  assert.deepEqual(asked, [team]);
  assert.deepEqual(vault.team, others[0]);
  assert.equal(vault.teamAdvancedAt, 3000);
  assert.equal(vault.teamRadioRole('node-a'), undefined);
});

test('a radio that refuses to become a relay keeps the role it really has', async () => {
  const refused = new Error('The radio refused.');
  const setup = (prior?: 'member' | 'relay') => {
    const vault = new EncryptionVault(new MemoryStorage());
    vault.setTeam(newTeam('Alpha'));
    const deviceKey = prior && vault.enrollTeamRadio('node-a', prior).deviceKey;
    const radio = {
      here: true,
      loaded: true,
      calls: [] as string[],
      fails: '',
      onTeam: () => radio.here,
      teamLoaded: () => radio.loaded,
      erase: async () => {
        radio.calls.push('erase');
        if (radio.fails === 'erase') throw refused;
        radio.here = radio.loaded = false;
      },
      fill: async () => {
        radio.calls.push('fill');
        if (radio.fails === 'fill') throw refused;
        radio.here = true;
      },
    };
    return { vault, radio, deviceKey };
  };

  // No button window over Bluetooth: it still holds the key, so its key must keep being reloaded.
  const member = setup('member');
  member.radio.fails = 'erase';
  await assert.rejects(addRadioToTeam(member.vault, 'node-a', 'relay', member.radio), refused);
  assert.equal(member.vault.teamRadioRole('node-a'), 'member');
  assert.deepEqual(member.radio.calls, ['erase']);
  assert.equal(member.vault.enrollTeamRadio('node-a', 'member').deviceKey, member.deviceKey);

  // Added by another browser, so none is recorded here. Holding the key still makes it a member.
  const unrecorded = setup();
  unrecorded.radio.fails = 'erase';
  await assert.rejects(
    addRadioToTeam(unrecorded.vault, 'node-a', 'relay', unrecorded.radio),
    refused,
  );
  assert.equal(unrecorded.vault.teamRadioRole('node-a'), 'member');

  // The key is gone once the erase is through, so a failed refill leaves it a relay to finish.
  const erased = setup('member');
  erased.radio.fails = 'fill';
  await assert.rejects(addRadioToTeam(erased.vault, 'node-a', 'relay', erased.radio), refused);
  assert.equal(erased.vault.teamRadioRole('node-a'), 'relay');
  assert.deepEqual(erased.radio.calls, ['erase', 'fill']);

  // A radio not on the team has no key to protect, so nothing is restored.
  const outside = setup('member');
  outside.radio.here = outside.radio.loaded = false;
  outside.radio.fails = 'fill';
  await assert.rejects(addRadioToTeam(outside.vault, 'node-a', 'relay', outside.radio), refused);
  assert.equal(outside.vault.teamRadioRole('node-a'), 'relay');

  // The move itself still works when the radio agrees.
  const agreed = setup('member');
  await addRadioToTeam(agreed.vault, 'node-a', 'relay', agreed.radio);
  assert.equal(agreed.vault.teamRadioRole('node-a'), 'relay');
  assert.deepEqual(agreed.radio.calls, ['erase', 'fill']);
  assert.equal(agreed.radio.loaded, false);

  // Back to member needs no command, because the radio is already on the team without its key.
  await addRadioToTeam(agreed.vault, 'node-a', 'member', agreed.radio);
  assert.equal(agreed.vault.teamRadioRole('node-a'), 'member');
  assert.deepEqual(agreed.radio.calls, ['erase', 'fill']);
});
