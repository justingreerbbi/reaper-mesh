import type { Config } from '../agent-core/sync.ts';
import type { ConfigCommand, Result } from '../agent-core/commands.ts';

/** Host reference only. FIFO receipts with non-evicting per-owner high-water marks. */
export class ConfigDevice {
  boot = 'boot-A';
  revision = 0;
  config: Config = { region: 'US', label: 'initial' };
  commits = 0;
  #receipts = new Map<string, { command: ConfigCommand; result: Result }>();
  #highest = new Map<string, number>();
  #boots = 0;
  readonly capacity: number;
  readonly ownerCapacity: number;

  constructor(capacity = 32, ownerCapacity = 8) {
    if (![capacity, ownerCapacity].every(value => Number.isSafeInteger(value) && value > 0)) {
      throw new Error('invalid receipt capacity');
    }
    this.capacity = capacity;
    this.ownerCapacity = ownerCapacity;
  }

  admit(owner: string) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(owner)) return false;
    if (this.#highest.has(owner)) return true;
    if (this.#highest.size >= this.ownerCapacity) return false;
    this.#highest.set(owner, 0);
    return true;
  }

  apply(command: ConfigCommand): Result {
    const result = (outcome: Result['outcome']): Result => Object.freeze({
      id: command.id, boot: this.boot, outcome, revision: this.revision,
    });
    if (command.boot !== this.boot) return result('rejected');
    const match = /^([A-Za-z0-9_-]{1,64}):([1-9][0-9]{0,9})$/.exec(command.id);
    if (!match || Number(match[2]) > 0xffffffff) return result('rejected');
    const [, owner, counterText] = match;
    const counter = Number(counterText);
    const prior = this.#receipts.get(command.id);
    if (prior) {
      const old = prior.command;
      if (old.boot !== command.boot || old.expectedRevision !== command.expectedRevision ||
          old.config.region !== command.config.region || old.config.label !== command.config.label) {
        return result('rejected');
      }
      return prior.result;
    }
    const highest = this.#highest.get(owner);
    if (highest !== undefined && counter <= highest) return result('unknown');
    if (highest === undefined && this.#highest.size >= this.ownerCapacity) return result('rejected');
    // Never evict these marks within a boot: delayed old IDs must not become new work.
    this.#highest.set(owner, counter);
    let outcome: Result['outcome'] = 'conflict';
    if (command.expectedRevision === this.revision && this.revision < 0xffffffff) {
      this.config = Object.freeze({ ...command.config });
      this.revision++;
      this.commits++;
      outcome = 'committed';
    }
    const receipt = result(outcome);
    if (this.#receipts.size >= this.capacity) this.#receipts.delete(this.#receipts.keys().next().value!);
    this.#receipts.set(command.id, {
      command: Object.freeze({ ...command, config: Object.freeze({ ...command.config }) }),
      result: receipt,
    });
    return receipt;
  }

  query(id: string): Result {
    return this.#receipts.get(id)?.result ?? { id, boot: this.boot, outcome: 'unknown' };
  }

  reboot() {
    this.boot = `boot-${++this.#boots}`;
    this.#receipts.clear(); // Persisted config survives; volatile command receipts do not.
    this.#highest.clear();
  }
}
