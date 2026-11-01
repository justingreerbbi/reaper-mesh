import { SerialAdapter } from '../../packages/client-core/serial.ts';
import type { Config } from '../../packages/client-core/sync.ts';

/** UI drafts/history only. The shared core owns all connection and protocol state. */
export class ConfigModel {
  readonly adapter: SerialAdapter;
  draft: Config = { region: 'UNSET', label: '' };
  baseRevision = -1;
  #baseDevice: string | undefined;
  #baseBoot: string | undefined;
  dirty = false;
  get history() { return this.adapter.connection.commands.history.map(entry => ({ id: entry.command.id, label: entry.command.config.radio ? 'Radio/channel settings' : entry.command.config.label })); }

  constructor(adapter = new SerialAdapter()) { this.adapter = adapter; }
  get stale() {
    const sync = this.adapter.connection.sync;
    return this.baseRevision >= 0 && (sync.revision !== this.baseRevision ||
      sync.boot !== this.#baseBoot || this.adapter.connection.device !== this.#baseDevice);
  }
  get pending() { return this.history.some(entry => this.adapter.connection.commands.status(entry.id).outcome === 'pending'); }
  refresh() {
    if (!this.dirty && !this.pending && this.adapter.connection.sync.state === 'ready') this.reset();
  }
  edit(config: Config) { this.draft = { ...config }; this.dirty = true; }
  reset() {
    const { sync, device } = this.adapter.connection;
    if (sync.state !== 'ready' || !sync.config) throw new Error('connect and synchronize first');
    this.draft = { ...sync.config };
    this.baseRevision = sync.revision;
    this.#baseBoot = sync.boot;
    this.#baseDevice = device;
    this.dirty = false;
  }
  save() {
    if (!this.dirty) throw new Error('no configuration changes');
    if (this.stale) throw new Error('device changed; load its latest configuration before saving');
    if (this.pending) throw new Error('wait for the pending command');
    const id = this.adapter.configure(this.draft);
    this.dirty = false;
    return id;
  }
  forget(id: string) {
    this.adapter.connection.forget(id);
  }
}
