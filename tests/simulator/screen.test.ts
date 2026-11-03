import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readScreen, screenFields, validScreen } from '../../packages/protocol/screen-config.ts';
import { Connection } from '../../packages/agent-core/connection.ts';
import { deviceCapabilities } from './capabilities.ts';
import { decodeMessage, encodeMessage, type Message } from '../../packages/protocol/messages.ts';
import { encodeFrame, FrameDecoder } from '../../packages/protocol/framing.ts';

const wire = (message: Message) => encodeFrame(encodeMessage(message));
function ready(capability: object, snapshot: object = {}) {
  const agent = new Connection('owner'),
    session = agent.open('link', 0);
  agent.drain();
  agent.receive(
    session,
    wire({
      type: 'welcome',
      link: 'link',
      device: 'device',
      boot: 'boot',
      minVersion: 1,
      maxVersion: 1,
      ...deviceCapabilities,
      ...capability,
    }),
    0,
  );
  agent.drain();
  agent.receive(
    session,
    wire({
      type: 'snapshot',
      link: 'link',
      boot: 'boot',
      request: 1,
      sequence: 0,
      revision: 0,
      region: 'US',
      label: '',
      ...snapshot,
    } as Message),
    0,
  );
  return agent;
}
const sent = (agent: Connection) => {
  const messages: Message[] = [];
  for (const bytes of agent.drain())
    new FrameDecoder().feed(bytes, payload => messages.push(decodeMessage(payload)));
  return messages;
};

test('screen settings accept only always-on or 10-3600 seconds with both fields together', () => {
  for (const timeout of [0, 10, 30, 3600])
    assert.equal(validScreen({ timeout, wake: false }), true);
  for (const timeout of [1, 9, 3601, 30.5, -1])
    assert.equal(validScreen({ timeout, wake: false }), false);
  assert.equal(readScreen({}), undefined);
  assert.deepEqual(readScreen({ screenTimeout: 60, screenWake: 1 }), { timeout: 60, wake: true });
  for (const fields of [
    { screenTimeout: 60 },
    { screenWake: 0 },
    { screenTimeout: 60, screenWake: 2 },
    { screenTimeout: 5, screenWake: 0 },
  ])
    assert.throws(() => readScreen(fields), /screen/);
  assert.deepEqual(screenFields({ timeout: 0, wake: true }), { screenTimeout: 0, screenWake: 1 });
  assert.deepEqual(screenFields(), {});
});

test('screen writes require screenVersion 1 and feature bit 9 together', () => {
  const screen = { timeout: 60, wake: true };
  for (const capability of [
    {},
    { screenVersion: 1 },
    { features: 7 | 512 },
    { screenVersion: 2, features: 7 | 512 },
  ]) {
    const agent = ready(capability);
    assert.equal(agent.supportsScreen, false);
    assert.throws(() => agent.configure({ region: 'US', label: '', screen }, 0), /screen/);
  }
  const agent = ready(
    { screenVersion: 1, features: 7 | 512 },
    { screenTimeout: 30, screenWake: 0 },
  );
  assert.equal(agent.supportsScreen, true);
  assert.deepEqual(agent.sync.config?.screen, { timeout: 30, wake: false });
  assert.throws(() =>
    agent.configure({ region: 'US', label: '', screen: { timeout: 5, wake: false } }, 0),
  );
  agent.configure({ ...agent.sync.config!, screen }, 0);
  const [configure] = sent(agent);
  assert.equal(configure.type === 'configure' && configure.screenTimeout, 60);
  assert.equal(configure.type === 'configure' && configure.screenWake, 1);
});

test('an unsupported screen version stays readable and base edits leave its policy alone', () => {
  const agent = ready({ screenVersion: 2, features: 7 | 512 }, { screenTimeout: 7, screenWake: 3 });
  assert.equal(agent.sync.state, 'ready');
  assert.equal(agent.sync.config?.screen, undefined);
  agent.configure({ ...agent.sync.config!, label: 'base edit' }, 1);
  const [configure] = sent(agent);
  assert.equal(configure.type === 'configure' && configure.screenTimeout, undefined);
});

test('invalid screen settings from a supporting device close the connection', () => {
  const agent = ready({ screenVersion: 1, features: 7 | 512 }, { screenTimeout: 5, screenWake: 0 });
  assert.notEqual(agent.sync.state, 'ready');
  assert.equal(agent.sync.config, undefined);
});

test('journaled screen commands restore exactly and corrupt screen recovery data fails closed', () => {
  const agent = ready(
    { screenVersion: 1, features: 7 | 512 },
    { screenTimeout: 30, screenWake: 0 },
  );
  const id = agent.configure({ ...agent.sync.config!, screen: { timeout: 300, wake: true } }, 0);
  const journal = agent.exportJournal();
  const restored = Connection.fromJournal(journal);
  const entry = restored.commands.history.find(item => item.command.id === id);
  assert.deepEqual(entry?.command.config.screen, { timeout: 300, wake: true });
  const corrupt = JSON.parse(JSON.stringify(journal));
  corrupt.commands.entries[0].command.config.screen.timeout = 5;
  assert.throws(() => Connection.fromJournal(corrupt), /screen/);
});
