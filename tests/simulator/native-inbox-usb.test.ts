import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Connection } from '../../packages/agent-core/connection.ts';
import { FrameDecoder, encodeFrame } from '../../packages/protocol/framing.ts';
import { encodeMessage, decodeMessage, type Message } from '../../packages/protocol/messages.ts';
import {
  DEFAULT_CHANNEL_IDS,
  channelList,
  withChannel,
} from '../../packages/protocol/radio-config.ts';

const directory = mkdtempSync(join(tmpdir(), 'reaper-inbox-usb-'));
const binary = join(directory, 'device-bridge');
after(() => rmSync(directory, { recursive: true, force: true }));
const sanitizers =
  process.platform === 'darwin' && process.env.REAPER_ASAN !== '1'
    ? 'undefined'
    : 'address,undefined';
execFileSync(
  process.env.CXX || 'c++',
  [
    '-std=c++17',
    '-O1',
    '-Wall',
    '-Wextra',
    '-Werror',
    '-pedantic',
    `-fsanitize=${sanitizers}`,
    '-fno-sanitize-recover=all',
    '-fno-omit-frame-pointer',
    '-Ifirmware/components/reaper_protocol/include',
    '-Ifirmware/components/reaper_mesh/include',
    '-Ifirmware/components/reaper_crypto/include',
    '-Ifirmware/components/reaper_device/include',
    'firmware/components/reaper_protocol/protocol.cpp',
    'firmware/components/reaper_device/configuration.cpp',
    'firmware/components/reaper_device/discovery.cpp',
    'firmware/components/reaper_mesh/radio_packet.cpp',
    'firmware/components/reaper_device/session.cpp',
    'firmware/components/reaper_device/inbox.cpp',
    'firmware/components/reaper_device/messages.cpp',
    'firmware/tests/device_bridge.cpp',
    '-o',
    binary,
  ],
  { stdio: 'pipe', timeout: 30000 },
);
const wire = (message: Message) => encodeFrame(encodeMessage(message));
const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');
test('actual TypeScript agent retrieves diagnostics and complete UTF-8 inbox from native Session without writes', () => {
  const requests: Message[] = [
    {
      type: 'hello',
      link: 'link-A',
      minVersion: 1,
      maxVersion: 1,
      owner: 'agent-A',
      agentFeatures: 3,
    },
    { type: 'sync', link: 'link-A', boot: 'boot-A', request: 1 },
    { type: 'inboxQuery', link: 'link-A', boot: 'boot-A', request: 1 },
    { type: 'radioQuery', link: 'link-A', boot: 'boot-A', request: 1 },
    ...Array.from({ length: 32 }, (_, part): Message => ({
      type: 'inboxRead',
      link: 'link-A',
      boot: 'boot-A',
      request: part + 2,
      sequence: 1,
      part,
    })),
  ];
  const lines = execFileSync(binary, ['inbox'], {
    input: requests.map(message => hex(wire(message))).join('\n') + '\n',
    encoding: 'utf8',
    timeout: 10000,
  })
    .trim()
    .split('\n');
  assert.equal(lines.pop(), 'writes=0');
  const replies = lines.map(line => Uint8Array.from(Buffer.from(line, 'hex')));
  const agent = new Connection('agent-A');
  const generation = agent.open('link-A', 0);
  const expect = (messages: Message[]) => {
    const output: Message[] = [];
    const decoder = new FrameDecoder();
    for (const frame of agent.drain())
      decoder.feed(frame, payload => output.push(decodeMessage(payload)));
    assert.deepEqual(output, messages);
  };
  expect([requests[0]]);
  agent.receive(generation, replies[0], 0);
  expect([requests[1]]);
  agent.receive(generation, replies[1], 0);
  agent.tick(0);
  expect(requests.slice(2, 4));
  agent.receive(generation, replies[2], 0);
  agent.receive(generation, replies[3], 0);
  assert.equal(agent.radioInfo?.probe, 1);
  assert.equal(agent.radioInfo?.transmitted, 0);
  for (let part = 0; part < 32; part++) {
    agent.tick(0);
    expect([requests[part + 4]]);
    agent.receive(generation, replies[part + 4], 0);
  }
  assert.equal(agent.inbox.history.length, 1);
  assert.equal(agent.inbox.history[0].text, 'x'.repeat(31) + '📻' + 'z'.repeat(989));
  assert.equal(agent.inbox.history[0].messageId, 'remote_1');
});

