import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Connection } from '../../packages/agent-core/connection.ts';
import { FrameDecoder, encodeFrame } from '../../packages/protocol/framing.ts';
import { encodeMessage, decodeMessage, type Message } from '../../packages/protocol/messages.ts';

const directory = mkdtempSync(join(tmpdir(), 'reaper-message-usb-'));
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
test('actual TypeScript message agent uploads 1024 bytes and queries a lost native acceptance without replay', () => {
  const agent = new Connection('agent-A');
  let generation = agent.open('link-A', 0);
  const hello: Message = {
    type: 'hello',
    link: 'link-A',
    minVersion: 1,
    maxVersion: 1,
    owner: 'agent-A',
  };
  const sync: Message = { type: 'sync', link: 'link-A', boot: 'boot-A', request: 1 };
  const body = 'x'.repeat(31) + '📻' + 'z'.repeat(989);
  const bytes = Buffer.from(body);
  const submissions: Message[] = [];
  for (let part = 0; part < 32; ++part)
    submissions.push({
      type: 'submit',
      link: 'link-A',
      boot: 'boot-A',
      id: 'agent-A:1',
      channel: 0,
      destination: 'broadcast',
      part,
      count: 32,
      data: bytes.subarray(part * 32, (part + 1) * 32).toString('hex'),
    });
  const requests: Message[] = [
    hello,
    sync,
    ...submissions,
    { ...hello, link: 'link-B' },
    { ...sync, link: 'link-B', request: 2 },
    { type: 'messageQuery', link: 'link-B', boot: 'boot-A', id: 'agent-A:1' },
  ];
  const lines = execFileSync(binary, ['messages'], {
    input: requests.map(message => hex(wire(message))).join('\n') + '\n',
    encoding: 'utf8',
    timeout: 10000,
  })
    .trim()
    .split('\n');
  assert.equal(lines.pop(), 'writes=0');
  const replies = lines.map(line => Uint8Array.from(Buffer.from(line, 'hex')));
  const expect = (expected: Message) => {
    const decoded: Message[] = [];
    const decoder = new FrameDecoder();
    for (const frame of agent.drain())
      decoder.feed(frame, payload => decoded.push(decodeMessage(payload)));
    assert.deepEqual(decoded, [expected]);
  };
  expect(hello);
  agent.receive(generation, replies[0], 0);
  expect(sync);
  agent.receive(generation, replies[1], 0);
  const id = agent.sendMessage(body, 'broadcast', 0, 0);
  for (let part = 0; part < 32; ++part) {
    expect(submissions[part]);
    if (part < 31) agent.receive(generation, replies[part + 2], 0); // Lose final queued receipt.
  }
  agent.close();
  assert.equal(agent.messaging.history[0].state, 'unknown');
  generation = agent.open('link-B', 1);
  expect(requests[34]);
  agent.receive(generation, replies[34], 1);
  expect(requests[35]);
  agent.receive(generation, replies[35], 1);
  assert.equal(agent.recoverMessage(id, 1), true);
  expect(requests[36]);
  agent.receive(generation, replies[36], 1);
  assert.equal(agent.messaging.history[0].state, 'queued');
  assert.equal(agent.messaging.history[0].text, body);
  assert.equal(agent.messaging.history[0].messageId, 'boot-A_1');
  assert.deepEqual(agent.drain(), []);
});

test('map application text passes unchanged native firmware message admission without a schema update', async () => {
  const { encodeMap, decodeMap } = await import('../../packages/protocol/map-item.ts');
  const body = encodeMap({
    operation: 'put',
    item: {
      id: '11223344-1122-3344-5566-112233445566',
      revision: 1,
      geometry: 'point',
      type: 'core/point',
      color: '#abcdef',
      name: 'Field point',
      note: 'Native compatibility',
      coordinates: [900000000, 1800000000],
      metadata: {},
    },
  });
  const bytes = Buffer.from(body),
    count = Math.ceil(bytes.length / 32);
  const requests: Message[] = [
    { type: 'hello', link: 'link-A', minVersion: 1, maxVersion: 1, owner: 'agent-A' },
    { type: 'sync', link: 'link-A', boot: 'boot-A', request: 1 },
    ...Array.from({ length: count }, (_, part): Message => ({
      type: 'submit',
      link: 'link-A',
      boot: 'boot-A',
      id: 'agent-A:1',
      channel: 0,
      destination: 'broadcast',
      part,
      count,
      data: bytes.subarray(part * 32, (part + 1) * 32).toString('hex'),
    })),
  ];
  const lines = execFileSync(binary, ['messages'], {
    input: requests.map(m => hex(wire(m))).join('\n') + '\n',
    encoding: 'utf8',
    timeout: 10000,
  })
    .trim()
    .split('\n');
  assert.equal(lines.pop(), 'writes=0');
  const responses: Message[] = [];
  for (const line of lines)
    new FrameDecoder().feed(Buffer.from(line, 'hex'), payload =>
      responses.push(decodeMessage(payload)),
    );
  const result = responses.at(-1);
  assert.equal(result?.type, 'messageStatus');
  assert.equal(result?.type === 'messageStatus' && result.state, 'queued');
  assert.equal(decodeMap(body)?.item.name, 'Field point');
});
