import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clearLocalAppData, WIPE_SIGNAL } from '../../clients/web/local-data.ts';
class MemoryStorage {
  values = new Map<string, string>();
  get length() { return this.values.size; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
}
test('wipe removes every app namespace key without skipping shifted indexes', () => {
  const storage = new MemoryStorage();
  for (const key of ['crypto-vault.v1', 'crypto-policy.v1', 'app-access.v1', 'usb-recovery.v1', 'message-ui.v1', 'future-setting']) storage.values.set('reaper-mesh.' + key, 'private');
  storage.values.set('other-app', 'keep'); storage.values.set(WIPE_SIGNAL, 'signal');
  clearLocalAppData(storage, true);
  assert.deepEqual([...storage.values.keys()], ['other-app', WIPE_SIGNAL]);
  clearLocalAppData(storage); assert.deepEqual([...storage.values.keys()], ['other-app']);
  clearLocalAppData(storage); assert.equal(storage.length, 1);
});
test('wipe reports deletion failures and never claims success', () => {
  const storage = new MemoryStorage(); storage.values.set('reaper-mesh.crypto-vault.v1', 'private');
  storage.removeItem = () => { throw Error('blocked'); };
  assert.throws(() => clearLocalAppData(storage), /blocked/);
  storage.removeItem = () => {};
  assert.throws(() => clearLocalAppData(storage), /could not be removed/);
});