test('native Session capability-gates discovery, deduplicates starts and pages an independent node snapshot', () => {
  const requests: Message[] = [
    {
      type: 'hello',
      link: 'link-A',
      minVersion: 1,
      maxVersion: 1,
      owner: 'agent-A',
      agentFeatures: 3,
    },
    { type: 'sync', link: 'link-A', boot: 'boot-A', request: 1 },
    { type: 'discover', link: 'link-A', boot: 'boot-A', id: 'agent-A:1', action: 1 },
    { type: 'discover', link: 'link-A', boot: 'boot-A', id: 'agent-A:1', action: 1 },
    { type: 'discover', link: 'link-A', boot: 'boot-A', id: 'other:1', action: 1 },
    { type: 'nodeQuery', link: 'link-A', boot: 'boot-A', request: 1, generation: 0, cursor: 0 },
    { type: 'nodeQuery', link: 'link-A', boot: 'boot-A', request: 2, generation: 1, cursor: 0 },
  ];
  const lines = execFileSync(binary, ['discovery'], {
    input: requests.map(message => hex(wire(message))).join('\n') + '\n',
    encoding: 'utf8',
    timeout: 10000,
  })
    .trim()
    .split('\n');
  assert.equal(lines.pop(), 'writes=0');
  const responses: Message[] = [];
  for (const line of lines)
    new FrameDecoder().feed(Uint8Array.from(Buffer.from(line, 'hex')), payload =>
      responses.push(decodeMessage(payload)),
    );
  assert.equal(responses[0].type === 'welcome' && responses[0].discoveryVersion, 1);
  assert.deepEqual(responses[2], responses[3]);
  assert.equal(responses[4].type === 'discoveryStatus' && responses[4].state, 'rejected');
  const agent = new Connection('agent-A');
  const generation = agent.open('link-A', 0);
  agent.drain();
  agent.receive(generation, Uint8Array.from(Buffer.from(lines[0], 'hex')), 0);
  agent.drain();
  agent.receive(generation, Uint8Array.from(Buffer.from(lines[1], 'hex')), 0);
  agent.tick(0);
  agent.drain();
  agent.discover(0);
  agent.drain();
  agent.receive(generation, Uint8Array.from(Buffer.from(lines[2], 'hex')), 0);
  assert.equal(agent.discovery.last?.sequence, 1);
  agent.receive(generation, Uint8Array.from(Buffer.from(lines[5], 'hex')), 0);
  agent.tick(1);
  agent.drain();
  agent.receive(generation, Uint8Array.from(Buffer.from(lines[6], 'hex')), 1);
  assert.equal(agent.discovery.nodes[0].name, 'Bravo');
  assert.equal(agent.discovery.nodes[0].node, 'node-0000000000000002');
});

