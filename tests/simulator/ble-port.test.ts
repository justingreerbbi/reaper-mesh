import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BLE_SERVICE,
  BlePort,
  pairBleDevice,
  type BleCharacteristic,
  type BleDevice,
  type BleServer,
} from '../../packages/agent-core/ble.ts';
import { Connection } from '../../packages/agent-core/connection.ts';
import { SerialAdapter } from '../../packages/agent-core/serial.ts';
import { SimulatedDevice } from '../../packages/simulator/serial-device.ts';

const id = (part: string) => `5d7e00${part}-8b3a-4f6c-9e21-3c1a7f42b9d0`;
class FakeCharacteristic extends EventTarget implements BleCharacteristic {
  value?: DataView;
  writes: Uint8Array[] = [];
  log: string[];
  name: string;
  readBytes = Uint8Array.of(1);
  failRead?: Error;
  onWrite?: (bytes: Uint8Array) => void;
  constructor(name: string, log: string[]) {
    super();
    this.name = name;
    this.log = log;
  }
  async readValue() {
    this.log.push(`read ${this.name}`);
    if (this.failRead) throw this.failRead;
    return new DataView(this.readBytes.buffer);
  }
  async writeValueWithResponse(bytes: Uint8Array) {
    this.log.push(`write ${this.name}`);
    this.writes.push(bytes);
    this.onWrite?.(bytes);
  }
  async startNotifications() {
    this.log.push(`notify ${this.name}`);
  }
  notify(bytes: Uint8Array) {
    this.value = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.dispatchEvent(new Event('characteristicvaluechanged'));
  }
}
class FakeDevice extends EventTarget implements BleDevice {
  log: string[] = [];
  input = new FakeCharacteristic('input', this.log);
  output = new FakeCharacteristic('output', this.log);
  pairing = new FakeCharacteristic('pairing', this.log);
  disconnects = 0;
  gatt: BleServer = {
    connected: false,
    connect: async () => {
      this.log.push('connect');
      return this.gatt;
    },
    disconnect: () => {
      this.disconnects++;
    },
    getPrimaryService: async service => {
      assert.equal(service, BLE_SERVICE);
      return {
        getCharacteristic: async characteristic => {
          const found = {
            [id('02')]: this.input,
            [id('03')]: this.output,
            [id('04')]: this.pairing,
          }[characteristic];
          assert.ok(found);
          return found;
        },
      };
    },
  };
}

test('Bluetooth port pairs before it subscribes or carries any protocol bytes', async () => {
  const device = new FakeDevice();
  const port = new BlePort(device);
  await port.open();
  assert.deepEqual(device.log, ['connect', 'read pairing', 'notify output']);
  await port.close();
  assert.equal(device.disconnects, 1);
});

test('Bluetooth port fails closed when pairing fails or the link version is unknown', async () => {
  const refused = new FakeDevice();
  refused.pairing.failRead = new Error('Authentication failed');
  await assert.rejects(new BlePort(refused).open(), /Authentication failed/);
  assert.ok(!refused.log.some(entry => entry.startsWith('notify')));
  assert.equal(refused.disconnects, 1);

  const newer = new FakeDevice();
  newer.pairing.readBytes = Uint8Array.of(2);
  await assert.rejects(new BlePort(newer).open(), /link version 2/);
  assert.ok(!newer.log.some(entry => entry.startsWith('notify')));
});

test('Bluetooth port splits writes, relays notifications and ends on disconnect', async () => {
  const device = new FakeDevice();
  const port = new BlePort(device);
  await port.open();
  let lost = 0;
  port.addEventListener('disconnect', () => lost++);
  const writer = port.writable!.getWriter();
  const bytes = Uint8Array.from({ length: 450 }, (_, index) => index % 251);
  await writer.write(bytes);
  assert.deepEqual(
    device.input.writes.map(chunk => chunk.length),
    [200, 200, 50],
  );
  assert.deepEqual(Uint8Array.from(device.input.writes.flatMap(chunk => [...chunk])), bytes);
  const reader = port.readable!.getReader();
  device.output.notify(Uint8Array.of(1, 2, 3));
  assert.deepEqual((await reader.read()).value, Uint8Array.of(1, 2, 3));
  device.dispatchEvent(new Event('gattserverdisconnected'));
  assert.equal((await reader.read()).done, true);
  assert.equal(lost, 1);
});

test('pairing this browser reads the protected value and leaves no connection open', async () => {
  const device = new FakeDevice();
  await pairBleDevice(device);
  assert.deepEqual(device.log, ['connect', 'read pairing']);
  assert.equal(device.disconnects, 1);
});

test('the normal agent session runs over the Bluetooth port', async () => {
  const device = new FakeDevice();
  const simulated = new SimulatedDevice().createPort();
  await simulated.open({ baudRate: 115200, bufferSize: 4096, flowControl: 'none' });
  const writer = simulated.writable!.getWriter();
  device.input.onWrite = bytes => void writer.write(bytes);
  void (async () => {
    const reader = simulated.readable!.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      device.output.notify(value);
    }
  })();
  const connection = new Connection();
  const adapter = new SerialAdapter(connection);
  await adapter.connect(new BlePort(device), crypto.randomUUID());
  const until = performance.now() + 3000;
  while (connection.sync.state !== 'ready' && performance.now() < until)
    await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(connection.sync.state, 'ready');
  assert.equal(connection.device, 'demo-heltec-v3');
  await adapter.disconnect();
  await simulated.close();
});

test('pairing is opened and watched only through the device, and reports state', async () => {
  const simulator = new SimulatedDevice();
  const connection = new Connection();
  const adapter = new SerialAdapter(connection);
  await adapter.connect(simulator.createPort(), crypto.randomUUID());
  const until = performance.now() + 3000;
  while (connection.sync.state !== 'ready' && performance.now() < until)
    await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(connection.supportsPairing, true);
  const pairing = () => connection.pairing;
  assert.equal(pairing(), undefined);
  adapter.openPairing();
  const opened = performance.now() + 3000;
  while (pairing()?.state !== 'open' && performance.now() < opened)
    await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(pairing()?.state, 'open');
  assert.equal(pairing()?.name, 'Reaper-SIM0');
  assert.equal(pairing()?.passkey, undefined);
  await adapter.disconnect();
  assert.equal(pairing(), undefined);
});
