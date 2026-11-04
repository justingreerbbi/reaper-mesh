/**
 * Two-board channel ID check (D45): existing channels after upgrade, membership, joining by
 * invite in a different slot, plaintext and encrypted delivery, persistence. Requires confirmed
 * US antennas on both boards. Restores each board's original channel table.
 */
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { formatInvite, parseInvite } from '../agents/web/channel-invite.ts';
import { EncryptionVault } from '../agents/web/encryption.ts';
import type { Config } from '../packages/agent-core/sync.ts';
import { parseEncryptedHeader } from '../packages/protocol/encrypted-message.ts';
import { newChannelId, channelList, withChannel } from '../packages/protocol/radio-config.ts';
import { openBoard } from './hardware-port.ts';

const [python, heltecPort, tbeamPort] = process.argv.slice(2);
if (!python || !heltecPort || !tbeamPort || heltecPort === tbeamPort)
  throw new Error('usage: node tools/hardware-channel-smoke.ts PYTHON HELTEC_PORT TBEAM_PORT');
class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}
type Board = Awaited<ReturnType<typeof openBoard>>;
const opened: Board[] = [];
const originals: Config[] = [];
const results: Record<string, unknown>[] = [];
let reopening: Board | undefined; // Deliberately closed, so its state is not a failure.
const SLOTS = [4, 7]; // Deliberately different: a joined channel is not tied to a slot.
const NAME = 'QaRidge';
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const hexBytes = (value: string) =>
  Uint8Array.from(value.match(/../g)!, byte => Number.parseInt(byte, 16));
const bytesHex = (bytes: Uint8Array) =>
  Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