test('position settings cross TS/native USB, survive lost replies and legacy writes, and reject partial updates', () => {
  const requests: Message[] = [
    {
      type: 'hello',
      link: 'link-A',
      minVersion: 1,
      maxVersion: 1,
      owner: 'agent-A',
      agentFeatures: 3,
    },
    { type: 'sync', link: 'link-A', boot: 'boot-A', request: 1 },
    {
      type: 'configure',
      link: 'link-A',
      boot: 'boot-A',
      id: 'agent-A:1',
      expectedRevision: 0,
      region: 'US',
      label: 'fixed',
      shareLocation: 1,
      positionSource: 1,
      latitude: 900000000,
      longitude: 1800000000,
    },
    {
      type: 'hello',
      link: 'link-B',
      minVersion: 1,
      maxVersion: 1,
      owner: 'agent-A',
      agentFeatures: 3,
    },
    { type: 'sync', link: 'link-B', boot: 'boot-A', request: 2 },
    { type: 'query', link: 'link-B', boot: 'boot-A', id: 'agent-A:1' },
    { type: 'sync', link: 'link-B', boot: 'boot-A', request: 3 },
    {
      type: 'configure',
      link: 'link-B',
      boot: 'boot-A',
      id: 'agent-A:2',
      expectedRevision: 1,
      region: 'US',
      label: 'legacy edit',
    },
    { type: 'sync', link: 'link-B', boot: 'boot-A', request: 4 },
    {
      type: 'configure',
      link: 'link-B',
      boot: 'boot-A',
      id: 'agent-A:3',
      expectedRevision: 2,
      region: 'US',
      label: 'bad partial',
      shareLocation: 0,
    },
    { type: 'sync', link: 'link-B', boot: 'boot-A', request: 5 },
  ];
  const lines = execFileSync(binary, ['discovery'], {
    input: requests.map(message => hex(wire(message))).join('\n') + '\n',
    encoding: 'utf8',
    timeout: 10000,
  })
    .trim()
    .split('\n');
  assert.equal(lines.pop(), 'writes=2');
  const frames = lines.map(line => Uint8Array.from(Buffer.from(line, 'hex')));
  const agent = new Connection('agent-A');
  let session = agent.open('link-A', 0);
  agent.drain();
  agent.receive(session, frames[0], 0);
  agent.drain();
  agent.receive(session, frames[1], 0);
  agent.drain();
  assert.equal(agent.supportsPosition, true);
  const position = { share: true, source: 1 as const, latitude: 900000000, longitude: 1800000000 };
  const id = agent.configure({ region: 'US', label: 'fixed', position }, 1);
  const sent: Message[] = [];
  for (const bytes of agent.drain())
    new FrameDecoder().feed(bytes, payload => sent.push(decodeMessage(payload)));
  assert.deepEqual(sent, [requests[2]]); // Drop the committed reply.
  const restored = Connection.fromJournal(agent.exportJournal());
  assert.equal(restored.commands.status(id).outcome, 'unknown');
  agent.close();
  session = agent.open('link-B', 2);
  agent.drain();
  agent.receive(session, frames[3], 2);
  agent.drain();
  agent.receive(session, frames[4], 2);
  agent.drain();
  assert.deepEqual(agent.sync.config?.position, position);
  agent.recover(id, 3);
  const recovery: Message[] = [];
  for (const bytes of agent.drain())
    new FrameDecoder().feed(bytes, payload => recovery.push(decodeMessage(payload)));
  assert.deepEqual(recovery, [requests[5]]);
  agent.receive(session, frames[5], 3);
  agent.drain();
  agent.receive(session, frames[6], 3);
  assert.equal(agent.commands.status(id).outcome, 'committed');
  const responses: Message[] = [];
  for (const frame of frames)
    new FrameDecoder().feed(frame, payload => responses.push(decodeMessage(payload)));
  assert.equal(responses[8].type === 'snapshot' && responses[8].shareLocation, 1);
  assert.equal(responses[9].type === 'result' && responses[9].outcome, 'rejected');
  assert.equal(responses[10].type === 'snapshot' && responses[10].revision, 2);
});

test('native node paging freezes position with identity while a later name-only RF report arrives', () => {
  const requests: Message[] = [
    {
      type: 'hello',
      link: 'link-A',
      minVersion: 1,
      maxVersion: 1,
      owner: 'agent-A',
      agentFeatures: 3,
    },
    { type: 'sync', link: 'link-A', boot: 'boot-A', request: 1 },
    { type: 'nodeQuery', link: 'link-A', boot: 'boot-A', request: 1, generation: 0, cursor: 0 },
    { type: 'nodeQuery', link: 'link-A', boot: 'boot-A', request: 2, generation: 1, cursor: 0 },
    { type: 'nodeQuery', link: 'link-A', boot: 'boot-A', request: 3, generation: 0, cursor: 0 },
    { type: 'nodeQuery', link: 'link-A', boot: 'boot-A', request: 4, generation: 2, cursor: 0 },
  ];
  const lines = execFileSync(binary, ['position'], {
    input: requests.map(message => hex(wire(message))).join('\n') + '\n',
    encoding: 'utf8',
    timeout: 10000,
  })
    .trim()
    .split('\n');
  assert.equal(lines.pop(), 'writes=0');
  const responses: Message[] = [];
  for (const line of lines)
    new FrameDecoder().feed(Uint8Array.from(Buffer.from(line, 'hex')), payload =>
      responses.push(decodeMessage(payload)),
    );
  assert.equal(responses[3].type === 'nodeReply' && responses[3].latitude, 900000000);
  assert.equal(responses[3].type === 'nodeReply' && responses[3].name, 'Bravo');
  assert.equal(responses[5].type === 'nodeReply' && responses[5].positionSource, undefined);
  assert.equal(responses[5].type === 'nodeReply' && responses[5].name, 'Delta');
});

