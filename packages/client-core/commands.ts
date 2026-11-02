import { positionFields, validPosition, type PositionConfig } from '../protocol/position-config.ts';
import { discoveryFields, validDiscovery, type DiscoveryConfig } from '../protocol/discovery-config.ts';
import { encodeMessage, validateField } from '../protocol/messages.ts';
import { radioFields, validRadio, type RadioConfig } from '../protocol/radio-config.ts';
import * as recovery from './recovery-data.ts';
import { Synchronizer, copyConfig, type Config } from './sync.ts';

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

  get history() { return [...this.#entries.values()].map(entry => Object.freeze({ command: entry.command, outcome: entry.outcome, attempts: entry.attempts, result: entry.result })); }
  exportState() { return { counter: this.#counter, entries: this.history }; }
  restoreState(value: unknown) {
    if (this.sync.state !== 'disconnected' || this.#counter || this.#entries.size) throw new Error('restore requires a fresh disconnected command manager');
    const state = recovery.object(value); const counter = recovery.u32(state.counter); const entries = new Map<string, Entry>();
    for (const raw of recovery.list(state.entries, this.capacity)) {
      const item = recovery.object(raw); const source = recovery.object(item.command); const config = recovery.object(source.config);
      const identity = recovery.sequence(source.id, this.incarnation); const boot = recovery.id(source.boot);
      const region = recovery.string(config.region), label = recovery.string(config.label); let radio: RadioConfig | undefined;
      if (config.radio !== undefined) {
        const r = recovery.object(config.radio);
        if (typeof r.relay !== 'boolean') throw new Error('invalid recovery relay');
        radio = { mode: recovery.string(r.mode) as RadioConfig['mode'], power: recovery.u32(r.power), relay: r.relay,
          channels: recovery.string(r.channels), preset: recovery.string(r.preset) as RadioConfig['preset'] };
        if (!validRadio(radio, region)) throw new Error('invalid recovery radio policy');
      }
      let position: PositionConfig | undefined;
      if (config.position !== undefined) {
        const p = recovery.object(config.position);
        if (p.source !== 0 && p.source !== 1) throw new Error('invalid position recovery source');
        position = { share: p.share as boolean, source: p.source, latitude: recovery.u32(p.latitude), longitude: recovery.u32(p.longitude) };
        if (!validPosition(position)) throw new Error('invalid position recovery settings');
      }
      let discovery: DiscoveryConfig | undefined;
      if (config.discovery !== undefined) { const d = recovery.object(config.discovery); discovery = { beacon: d.beacon as boolean, respond: d.respond as boolean, interval: recovery.u32(d.interval) }; if (!validDiscovery(discovery)) throw new Error('invalid discovery recovery settings'); }
      const command: ConfigCommand = Object.freeze({ id: identity.id, boot, expectedRevision: recovery.u32(source.expectedRevision),
        config: copyConfig({ region, label, ...(position ? { position } : {}), ...(discovery ? { discovery } : {}), ...(radio ? { radio } : {}) }) });
      encodeMessage({ type: 'configure', link: 'recovery', id: command.id, boot, expectedRevision: command.expectedRevision,
        region, label, ...positionFields(position), ...discoveryFields(discovery), ...radioFields(radio) } as import('../protocol/messages.ts').Message);
      const outcome = recovery.string(item.outcome);
      if (!['pending', 'unknown', 'committed', 'conflict', 'rejected'].includes(outcome)) throw new Error('invalid recovery outcome');
      const attempts = recovery.u32(item.attempts);
      if (!attempts || attempts > this.maxAttempts || identity.sequence > counter || entries.has(identity.id)) throw new Error('invalid recovery sequence/history');
      let result: Result | undefined;
      if (item.result !== undefined) {
        const r = recovery.object(item.result); const resultOutcome = recovery.string(r.outcome); validateField('outcome', resultOutcome);
        if (r.id !== identity.id || r.boot !== boot || resultOutcome !== outcome) throw new Error('recovery receipt mismatch');
        result = Object.freeze({ id: identity.id, boot, outcome: resultOutcome as Result['outcome'], ...(r.revision !== undefined ? { revision: recovery.u32(r.revision) } : {}) });
      }
      if (['committed', 'conflict', 'rejected'].includes(outcome) && !result) throw new Error('terminal recovery receipt missing');
      entries.set(identity.id, { command, session: this.sync.session, attempts, deadline: 0,
        outcome: outcome === 'pending' ? 'unknown' : outcome as Entry['outcome'], result });
    }
    this.#counter = counter; this.#entries = entries;
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
      expectedRevision: context.expectedRevision, config: copyConfig(config),
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