function note(result: Record<string, unknown>) {
  results.push(result);
  console.log(JSON.stringify(result));
}
async function waitFor(test: () => boolean, what: string, timeout = 65000) {
  const until = performance.now() + timeout;
  while (!test()) {
    if (
      performance.now() > until ||
      opened.some(board => board !== reopening && board.connection.sync.state === 'disconnected')
    )
      throw new Error(
        `${what} timed out/disconnected: ` +
          opened
            .map(board => board.connection.error ?? board.connection.radioInfo?.reason)
            .join(', '),
      );
    await sleep(25);
  }
}
async function save(board: Board, config: Config) {
  const id = board.adapter.configure(config);
  await waitFor(() => board.connection.commands.status(id).outcome !== 'pending', 'save', 10000);
  assert.equal(board.connection.commands.status(id).outcome, 'committed');
  await waitFor(() => board.connection.sync.state === 'ready', 'resync', 10000);
  await waitFor(() => board.connection.radioInfo?.reason === 'ready', 'radio', 10000);
}
async function open(port: string) {
  const board = await openBoard(python, port);
  try {
    await waitFor(() => board.connection.radioInfo?.reason === 'ready', 'radio', 10000);
  } catch (error) {
    await board.adapter.disconnect();
    throw error;
  }
  return board;
}
async function outcome(sender: Board, id: string) {
  await waitFor(
    () =>
      ['acknowledged', 'transmitted', 'failed', 'rejected', 'unknown'].includes(
        sender.connection.messaging.history.find(item => item.id === id)?.state ?? '',
      ),
    'send',
  );
  return sender.connection.messaging.history.find(item => item.id === id)!;
}
async function direct(sender: Board, receiver: Board, channel: number, label: string) {
  const text = `Reaper ${label} ${crypto.randomUUID()}`;
  const id = sender.adapter.sendMessage(text, receiver.connection.device!, channel);
  const status = await outcome(sender, id);
  await waitFor(
    () => sender.connection.messaging.history.find(item => item.id === id)?.state !== 'transmitted',
    'ack',
  );
  const final = sender.connection.messaging.history.find(item => item.id === id)!;
  assert.equal(final.state, 'acknowledged', `${label}: ${status.reason}`);
  await waitFor(
    () => receiver.connection.inbox.history.some(item => item.messageId === final.messageId),
    'inbox',
  );
  const item = receiver.connection.inbox.history.find(m => m.messageId === final.messageId)!;
  assert.equal(item.text, text);
  assert.equal(item.channel, channel);
  note({ check: label, from: sender.connection.device, channel, outcome: 'acknowledged+inbox' });
}
try {
  opened.push(await open(heltecPort), await open(tbeamPort));
  for (const [index, board] of opened.entries()) {
    assert.match(board.connection.capabilities?.firmware ?? '', /-reaper-mesh-v0\.3\./);
    assert.equal(board.connection.supportsChannelIds, true);
    originals[index] = board.connection.sync.config!;
    assert.equal(originals[index].radio?.mode, 'mesh');
  }
  // Existing channels still connect the boards after the upgrade.
  const shared = channelList(originals[0].radio!).filter(a =>
    channelList(originals[1].radio!).some(b => b.id === a.id),
  );
  for (const channel of shared.slice(0, 2))
    for (const source of [0, 1])
      await direct(opened[source], opened[1 - source], channel.id, `existing ${channel.name}`);

  // A new channel exists only on the Heltec: the T-Beam must ignore it.
  const taken = originals.flatMap(config => channelList(config.radio!).map(c => c.id));
  const channel = newChannelId(taken);
  assert.ok(SLOTS.every((slot, i) => !originals[i].radio!.channels.split('|')[slot]));
  await save(opened[0], {
    ...opened[0].connection.sync.config!,
    radio: withChannel(opened[0].connection.sync.config!.radio!, SLOTS[0], NAME, channel),
  });
  const outsider = `Reaper outsider ${crypto.randomUUID()}`;
  const unseen = await outcome(
    opened[0],
    opened[0].adapter.sendMessage(outsider, 'broadcast', channel),
  );
  assert.equal(unseen.state, 'transmitted');
  await sleep(8000);
  assert.ok(!opened[1].connection.inbox.history.some(item => item.text === outsider));
  note({ check: 'non-member ignores channel', channel: channel.toString(16), heardBy: 'nobody' });
  // A device refuses to send on a channel it has not joined.
  const refused = await outcome(
    opened[1],
    opened[1].adapter.sendMessage('Reaper refused', 'broadcast', channel),
  );
  assert.equal(refused.state, 'rejected');
  note({ check: 'non-member cannot send', outcome: refused.state, reason: refused.reason });

  // Join by invite, with a key, in a different slot.
  const vaults = [
    new EncryptionVault(new MemoryStorage()),
    new EncryptionVault(new MemoryStorage()),
  ];
  vaults[0].generate(channel);
  const invite = parseInvite(
    formatInvite({ id: channel, name: NAME, key: vaults[0].exportBundle(channel) }),
  );
  vaults[1].importBundle(invite.key!, invite.id);
  await save(opened[1], {
    ...opened[1].connection.sync.config!,
    radio: withChannel(opened[1].connection.sync.config!.radio!, SLOTS[1], invite.name, invite.id),
  });
  note({ check: 'joined by invite', channel: channel.toString(16), slots: SLOTS });

  for (const source of [0, 1])
    await direct(opened[source], opened[1 - source], channel, 'joined plaintext direct');
  const broadcast = `Reaper joined broadcast ${crypto.randomUUID()}`;
  await outcome(opened[0], opened[0].adapter.sendMessage(broadcast, 'broadcast', channel));
  await waitFor(
    () =>
      opened[1].connection.inbox.history.some(
        item => item.text === broadcast && item.channel === channel,
      ),
    'broadcast inbox',
  );
  note({ check: 'joined plaintext broadcast', outcome: 'inbox' });

  for (const source of [0, 1]) {
    const sender = opened[source],
      receiver = opened[1 - source];
    const text = `Reaper encrypted ${crypto.randomUUID()}`;
    const payload = vaults[source].encrypt(
      text,
      channel,
      sender.connection.device!,
      receiver.connection.device!,
    );
    assert.equal(parseEncryptedHeader(payload)?.channel, channel);
    const id = sender.adapter.sendMessagePayload(payload, receiver.connection.device!, channel);
    await outcome(sender, id);
    await waitFor(
      () =>
        sender.connection.messaging.history.find(item => item.id === id)?.state !== 'transmitted',
      'ack',
    );
    const final = sender.connection.messaging.history.find(item => item.id === id)!;
    assert.equal(final.state, 'acknowledged', final.reason);
    await waitFor(
      () => receiver.connection.inbox.history.some(item => item.messageId === final.messageId),
      'inbox',
    );
    const item = receiver.connection.inbox.history.find(m => m.messageId === final.messageId)!;
    assert.equal(item.payloadHex, bytesHex(payload));
    assert.ok(!Buffer.from(hexBytes(item.payloadHex!)).includes(text));
    const opened_ = vaults[1 - source].decrypt(
      hexBytes(item.payloadHex!),
      item.channel,
      item.origin,
      item.destination ?? 'broadcast',
    );
    assert.equal(opened_.text, text);
    note({ check: 'joined encrypted direct', from: sender.connection.device, decrypted: true });
  }

  // The table survives a reset: opening the port reboots the board and reloads record 6.
  for (const [index, port] of [heltecPort, tbeamPort].entries()) {
    const before = opened[index].connection.sync.boot;
    reopening = opened[index];
    await reopening.adapter.disconnect();
    opened[index] = await open(port);
    reopening = undefined;
    assert.notEqual(opened[index].connection.sync.boot, before);
    assert.ok(
      channelList(opened[index].connection.sync.config!.radio!).some(
        c => c.id === channel && c.slot === SLOTS[index] && c.name === NAME,
      ),
    );
  }
  note({ check: 'channel survives reset', slots: SLOTS });
  await direct(opened[0], opened[1], channel, 'after reset plaintext direct');
  // Removing the channel from the T-Beam makes it a non-member again, without touching the others.
  await save(opened[1], {
    ...opened[1].connection.sync.config!,
    radio: withChannel(opened[1].connection.sync.config!.radio!, SLOTS[1], '', 0),
  });
  assert.ok(!channelList(opened[1].connection.sync.config!.radio!).some(c => c.id === channel));
  const removed = await outcome(
    opened[1],
    opened[1].adapter.sendMessage('Reaper after removal', 'broadcast', channel),
  );
  assert.equal(removed.state, 'rejected');
  const afterRemoval = `Reaper after removal ${crypto.randomUUID()}`;
  await outcome(opened[0], opened[0].adapter.sendMessage(afterRemoval, 'broadcast', channel));
  await sleep(8000);
  assert.ok(!opened[1].connection.inbox.history.some(item => item.text === afterRemoval));
  await direct(opened[0], opened[1], 0, 'Public after removal');
  note({ check: 'removed channel', sends: removed.state, heardBy: 'nobody', others: 'unchanged' });
  await writeFile(
    'build/channel-smoke.json',
    JSON.stringify({ time: new Date().toISOString(), results, relayQualified: false }, null, 2) +
      '\n',
  );
} finally {
  // Only the channel table changed, so put back exactly that.
  for (const [index, board] of opened.entries()) {
    try {
      const config = board.connection.sync.config;
      if (
        config?.radio &&
        originals[index] &&
        board.connection.sync.state === 'ready' &&
        config.radio.channelIds !== originals[index].radio!.channelIds
      )
        await save(board, {
          ...config,
          radio: {
            ...config.radio,
            channels: originals[index].radio!.channels,
            channelIds: originals[index].radio!.channelIds,
          },
        });
    } catch (error) {
      process.exitCode = 1;
      console.error('Verify the original channel table was restored:', error);
    }
  }
  for (const board of opened) await board.adapter.disconnect();
}
