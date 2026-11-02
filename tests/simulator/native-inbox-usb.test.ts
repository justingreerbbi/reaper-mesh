import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Connection } from '../../packages/agent-core/connection.ts';
import { FrameDecoder, encodeFrame } from '../../packages/protocol/framing.ts';
import { encodeMessage, decodeMessage, type Message } from '../../packages/protocol/messages.ts';

const directory = mkdtempSync(join(tmpdir(), 'reaper-inbox-usb-'));
const binary = join(directory, 'device-bridge');
after(() => rmSync(directory, { recursive: true, force: true }));
const sanitizers = process.platform === 'darwin' && process.env.REAPER_ASAN !== '1' ? 'undefined' : 'address,undefined';
execFileSync(process.env.CXX || 'c++', [
  '-std=c++17', '-O1', '-Wall', '-Wextra', '-Werror', '-pedantic',
  `-fsanitize=${sanitizers}`, '-fno-sanitize-recover=all', '-fno-omit-frame-pointer',
  '-Ifirmware/components/reaper_protocol/include', '-Ifirmware/components/reaper_mesh/include', '-Ifirmware/components/reaper_device/include',
  'firmware/components/reaper_protocol/protocol.cpp', 'firmware/components/reaper_device/configuration.cpp',
  'firmware/components/reaper_device/discovery.cpp', 'firmware/components/reaper_mesh/radio_packet.cpp', 'firmware/components/reaper_device/session.cpp', 'firmware/components/reaper_device/inbox.cpp', 'firmware/components/reaper_device/messages.cpp', 'firmware/tests/device_bridge.cpp', '-o', binary,
], { stdio: 'pipe', timeout: 30000 });
const wire = (message: Message) => encodeFrame(encodeMessage(message));
const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');
test('actual TypeScript agent retrieves diagnostics and complete UTF-8 inbox from native Session without writes', () => {
  const requests: Message[] = [
    { type: 'hello', link: 'link-A', minVersion: 1, maxVersion: 1, owner: 'agent-A' },
    { type: 'sync', link: 'link-A', boot: 'boot-A', request: 1 },
    { type: 'inboxQuery', link: 'link-A', boot: 'boot-A', request: 1 },
    { type: 'radioQuery', link: 'link-A', boot: 'boot-A', request: 1 },
    ...Array.from({ length: 32 }, (_, part): Message => ({ type: 'inboxRead', link: 'link-A', boot: 'boot-A', request: part + 2, sequence: 1, part })),
  ];
  const lines = execFileSync(binary, ['inbox'], { input: requests.map(message => hex(wire(message))).join('\n') + '\n', encoding: 'utf8', timeout: 10000 }).trim().split('\n');
  assert.equal(lines.pop(), 'writes=0'); const replies = lines.map(line => Uint8Array.from(Buffer.from(line, 'hex')));
  const agent = new Connection('agent-A'); const generation = agent.open('link-A', 0);
  const expect = (messages: Message[]) => {
    const output: Message[] = []; const decoder = new FrameDecoder();
    for (const frame of agent.drain()) decoder.feed(frame, payload => output.push(decodeMessage(payload)));
    assert.deepEqual(output, messages);
  };
  expect([requests[0]]); agent.receive(generation, replies[0], 0); expect([requests[1]]); agent.receive(generation, replies[1], 0);
  agent.tick(0); expect(requests.slice(2, 4)); agent.receive(generation, replies[2], 0); agent.receive(generation, replies[3], 0);
  assert.equal(agent.radioInfo?.probe, 1); assert.equal(agent.radioInfo?.transmitted, 0);
  for (let part = 0; part < 32; part++) { agent.tick(0); expect([requests[part + 4]]); agent.receive(generation, replies[part + 4], 0); }
  assert.equal(agent.inbox.history.length, 1); assert.equal(agent.inbox.history[0].text, 'x'.repeat(31) + '📻' + 'z'.repeat(989));
  assert.equal(agent.inbox.history[0].messageId, 'remote_1');
});

