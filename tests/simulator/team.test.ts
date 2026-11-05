import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { EncryptionVault } from '../../agents/web/encryption.ts';
import { qrPixels, readQr } from '../../agents/web/qr.ts';
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
