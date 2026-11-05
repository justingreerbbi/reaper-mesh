/**
 * Two-board check of the inbox alert and of payloads firmware does not understand (D50). Needs both
 * boards in Open mode. Changes no settings.
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { openBoard } from './hardware-port.ts';

const [python, heltecPort, tbeamPort] = process.argv.slice(2);
if (!python || !heltecPort || !tbeamPort || heltecPort === tbeamPort)
  throw new Error('usage: node tools/hardware-payload-smoke.ts PYTHON HELTEC_PORT TBEAM_PORT');
type Board = Awaited<ReturnType<typeof openBoard>>;
const boards: Board[] = [];
const report = (check: string, outcome: unknown) => console.log(JSON.stringify({ check, outcome }));
async function waitFor(test: () => boolean, what: string, timeout = 30000) {
  const until = performance.now() + timeout;
  while (!test()) {
    if (performance.now() > until) throw new Error(`timed out waiting for ${what}`);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');
try {
  boards.push(await openBoard(python, heltecPort));
  boards.push(await openBoard(python, tbeamPort));
  for (const board of boards) {
    await waitFor(() => board.connection.radioInfo?.reason === 'ready', 'radio ready', 10000);
    assert.ok(board.connection.capabilities!.features & 32768, 'firmware has no inbox alert');
    await waitFor(() => board.connection.inbox.history !== undefined, 'inbox');
  }
  for (const [from, to] of [
    [boards[0], boards[1]],
    [boards[1], boards[0]],
  ]) {
    // Text: the alert arrives, and the agent's read is started by it.
    const alerts = to.connection.inboxAlerts;
    const text = `alert ${crypto.randomUUID()}`;
    const sent = from.adapter.sendMessage(text, to.connection.device!, 0);
    await waitFor(() => to.connection.inboxAlerts > alerts, 'inbox alert');
    await waitFor(
      () => to.connection.inbox.history.some(item => item.text === text),
      'text in inbox',
    );
    await waitFor(
      () => from.connection.messaging.history.find(i => i.id === sent)?.state === 'acknowledged',
      'text acknowledged',
    );
    report('inbox alert', { to: to.connection.device, alerts: to.connection.inboxAlerts - alerts });

    // Bytes that are neither text nor a known envelope, longer than one frame.
    const payload = Uint8Array.from([0xff, 0x00, ...randomBytes(250)]);
    const id = from.adapter.sendMessagePayload(payload, to.connection.device!, 0);
    await waitFor(
      () => to.connection.inbox.history.some(item => item.payloadHex === hex(payload)),
      'payload in inbox',
    );
    await waitFor(
      () => from.connection.messaging.history.find(i => i.id === id)?.state === 'acknowledged',
      'payload acknowledged',
    );
    assert.equal(to.connection.inbox.error, undefined);
    report('opaque payload', { to: to.connection.device, bytes: payload.length, exact: true });

    // Reading carries on past it.
    const after = `after ${crypto.randomUUID()}`;
    from.adapter.sendMessage(after, to.connection.device!, 0);
    await waitFor(
      () => to.connection.inbox.history.some(item => item.text === after),
      'text after a payload',
    );
    report('inbox keeps reading', { to: to.connection.device, outcome: true });
  }
} finally {
  for (const board of boards) await board.adapter.disconnect();
}