test('native Session capability-gates discovery, deduplicates starts and pages an independent node snapshot', () => {
  const requests: Message[] = [
    { type: 'hello', link: 'link-A', minVersion: 1, maxVersion: 1, owner: 'agent-A' },
    { type: 'sync', link: 'link-A', boot: 'boot-A', request: 1 },
    { type: 'discover', link: 'link-A', boot: 'boot-A', id: 'agent-A:1', action: 1 },
    { type: 'discover', link: 'link-A', boot: 'boot-A', id: 'agent-A:1', action: 1 },
    { type: 'discover', link: 'link-A', boot: 'boot-A', id: 'other:1', action: 1 },
    { type: 'nodeQuery', link: 'link-A', boot: 'boot-A', request: 1, generation: 0, cursor: 0 },
    { type: 'nodeQuery', link: 'link-A', boot: 'boot-A', request: 2, generation: 1, cursor: 0 },
  ];
  const lines = execFileSync(binary, ['discovery'], { input: requests.map(message => hex(wire(message))).join('\n') + '\n', encoding: 'utf8', timeout: 10000 }).trim().split('\n');
  assert.equal(lines.pop(), 'writes=0');
  const responses: Message[] = [];
  for (const line of lines) new FrameDecoder().feed(Uint8Array.from(Buffer.from(line, 'hex')), payload => responses.push(decodeMessage(payload)));
  assert.equal(responses[0].type === 'welcome' && responses[0].discoveryVersion, 1);
  assert.deepEqual(responses[2], responses[3]); assert.equal(responses[4].type === 'discoveryStatus' && responses[4].state, 'rejected');
  const agent = new Connection('agent-A'); const generation = agent.open('link-A', 0); agent.drain();
  agent.receive(generation, Uint8Array.from(Buffer.from(lines[0], 'hex')), 0); agent.drain();
  agent.receive(generation, Uint8Array.from(Buffer.from(lines[1], 'hex')), 0);
  agent.tick(0); agent.drain(); agent.discover(0); agent.drain();
  agent.receive(generation, Uint8Array.from(Buffer.from(lines[2], 'hex')), 0);
  assert.equal(agent.discovery.last?.sequence, 1);
  agent.receive(generation, Uint8Array.from(Buffer.from(lines[5], 'hex')), 0); agent.tick(1); agent.drain();
  agent.receive(generation, Uint8Array.from(Buffer.from(lines[6], 'hex')), 1);
  assert.equal(agent.discovery.nodes[0].name, 'Bravo'); assert.equal(agent.discovery.nodes[0].node, 'node-0000000000000002');
});