test('screen settings cross TS/native USB, persist with the revision and reject partial or invalid updates', () => {
  const requests: Message[] = [
    {
      type: 'hello',
      link: 'link-A',
      minVersion: 1,
      maxVersion: 1,
      owner: 'agent-A',
      agentFeatures: 3,
    },
    { type: 'sync', link: 'link-A', boot: 'boot-A', request: 1 },
    {
      type: 'configure',
      link: 'link-A',
      boot: 'boot-A',
      id: 'agent-A:1',
      expectedRevision: 0,
      region: 'US',
      label: 'screen',
      screenTimeout: 60,
      screenWake: 1,
    },
    { type: 'sync', link: 'link-A', boot: 'boot-A', request: 2 },
    {
      type: 'configure',
      link: 'link-A',
      boot: 'boot-A',
      id: 'agent-A:2',
      expectedRevision: 1,
      region: 'US',
      label: 'legacy edit',
    },
    { type: 'sync', link: 'link-A', boot: 'boot-A', request: 3 },
    {
      type: 'configure',
      link: 'link-A',
      boot: 'boot-A',
      id: 'agent-A:3',
      expectedRevision: 2,
      region: 'US',
      label: 'partial',
      screenTimeout: 60,
    },
    {
      type: 'configure',
      link: 'link-A',
      boot: 'boot-A',
      id: 'agent-A:4',
      expectedRevision: 2,
      region: 'US',
      label: 'too short',
      screenTimeout: 5,
      screenWake: 0,
    },
    { type: 'sync', link: 'link-A', boot: 'boot-A', request: 4 },
  ];
  const lines = execFileSync(binary, ['discovery'], {
    input: requests.map(message => hex(wire(message))).join('\n') + '\n',
    encoding: 'utf8',
    timeout: 10000,
  })
    .trim()
    .split('\n');
  assert.equal(lines.pop(), 'writes=2');
  const frames = lines.map(line => Uint8Array.from(Buffer.from(line, 'hex')));
  const responses: Message[] = [];
  for (const frame of frames)
    new FrameDecoder().feed(frame, payload => responses.push(decodeMessage(payload)));
  const welcome = responses[0];
  assert.equal(welcome.type === 'welcome' && welcome.screenVersion, 1);
  assert.ok(welcome.type === 'welcome' && (welcome.features ?? 0) & 512);
  const first = responses[1];
  assert.ok(first.type === 'snapshot' && first.screenTimeout === 30 && first.screenWake === 0);
  assert.ok(welcome.type === 'welcome' && (welcome.features ?? 0) & 131072);
  assert.ok(first.type === 'snapshot' && first.ledEnabled === 0);
  assert.equal(responses[2].type === 'result' && responses[2].outcome, 'committed');
  const saved = responses[3];
  assert.ok(saved.type === 'snapshot' && saved.screenTimeout === 60 && saved.screenWake === 1);
  const legacy = responses[5];
  assert.ok(legacy.type === 'snapshot' && legacy.revision === 2 && legacy.screenTimeout === 60);
  assert.equal(responses[6].type === 'result' && responses[6].outcome, 'rejected');
  assert.equal(responses[7].type === 'result' && responses[7].outcome, 'rejected');
  assert.equal(responses[8].type === 'snapshot' && responses[8].revision, 2);

  // The actual agent reads the native welcome and snapshot and sends both fields.
  const agent = new Connection('agent-A');
  const session = agent.open('link-A', 0);
  agent.drain();
  agent.receive(session, frames[0], 0);
  agent.drain();
  agent.receive(session, frames[1], 0);
  agent.drain();
  assert.equal(agent.supportsScreen, true);
  assert.deepEqual(agent.sync.config?.screen, { timeout: 30, wake: false });
  agent.configure({ ...agent.sync.config!, screen: { timeout: 60, wake: true } }, 1);
  const sent: Message[] = [];
  for (const bytes of agent.drain())
    new FrameDecoder().feed(bytes, payload => sent.push(decodeMessage(payload)));
  assert.ok(
    sent[0].type === 'configure' && sent[0].screenTimeout === 60 && sent[0].screenWake === 1,
  );
  agent.receive(session, frames[2], 1);
  agent.drain();
  agent.receive(session, frames[3], 1);
  assert.deepEqual(agent.sync.config?.screen, { timeout: 60, wake: true });
});

