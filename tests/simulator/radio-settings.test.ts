import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Synchronizer } from '../../packages/agent-core/sync.ts';
import { Connection } from '../../packages/agent-core/connection.ts';
import { FrameDecoder, encodeFrame } from '../../packages/protocol/framing.ts';
import { encodeMessage, decodeMessage, type Message } from '../../packages/protocol/messages.ts';
import {
  DEFAULT_CHANNEL_IDS,
  DEFAULT_CHANNELS,
  channelList,
  legacyChannelIds,
  newChannelId,
  validChannels,
  validRadio,
  withChannel,
  type RadioConfig,
} from '../../packages/protocol/radio-config.ts';
import { deviceCapabilities } from './capabilities.ts';
function ready(supported = true, channelIds = true) {
  const connection = new Connection('agent-A');
  const generation = connection.open('link-A', 0);
  connection.drain();
  const receive = (message: Message) =>
    connection.receive(generation, encodeFrame(encodeMessage(message)), 0);
  receive({
    type: 'welcome',
    link: 'link-A',
    boot: 'boot-A',
    device: 'device-A',
    minVersion: 1,
    maxVersion: 1,
    ...deviceCapabilities,
    ...(supported ? { features: 31, radioSchema: 1, maxChannels: 8 } : {}),
    ...(supported && channelIds ? { features: 31 | 1024, channelIdVersion: 1 } : {}),
  });
  connection.drain();
  receive({
    type: 'snapshot',
    link: 'link-A',
    boot: 'boot-A',
    request: connection.sync.snapshotRequest,
    sequence: 0,
    revision: 0,
    region: 'US',
    label: 'node',
    radioMode: 'off',
    txPower: 0,
    relay: 0,
    channels: channelIds ? DEFAULT_CHANNELS : 'Public|Camp||||||',
    ...(channelIds ? { channelIds: DEFAULT_CHANNEL_IDS } : {}),
    preset: 'US915_LAB1',
  });
  const drain = () => {
    const values: Message[] = [];
    const decoder = new FrameDecoder();
    for (const frame of connection.drain())
      decoder.feed(frame, payload => values.push(decodeMessage(payload)));
    return values;
  };
  return { connection, drain };
}
const radio: RadioConfig = {
  mode: 'receive',
  power: 5,
  relay: true,
  channels: 'Public|Camp||||||',
  channelIds: '00000000|9c41e2a7|00000000|00000000|00000000|00000000|00000000|00000000',
  preset: 'US915_LAB1',
};
test('radio extensions require capabilities before consuming IDs, while legacy edits remain supported', () => {
  const { connection, drain } = ready(false);
  assert.throws(
    () => connection.configure({ region: 'US', label: 'node', radio }, 0),
    /radio configuration/,
  );
  assert.deepEqual(drain(), []);
  assert.equal(connection.configure({ region: 'US', label: 'legacy' }, 0), 'agent-A:1');
  const packet = drain()[0];
  assert.equal(packet.type, 'configure');
  assert.ok(!('radioMode' in packet));
});
test('radio settings preserve nested immutable snapshots and retry bodies', () => {
  const { connection, drain } = ready();
  assert.equal(connection.sync.config?.radio?.mode, 'off');
  assert.ok(Object.isFrozen(connection.sync.config?.radio));
  const draft = { ...radio };
  const id = connection.configure({ region: 'US', label: 'node', radio: draft }, 0);
  draft.power = 10;
  const packet = drain()[0];
  assert.equal(packet.type, 'configure');
  if (packet.type === 'configure') {
    assert.equal(packet.txPower, 5);
    assert.equal(packet.channels, 'Public|Camp||||||');
    assert.equal(packet.channelIds, radio.channelIds);
  }
  connection.tick(1000);
  assert.deepEqual(drain(), [packet]);
  assert.equal(id, 'agent-A:1');
});
test('regional, power and channel bounds are enforced consistently before sending', () => {
  const { connection } = ready();
  for (const changed of [
    { ...radio, power: 11 },
    { ...radio, power: -1 },
    { ...radio, channels: 'Public|NameTooLong||||||' },
    { ...radio, channels: 'Secret|||||||' },
    { ...radio, channelIds: DEFAULT_CHANNEL_IDS }, // named slot without an ID
    { ...radio, channelIds: radio.channelIds.replace('00000000|9c', '00000001|9c') }, // Public
    { ...radio, channelIds: radio.channelIds.replace('9c41e2a7', 'ffffffff') }, // reserved
    { ...radio, channelIds: radio.channelIds.replace('9c41e2a7', '9C41E2A7') }, // case
  ]) {
    assert.equal(validRadio(changed, 'US'), false);
    assert.throws(() => connection.configure({ region: 'US', label: 'node', radio: changed }, 0));
  }
  assert.equal(validRadio(radio, 'UNSET'), false);
  assert.equal(validRadio({ ...radio, mode: 'off' }, 'UNSET'), true);
});