test('position settings cross TS/native USB, survive lost replies and legacy writes, and reject partial updates', () => {
  const requests: Message[] = [
    { type: 'hello', link: 'link-A', minVersion: 1, maxVersion: 1, owner: 'agent-A' },
    { type: 'sync', link: 'link-A', boot: 'boot-A', request: 1 },
    { type: 'configure', link: 'link-A', boot: 'boot-A', id: 'agent-A:1', expectedRevision: 0, region: 'US', label: 'fixed', shareLocation: 1, positionSource: 1, latitude: 900000000, longitude: 1800000000 },
    { type: 'hello', link: 'link-B', minVersion: 1, maxVersion: 1, owner: 'agent-A' },
    { type: 'sync', link: 'link-B', boot: 'boot-A', request: 2 },
    { type: 'query', link: 'link-B', boot: 'boot-A', id: 'agent-A:1' },
    { type: 'sync', link: 'link-B', boot: 'boot-A', request: 3 },
    { type: 'configure', link: 'link-B', boot: 'boot-A', id: 'agent-A:2', expectedRevision: 1, region: 'US', label: 'legacy edit' },
    { type: 'sync', link: 'link-B', boot: 'boot-A', request: 4 },
    { type: 'configure', link: 'link-B', boot: 'boot-A', id: 'agent-A:3', expectedRevision: 2, region: 'US', label: 'bad partial', shareLocation: 0 },
    { type: 'sync', link: 'link-B', boot: 'boot-A', request: 5 },
  ];
  const lines = execFileSync(binary, ['discovery'], { input: requests.map(message => hex(wire(message))).join('\n') + '\n', encoding: 'utf8', timeout: 10000 }).trim().split('\n');
  assert.equal(lines.pop(), 'writes=2');
  const frames = lines.map(line => Uint8Array.from(Buffer.from(line, 'hex')));
  const agent = new Connection('agent-A'); let session = agent.open('link-A', 0); agent.drain();
  agent.receive(session, frames[0], 0); agent.drain(); agent.receive(session, frames[1], 0); agent.drain();
  assert.equal(agent.supportsPosition, true);
  const position = { share: true, source: 1 as const, latitude: 900000000, longitude: 1800000000 };
  const id = agent.configure({ region: 'US', label: 'fixed', position }, 1);
  const sent: Message[] = []; for (const bytes of agent.drain()) new FrameDecoder().feed(bytes, payload => sent.push(decodeMessage(payload)));
  assert.deepEqual(sent, [requests[2]]); // Drop the committed reply.
  const restored = Connection.fromJournal(agent.exportJournal()); assert.equal(restored.commands.status(id).outcome, 'unknown');
  agent.close(); session = agent.open('link-B', 2); agent.drain();
  agent.receive(session, frames[3], 2); agent.drain(); agent.receive(session, frames[4], 2); agent.drain();
  assert.deepEqual(agent.sync.config?.position, position);
  agent.recover(id, 3);
  const recovery: Message[] = []; for (const bytes of agent.drain()) new FrameDecoder().feed(bytes, payload => recovery.push(decodeMessage(payload)));
  assert.deepEqual(recovery, [requests[5]]);
  agent.receive(session, frames[5], 3); agent.drain(); agent.receive(session, frames[6], 3);
  assert.equal(agent.commands.status(id).outcome, 'committed');
  const responses: Message[] = []; for (const frame of frames) new FrameDecoder().feed(frame, payload => responses.push(decodeMessage(payload)));
  assert.equal(responses[8].type === 'snapshot' && responses[8].shareLocation, 1);
  assert.equal(responses[9].type === 'result' && responses[9].outcome, 'rejected');
  assert.equal(responses[10].type === 'snapshot' && responses[10].revision, 2);
});

test('native node paging freezes position with identity while a later name-only RF report arrives', () => {
  const requests: Message[] = [
    { type: 'hello', link: 'link-A', minVersion: 1, maxVersion: 1, owner: 'agent-A' },
    { type: 'sync', link: 'link-A', boot: 'boot-A', request: 1 },
    { type: 'nodeQuery', link: 'link-A', boot: 'boot-A', request: 1, generation: 0, cursor: 0 },
    { type: 'nodeQuery', link: 'link-A', boot: 'boot-A', request: 2, generation: 1, cursor: 0 },
    { type: 'nodeQuery', link: 'link-A', boot: 'boot-A', request: 3, generation: 0, cursor: 0 },
    { type: 'nodeQuery', link: 'link-A', boot: 'boot-A', request: 4, generation: 2, cursor: 0 },
  ];
  const lines = execFileSync(binary, ['position'], { input: requests.map(message => hex(wire(message))).join('\n') + '\n', encoding: 'utf8', timeout: 10000 }).trim().split('\n');
  assert.equal(lines.pop(), 'writes=0');
  const responses: Message[] = []; for (const line of lines) new FrameDecoder().feed(Uint8Array.from(Buffer.from(line, 'hex')), payload => responses.push(decodeMessage(payload)));
  assert.equal(responses[3].type === 'nodeReply' && responses[3].latitude, 900000000);
  assert.equal(responses[3].type === 'nodeReply' && responses[3].name, 'Bravo');
  assert.equal(responses[5].type === 'nodeReply' && responses[5].positionSource, undefined);
  assert.equal(responses[5].type === 'nodeReply' && responses[5].name, 'Delta');
});