test('a joined channel ID crosses TS/native USB, persists and gates native message admission', () => {
  const hello: Message = {
    type: 'hello',
    link: 'link-A',
    minVersion: 1,
    maxVersion: 1,
    owner: 'agent-A',
    agentFeatures: 3,
  };
  const run = (requests: Message[]) => {
    const lines = execFileSync(binary, ['messages'], {
      input: requests.map(message => hex(wire(message))).join('\n') + '\n',
      encoding: 'utf8',
      timeout: 10000,
    })
      .trim()
      .split('\n');
    const writes = lines.pop();
    const frames = lines.map(line => Uint8Array.from(Buffer.from(line, 'hex')));
    const responses: Message[] = [];
    for (const frame of frames)
      new FrameDecoder().feed(frame, payload => responses.push(decodeMessage(payload)));
    return { frames, responses, writes };
  };
  const first = run([hello, { type: 'sync', link: 'link-A', boot: 'boot-A', request: 1 }]);
  const welcome = first.responses[0];
  assert.ok(welcome.type === 'welcome' && welcome.channelIdVersion === 1);
  assert.ok(welcome.type === 'welcome' && (welcome.features ?? 0) & 1024);
  assert.ok(welcome.type === 'welcome' && (welcome.features ?? 0) & 2048);
  const snapshot = first.responses[1];
  assert.ok(snapshot.type === 'snapshot' && snapshot.channelIds === DEFAULT_CHANNEL_IDS);
  assert.ok(snapshot.type === 'snapshot' && snapshot.txLevel === 1 && snapshot.txBoost === 0);

  // The actual agent joins a channel by its ID in a free slot (here slot 3, not slot 1).
  const agent = new Connection('agent-A');
  const session = agent.open('link-A', 0);
  agent.drain();
  for (const frame of first.frames) agent.receive(session, frame, 0);
  agent.drain();
  assert.equal(agent.supportsChannelIds, true);
  assert.equal(agent.supportsTxLevels, true);
  assert.equal(agent.supportsTxBoost, false);
  assert.equal(agent.sync.config!.radio!.level, 'medium');
  const joined = withChannel(agent.sync.config!.radio!, 3, 'Ridge', 0x9c41e2a7);
  agent.configure({ ...agent.sync.config!, radio: joined }, 1);
  const sent: Message[] = [];
  for (const bytes of agent.drain())
    new FrameDecoder().feed(bytes, payload => sent.push(decodeMessage(payload)));
  const configure = sent[0];
  assert.ok(configure.type === 'configure' && configure.channelIds === joined.channelIds);

  const submit = (id: string, channel: number): Message => ({
    type: 'submit',
    link: 'link-A',
    boot: 'boot-A',
    id,
    channel,
    destination: 'broadcast',
    part: 0,
    count: 1,
    data: Buffer.from('ridge').toString('hex'),
  });
  const second = run([
    hello,
    { type: 'sync', link: 'link-A', boot: 'boot-A', request: 1 },
    configure,
    { type: 'sync', link: 'link-A', boot: 'boot-A', request: 2 },
    submit('agent-A:2', 0x9c41e2a7),
    submit('agent-A:3', 0x9c41e2a8),
  ]);
  assert.equal(second.writes, 'writes=1');
  assert.equal(second.responses[2].type === 'result' && second.responses[2].outcome, 'committed');
  const saved = second.responses[3];
  assert.ok(
    saved.type === 'snapshot' &&
      saved.channels === 'Public|||Ridge||||' &&
      saved.channelIds === joined.channelIds,
  );
  const accepted = second.responses[4],
    refused = second.responses[5];
  assert.ok(accepted.type === 'messageStatus' && accepted.state !== 'rejected');
  assert.ok(refused.type === 'messageStatus' && refused.state === 'rejected');
  agent.receive(session, second.frames[2], 2);
  agent.receive(session, second.frames[3], 2);
  assert.deepEqual(channelList(agent.sync.config!.radio!), [
    { slot: 0, id: 0, name: 'Public' },
    { slot: 3, id: 0x9c41e2a7, name: 'Ridge' },
  ]);
});
