import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BrowserRecovery, RECOVERY_KEY } from '../../clients/web/recovery.ts';
function storage(initial?: string) {
  let value = initial; let failing = false;
  return { getItem: (key: string) => key === RECOVERY_KEY ? value ?? null : null, setItem: (key: string, text: string) => {
    assert.equal(key, RECOVERY_KEY); if (failing) throw new Error('quota'); value = text;
  }, fail: (next: boolean) => { failing = next; }, read: () => value };
}
function locks() {
  let held = false;
  const request = async (_name: string, _options: unknown, callback: (lock: object | null) => unknown) => {
    if (held) { await callback(null); return; }
    held = true; try { await callback({}); } finally { held = false; }
  };
  return { request } as unknown as Pick<LockManager, 'request'>;
}
test('browser reload retains identity and a second tab cannot write or reset the journal', async () => {
  const store = storage(), manager = locks();
  const first = await BrowserRecovery.open(store, manager); assert.equal(first.writable, true);
  const owner = first.connection.commands.incarnation; const saved = store.read(); assert.ok(saved);
  const second = await BrowserRecovery.open(store, manager);
  assert.equal(second.writable, false); assert.match(second.connection.writeBlockReason!, /another tab/);
  assert.throws(() => second.reset(), /lock/); second.retry(); assert.equal(store.read(), saved);
  first.release(); await new Promise(resolve => setImmediate(resolve));
  const third = await BrowserRecovery.open(store, manager);
  assert.equal(third.writable, true); assert.equal(third.connection.commands.incarnation, owner);
  third.reset(); assert.notEqual(third.connection.commands.incarnation, owner);
  const reset = store.read(); first.retry(); second.retry(); assert.equal(store.read(), reset);
  third.release();
});
test('invalid recovery data is preserved until an explicit disconnected reset', async () => {
  const original = '{broken'; const store = storage(original); const session = await BrowserRecovery.open(store, locks());
  assert.equal(session.writable, false); assert.match(session.connection.writeBlockReason!, /cannot be loaded/);
  assert.equal(session.exportText(), original); session.retry(); assert.equal(store.read(), original);
  store.fail(true); assert.throws(() => session.reset(), /quota/); assert.equal(session.exportText(), original);
  store.fail(false); session.reset(); assert.equal(session.writable, true); assert.equal(session.connection.recoveryError, undefined);
  session.release();
});
test('unsupported locks and blocked local storage leave reads available and writes blocked', async () => {
  const session = await BrowserRecovery.open(storage()); assert.match(session.connection.writeBlockReason!, /cannot lock/);
  const store = storage(); store.fail(true); const blocked = await BrowserRecovery.open(store, locks());
  assert.match(blocked.connection.writeBlockReason!, /quota/); store.fail(false); assert.equal(blocked.retry(), true);
  blocked.release();
});

test('wipe marker blocks checkpoints before another tab receives its storage event', async () => {
  const values = new Map<string, string>();
  const store = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  const session = await BrowserRecovery.open(store, locks());
  const before = values.get(RECOVERY_KEY);
  values.set('reaper-mesh.wipe.v1', 'in-progress');
  assert.equal(session.writable, false);
  session.retry(); assert.equal(values.get(RECOVERY_KEY), before);
  assert.throws(() => session.reset(), /wipe/i);
  session.release(); values.delete(RECOVERY_KEY); session.retry();
  assert.equal(values.has(RECOVERY_KEY), false);
});
