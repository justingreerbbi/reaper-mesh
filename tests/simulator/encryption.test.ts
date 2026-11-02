import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EncryptionVault, ENCRYPTION_VAULT_KEY, ENCRYPTION_POLICY_KEY } from '../../agents/web/encryption.ts';

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

test('encrypted channel vault protects keys and transfers a usable shared key', () => {
  const leftStorage = new MemoryStorage(); const left = new EncryptionVault(leftStorage);
  left.unlock('correct horse battery', 'correct horse battery'); left.generate(2);
  const rawVault = leftStorage.getItem(ENCRYPTION_VAULT_KEY)!;
  assert.ok(!rawVault.includes('keyHex'));
  assert.ok(!rawVault.includes('"key":"'));
  assert.deepEqual(JSON.parse(leftStorage.getItem(ENCRYPTION_POLICY_KEY)!).required, [2]);

  const bundle = left.exportBundle(2);
  const right = new EncryptionVault(new MemoryStorage()); right.unlock('another secure passphrase', 'another secure passphrase'); right.importBundle(bundle, 2);
  const message = left.encrypt('hello mesh 📻', 2, 'heltec-001122334455', 'broadcast');
  assert.equal(right.decrypt(message, 2, 'node-0000001122334455', 'broadcast', 'rx-1').text, 'hello mesh 📻');
  assert.equal(right.decrypt(message, 2, 'node-0000001122334455', 'broadcast', 'rx-1').text, 'hello mesh 📻');
  assert.equal(right.decrypt(message, 2, 'node-0000001122334455', 'broadcast', 'rx-2').state, 'replay');
  assert.equal(right.decrypt(message, 1, 'node-0000001122334455', 'broadcast').state, 'invalid');
  assert.equal(right.decrypt(message, 2, 'node-abcdefabcdef', 'broadcast').state, 'invalid');
  const damaged = message.slice(); damaged[damaged.length - 1] ^= 1;
  assert.equal(right.decrypt(damaged, 2, 'node-0000001122334455', 'broadcast').state, 'invalid');
});

test('vault is locked after reload, wrong passphrases fail, and plaintext policy fails closed', () => {
  const storage = new MemoryStorage(); const first = new EncryptionVault(storage);
  first.unlock('correct horse battery', 'correct horse battery'); first.generate(0);
  const envelope = first.encrypt('secret', 0, 'node-A', 'broadcast'); first.lock();
  const reloaded = new EncryptionVault(storage);
  assert.equal(reloaded.decrypt(envelope, 0, 'node-A', 'broadcast').state, 'locked');
  assert.throws(() => reloaded.encrypt('still requires key', 0, 'node-A', 'broadcast'), /Unlock the local encryption vault/);
  assert.throws(() => reloaded.unlock('wrong passphrase value'), /Incorrect passphrase/);
  reloaded.unlock('correct horse battery');
  reloaded.setRequired(0, false);
  assert.equal(new TextDecoder().decode(reloaded.encrypt('public', 0, 'node-A', 'broadcast')), 'public');
});
