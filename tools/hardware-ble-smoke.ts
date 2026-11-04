/**
 * Bluetooth check with the real agent code (D47). The owner opens pairing on board A with a
 * 5-second button hold and enters the passkey in the prompt on this computer. Then: session over
 * Bluetooth, short and full-size messages both ways with board B on USB, reconnect without
 * pairing, a USB takeover that resets the board, and the pairing surviving that reset. Requires
 * confirmed US antennas on both boards. Pass the Python that has bleak as BLE_PYTHON.
 */
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { openBleBoard, openBoard } from './hardware-port.ts';

const [python, blePython, boardAPort, boardBPort, pairingSeconds = '150'] = process.argv.slice(2);
if (!python || !blePython || !boardAPort || !boardBPort || boardAPort === boardBPort)
  throw new Error(
    'usage: node tools/hardware-ble-smoke.ts PYTHON BLE_PYTHON BOARD_A_PORT BOARD_B_PORT [PAIRING_SECONDS]',
  );
type Board = Awaited<ReturnType<typeof openBoard>>;
const results: Record<string, unknown>[] = [];
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
function note(result: Record<string, unknown>) {
  results.push(result);
  console.log(JSON.stringify(result));
}
async function waitFor(test: () => boolean, what: string, timeout = 65000) {
  const until = performance.now() + timeout;
  while (!test()) {
    if (performance.now() > until) throw new Error(`${what} timed out`);
    await sleep(25);
  }
}
async function direct(sender: Board, receiver: Board, text: string, label: string) {
  const started = performance.now();
  const id = sender.adapter.sendMessage(text, receiver.connection.device!, 0);
  const sent = () => sender.connection.messaging.history.find(item => item.id === id);
  await waitFor(
    () => ['acknowledged', 'failed', 'rejected', 'unknown'].includes(sent()?.state ?? ''),
    `${label} send`,
  );
  assert.equal(sent()!.state, 'acknowledged', `${label}: ${sent()!.reason}`);
  const key = sent()!.messageId;
  await waitFor(
    () => receiver.connection.inbox.history.some(item => item.messageId === key),
    `${label} inbox`,
  );
  const item = receiver.connection.inbox.history.find(message => message.messageId === key)!;
  assert.equal(item.text, text);
  note({ check: label, bytes: text.length, seconds: (performance.now() - started) / 1000 });
}
const words = (size: number) => `Reaper ${crypto.randomUUID()} `.padEnd(size, 'x');

let usb: Board | undefined = await openBoard(python, boardBPort);
let ble: Board | undefined;
try {
  console.log('Hold the main button on board A for 5 seconds, then enter the passkey here.');
  ble = await openBleBoard(blePython, Number(pairingSeconds));
  const device = ble.connection.device!;
  assert.match(ble.connection.capabilities?.firmware ?? '', /-reaper-mesh-v0\.6\./);
  assert.equal(ble.connection.sync.state, 'ready');
  note({ check: 'paired and synchronized over Bluetooth', device });

  await direct(ble, usb, words(40), 'Bluetooth to USB, short');
  await direct(usb, ble, words(40), 'USB to Bluetooth, short');
  await direct(ble, usb, words(1024), 'Bluetooth to USB, 1024 bytes');
  await direct(usb, ble, words(1024), 'USB to Bluetooth, 1024 bytes');
  note({
    check: 'memory while connected',
    heap: ble.connection.radioInfo?.heapFree,
    stack: ble.connection.radioInfo?.stackFree,
  });

  await ble.adapter.disconnect();
  ble = undefined;
  await sleep(2000);
  ble = await openBleBoard(blePython, 30);
  assert.equal(ble.connection.device, device);
  await direct(ble, usb, words(40), 'after reconnect without pairing');

  // Opening the USB port resets the board, which ends the Bluetooth link; the newest host wins.
  const bleConnection = ble.connection;
  const usbA = await openBoard(python, boardAPort);
  await waitFor(() => bleConnection.sync.state === 'disconnected', 'Bluetooth loss', 15000);
  assert.equal(usbA.connection.device, device);
  note({ check: 'USB took over after reset', device });
  await ble.adapter.disconnect();
  ble = undefined;
  await usbA.adapter.disconnect();
  await sleep(3000);

  ble = await openBleBoard(blePython, 30);
  assert.equal(ble.connection.device, device);
  await direct(ble, usb, words(40), 'pairing survived the reset');
  await writeFile(
    'build/ble-smoke.json',
    JSON.stringify({ time: new Date().toISOString(), results, relayQualified: false }, null, 2) +
      '\n',
  );
} finally {
  await ble?.adapter.disconnect();
  await usb?.adapter.disconnect();
  usb = undefined;
}
