import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Connection } from '../../packages/client-core/connection.ts';
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
test('actual TypeScript client retrieves diagnostics and complete UTF-8 inbox from native Session without writes', () => {
  const requests: Message[] = [
    { type: 'hello', link: 'link-A', minVersion: 1, maxVersion: 1, owner: 'client-A' },
    { type: 'sync', link: 'link-A', boot: 'boot-A', request: 1 },
    { type: 'inboxQuery', link: 'link-A', boot: 'boot-A', request: 1 },
    { type: 'radioQuery', link: 'link-A', boot: 'boot-A', request: 1 },
    ...Array.from({ length: 32 }, (_, part): Message => ({ type: 'inboxRead', link: 'link-A', boot: 'boot-A', request: part + 2, sequence: 1, part })),
  ];
  const lines = execFileSync(binary, ['inbox'], { input: requests.map(message => hex(wire(message))).join('\n') + '\n', encoding: 'utf8', timeout: 10000 }).trim().split('\n');
  assert.equal(lines.pop(), 'writes=0'); const replies = lines.map(line => Uint8Array.from(Buffer.from(line, 'hex')));
  const client = new Connection('client-A'); const generation = client.open('link-A', 0);
  const expect = (messages: Message[]) => {
    const output: Message[] = []; const decoder = new FrameDecoder();
    for (const frame of client.drain()) decoder.feed(frame, payload => output.push(decodeMessage(payload)));
    assert.deepEqual(output, messages);
  };
  expect([requests[0]]); client.receive(generation, replies[0], 0); expect([requests[1]]); client.receive(generation, replies[1], 0);
  client.tick(0); expect(requests.slice(2, 4)); client.receive(generation, replies[2], 0); client.receive(generation, replies[3], 0);
  assert.equal(client.radioInfo?.probe, 1); assert.equal(client.radioInfo?.transmitted, 0);
  for (let part = 0; part < 32; part++) { client.tick(0); expect([requests[part + 4]]); client.receive(generation, replies[part + 4], 0); }
  assert.equal(client.inbox.history.length, 1); assert.equal(client.inbox.history[0].text, 'x'.repeat(31) + '📻' + 'z'.repeat(989));
  assert.equal(client.inbox.history[0].messageId, 'remote_1');
});

test('native Session capability-gates discovery, deduplicates starts and pages an independent node snapshot', () => {
  const requests: Message[] = [
    { type: 'hello', link: 'link-A', minVersion: 1, maxVersion: 1, owner: 'client-A' },
    { type: 'sync', link: 'link-A', boot: 'boot-A', request: 1 },
    { type: 'discover', link: 'link-A', boot: 'boot-A', id: 'client-A:1', action: 1 },
    { type: 'discover', link: 'link-A', boot: 'boot-A', id: 'client-A:1', action: 1 },
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
  const client = new Connection('client-A'); const generation = client.open('link-A', 0); client.drain();
  client.receive(generation, Uint8Array.from(Buffer.from(lines[0], 'hex')), 0); client.drain();
  client.receive(generation, Uint8Array.from(Buffer.from(lines[1], 'hex')), 0);
  client.tick(0); client.drain(); client.discover(0); client.drain();
  client.receive(generation, Uint8Array.from(Buffer.from(lines[2], 'hex')), 0);
  assert.equal(client.discovery.last?.sequence, 1);
  client.receive(generation, Uint8Array.from(Buffer.from(lines[5], 'hex')), 0); client.tick(1); client.drain();
  client.receive(generation, Uint8Array.from(Buffer.from(lines[6], 'hex')), 1);
  assert.equal(client.discovery.nodes[0].name, 'Bravo'); assert.equal(client.discovery.nodes[0].node, 'node-0000000000000002');
});
