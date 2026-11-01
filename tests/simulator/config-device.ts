import type { Config } from '../../packages/client-core/sync.ts';
import type { ConfigCommand, Result } from '../../packages/client-core/commands.ts';

/** Host reference only. A boot retains receipts until capacity; it never evicts them. */
export class ConfigDevice {
  boot = 'boot-A';
  revision = 0;
  config: Config = { region: 'US', label: 'initial' };
  commits = 0;
  #receipts = new Map<string, { command: ConfigCommand; result: Result }>();
  readonly capacity: number;

  constructor(capacity = 32) { this.capacity = capacity; }

  apply(command: ConfigCommand): Result {
    const result = (outcome: Result['outcome']): Result => Object.freeze({
      id: command.id, boot: this.boot, outcome, revision: this.revision,
    });
    if (command.boot !== this.boot) return result('rejected');
    const prior = this.#receipts.get(command.id);
    if (prior) {
      const old = prior.command;
      if (old.boot !== command.boot || old.expectedRevision !== command.expectedRevision ||
          old.config.region !== command.config.region || old.config.label !== command.config.label) {
        return result('rejected');
      }
      return prior.result;
    }
    if (this.#receipts.size >= this.capacity) return result('rejected');
    let outcome: Result['outcome'] = 'conflict';
    if (command.expectedRevision === this.revision) {
      this.config = Object.freeze({ ...command.config });
      this.revision++;
      this.commits++;
      outcome = 'committed';
    }
    const receipt = result(outcome);
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
    this.boot += '-next';
    this.#receipts.clear(); // Persisted config survives; volatile command receipts do not.
  }
}
