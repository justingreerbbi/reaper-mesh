import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Connection } from '../../packages/agent-core/connection.ts';
import { SerialAdapter } from '../../packages/agent-core/serial.ts';
import { SimulatedDevice } from '../../packages/simulator/serial-device.ts';

const RELAY = 'ab'.repeat(32),
  DEVICE = 'cd'.repeat(32),
  TEAM = 'ef'.repeat(32);
async function until(check: () => boolean) {
  const deadline = performance.now() + 3000;
  while (!check() && performance.now() < deadline)
    await new Promise(resolve => setTimeout(resolve, 5));
  assert.ok(check());
}
async function connected(simulator = new SimulatedDevice()) {
  const connection = new Connection();
  const adapter = new SerialAdapter(connection);
  await adapter.connect(simulator.createPort(), crypto.randomUUID());
  await until(() => connection.sync.state === 'ready');
  return { connection, adapter, simulator };
}

test('an agent learns the network, fills it, loads the team key and erases it', async () => {
  const { connection, adapter, simulator } = await connected();
  assert.equal(connection.supportsNetwork, true);
  await until(() => connection.network?.networkMode === 1);
  adapter.fillTeam({ generation: 2, epoch: 5, relayChain: RELAY, deviceKey: DEVICE });
  await until(() => connection.network?.networkMode === 2);
  assert.equal(connection.network?.state, 'ok');
  assert.equal(connection.network?.generation, 2);
  assert.equal(connection.network?.teamLoaded, 0);
  adapter.loadTeamKey({ generation: 1, epoch: 5, teamChain: TEAM });
  await until(() => connection.network?.state === 'mismatch');
  adapter.loadTeamKey({ generation: 2, epoch: 5, teamChain: TEAM });
  await until(() => connection.network?.teamLoaded === 1);
  adapter.eraseNetwork();
  await until(() => connection.network?.networkMode === 0);
  adapter.chooseOpenMode();
  await until(() => connection.network?.networkMode === 1);
  assert.equal(simulator.network.mode, 1);
  await adapter.disconnect();
  assert.equal(connection.network, undefined);
});

test('keys reach neither the journal nor anything the agent keeps', async () => {
  const { connection, adapter } = await connected();
  await until(() => !!connection.network);
  adapter.fillTeam({ generation: 1, epoch: 0, relayChain: RELAY, deviceKey: DEVICE });
  await until(() => connection.network?.networkMode === 2);
  adapter.loadTeamKey({ generation: 1, epoch: 0, teamChain: TEAM });
  await until(() => connection.network?.teamLoaded === 1);
  const kept = JSON.stringify([connection.exportJournal(), connection.network]);
  for (const key of [RELAY, DEVICE, TEAM]) assert.ok(!kept.includes(key));
  await adapter.disconnect();
});

test('a read-only or older device offers no network commands', async () => {
  const simulator = new SimulatedDevice();
  simulator.readOnly = true;
  const connection = new Connection();
  const adapter = new SerialAdapter(connection);
  await adapter.connect(simulator.createPort(), crypto.randomUUID());
  await until(() => connection.sync.state === 'ready');
  assert.equal(connection.supportsNetwork, false);
  assert.throws(() => adapter.chooseOpenMode());
  assert.equal(connection.network, undefined);
  await adapter.disconnect();
});

test('an agent asks for alerts and handles payloads, and an alert wakes the inbox read', async () => {
  const { connection, adapter, simulator } = await connected();
  assert.equal(connection.inboxAlerts, 0);
  simulator.alertInbox(1);
  await until(() => connection.inboxAlerts === 1);
  await adapter.disconnect();
  assert.equal(connection.inboxAlerts, 0);
});
