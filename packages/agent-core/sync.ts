import type { PositionConfig } from '../protocol/position-config.ts';
import type { DiscoveryConfig } from '../protocol/discovery-config.ts';
import type { RadioConfig } from '../protocol/radio-config.ts';
/** Transport-independent synchronization core. Wire decoding must validate input first. */
export type Config = Readonly<{
  region: string;
  label: string;
  position?: PositionConfig;
  radio?: RadioConfig;
  discovery?: DiscoveryConfig;
}>;
export type Event = Readonly<{
  session: number;
  boot: string;
  sequence: number;
  revision: number;
  config: Config;
}>;
export type Snapshot = Event & Readonly<{ request: number }>;
export type State = 'disconnected' | 'negotiating' | 'synchronizing' | 'ready' | 'incompatible';

export class Synchronizer {
  state: State = 'disconnected';
  session = 0;
  boot: string | undefined;
  sequence = 0;
  revision = 0;
  config: Config | undefined;
  snapshotRequest = 0;
  #buffer: Event[] = [];
  readonly capacity: number;

  constructor(capacity = 64) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) throw new Error('invalid capacity');
    this.capacity = capacity;
  }

  connect() {
    this.session++;
    this.state = 'negotiating';
    this.#clear();
    return this.session;
  }

  disconnect() {
    this.session++; // Invalidate every pending transport callback immediately.
    this.state = 'disconnected';
    this.#clear();
  }

  hello(session: number, boot: string, minVersion: number, maxVersion: number) {
    if (session !== this.session || this.state !== 'negotiating') return;
    if (!boot || minVersion > 1 || maxVersion < 1 || minVersion > maxVersion) {
      this.state = 'incompatible';
      return false;
    }
    this.boot = boot;
    this.#resync();
    return true;
  }

  event(event: Event) {
    if (!this.#matches(event) || !['ready', 'synchronizing'].includes(this.state)) return;
    if (this.state === 'synchronizing') {
      if (this.#buffer.length >= this.capacity) this.#resync();
      else this.#buffer.push({ ...event, config: copyConfig(event.config) });
      return;
    }
    if (event.sequence <= this.sequence) return;
    if (!this.#apply(event)) this.#resync();
  }

  snapshot(snapshot: Snapshot) {
    if (
      !this.#matches(snapshot) ||
      this.state !== 'synchronizing' ||
      snapshot.request !== this.snapshotRequest
    )
      return;
    if (snapshot.sequence < this.sequence || snapshot.revision < this.revision) {
      this.#resync();
      return;
    }
    this.sequence = snapshot.sequence;
    this.revision = snapshot.revision;
    this.config = copyConfig(snapshot.config);
    const pending = this.#buffer;
    this.#buffer = [];
    // Event delivery is ordered within a live subscription. A gap requires a new snapshot.
    for (const event of pending) {
      if (event.sequence <= this.sequence) continue;
      if (!this.#apply(event)) {
        this.#resync();
        return;
      }
    }
    this.state = 'ready';
  }

  mutationContext() {
    if (this.state !== 'ready') throw new Error('device is not synchronized');
    return { session: this.session, boot: this.boot!, expectedRevision: this.revision };
  }

  resynchronize() {
    if (this.state !== 'ready') throw new Error('device is not ready');
    this.#resync();
  }

  #matches(value: Event | Snapshot) {
    return value.session === this.session && value.boot === this.boot;
  }

  #apply(event: Event) {
    if (event.sequence !== this.sequence + 1 || event.revision !== this.revision + 1) return false;
    this.sequence = event.sequence;
    this.revision = event.revision;
    this.config = copyConfig(event.config);
    return true;
  }

  #resync() {
    this.state = 'synchronizing';
    this.snapshotRequest++;
    this.#buffer = [];
  }

  #clear() {
    this.boot = undefined;
    this.config = undefined;
    this.sequence = 0;
    this.revision = 0;
    this.#buffer = [];
  }
}

export function copyConfig(config: Config): Config {
  return Object.freeze({
    ...config,
    ...(config.position ? { position: Object.freeze({ ...config.position }) } : {}),
    ...(config.discovery ? { discovery: Object.freeze({ ...config.discovery }) } : {}),
    ...(config.radio ? { radio: Object.freeze({ ...config.radio }) } : {}),
  });
}
