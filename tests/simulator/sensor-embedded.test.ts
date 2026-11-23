import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import fixtures from '../../packages/protocol/fixtures/sensor-messages-v1.json' with { type: 'json' };
import {
  decodeSensorMessage,
  encodeSensorFrame,
  encodeSensorMessage,
  type SensorMessage,
} from '../../packages/protocol/sensor-messages.ts';
import { encodeMessage } from '../../packages/protocol/messages.ts';
import {
  encodeFrame,
  FrameDecoder,
  maxEncoded,
  SENSOR_ENVELOPE,
} from '../../packages/protocol/framing.ts';

const directory = mkdtempSync(join(tmpdir(), 'reaper-sensor-codec-'));
const binary = join(directory, 'sensor-codec-bridge');
// Same sanitizer choice as embedded.test.ts: AppleClang AddressSanitizer stalls on macOS hosts.
const sanitizers =
  process.platform === 'darwin' && process.env.REAPER_ASAN !== '1'
    ? 'undefined'
    : 'address,undefined';
after(() => rmSync(directory, { recursive: true, force: true }));
execFileSync(
  process.env.CXX || 'c++',
  [
    '-std=c++17',
    '-O1',
    '-g',
    '-Wall',
    '-Wextra',
    '-Werror',
    '-pedantic',
    `-fsanitize=${sanitizers}`,
    '-fno-omit-frame-pointer',
    '-fno-sanitize-recover=all',
    '-Ifirmware/components/reaper_protocol/include',
    'firmware/components/reaper_protocol/protocol.cpp',
    'firmware/components/reaper_protocol/sensor_protocol.cpp',
    'firmware/tests/sensor_codec_bridge.cpp',
    '-o',
    binary,
  ],
  { cwd: resolve('.'), stdio: 'pipe', timeout: 30000 },
);
const hex = (value: Uint8Array) => Buffer.from(value).toString('hex');
const joinBytes = (...parts: Uint8Array[]) => Uint8Array.from(parts.flatMap(part => [...part]));
const sensorFrame = (payload: Uint8Array) => encodeFrame(payload, SENSOR_ENVELOPE);
const messages = fixtures.map(fixture => fixture.message as SensorMessage);

function expected(stream: Uint8Array) {
  const frames: string[] = [];
  new FrameDecoder(SENSOR_ENVELOPE).feed(stream, payload => {
    try {
      frames.push(hex(encodeSensorFrame(decodeSensorMessage(payload))));
    } catch {
      /* invalid typed payload */
    }
  });
  return frames.join('|') || 'ERR';
}
function compare(streams: Uint8Array[], chunk = 1) {
  const result = execFileSync(binary, [String(chunk)], {
    input: streams.map(hex).join('\n') + '\n',
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    timeout: 30000,
  })
    .trim()
    .split('\n');
  assert.deepEqual(result, streams.map(expected));
}

test('sensor codec compiles with warnings as errors and passes sanitizer self-checks', () => {
  assert.match(execFileSync(binary, ['selftest'], { encoding: 'utf8' }), /^ok /);
});

test('sensor fixtures keep exact bytes across both codecs', () => {
  for (const fixture of fixtures) {
    const frame = Uint8Array.from(Buffer.from(fixture.frameHex, 'hex'));
    assert.equal(expected(frame), fixture.frameHex);
  }
  compare(fixtures.map(fixture => Uint8Array.from(Buffer.from(fixture.frameHex, 'hex'))));
  compare([joinBytes(...messages.map(message => encodeSensorFrame(message)))], 5);
});

test('the sensor codec rejects node frames, and the boundary values match', () => {
  const node = encodeFrame(
    encodeMessage({ type: 'hello', link: 'link-A', minVersion: 1, maxVersion: 1 }),
  );
  const ap = messages.find(message => message.type === 'wifiAp')!;
  const probe = messages.find(message => message.type === 'wifiProbe')!;
  const streams = [
    node,
    joinBytes(node, encodeSensorFrame(messages[0])),
    ...[-0x80000000, -1, 0, 0x7fffffff].map(rssi =>
      encodeSensorFrame({ ...ap, rssi } as SensorMessage),
    ),
    ...['', 'ff'.repeat(64)].map(ssid => encodeSensorFrame({ ...probe, ssid } as SensorMessage)),
  ];
  // A 65-byte bytes field and a 3-byte integer, with valid envelopes around them.
  const payload = encodeSensorMessage({ ...probe, ssid: undefined } as SensorMessage);
  streams.push(sensorFrame(joinBytes(payload, Uint8Array.of(8, 65, 0), new Uint8Array(65))));
  streams.push(sensorFrame(joinBytes(payload.subarray(0, 2), Uint8Array.of(2, 3, 0, 1, 2, 3))));
  compare(streams);
  assert.equal(expected(node), 'ERR');
});

test('truncated payloads and corrupt bit positions agree with the agent decoder', () => {
  const samples: Uint8Array[] = [];
  for (const message of messages) {
    const payload = encodeSensorMessage(message);
    for (let end = 1; end < payload.length; end++)
      samples.push(sensorFrame(payload.subarray(0, end)));
  }
  const valid = encodeSensorFrame(messages[messages.length - 1]);
  for (let i = 0; i < valid.length; i++) {
    for (let bit = 0; bit < 8; bit++) {
      const corrupt = valid.slice();
      corrupt[i] ^= 1 << bit;
      samples.push(joinBytes(corrupt, Uint8Array.of(0), valid));
    }
  }
  compare(samples);
});

test('oversized streams, missing delimiters and combined frames recover identically', () => {
  const valid = encodeSensorFrame(messages[0]);
  const hello = encodeSensorMessage(messages[0]);
  const padding = SENSOR_ENVELOPE.maxPayload - hello.length - 3;
  const maximum = joinBytes(
    hello,
    Uint8Array.of(200, padding & 255, padding >> 8),
    new Uint8Array(padding).fill(0x7e),
  );
  compare(
    [
      joinBytes(new Uint8Array(maxEncoded(512) * 3).fill(1), Uint8Array.of(0), valid),
      joinBytes(valid.subarray(0, -1), valid, valid),
      joinBytes(valid, valid, Uint8Array.of(0, 0), valid),
      sensorFrame(new Uint8Array(512).fill(255)),
      sensorFrame(maximum),
      encodeFrame(joinBytes(maximum, Uint8Array.of(1))),
    ],
    13,
  );
});

test('seeded malformed payloads and corrupted streams have matching accept/reject behavior', () => {
  let seed = 0x5253;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed;
  };
  const samples: Uint8Array[] = [];
  for (let i = 0; i < 500; i++) {
    const payload = encodeSensorMessage(messages[random() % messages.length]);
    const corrupt = payload.slice();
    for (let j = 0, edits = 1 + (random() % 5); j < edits; j++)
      corrupt[random() % corrupt.length] ^= 1 + (random() % 255);
    samples.push(sensorFrame(corrupt));
    const noise = Uint8Array.from({ length: random() % 250 }, () => random() >>> 24);
    samples.push(
      joinBytes(noise, Uint8Array.of(0), encodeSensorFrame(messages[i % messages.length])),
    );
  }
  compare(samples, 7);
});