test('buffered radio events keep their original nested policy during snapshot reconciliation', () => {
  const sync = new Synchronizer();
  const session = sync.connect();
  sync.hello(session, 'boot-A', 1, 1);
  const mutable = { ...radio };
  sync.event({
    session,
    boot: 'boot-A',
    sequence: 1,
    revision: 1,
    config: { region: 'US', label: 'node', radio: mutable },
  });
  mutable.power = 10;
  sync.snapshot({
    session,
    boot: 'boot-A',
    request: sync.snapshotRequest,
    sequence: 0,
    revision: 0,
    config: { region: 'US', label: 'initial' },
  });
  assert.equal(sync.config?.radio?.power, 5);
  assert.ok(Object.isFrozen(sync.config?.radio));
});

test('channel tables follow the device rules and joined channels keep their own ID', () => {
  assert.equal(
    legacyChannelIds('Public|Camp||Ops||||'),
    '00000000|00000001|00000000|00000003|00000000|00000000|00000000|00000000',
  );
  assert.ok(validChannels('Public|Camp||Ops||||', legacyChannelIds('Public|Camp||Ops||||')));
  const twice = '00000000|9c41e2a7|9c41e2a7|00000000|00000000|00000000|00000000|00000000';
  assert.equal(validChannels('Public|Camp|Ops|||||', twice), false);
  const joined = withChannel(radio, 5, 'Ridge', 0x1234abcd);
  assert.deepEqual(channelList(joined), [
    { slot: 0, id: 0, name: 'Public' },
    { slot: 1, id: 0x9c41e2a7, name: 'Camp' },
    { slot: 5, id: 0x1234abcd, name: 'Ridge' },
  ]);
  assert.deepEqual(
    channelList(withChannel(joined, 1, '', 0)).map(c => c.name),
    ['Public', 'Ridge'],
  );
  assert.throws(() => withChannel(radio, 0, 'Public', 5));
  assert.throws(() => withChannel(radio, 2, 'Again', 0x9c41e2a7));
  const values = [7, 0xffffffff, 0x9c41e2a7, 0x4242];
  assert.equal(
    newChannelId([0x9c41e2a7], () => values.shift()!),
    0x4242,
  );
});
test('firmware without channel IDs reads slot numbers as IDs and blocks channel edits', () => {
  const { connection, drain } = ready(true, false);
  assert.equal(connection.supportsChannelIds, false);
  assert.equal(connection.sync.config?.radio?.channelIds, legacyChannelIds('Public|Camp||||||'));
  assert.match(connection.radioBlockReason ?? '', /update the device firmware/);
  assert.throws(() => connection.configure({ region: 'US', label: 'node', radio }, 0));
  assert.deepEqual(drain(), []);
});
test('removing a channel empties its slot and keeps Public and the others', () => {
  const joined = withChannel(radio, 5, 'Ridge', 0x1234abcd);
  const removed = withChannel(joined, 1, '', 0);
  assert.equal(removed.channels, 'Public|||||Ridge||');
  assert.ok(validChannels(removed.channels, removed.channelIds));
  assert.deepEqual(
    channelList(removed).map(c => c.id),
    [0, 0x1234abcd],
  );
  assert.throws(() => withChannel(joined, 0, '', 0));
});
