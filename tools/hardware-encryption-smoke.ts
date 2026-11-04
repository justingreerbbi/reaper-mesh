/** Two-board opaque-ciphertext, shared-key, direct-ACK check; restores radio policy. */
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { EncryptionVault } from '../agents/web/encryption.ts';
import { openBoard } from './hardware-port.ts';
import type { Config } from '../packages/agent-core/sync.ts';

const [python, heltecPort, tbeamPort] = process.argv.slice(2);
if (!python || !heltecPort || !tbeamPort || heltecPort === tbeamPort)
  throw new Error('usage: node tools/hardware-encryption-smoke.ts PYTHON HELTEC_PORT TBEAM_PORT');
class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}
const bytesHex = (bytes: Uint8Array) =>
  Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
const opened: Awaited<ReturnType<typeof openBoard>>[] = [];
const originals: Config[] = [];
const changed: number[] = [];
const results: { source: string; destination: string; transport: string; decryption: string }[] =
  [];
async function waitFor(test: () => boolean, timeout = 65000) {
  const until = performance.now() + timeout;
  while (!test()) {
    if (
      performance.now() > until ||
      opened.some(board => board.connection.sync.state === 'disconnected')
    ) {
      throw new Error(
        'encrypted two-board test timed out/disconnected: ' +
          opened
            .map(board => board.connection.error ?? board.connection.radioInfo?.reason)
            .join(', '),
      );
    }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}
async function save(index: number, config: Config) {
  const board = opened[index];
  const id = board.adapter.configure(config);
  await waitFor(() => board.connection.commands.status(id).outcome !== 'pending', 10000);
  assert.equal(board.connection.commands.status(id).outcome, 'committed');
  await waitFor(() => board.connection.sync.state === 'ready', 10000);
}
function agent() {
  return new EncryptionVault(new MemoryStorage());
}
try {
  opened.push(await openBoard(python, heltecPort));
  opened.push(await openBoard(python, tbeamPort));
  assert.match(opened[0].connection.device!, /^heltec-/);
  assert.match(opened[1].connection.capabilities?.firmware ?? '', /^tbeam-reaper-mesh-v/);
  for (const [index, board] of opened.entries()) {
    const config = board.connection.sync.config!;
    originals[index] = config;
    assert.equal(config.region, 'US');
    assert.ok(config.radio);
    if (config.radio.mode !== 'mesh' || config.radio.level !== 'low') {
      changed.push(index);
      await save(index, { ...config, radio: { ...config.radio, mode: 'mesh', level: 'low' } });
    }
    await waitFor(() => board.connection.radioInfo?.reason === 'ready', 10000);
    assert.equal(board.connection.radioInfo?.probe, 1);
  }

  const heltec = agent(),
    tbeam = agent();
  heltec.unlock('heltec vault smoke passphrase', 'heltec vault smoke passphrase');
  const created = heltec.generate(0);
  tbeam.unlock('tbeam vault smoke passphrase', 'tbeam vault smoke passphrase');
  const bundle = heltec.exportBundle(0);
  tbeam.importBundle(bundle, 0);
  assert.equal(created.epoch, 1);
  assert.ok(!JSON.stringify(opened[0].connection.exportJournal()).includes(bundle));

  for (const sourceIndex of [0, 1]) {
    const sender = opened[sourceIndex],
      receiver = opened[1 - sourceIndex];
    const senderVault = sourceIndex === 0 ? heltec : tbeam;
    const receiverVault = sourceIndex === 0 ? tbeam : heltec;
    const recipient = receiver.connection.device!;
    const plaintext = `RME hardware ciphertext ${sourceIndex} ${crypto.randomUUID()}`;
    const envelope = senderVault.encrypt(plaintext, 0, sender.connection.device!, recipient);
    assert.ok(!new TextDecoder().decode(envelope).includes(plaintext));
    const uploadId = sender.adapter.sendMessagePayload(envelope, recipient, 0);
    assert.equal(
      sender.connection.messaging.history.find(entry => entry.id === uploadId)?.text,
      '',
    );
    assert.equal(
      sender.connection.messaging.history.find(entry => entry.id === uploadId)?.payloadHex,
      bytesHex(envelope),
    );
    await waitFor(() =>
      ['acknowledged', 'failed', 'rejected', 'unknown'].includes(
        sender.connection.messaging.history.find(entry => entry.id === uploadId)?.state ?? '',
      ),
    );
    const status = sender.connection.messaging.history.find(entry => entry.id === uploadId)!;
    assert.equal(status.state, 'acknowledged', status.reason);
    assert.ok(status.messageId);
    await waitFor(() =>
      receiver.connection.inbox.history.some(entry => entry.messageId === status.messageId),
    );
    const received = receiver.connection.inbox.history.find(
      entry => entry.messageId === status.messageId,
    )!;
    assert.equal(received.text, '');
    assert.equal(received.payloadHex, bytesHex(envelope));
    const openedMessage = receiverVault.decrypt(
      envelope,
      0,
      received.origin,
      received.destination ?? 'broadcast',
      `${received.device}:${received.origin}:${received.messageId}`,
    );
    assert.deepEqual(openedMessage, { state: 'decrypted', text: plaintext });
    const unrelatedAgent = agent();
    unrelatedAgent.unlock('unrelated vault passphrase', 'unrelated vault passphrase');
    unrelatedAgent.generate(0);
    assert.equal(
      unrelatedAgent.decrypt(envelope, 0, received.origin, received.destination ?? 'broadcast')
        .state,
      'key-needed',
    );
    results.push({
      source: sender.connection.device!,
      destination: recipient,
      transport: 'ciphertext delivered; one device ACK',
      decryption: 'matching key decrypted; unrelated key rejected',
    });
    console.log('Encrypted direct-message hardware check passed:', results.at(-1));
  }
  await writeFile(
    'build/tbeam-v12/encryption-smoke.json',
    JSON.stringify(
      { time: new Date().toISOString(), results, keysInFirmware: false, relayQualified: false },
      null,
      2,
    ) + '\n',
  );
} finally {
  for (const index of changed.reverse()) {
    try {
      if (opened[index].connection.sync.state === 'ready') await save(index, originals[index]);
    } catch (error) {
      process.exitCode = 1;
      console.error('Verify original radio policy restoration:', error);
    }
  }
  for (const board of opened) await board.adapter.disconnect();
}
