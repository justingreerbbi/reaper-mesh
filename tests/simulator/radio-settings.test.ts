import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Synchronizer } from '../../packages/client-core/sync.ts';
import { Connection } from '../../packages/client-core/connection.ts';
import { FrameDecoder, encodeFrame } from '../../packages/protocol/framing.ts';
import { encodeMessage, decodeMessage, type Message } from '../../packages/protocol/messages.ts';
import { DEFAULT_CHANNELS, validRadio, type RadioConfig } from '../../packages/protocol/radio-config.ts';
import { deviceCapabilities } from './capabilities.ts';
function ready(supported = true) {
  const connection = new Connection('client-A'); const generation = connection.open('link-A', 0); connection.drain();
  const receive = (message: Message) => connection.receive(generation, encodeFrame(encodeMessage(message)), 0);
  receive({ type: 'welcome', link: 'link-A', boot: 'boot-A', device: 'device-A', minVersion: 1, maxVersion: 1,
    ...deviceCapabilities, ...(supported ? { features: 31, radioSchema: 1, maxChannels: 8 } : {}) }); connection.drain();
  receive({ type: 'snapshot', link: 'link-A', boot: 'boot-A', request: connection.sync.snapshotRequest,
    sequence: 0, revision: 0, region: 'US', label: 'node', radioMode: 'off', txPower: 0, relay: 0, channels: DEFAULT_CHANNELS, preset: 'US915_LAB1' });
  const drain = () => { const values: Message[] = []; const decoder = new FrameDecoder(); for (const frame of connection.drain()) decoder.feed(frame, payload => values.push(decodeMessage(payload))); return values; };
  return { connection, drain };
}
const radio: RadioConfig = { mode: 'receive', power: 5, relay: true, channels: 'Public|Camp||||||', preset: 'US915_LAB1' };
test('radio extensions require capabilities before consuming IDs, while legacy edits remain supported', () => {
  const { connection, drain } = ready(false);
  assert.throws(() => connection.configure({ region: 'US', label: 'node', radio }, 0), /radio configuration/);
  assert.deepEqual(drain(), []); assert.equal(connection.configure({ region: 'US', label: 'legacy' }, 0), 'client-A:1');
  const packet = drain()[0]; assert.equal(packet.type, 'configure'); assert.ok(!('radioMode' in packet));
});
test('radio settings preserve nested immutable snapshots and retry bodies', () => {
  const { connection, drain } = ready();
  assert.equal(connection.sync.config?.radio?.mode, 'off'); assert.ok(Object.isFrozen(connection.sync.config?.radio));
  const draft = { ...radio };
  const id = connection.configure({ region: 'US', label: 'node', radio: draft }, 0); draft.power = 10;
  const packet = drain()[0]; assert.equal(packet.type, 'configure');
  if (packet.type === 'configure') { assert.equal(packet.txPower, 5); assert.equal(packet.channels, 'Public|Camp||||||'); }
  connection.tick(1000); assert.deepEqual(drain(), [packet]); assert.equal(id, 'client-A:1');
});
test('regional, power and channel bounds are enforced consistently before sending', () => {
  const { connection } = ready();
  for (const changed of [{ ...radio, power: 11 }, { ...radio, power: -1 }, { ...radio, channels: 'Public|NameTooLong||||||' }, { ...radio, channels: 'Secret|||||||' }]) {
    assert.equal(validRadio(changed, 'US'), false);
    assert.throws(() => connection.configure({ region: 'US', label: 'node', radio: changed }, 0));
  }
  assert.equal(validRadio(radio, 'UNSET'), false);
  assert.equal(validRadio({ ...radio, mode: 'off' }, 'UNSET'), true);
});

test('buffered radio events keep their original nested policy during snapshot reconciliation', () => {
  const sync = new Synchronizer(); const session = sync.connect(); sync.hello(session, 'boot-A', 1, 1);
  const mutable = { ...radio };
  sync.event({ session, boot: 'boot-A', sequence: 1, revision: 1, config: { region: 'US', label: 'node', radio: mutable } });
  mutable.power = 10;
  sync.snapshot({ session, boot: 'boot-A', request: sync.snapshotRequest, sequence: 0, revision: 0, config: { region: 'US', label: 'initial' } });
  assert.equal(sync.config?.radio?.power, 5); assert.ok(Object.isFrozen(sync.config?.radio));
});
