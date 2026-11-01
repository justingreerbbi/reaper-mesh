/** Explicit physical check of the real TS Connection/SerialAdapter over a Python serial byte bridge. */
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { Connection } from '../packages/client-core/connection.ts';
import { SerialAdapter, type SerialPortLike } from '../packages/client-core/serial.ts';
const [python, port, expectedFirmware, messageTest] = process.argv.slice(2);
if (!python || !port) throw new Error('usage: node tools/hardware-client-smoke.ts PYTHON SERIAL_PORT [EXPECTED_FIRMWARE] [--message-test]');
const bridge = `
import serial,sys,threading
s=serial.Serial(port=None,baudrate=115200,timeout=.05,exclusive=True)
s.dtr=False;s.rts=False;s.port=sys.argv[1];s.open()
def write():
 while True:
  data=sys.stdin.buffer.read(1)
  if not data:return
  s.write(data)
threading.Thread(target=write,daemon=True).start()
try:
 while True:
  data=s.read(256)
  if data:sys.stdout.buffer.write(data);sys.stdout.buffer.flush()
finally:s.close()
`;
for (let run = 0; run < 3; run++) {
  const child = spawn(python, ['-u', '-c', bridge, port], { stdio: ['pipe', 'pipe', 'pipe'] });
  const client = new Connection(crypto.randomUUID());
  const start = performance.now();
  const now = () => Math.floor(performance.now() - start);
  let error = '';
  let bytesSent = 0;
  child.stderr.on('data', bytes => { error += bytes.toString(); });
  let receive: ((bytes: Buffer) => void) | undefined;
  const serialPort: SerialPortLike = {
    readable: new ReadableStream<Uint8Array>({
      start(controller) {
        receive = bytes => controller.enqueue(bytes);
        child.stdout.on('data', receive);
      },
      cancel() { if (receive) child.stdout.off('data', receive); },
    }),
    writable: new WritableStream<Uint8Array>({
      write(bytes) {
        bytesSent += bytes.length;
        return new Promise<void>((resolve, reject) => child.stdin.write(bytes, error => error ? reject(error) : resolve()));
      },
    }),
    async open() {},
    async close() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const exited = new Promise<void>(resolve => child.once('exit', () => resolve()));
      child.kill(); await exited;
    },
  };
  const adapter = new SerialAdapter(client, { now });
  try {
    await adapter.connect(serialPort, crypto.randomUUID());
    await new Promise<void>((resolve, reject) => {
      const timer = setInterval(() => {
        try {
          if (client.sync.state === 'ready') { clearInterval(timer); resolve(); }
          else if (client.sync.state === 'disconnected' || now() > 7000) {
            clearInterval(timer); reject(new Error(client.error || error || 'hardware timeout'));
          }
        } catch (error) { clearInterval(timer); reject(error); }
      }, 25);
      child.once('error', error => { clearInterval(timer); reject(error); });
      child.once('exit', () => { clearInterval(timer); reject(new Error(error || 'serial bridge exited')); });
    });
    assert.equal(client.capabilities?.radioVersion, 0);
    if (expectedFirmware) assert.equal(client.capabilities?.firmware, expectedFirmware);
    if (run === 0 && messageTest === '--message-test') {
      const id = adapter.sendMessage('Reaper USB message test ' + 'x'.repeat(1001));
      const waitFor = async (state: string, timeout: number) => {
        const end = now() + timeout;
        while (client.messaging.history.find(entry => entry.id === id)?.state !== state) {
          if (now() > end || client.sync.state !== 'ready') throw new Error(`message did not reach ${state}`);
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      };
      await waitFor('queued', 10000);
      console.log('Physical 1024-byte message accepted as queued; RF remains off');
      await waitFor('failed', 65000);
      assert.equal(client.messaging.history.find(entry => entry.id === id)?.reason, 'expired');
      console.log('Physical queue expiry reported failed; no transmission or delivery claimed');
    }
    console.log(`Physical TS client/adapter run ${run + 1}: ready after ${now()} ms; sent ${bytesSent} bytes; revision ${client.sync.revision}`);
  } finally {
    await adapter.disconnect();
  }
}
