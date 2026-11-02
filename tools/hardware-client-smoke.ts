/** Explicit physical check of the real TS Connection/SerialAdapter over a Python serial byte bridge. */
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { FrameDecoder } from '../packages/protocol/framing.ts';
import { decodeMessage } from '../packages/protocol/messages.ts';
import { Connection } from '../packages/client-core/connection.ts';
import { SerialAdapter, type SerialPortLike } from '../packages/client-core/serial.ts';
const [python, port, expectedFirmware, messageTest] = process.argv.slice(2);
if (!python || !port) throw new Error('usage: node tools/hardware-client-smoke.ts PYTHON SERIAL_PORT [EXPECTED_FIRMWARE] [--message-test|--radio-test|--local-test|--tbeam-test|--rf-test]');
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
  if (process.env.REAPER_TRACE === '1') {
    const trace = new FrameDecoder();
    child.stdout.on('data', bytes => trace.feed(bytes, payload => {
      const message = decodeMessage(payload);
      if (message.type === 'messageStatus') console.log('Device message state:', message.state, message.reason, message.received);
      if (message.type === 'snapshot') console.log('Device snapshot:', message.revision, message.txPower, message.channels);
    }));
  }
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
    assert.ok([0, 1].includes(client.capabilities?.radioVersion ?? -1));
    if (expectedFirmware) assert.equal(client.capabilities?.firmware, expectedFirmware);
    const readyAt = now();
    if (messageTest === '--local-test' || messageTest === '--tbeam-test') {
      const waitFor = async (test: () => boolean) => {
        const until = now() + 10000;
        while (!test()) {
          if (now() >= until || ['disconnected', 'incompatible'].includes(client.sync.state)) throw new Error('local hardware test timed out: ' + (client.radioError ?? client.inbox.error ?? client.error ?? ''));
          await new Promise(resolve => setTimeout(resolve, 25));
        }
      };
      if (run === 0 && messageTest === '--tbeam-test' && client.sync.config?.region === 'UNSET') {
        assert.equal(client.capabilities?.firmware, 'tbeam-usb-prototype-1');
        const first = adapter.configure({ region: 'US', label: 'Reaper T-Beam V1.2',
          radio: { ...client.sync.config.radio!, mode: 'off', power: 2 } });
        await waitFor(() => client.commands.status(first).outcome === 'committed' && client.sync.state === 'ready');
      }
      await waitFor(() => !!client.radioInfo);
      console.log('Physical radio diagnostic:', client.radioInfo?.state, client.radioInfo?.reason, 'probe', client.radioInfo?.probe,
        'heap', client.radioInfo?.heapFree, 'stack', client.radioInfo?.stackFree);
      assert.equal(client.radioInfo?.probe, 1, 'SX1262 SPI/configuration probe failed');
      assert.ok((client.radioInfo?.stackFree ?? 0) > 2048, 'main task stack headroom too low');
      assert.equal(client.radioInfo?.transmitted, 0);
      const body = `Local USB message ${run + 1}: ` .padEnd(1024, 'x');
      const id = adapter.sendMessage(body, client.device!, 0);
      await waitFor(() => client.messaging.history.find(entry => entry.id === id)?.state === 'acknowledged');
      assert.equal(client.messaging.history.find(entry => entry.id === id)?.reason, 'local-delivery');
      await waitFor(() => client.inbox.history.some(entry => entry.messageId === client.messaging.history.find(item => item.id === id)?.messageId));
      assert.equal(client.inbox.history.find(entry => entry.messageId === client.messaging.history.find(item => item.id === id)?.messageId)?.text, body);
      assert.equal(client.radioInfo?.transmitted, 0);
      if (run === 0) {
        const original = client.sync.config!; assert.ok(original.radio);
        const update = adapter.configure({ ...original, radio: { ...original.radio, mode: 'receive' } });
        await waitFor(() => client.commands.status(update).outcome === 'committed' && client.sync.state === 'ready');
        await waitFor(() => client.radioInfo?.state === 'receiving'); assert.equal(client.radioInfo?.transmitted, 0);
        const restore = adapter.configure(original);
        await waitFor(() => client.commands.status(restore).outcome === 'committed' && client.sync.state === 'ready');
        await waitFor(() => client.radioInfo?.state === 'off');
        console.log('Physical receive-only initialization and restored off mode passed without TX');
      }
      console.log('Physical 1024-byte local delivery and inbox retrieval passed without RF');
    }
    if (run === 0 && messageTest === '--rf-test') {
      const original = client.sync.config!; assert.equal(original.region, 'US'); assert.ok(original.radio);
      assert.equal(original.radio.mode, 'off', 'RF qualification starts from off mode');
      const waitFor = async (condition: () => boolean, timeout = 12000) => {
        const until = now() + timeout;
        while (!condition()) {
          if (now() >= until || ['disconnected', 'incompatible'].includes(client.sync.state)) throw new Error('RF hardware timeout: ' + (client.radioInfo?.reason ?? client.error ?? '') + ' / ' + client.messaging.history.map(item => item.state + ':' + item.reason).join(','));
          await new Promise(resolve => setTimeout(resolve, 25));
        }
      };
      const save = async (config: typeof original) => {
        const id = adapter.configure(config);
        await waitFor(() => client.commands.status(id).outcome !== 'pending');
        assert.equal(client.commands.status(id).outcome, 'committed'); await waitFor(() => client.sync.state === 'ready');
      };
      try {
        await save({ ...original, radio: { ...original.radio, mode: 'mesh', power: 2, relay: false } });
        await waitFor(() => client.radioInfo?.reason === 'ready');
        const before = client.radioInfo!.transmitted;
        const broadcast = adapter.sendMessage('Reaper US single-board RF test '.padEnd(1024, 'x'), 'broadcast', 0);
        await waitFor(() => client.messaging.history.find(item => item.id === broadcast)?.state === 'transmitted');
        await waitFor(() => (client.radioInfo?.transmitted ?? 0) >= before + 7);
        assert.equal(client.messaging.history.find(item => item.id === broadcast)?.state, 'transmitted');
        console.log('Physical RF: seven 1024-byte-message fragments reached TX_DONE; broadcast has no recipient ACK');
        const unreachable = adapter.sendMessage('No destination ACK should be fabricated', 'node-0000000000000001', 0);
        await waitFor(() => client.messaging.history.find(item => item.id === unreachable)?.state === 'transmitted');
        await waitFor(() => client.messaging.history.find(item => item.id === unreachable)?.state === 'failed', 65000);
        assert.ok(['expired', 'delivery-unconfirmed'].includes(client.messaging.history.find(item => item.id === unreachable)?.reason ?? ''));
        assert.ok((client.radioInfo?.transmitted ?? 0) >= before + 10);
        console.log('Physical RF: unreachable unicast retried and failed without a recipient ACK; TX', client.radioInfo?.transmitted);
      } finally {
        if (client.sync.state === 'ready') {
          await save(original); await waitFor(() => client.radioInfo?.state === 'off');
          console.log('Physical RF qualification restored original off-mode policy');
        } else console.error('Connection lost: verify and restore off mode before further RF tests.');
      }
    }
    if (run === 0 && messageTest === '--radio-test') {
      assert.equal(client.capabilities?.radioVersion, 0, 'queue policy preview requires RF-disabled firmware v3');
      const original = client.sync.config!; assert.ok(original.radio);
      const waitFor = async (condition: () => boolean) => {
        const until = now() + 10000;
        while (!condition()) {
          if (now() >= until || ['disconnected', 'incompatible'].includes(client.sync.state)) throw new Error('radio settings test timed out or disconnected: ' + client.sync.state + ' / ' + (client.error ?? '') + ' / ' + client.messaging.history.map(entry => entry.state + ':' + entry.reason).join(','));
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      };
      const save = async (config: typeof original) => {
        const id = adapter.configure(config);
        await waitFor(() => client.commands.status(id).outcome !== 'pending');
        assert.equal(client.commands.status(id).outcome, 'committed');
        await waitFor(() => client.sync.state === 'ready');
      };
      await save({ ...original, radio: { ...original.radio, mode: 'off', power: 1, relay: true, channels: 'Public|Camp||||||' } });
      assert.equal(client.sync.config?.radio?.power, 1);
      const message = adapter.sendMessage('Named channel queue policy test', 'broadcast', 1);
      await waitFor(() => client.messaging.history.find(entry => entry.id === message)?.state === 'queued');
      await save({ ...client.sync.config!, radio: { ...client.sync.config!.radio!, power: 2 } });
      await waitFor(() => client.messaging.history.find(entry => entry.id === message)?.state === 'failed');
      assert.equal(client.messaging.history.find(entry => entry.id === message)?.reason, 'radio-config-changed');
      await save(original);
      console.log('Physical named-channel queue and radio-policy quiesce passed; original radio settings restored');
    }
    if (run === 0 && messageTest === '--message-test') {
      assert.equal(client.capabilities?.radioVersion, 0, 'expiry preview requires RF-disabled firmware v2');
      const id = adapter.sendMessage('Reaper USB message test '.padEnd(1024, 'x'));
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
    console.log(`Physical TS client/adapter run ${run + 1}: ready after ${readyAt} ms; sent ${bytesSent} bytes; revision ${client.sync.revision}`);
  } finally {
    await adapter.disconnect();
  }
}
