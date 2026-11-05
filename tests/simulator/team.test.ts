import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { EncryptionVault } from '../../agents/web/encryption.ts';
import { qrPixels, readQr } from '../../agents/web/qr.ts';
import { addRadioToTeam } from '../../agents/web/team-radio.ts';
import {
  chainFingerprint,
  formatTeamInvite,
  newTeam,
  parseTeamInvite,
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
  assert.throws(() => parseTeamInvite('RMTEAM1.!!!'), /damaged/);
  assert.throws(() => parseTeamInvite(`RMTEAM1.${'a'.repeat(3000)}`), /too long/);
  const encode = (value: object) =>
    `RMTEAM1.${Buffer.from(JSON.stringify(value)).toString('base64url')}`;
  const good = {
    format: 'RMTEAM1',
    name: 'A',
    generation: 1,
    epoch: 0,
    relay: 'ab'.repeat(32),
    team: 'cd'.repeat(32),
  };
  assert.equal(parseTeamInvite(encode(good)).name, 'A');
  assert.equal(parseTeamInvite(encode({ ...good, future: 1 })).name, 'A');
  for (const bad of [
    { ...good, format: 'RMTEAM2' },
    { ...good, name: '<script>' },
    { ...good, generation: 0 },
    { ...good, epoch: -1 },
    { ...good, relay: 'ab' },
    { ...good, team: good.relay },
    { ...good, team: '00'.repeat(32) },
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
  stored.record.team.teamChain = 'nope';
  storage.setItem('reaper-mesh.crypto-vault.v1', JSON.stringify(stored));
  assert.throws(() => new EncryptionVault(storage), /damaged/);
});

test('a team QR code reads back exactly', () => {
  const code = formatTeamInvite(newTeam('x'.repeat(24)));
  const { data, width } = qrPixels(code, 6);
  assert.equal(readQr(new Uint8ClampedArray(data), width, width), code);
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
