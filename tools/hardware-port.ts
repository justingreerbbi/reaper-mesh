/** Real serial bytes for explicitly invoked physical checks; never auto-replays work. */
import { spawn } from 'node:child_process';
import { Connection } from '../packages/client-core/connection.ts';
import { SerialAdapter, type SerialPortLike } from '../packages/client-core/serial.ts';
export async function openBoard(python: string, port: string) {
  const child = spawn(python, ['-u', '-c', `
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
`, port], { stdio: ['pipe', 'pipe', 'pipe'] });
  let error = ''; child.stderr.on('data', bytes => { error = (error + bytes.toString()).slice(-2048); });
  const start = performance.now(), now = () => Math.floor(performance.now() - start);
  const connection = new Connection();
  let receive: ((bytes: Buffer) => void) | undefined;
  const serial: SerialPortLike = {
    readable: new ReadableStream<Uint8Array>({ start(controller) {
      receive = bytes => controller.enqueue(bytes); child.stdout.on('data', receive);
      child.on('error', error => controller.error(error));
      child.on('exit', () => { try { controller.close(); } catch {} });
    }, cancel() { if (receive) child.stdout.off('data', receive); } }),
    writable: new WritableStream<Uint8Array>({ write(bytes) { return new Promise<void>((resolve, reject) => child.stdin.write(bytes, error => error ? reject(error) : resolve())); } }),
    async open() {}, async close() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const exited = new Promise<void>(resolve => child.once('exit', () => resolve())); child.kill(); await exited;
    },
  };
  const adapter = new SerialAdapter(connection, { now });
  try {
    await adapter.connect(serial, crypto.randomUUID());
    const until = now() + 8000;
    while (connection.sync.state !== 'ready') {
      if (now() > until || ['disconnected', 'incompatible'].includes(connection.sync.state)) throw new Error(error || connection.error || `Cannot synchronize ${port}`);
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  } catch (error) { await adapter.disconnect(); throw error; }
  return { adapter, connection };
}
