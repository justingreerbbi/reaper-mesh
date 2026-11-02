import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AppAccess } from '../../clients/web/app-access.ts';
import { EncryptionVault, ENCRYPTION_VAULT_KEY } from '../../clients/web/encryption.ts';
class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}
test('one PIN unlocks all channel keys and survives reload without storing the PIN', () => {
  const storage = new MemoryStorage(), keys = new EncryptionVault(storage), access = new AppAccess(keys, storage);
  assert.equal(access.setup, true);
  assert.throws(() => access.unlock('123', '123'), /4–6/);
  assert.throws(() => access.unlock('1234', '5678'), /match/);
  access.unlock('024681', '024681'); keys.generate(0); keys.generate(3);
  const bundle = keys.exportBundle(3); access.lock();
  assert.equal(keys.hasKey(0), false);
  const restored = new EncryptionVault(storage), reloaded = new AppAccess(restored, storage);
  assert.equal(reloaded.migration, false);
  assert.equal(reloaded.unlocked, false);
  assert.throws(() => reloaded.unlock('9999'), /Could not unlock/);
  reloaded.unlock('024681');
  assert.equal(restored.hasKey(0), true); assert.equal(restored.exportBundle(3), bundle);
  assert.equal(JSON.parse(storage.getItem(ENCRYPTION_VAULT_KEY)!).credential, 'pin');
  assert.ok(!storage.getItem(ENCRYPTION_VAULT_KEY)!.includes('024681'));
});
test('legacy password migrates every key to one app PIN', () => {
  const storage = new MemoryStorage(), keys = new EncryptionVault(storage);
  keys.unlock('old secure password', 'old secure password'); keys.generate(2);
  const bundle = keys.exportBundle(2); keys.lock();
  const access = new AppAccess(keys, storage);
  assert.equal(access.migration, true);
  assert.throws(() => access.unlock('1234', '1234', 'wrong password'), /Could not unlock/);
  assert.equal(access.migration, true);
  access.unlock('1234', '1234', 'old secure password');
  assert.equal(access.migration, false); access.lock(); access.unlock('1234');
  assert.equal(keys.exportBundle(2), bundle);
});
test('failed PIN attempts impose a persisted cooldown and successful unlock clears it', () => {
  const storage = new MemoryStorage(), keys = new EncryptionVault(storage);
  let now = 1000;
  const access = new AppAccess(keys, storage, () => now); access.unlock('1234', '1234'); access.lock();
  for (let i = 0; i < 5; i++) assert.throws(() => access.unlock('9999'));
  const reloaded = new AppAccess(new EncryptionVault(storage), storage, () => now);
  assert.throws(() => reloaded.unlock('1234'), /Try again/);
  now += 30000; reloaded.unlock('1234'); assert.equal(reloaded.unlocked, true);
});
test('failed PIN migration preserves the original encrypted data', () => {
  const storage = new MemoryStorage(), keys = new EncryptionVault(storage);
  keys.unlock('old secure password', 'old secure password'); keys.generate(1);
  const original = storage.getItem(ENCRYPTION_VAULT_KEY), bundle = keys.exportBundle(1);
  const write = storage.setItem.bind(storage);
  storage.setItem = (key, value) => { if (key === ENCRYPTION_VAULT_KEY) throw Error('disk full'); write(key, value); };
  assert.throws(() => keys.setPin('1234', '1234'), /disk full/);
  assert.equal(storage.getItem(ENCRYPTION_VAULT_KEY), original);
  assert.equal(keys.exportBundle(1), bundle); assert.equal(keys.pinConfigured, false);
});

