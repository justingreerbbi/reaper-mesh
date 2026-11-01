import { Synchronizer, type Config } from './sync.ts';

export type ConfigCommand = Readonly<{
  id: string; boot: string; expectedRevision: number; config: Config;
}>;
export type Result = Readonly<{
  id: string; boot: string;
  outcome: 'committed' | 'conflict' | 'rejected' | 'unknown';
  revision?: number;
}>;
type Entry = {
  command: ConfigCommand; session: number; attempts: number; deadline: number;
  outcome: 'pending' | Result['outcome']; result?: Result;
};

/** Explicit caller-driven clock; no background timers or implicit reconnect replay. */
export class Commands {
  #entries = new Map<string, Entry>();
  #counter = 0;
  #lastTime = -Infinity;
  readonly sync: Synchronizer;
  readonly incarnation: string;
  readonly capacity: number;
  readonly timeoutMs: number;
  readonly maxAttempts: number;

  constructor(sync: Synchronizer, incarnation: string,
    { capacity = 32, timeoutMs = 1000, maxAttempts = 3 } = {}) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(incarnation)) throw new Error('invalid client incarnation');
    for (const value of [capacity, timeoutMs, maxAttempts]) {
      if (!Number.isSafeInteger(value) || value < 1) throw new Error('invalid command limit');
    }
    this.sync = sync;
    this.incarnation = incarnation;
    this.capacity = capacity;
    this.timeoutMs = timeoutMs;
    this.maxAttempts = maxAttempts;
  }

  submit(config: Config, now: number): ConfigCommand {
    this.#time(now);
    const context = this.sync.mutationContext();
    if (this.#counter >= 0xffffffff) throw new Error('command sequence exhausted');
    if (this.#entries.size >= this.capacity) throw new Error('command history full');
    if ([...this.#entries.values()].some(entry => entry.outcome === 'pending')) {
      throw new Error('a configuration command is already pending');
    }
    const command = Object.freeze({
      id: `${this.incarnation}:${++this.#counter}`, boot: context.boot,
      expectedRevision: context.expectedRevision, config: Object.freeze({ ...config }),
    });
    this.#entries.set(command.id, {
      command, session: context.session, attempts: 1,
      deadline: now + this.timeoutMs, outcome: 'pending',
    });
    return command;
  }

  /** Return packets to retry, only in the same synchronized connection and boot. */
  tick(now: number): ConfigCommand[] {
    this.#time(now);
    const retries: ConfigCommand[] = [];
    for (const entry of this.#entries.values()) {
      if (entry.outcome !== 'pending') continue;
      if (entry.session !== this.sync.session || entry.command.boot !== this.sync.boot ||
          this.sync.state !== 'ready') {
        entry.outcome = 'unknown';
      } else if (now >= entry.deadline) {
        if (entry.attempts >= this.maxAttempts) entry.outcome = 'unknown';
        else {
          entry.attempts++;
          entry.deadline = now + this.timeoutMs;
          retries.push(entry.command);
        }
      }
    }
    return retries;
  }

  receive(session: number, result: Result) {
    const entry = this.#entries.get(result.id);
    if (!entry || session !== this.sync.session || session !== entry.session ||
        result.boot !== entry.command.boot || result.boot !== this.sync.boot ||
        !['pending', 'unknown'].includes(entry.outcome)) return false;
    entry.result = Object.freeze({ ...result });
    entry.outcome = result.outcome;
    return true;
    // Results never overwrite config: the authoritative event/snapshot path owns it.
  }

  /** Query-only recovery. The caller must send a status request, never the mutation. */
  recover(id: string) {
    const context = this.sync.mutationContext();
    const entry = this.#get(id);
    if (entry.outcome !== 'unknown') throw new Error('command is not uncertain');
    if (context.boot !== entry.command.boot) return undefined; // Receipt did not survive reboot.
    entry.session = context.session;
    return Object.freeze({ id, boot: context.boot });
  }

  status(id: string) {
    const entry = this.#get(id);
    // Callers cannot mutate retained state.
    return Object.freeze({ outcome: entry.outcome, attempts: entry.attempts, result: entry.result });
  }

  forget(id: string) {
    if (this.#get(id).outcome === 'pending') throw new Error('cannot forget a pending command');
    this.#entries.delete(id);
  }

  #get(id: string) {
    const entry = this.#entries.get(id);
    if (!entry) throw new Error('unknown command ID');
    return entry;
  }

  #time(now: number) {
    if (!Number.isSafeInteger(now) || now < this.#lastTime || now < 0) {
      throw new Error('clock must be a nonnegative monotonic integer');
    }
    this.#lastTime = now;
  }
}
