import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Synchronizer } from '../../packages/agent-core/sync.ts';
import { Commands } from '../../packages/agent-core/commands.ts';
import { ConfigDevice } from './config-device.ts';

function setup(options = {}) {
  const sync = new Synchronizer();
  const device = new ConfigDevice();
  const ready = () => {
    const session = sync.connect();
    sync.hello(session, device.boot, 1, 1);
    sync.snapshot({ session, boot: device.boot, request: sync.snapshotRequest,
      sequence: device.revision, revision: device.revision, config: device.config });
  };
  ready();
  return { sync, device, ready, commands: new Commands(sync, 'agent-A', options) };
}
const config = { region: 'US', label: 'changed' };

test('lost commit response retries the same request without committing twice', () => {
  const { commands, device, sync } = setup();
  const command = commands.submit(config, 0);
  device.apply(command); // Drop the reply.
  const [retry] = commands.tick(1000);
  assert.equal(retry, command);
  commands.receive(sync.session, device.apply(retry));
  assert.equal(device.commits, 1);
  assert.equal(commands.status(command.id).outcome, 'committed');
  assert.equal(sync.config?.label, 'initial'); // Receipt is not a config snapshot.
});

test('concurrent agents cannot overwrite a newer configuration revision', () => {
  const { commands, device } = setup();
  const first = commands.submit(config, 0);
  const second = { ...first, id: 'agent-B:1', config: { ...config, label: 'other' } };
  assert.equal(device.apply(first).outcome, 'committed');
  assert.equal(device.apply(second).outcome, 'conflict');
  assert.equal(device.config.label, 'changed');
  assert.equal(device.commits, 1);
});

test('disconnect after commit recovers by query without resubmission', () => {
  const { commands, device, sync, ready } = setup();
  const command = commands.submit(config, 0);
  const reply = device.apply(command);
  const oldSession = sync.session;
  sync.disconnect();
  assert.deepEqual(commands.tick(1), []);
  assert.equal(commands.status(command.id).outcome, 'unknown');
  ready();
  commands.receive(oldSession, reply);
  assert.equal(commands.status(command.id).outcome, 'unknown');
  assert.equal(commands.recover(command.id)?.id, command.id);
  commands.receive(sync.session, device.query(command.id));
  assert.equal(commands.status(command.id).outcome, 'committed');
  assert.equal(sync.config?.label, 'changed');
  assert.equal(device.commits, 1);
});

test('reboot keeps persisted config but cannot prove the old command outcome', () => {
  const { commands, device, sync, ready } = setup();
  const command = commands.submit(config, 0);
  device.apply(command);
  device.reboot();
  sync.disconnect();
  commands.tick(1);
  ready();
  assert.equal(commands.recover(command.id), undefined);
  assert.equal(commands.status(command.id).outcome, 'unknown');
  assert.equal(sync.config?.label, 'changed');
  assert.equal(device.apply(command).outcome, 'rejected');
});

test('retry budget ends in unknown and never sends on reconnect automatically', () => {
  const { commands, ready } = setup({ maxAttempts: 2 });
  const command = commands.submit(config, 0);
  assert.equal(commands.tick(1000).length, 1);
  assert.deepEqual(commands.tick(2000), []);
  assert.equal(commands.status(command.id).outcome, 'unknown');
  ready();
  assert.deepEqual(commands.tick(3000), []);
});

test('response and timeout at the same instant converge with a harmless duplicate', () => {
  for (const timeoutFirst of [true, false]) {
    const { commands, device, sync } = setup();
    const command = commands.submit(config, 0);
    const reply = device.apply(command);
    if (timeoutFirst) {
      const retries = commands.tick(1000);
      assert.equal(retries.length, 1);
      device.apply(retries[0]);
    }
    commands.receive(sync.session, reply);
    assert.deepEqual(commands.tick(1000), []);
    assert.equal(commands.status(command.id).outcome, 'committed');
    assert.equal(device.commits, 1);
  }
});

test('late response can resolve unknown on the original live connection', () => {
  const { commands, device, sync } = setup({ maxAttempts: 1 });
  const command = commands.submit(config, 0);
  const reply = device.apply(command);
  commands.tick(1000);
  assert.equal(commands.status(command.id).outcome, 'unknown');
  commands.receive(sync.session, reply);
  assert.equal(commands.status(command.id).outcome, 'committed');
});

test('receipt reclamation never allows an evicted request to execute again', () => {
  const { commands } = setup();
  const device = new ConfigDevice(1);
  const first = commands.submit(config, 0);
  assert.equal(device.apply(first).outcome, 'committed');
  assert.equal(device.apply({ ...first, id: 'agent-B:1', expectedRevision: 1 }).outcome, 'committed');
  assert.equal(device.query(first.id).outcome, 'unknown');
  assert.equal(device.apply(first).outcome, 'unknown');
  assert.equal(device.commits, 2);
});

test('one agent continues beyond receipt capacity while delayed IDs remain suppressed', () => {
  const device = new ConfigDevice(2);
  for (let i = 1; i <= 100; i++) {
    assert.equal(device.apply({ id: `agent-A:${i}`, boot: device.boot, expectedRevision: i - 1,
      config: { ...config, label: `${i}` } }).outcome, 'committed');
  }
  assert.equal(device.query('agent-A:1').outcome, 'unknown');
  assert.equal(device.apply({ id: 'agent-A:1', boot: device.boot, expectedRevision: 100,
    config }).outcome, 'unknown');
  assert.equal(device.commits, 100);
});

test('owner table exhaustion rejects newcomers without forgetting old request marks', () => {
  const device = new ConfigDevice(1, 1);
  const command = { id: 'agent-A:2', boot: device.boot, expectedRevision: 0, config };
  assert.equal(device.apply(command).outcome, 'committed');
  assert.equal(device.apply({ ...command, id: 'agent-B:1', expectedRevision: 1 }).outcome, 'rejected');
  assert.equal(device.apply({ ...command, id: 'agent-A:1', expectedRevision: 1 }).outcome, 'unknown');
  assert.equal(device.commits, 1);
});

test('reusing an ID with a different body is rejected', () => {
  const { commands, device } = setup();
  const command = commands.submit(config, 0);
  device.apply(command);
  assert.equal(device.apply({ ...command, config: { ...config, label: 'bad' } }).outcome, 'rejected');
  assert.equal(device.config.label, 'changed');
});

test('pending commands and retained history are bounded', () => {
  const { commands, device, sync } = setup({ capacity: 1 });
  const command = commands.submit(config, 0);
  assert.throws(() => commands.submit(config, 1));
  assert.throws(() => commands.forget(command.id));
  commands.receive(sync.session, device.apply(command));
  assert.throws(() => commands.submit(config, 2));
  commands.forget(command.id);
  assert.notEqual(commands.submit(config, 3).id, command.id);
});

test('resynchronization suspends retries and requires query recovery', () => {
  const { commands, sync } = setup();
  const command = commands.submit(config, 0);
  sync.event({ session: sync.session, boot: sync.boot!, sequence: 2, revision: 2, config });
  assert.deepEqual(commands.tick(1000), []);
  assert.equal(commands.status(command.id).outcome, 'unknown');
  assert.throws(() => commands.recover(command.id));
});

test('clock and limits reject invalid scheduling input', () => {
  const { commands, sync } = setup();
  commands.submit(config, 10);
  assert.throws(() => commands.tick(9));
  assert.throws(() => commands.tick(NaN));
  assert.throws(() => new Commands(sync, 'bad:id'));
  assert.throws(() => new Commands(sync, 'valid', { maxAttempts: 0 }));
});
