import { Connection } from './connection.ts';
import type { Config } from './sync.ts';

/** Structural Web Serial interface, also implemented by host test ports. */
export interface SerialPortLike {
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
  open(options: { baudRate: number; bufferSize: number; flowControl: 'none' }): Promise<void>;
  close(): Promise<void>;
  addEventListener?(type: string, listener: () => void): void;
  removeEventListener?(type: string, listener: () => void): void;
}
type Run = {
  port: SerialPortLike; session: number; stopped: boolean; opened: boolean;
  opening: Promise<void>; reading: Promise<void>; writing: Promise<void>;
  reader?: ReadableStreamDefaultReader<Uint8Array>;
  writer?: WritableStreamDefaultWriter<Uint8Array>;
  busy: boolean; stopTimer?: () => void; cleanup?: Promise<void>; removed: () => void;
};
type Options = {
  now?: () => number;
  schedule?: (tick: () => void) => () => void;
};

/** One port/run at a time. No automatic selection, reconnect, reset, or command replay. */
export class SerialAdapter {
  readonly connection: Connection;
  cleanupError: string | undefined;
  #run: Run | undefined;
  #now: () => number;
  #schedule: (tick: () => void) => () => void;

  constructor(connection = new Connection(), options: Options = {}) {
    this.connection = connection;
    this.#now = options.now ?? (() => Math.floor(performance.now()));
    this.#schedule = options.schedule ?? (tick => {
      const timer = setInterval(tick, 100);
      return () => clearInterval(timer);
    });
  }

  get active() { return this.#run !== undefined; }

  discover() { this.#readyRun(); const id = this.connection.discover(this.#now()); this.#flush(this.#run!); return id; }
  recoverDiscovery() { this.#readyRun(); const result = this.connection.recoverDiscovery(this.#now()); this.#flush(this.#run!); return result; }
  sendMessage(text: string, destination = 'broadcast', channel = 0) {
    this.#readyRun(); const id = this.connection.sendMessage(text, destination, channel, this.#now());
    this.#flush(this.#run!); return id;
  }
  sendMessagePayload(payload: Uint8Array, destination = 'broadcast', channel = 0) {
    this.#readyRun(); const id = this.connection.sendMessagePayload(payload, destination, channel, this.#now());
    this.#flush(this.#run!); return id;
  }

  recoverMessage(id: string) {
    this.#readyRun(); const found = this.connection.recoverMessage(id, this.#now());
    this.#flush(this.#run!); return found;
  }

  configure(config: Config) {
    const run = this.#readyRun();
    const id = this.connection.configure(config, this.#now());
    this.#check(run);
    this.#flush(run);
    return id;
  }

  recover(id: string) {
    const run = this.#readyRun();
    const queried = this.connection.recover(id, this.#now());
    this.#check(run);
    this.#flush(run);
    return queried;
  }

  #readyRun() {
    if (!this.#run || !this.#current(this.#run)) throw new Error('serial adapter is not active');
    return this.#run;
  }

  async connect(port: SerialPortLike, link: string, baudRate = 115200) {
    if (this.#run) throw new Error('serial adapter is opening, active, or cleaning up');
    if (!Number.isInteger(baudRate) || baudRate < 1) throw new Error('invalid baud rate');
    const run: Run = {
      port, session: 0, stopped: false, opened: false, busy: false,
      opening: Promise.resolve(), reading: Promise.resolve(), writing: Promise.resolve(),
      removed: () => this.#fail(run, 'serial device removed'),
    };
    this.#run = run;
    this.cleanupError = undefined;
    run.opening = Promise.resolve().then(async () => {
      await port.open({ baudRate, bufferSize: 4096, flowControl: 'none' });
      run.opened = true;
    });
    try {
      await run.opening;
      if (run.stopped) throw new Error('serial open cancelled');
      if (!port.readable || !port.writable) throw new Error('serial streams unavailable');
      run.reader = port.readable.getReader();
      run.writer = port.writable.getWriter();
      run.session = this.connection.open(link, this.#now());
      port.addEventListener?.('disconnect', run.removed);
      run.stopTimer = this.#schedule(() => {
        if (!this.#current(run)) return;
        try {
          this.connection.tick(this.#now());
          this.#check(run);
          this.#flush(run);
        } catch { this.#fail(run, 'serial lifecycle failure'); }
      });
      run.reading = this.#read(run);
      this.#flush(run);
    } catch (error) {
      this.#fail(run, error instanceof Error ? error.message : 'serial open failed');
      await run.cleanup;
      throw error;
    }
  }

  async disconnect() {
    const run = this.#run;
    if (run) await this.#stop(run);
  }

  #current(run: Run) { return this.#run === run && !run.stopped; }

  #check(run: Run) {
    if (['disconnected', 'incompatible'].includes(this.connection.sync.state)) {
      this.#fail(run, this.connection.error ?? 'unsupported device protocol');
    }
  }

  async #read(run: Run) {
    try {
      while (this.#current(run)) {
        const { done, value } = await run.reader!.read();
        if (!this.#current(run)) break;
        if (done) { this.#fail(run, 'serial stream ended'); break; }
        if (value) {
          // Browser buffers are bounded on open; also reject hostile custom adapters.
          if (!(value instanceof Uint8Array) || value.length > 65536) throw new Error('invalid serial chunk');
          this.connection.receive(run.session, value, this.#now());
          this.#check(run);
          this.#flush(run);
        }
      }
    } catch { this.#fail(run, 'serial read failed'); }
  }

  #flush(run: Run) {
    if (!this.#current(run) || run.busy) return;
    run.busy = true;
    run.writing = (async () => {
      try {
        while (this.#current(run)) {
          const batch = this.connection.drain();
          if (!batch.length) break;
          for (const frame of batch) {
            if (!this.#current(run)) return;
            await run.writer!.write(frame);
          }
        }
      } catch { this.#fail(run, 'serial write failed'); }
      finally { run.busy = false; }
    })();
  }

  #fail(run: Run, reason: string) {
    if (this.#current(run)) void this.#stop(run, reason);
  }

  #stop(run: Run, reason?: string): Promise<void> {
    if (run.cleanup) return run.cleanup;
    run.stopped = true; // Invalidate async continuations before awaiting I/O cleanup.
    this.connection.close(reason);
    run.stopTimer?.();
    run.port.removeEventListener?.('disconnect', run.removed);
    run.cleanup = (async () => {
      // Opening itself cannot be cancelled by Web Serial. Do not reuse its port meanwhile.
      await run.opening.catch(() => {});
      const cancelled = await Promise.allSettled([
        run.reader?.cancel(), run.writer?.abort(),
      ]);
      await Promise.allSettled([run.reading, run.writing]);
      try {
        run.reader?.releaseLock();
        run.writer?.releaseLock();
        if (run.opened) await run.port.close();
        if (this.#run === run) this.#run = undefined;
      } catch {
        this.cleanupError = 'serial cleanup failed; port ownership remains blocked';
      }
      if (cancelled.some(result => result.status === 'rejected') && !this.cleanupError) {
        this.cleanupError = 'serial stream cancellation reported an error; port was closed';
      }
    })();
    return run.cleanup;
  }
}
