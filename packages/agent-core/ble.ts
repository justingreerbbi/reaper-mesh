import type { SerialPortLike } from './serial.ts';

/** GATT contract in docs/reference/bluetooth.md. */
const uuid = (part: string) => `5d7e00${part}-8b3a-4f6c-9e21-3c1a7f42b9d0`;
export const BLE_SERVICE = uuid('01');
const BLE_INPUT = uuid('02');
const BLE_OUTPUT = uuid('03');
const BLE_PAIRING = uuid('04');
/** The browser does not expose the MTU, but a write of this size works at any MTU (long write). */
const WRITE_BYTES = 200;

/** The parts of Web Bluetooth used here, also implemented by host test devices. */
export interface BleCharacteristic extends EventTarget {
  value?: DataView;
  readValue(): Promise<DataView>;
  writeValueWithResponse(value: Uint8Array): Promise<void>;
  startNotifications(): Promise<unknown>;
}
export interface BleServer {
  connected: boolean;
  connect(): Promise<BleServer>;
  disconnect(): void;
  getPrimaryService(id: string): Promise<{
    getCharacteristic(id: string): Promise<BleCharacteristic>;
  }>;
}
export interface BleDevice extends EventTarget {
  name?: string;
  gatt?: BleServer;
}
export interface BleBluetooth {
  requestDevice(options: {
    filters: { services: string[] }[];
    optionalServices?: string[];
  }): Promise<BleDevice>;
}
export const chooseBleDevice = (bluetooth: BleBluetooth) =>
  bluetooth.requestDevice({ filters: [{ services: [BLE_SERVICE] }] });

/** Connects and reads the protected characteristic, which makes the system pair if needed. */
async function authenticate(device: BleDevice) {
  if (!device.gatt) throw new Error('Bluetooth device has no GATT server');
  const server = await device.gatt.connect();
  const service = await server.getPrimaryService(BLE_SERVICE);
  const pairing = await service.getCharacteristic(BLE_PAIRING);
  const version = (await pairing.readValue()).getUint8(0);
  if (version !== 1) throw new Error(`unsupported Bluetooth link version ${version}`);
  return { server, service };
}
/** Pairs without starting a session, so another link can stay open meanwhile. */
export async function pairBleDevice(device: BleDevice) {
  const { server } = await authenticate(device);
  server.disconnect();
}

/**
 * The Bluetooth link as a serial port. Pairing waits on a person, so it happens in open(), before
 * the adapter starts the session's five-second deadlines.
 */
export class BlePort implements SerialPortLike {
  readable: ReadableStream<Uint8Array> | null = null;
  writable: WritableStream<Uint8Array> | null = null;
  #device: BleDevice;
  #server?: BleServer;
  #output?: BleCharacteristic;
  #controller?: ReadableStreamDefaultController<Uint8Array>;
  #listeners = new Set<() => void>();
  #received = (event: Event) => {
    const value = (event.target as BleCharacteristic).value;
    if (value)
      this.#controller?.enqueue(
        new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)),
      );
  };
  #lost = () => {
    this.#finish();
    for (const listener of this.#listeners) listener();
  };

  constructor(device: BleDevice) {
    this.#device = device;
  }
  async open() {
    this.#device.addEventListener('gattserverdisconnected', this.#lost);
    try {
      const { server, service } = await authenticate(this.#device);
      this.#server = server;
      const input = await service.getCharacteristic(BLE_INPUT);
      this.#output = await service.getCharacteristic(BLE_OUTPUT);
      this.readable = new ReadableStream({
        start: controller => {
          this.#controller = controller;
        },
      });
      this.writable = new WritableStream({
        write: async bytes => {
          for (let start = 0; start < bytes.length; start += WRITE_BYTES)
            await input.writeValueWithResponse(bytes.slice(start, start + WRITE_BYTES));
        },
      });
      this.#output.addEventListener('characteristicvaluechanged', this.#received);
      await this.#output.startNotifications();
    } catch (error) {
      await this.close();
      throw error;
    }
  }
  async close() {
    this.#device.removeEventListener('gattserverdisconnected', this.#lost);
    this.#output?.removeEventListener('characteristicvaluechanged', this.#received);
    this.#finish();
    (this.#server ?? this.#device.gatt)?.disconnect();
  }
  #finish() {
    try {
      this.#controller?.close();
    } catch {}
    this.#controller = undefined;
  }
  addEventListener(type: string, listener: () => void) {
    if (type === 'disconnect') this.#listeners.add(listener);
  }
  removeEventListener(type: string, listener: () => void) {
    if (type === 'disconnect') this.#listeners.delete(listener);
  }
}