test('connection, manual lock and reconnect gate the entire session', () => {
  const storage = new MemoryStorage(), keys = new EncryptionVault(storage), access = new AppAccess(keys, storage);
  assert.equal(access.requiresUnlock(false), false);
  assert.equal(access.requiresUnlock(true), false);
  access.unlock('0123', '0123'); keys.generate(0);
  assert.equal(access.requiresUnlock(true), false);
  access.lock(); assert.equal(access.requiresUnlock(true), true);
  access.unlock('0123'); assert.equal(access.requiresUnlock(true), false);
  assert.equal(access.requiresUnlock(false), false); assert.equal(keys.hasKey(0), false);
  assert.equal(access.requiresUnlock(true), true);
  access.unlock('0123'); assert.equal(keys.hasKey(0), true);
});
test('malformed cooldown storage fails closed', () => {
  const storage = new MemoryStorage(), keys = new EncryptionVault(storage), access = new AppAccess(keys, storage);
  access.unlock('1234', '1234'); access.lock();
  storage.setItem('reaper-mesh.app-access.v1', 'null');
  assert.throws(() => access.unlock('1234', '1234'), /unavailable/);
  assert.equal(access.unlocked, false);
});

test('PIN is optional and adding/removing it keeps every key and replay record', () => {
  const storage = new MemoryStorage(), keys = new EncryptionVault(storage), access = new AppAccess(keys, storage);
  assert.equal(access.protected, false); assert.equal(access.requiresUnlock(true), false);
  keys.generate(1); keys.generate(3);
  const bundle = keys.exportBundle(1);
  const envelope = keys.encrypt('retained secret', 1, 'node-A', 'broadcast');
  assert.equal(keys.decrypt(envelope, 1, 'node-A', 'broadcast', 'rx-1').state, 'decrypted');
  const restored = new EncryptionVault(storage);
  assert.equal(restored.unlocked, true); assert.equal(restored.exportBundle(1), bundle);
  access.unlock('0123', '0123'); access.lock(); access.unlock('0123');
  assert.equal(keys.exportBundle(1), bundle); assert.equal(keys.hasKey(3), true);
  assert.throws(() => access.removeProtection('9999'), /Could not unlock/);
  assert.equal(access.protected, true);
  access.removeProtection('0123');
  assert.equal(access.protected, false); assert.equal(access.requiresUnlock(true), false);
  const plain = new EncryptionVault(storage);
  assert.equal(plain.exportBundle(1), bundle); assert.equal(plain.hasKey(3), true);
  assert.equal(plain.decrypt(envelope, 1, 'node-A', 'broadcast', 'rx-2').state, 'replay');
  assert.equal(plain.decrypt(envelope, 1, 'node-A', 'broadcast', 'rx-1').text, 'retained secret');
});
test('failed protection changes retain the previous usable storage', () => {
  const storage = new MemoryStorage(), keys = new EncryptionVault(storage);
  keys.generate(0); const original = storage.getItem(ENCRYPTION_VAULT_KEY);
  const write = storage.setItem.bind(storage);
  storage.setItem = (key, value) => { if (key === ENCRYPTION_VAULT_KEY) throw Error('disk full'); write(key, value); };
  assert.throws(() => keys.setPin('1234', '1234'), /disk full/);
  assert.equal(keys.protected, false); assert.equal(storage.getItem(ENCRYPTION_VAULT_KEY), original);
  storage.setItem = write; keys.setPin('1234', '1234');
  const protectedData = storage.getItem(ENCRYPTION_VAULT_KEY);
  storage.setItem = (key, value) => { if (key === ENCRYPTION_VAULT_KEY) throw Error('disk full'); write(key, value); };
  assert.throws(() => keys.removeProtection(), /disk full/);
  assert.equal(keys.protected, true); assert.equal(storage.getItem(ENCRYPTION_VAULT_KEY), protectedData);
});

test('malformed unprotected key records fail closed without overwriting data', () => {
  const storage = new MemoryStorage();
  const original = JSON.stringify({ version: 2, protection: 'none', record: { v: 1, keys: [], seen: [[123, 'id']] } });
  storage.setItem(ENCRYPTION_VAULT_KEY, original);
  assert.throws(() => new EncryptionVault(storage), /damaged/);
  assert.equal(storage.getItem(ENCRYPTION_VAULT_KEY), original);
});
