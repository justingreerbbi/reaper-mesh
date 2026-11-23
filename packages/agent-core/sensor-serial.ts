/**
 * Connects a SensorLink to a Web Serial port (or the desktop app's serial bridge, or a simulated
 * port). One read loop and one serialized writer per connection; nothing is replayed after a
 * disconnect. Opening the XIAO's port restarts it, which the link's hello retries cover.
 */
import type { SerialPortLike } from './serial.ts';
import { SensorLink } from './sensor.ts';

type Options = {
  now?: () => number;
  schedule?: (tick: () => void) => () => void;
  newLink?: () => string;
};

export const SENSOR_BAUD_RATE = 115_200;

export class SensorSerial {
  readonly link: SensorLink;
  #now: () => number;
  #schedule: (tick: () => void) => () => void;
  #newLink: () => string;
  #port: SerialPortLike | undefined;
  #reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  #writer: WritableStreamDefaultWriter<Uint8Array> | undefined;
  #stopTimer: (() => void) | undefined;
  #writing = false;
  #closing: Promise<void> | undefined;
  /** Called once when the port goes away without disconnect() being asked for. */
  onLost: () => void = () => {};

  constructor(link = new SensorLink(), options: Options = {}) {
    this.link = link;
    this.#now = options.now ?? (() => Math.floor(performance.now()));
    this.#schedule =
      options.schedule ??
      (tick => {
        const timer = setInterval(tick, 100);
        return () => clearInterval(timer);
      });
    this.#newLink = options.newLink ?? (() => crypto.randomUUID());
  }

  get port() {
    return this.#port;
  }

  async connect(port: SerialPortLike) {
    if (this.#port) throw new Error('The signals add-on is already connected');
    await port.open({ baudRate: SENSOR_BAUD_RATE, bufferSize: 8192, flowControl: 'none' });
    if (!port.readable || !port.writable) {
      await port.close().catch(() => {});
      throw new Error('The port opened without streams');
    }
    this.#port = port;
    this.#writer = port.writable.getWriter();
    this.link.open(this.#newLink(), this.#now());
    this.#stopTimer = this.#schedule(() => {
      this.link.tick(this.#now());
      void this.#flush();
    });
    void this.#read(port, port.readable.getReader());
    await this.#flush();
  }

  async disconnect() {
    if (this.#closing) return this.#closing;
    if (!this.#port) return;
    this.#closing = this.#cleanup().finally(() => {
      this.#closing = undefined;
    });
    return this.#closing;
  }

  async #cleanup() {
    const port = this.#port!;
    this.#stopTimer?.();
    this.#stopTimer = undefined;
    this.link.close();
    try {
      await this.#reader?.cancel();
    } catch {
      // Already closed.
    }
    try {
      await this.#writer?.close();
    } catch {
      this.#writer?.releaseLock();
    }
    this.#reader = this.#writer = undefined;
    this.#port = undefined;
    await port.close().catch(() => {});
  }

  async #read(port: SerialPortLike, reader: ReadableStreamDefaultReader<Uint8Array>) {
    this.#reader = reader;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value?.length) this.link.feed(value, this.#now());
        void this.#flush();
      }
    } catch {
      // Unplugged or closed; handled below.
    } finally {
      try {
        reader.releaseLock();
      } catch {
        // Released by cancel().
      }
      if (this.#port === port && !this.#closing) {
        await this.disconnect();
        this.onLost();
      }
    }
  }

  async #flush() {
    if (this.#writing || !this.#writer) return;
    this.#writing = true;
    try {
      for (let frames = this.link.drain(); frames.length; frames = this.link.drain())
        for (const frame of frames) await this.#writer.write(frame);
    } catch {
      // The read loop notices a dead port and cleans up.
    } finally {
      this.#writing = false;
    }
  }
}
