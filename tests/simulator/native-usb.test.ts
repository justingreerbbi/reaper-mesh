import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Connection } from '../../packages/client-core/connection.ts';
import { FrameDecoder, encodeFrame } from '../../packages/protocol/framing.ts';
import { encodeMessage, decodeMessage, type Message } from '../../packages/protocol/messages.ts';

const directory = mkdtempSync(join(tmpdir(), 'reaper-native-usb-'));
const binary = join(directory, 'device-bridge');
after(() => rmSync(directory, { recursive: true, force: true }));
const sanitizers = process.platform === 'darwin' && process.env.REAPER_ASAN !== '1' ? 'undefined' : 'address,undefined';
execFileSync(process.env.CXX || 'c++', [
  '-std=c++17', '-O1', '-Wall', '-Wextra', '-Werror', '-pedantic',
  `-fsanitize=${sanitizers}`, '-fno-sanitize-recover=all', '-fno-omit-frame-pointer',
  '-Ifirmware/components/reaper_protocol/include', '-Ifirmware/components/reaper_device/include',
  'firmware/components/reaper_protocol/protocol.cpp', 'firmware/components/reaper_device/configuration.cpp',
  'firmware/components/reaper_device/session.cpp', 'firmware/tests/device_bridge.cpp', '-o', binary,
], { stdio: 'pipe', timeout: 30000 });
const wire = (message: Message) => encodeFrame(encodeMessage(message));
const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');
const hello = (link: string): Message => ({ type: 'hello', link, minVersion: 1, maxVersion: 1, owner: 'client-A' });
const sync = (link: string, request: number): Message => ({ type: 'sync', link, boot: 'boot-A', request });
const change: Message = { type: 'configure', link: 'link-A', boot: 'boot-A', id: 'client-A:1',
  expectedRevision: 0, region: 'US', label: 'native C++ device' };
function transcript(messages: Message[], uncertain = false) {
  const lines = execFileSync(binary, uncertain ? ['uncertain'] : [], {
    input: messages.map(message => hex(wire(message))).join('\n') + '\n', encoding: 'utf8', timeout: 10000,
  }).trim().split('\n');
  assert.equal(lines.pop(), 'writes=1');
  return lines.map(line => line.split('|').map(part => Uint8Array.from(Buffer.from(part, 'hex'))));
}
function expectRequest(connection: Connection, expected: Message) {
  const messages: Message[] = [];
  const decoder = new FrameDecoder();
  for (const bytes of connection.drain()) decoder.feed(bytes, payload => messages.push(decodeMessage(payload)));
  assert.deepEqual(messages, [expected]);
}

test('TypeScript client synchronizes and saves against the actual native session engine', () => {
  const requests = [hello('link-A'), sync('link-A', 1), change, sync('link-A', 2)];
  const replies = transcript(requests);
  const client = new Connection('client-A'); const session = client.open('link-A', 0);
  expectRequest(client, requests[0]); client.receive(session, replies[0][0], 0);
  expectRequest(client, requests[1]); client.receive(session, replies[1][0], 0);
  const id = client.configure({ region: 'US', label: 'native C++ device' }, 0);
  expectRequest(client, requests[2]); client.receive(session, replies[2][0], 0);
  expectRequest(client, requests[3]); client.receive(session, replies[3][0], 0);
  assert.equal(client.sync.state, 'ready');
  assert.equal(client.sync.config?.label, 'native C++ device');
  assert.equal(client.commands.status(id).outcome, 'committed');
});

test('TypeScript client queries a lost native receipt on reconnect without replaying config', () => {
  const requests: Message[] = [hello('link-A'), sync('link-A', 1), change, hello('link-B'), sync('link-B', 2),
    { type: 'query', link: 'link-B', boot: 'boot-A', id: 'client-A:1' }, sync('link-B', 3)];
  const replies = transcript(requests);
  const client = new Connection('client-A'); let session = client.open('link-A', 0);
  expectRequest(client, requests[0]); client.receive(session, replies[0][0], 0);
  expectRequest(client, requests[1]); client.receive(session, replies[1][0], 0);
  const id = client.configure({ region: 'US', label: 'native C++ device' }, 0);
  expectRequest(client, requests[2]); // Drop native result at index 2.
  client.close(); session = client.open('link-B', 1);
  expectRequest(client, requests[3]); client.receive(session, replies[3][0], 1);
  expectRequest(client, requests[4]); client.receive(session, replies[4][0], 1);
  client.recover(id, 1); expectRequest(client, requests[5]); client.receive(session, replies[5][0], 1);
  expectRequest(client, requests[6]); client.receive(session, replies[6][0], 1);
  assert.equal(client.commands.status(id).outcome, 'committed');
  assert.equal(client.sync.revision, 1);
});

test('native uncertain persistence ends the client connection with an unknown command', () => {
  const requests = [hello('link-A'), sync('link-A', 1), change];
  const replies = transcript(requests, true);
  const client = new Connection('client-A'); const session = client.open('link-A', 0);
  client.drain(); client.receive(session, replies[0][0], 0);
  client.drain(); client.receive(session, replies[1][0], 0);
  const id = client.configure({ region: 'US', label: 'native C++ device' }, 0);
  for (const reply of replies[2]) client.receive(session, reply, 0);
  assert.equal(client.sync.state, 'disconnected');
  assert.equal(client.commands.status(id).outcome, 'unknown');
  assert.match(client.error!, /storage unavailable/);
});
