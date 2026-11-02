import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConfigModel } from '../../agents/web/model.ts';
import { SerialAdapter } from '../../packages/agent-core/serial.ts';
import { SimulatedDevice } from '../../packages/simulator/serial-device.ts';

const settle = () => new Promise<void>(resolve => setImmediate(resolve));
function setup() {
  let now = 0;
  let tick: (() => void) | undefined;
  let generation = 0;
  const device = new SimulatedDevice();
  const model = new ConfigModel(new SerialAdapter(undefined, {
    now: () => now,
    schedule(callback) { tick = callback; return () => { tick = undefined; }; },
  }));
  const connect = async () => {
    await model.adapter.connect(device.createPort(), `link-${++generation}`);
    await settle(); model.refresh();
  };
  return { device, model, connect,
    async advance(value: number) { now = value; tick?.(); await settle(); model.refresh(); } };
}

test('web model saves through the shared demo protocol and refreshes authoritative settings', async t => {
  const f = setup(); t.after(() => f.model.adapter.disconnect());
  await f.connect();
  f.model.edit({ region: 'US', label: 'Reaper One' });
  const id = f.model.save();
  assert.throws(() => f.model.save());
  await settle(); f.model.refresh();
  assert.equal(f.model.adapter.connection.commands.status(id).outcome, 'committed');
  assert.equal(f.model.draft.label, 'Reaper One');
  assert.equal(f.model.dirty, false);
  assert.equal(f.device.config.commits, 1);
});

test('unsaved edits survive a remote change and cannot overwrite it silently', async t => {
  const f = setup(); t.after(() => f.model.adapter.disconnect());
  await f.connect();
  f.model.edit({ region: 'US', label: 'unsaved' });
  f.device.config.apply({ id: 'other:1', boot: f.device.config.boot, expectedRevision: 0,
    config: { region: 'US', label: 'remote' } });
  await f.model.adapter.disconnect(); await f.connect();
  assert.equal(f.model.draft.label, 'unsaved');
  assert.equal(f.model.stale, true);
  assert.throws(() => f.model.save(), /load its latest/);
  f.model.reset();
  assert.equal(f.model.draft.label, 'remote');
  assert.equal(f.model.dirty, false);
});

test('demo disconnect after commit preserves unknown history for query-only recovery', async t => {
  const f = setup(); t.after(() => f.model.adapter.disconnect());
  await f.connect();
  f.device.nextFault = 'disconnect';
  f.model.edit({ region: 'US', label: 'committed before disconnect' });
  const id = f.model.save();
  await settle(); await f.model.adapter.disconnect();
  assert.equal(f.model.adapter.connection.commands.status(id).outcome, 'unknown');
  await f.connect();
  assert.equal(f.model.adapter.recover(id), true);
  await settle(); f.model.refresh();
  assert.equal(f.model.adapter.connection.commands.status(id).outcome, 'committed');
  assert.equal(f.device.config.commits, 1);
});

test('demo lost results exhaust bounded retries and can be queried without replay', async t => {
  const f = setup(); t.after(() => f.model.adapter.disconnect());
  await f.connect();
  f.device.nextFault = 'lose-result';
  f.model.edit({ region: 'US', label: 'uncertain' });
  const id = f.model.save();
  await settle();
  await f.advance(1000); await f.advance(2000); await f.advance(3000);
  assert.equal(f.model.adapter.connection.commands.status(id).outcome, 'unknown');
  assert.equal(f.model.adapter.recover(id), true);
  await settle(); f.model.refresh();
  assert.equal(f.model.adapter.connection.commands.status(id).outcome, 'committed');
  assert.equal(f.model.draft.label, 'uncertain');
  assert.equal(f.device.config.commits, 1);
});

test('demo read-only negotiation blocks saves while retaining readable configuration', async t => {
  const f = setup(); t.after(() => f.model.adapter.disconnect());
  f.device.readOnly = true; await f.connect();
  assert.equal(f.model.adapter.connection.sync.state, 'ready');
  f.model.edit({ region: 'US', label: 'blocked' });
  assert.throws(() => f.model.save(), /lacks safe/);
  assert.equal(f.model.history.length, 0);
});

test('forgetting settled UI history releases the corresponding core capacity', async t => {
  const f = setup(); t.after(() => f.model.adapter.disconnect());
  await f.connect();
  f.model.edit({ region: 'US', label: 'settled' });
  const id = f.model.save();
  assert.throws(() => f.model.forget(id), /pending/);
  await settle();
  f.model.forget(id);
  assert.equal(f.model.history.length, 0);
  assert.throws(() => f.model.adapter.connection.commands.status(id));
});
