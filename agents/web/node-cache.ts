// Keeps heard nodes across reconnects, per device. A position is only as fresh as its last report.
import { fromWire } from './geo.ts';

export const NODE_CACHE_PREFIX = 'reaper-mesh.nodes.v1.';
export const FORGOTTEN_NODES_PREFIX = 'reaper-mesh.nodes-forgotten.v1.';
const MAX_CACHED_NODES = 64;
/** A node not heard for this long may have moved or gone, which is not the same as offline. */
export const STALE_NODE_MS = 15 * 60 * 1000;

export type CachedNode = Readonly<{
  node: string;
  name: string;
  peerBoot: string;
  peerSequence: number;
  heardAt: number;
  /** Degrees. */
  position?: Readonly<{ latitude: number; longitude: number }>;
}>;
type LiveNode = Readonly<{
  node: string;
  name: string;
  peerBoot: string;
  peerSequence: number;
  ageMs: number;
  position?: Readonly<{ latitude: number; longitude: number }>;
}>;
/** The report a forgotten node was last seen in. Only a different one brings it back. */
type ForgottenNode = Readonly<{ peerBoot: string; peerSequence: number }>;
type Forgotten = Readonly<Record<string, ForgottenNode>>;

function validNode(value: unknown): value is CachedNode {
  const row = value as CachedNode | null;
  return (
    !!row &&
    typeof row.node === 'string' &&
    typeof row.name === 'string' &&
    typeof row.peerBoot === 'string' &&
    Number.isFinite(row.peerSequence) &&
    Number.isFinite(row.heardAt) &&
    (row.position === undefined ||
      (Number.isFinite(row.position.latitude) && Number.isFinite(row.position.longitude)))
  );
}

export class NodeCache {
  #store: Pick<Storage, 'getItem' | 'setItem'>;
  #writable: () => boolean;
  #device: string | undefined;
  #nodes: readonly CachedNode[] = [];
  #forgotten: Forgotten = {};

  constructor(store: Pick<Storage, 'getItem' | 'setItem'>, writable: () => boolean = () => true) {
    this.#store = store;
    this.#writable = writable;
  }
  get nodes() {
    return this.#nodes;
  }
  /** Loads the saved list when the device changes. A damaged list starts empty rather than fails. */
  use(device: string | undefined) {
    if (device === this.#device) return;
    this.#device = device;
    this.#nodes = [];
    this.#forgotten = {};
    if (!device) return;
    try {
      const saved = JSON.parse(this.#store.getItem(NODE_CACHE_PREFIX + device) ?? '[]');
      if (Array.isArray(saved)) this.#nodes = saved.filter(validNode).slice(0, MAX_CACHED_NODES);
    } catch {
      this.#nodes = [];
    }
    try {
      const saved = JSON.parse(this.#store.getItem(FORGOTTEN_NODES_PREFIX + device) ?? '{}');
      if (saved && typeof saved === 'object' && !Array.isArray(saved)) this.#forgotten = saved;
    } catch {
      this.#forgotten = {};
    }
  }
  #save(key: string, value: unknown) {
    if (!this.#writable()) return;
    try {
      this.#store.setItem(key, JSON.stringify(value));
    } catch {
      // The list is a convenience: it still works for this session if it can't be saved.
    }
  }
  /**
   * Removes a node from the list until the device hears it again. The device keeps reporting what
   * it last heard, so that report is remembered and only a newer one brings the node back.
   */
  forget(node: string, live: readonly LiveNode[]) {
    const row = this.#nodes.find(item => item.node === node);
    if (!row || !this.#device) return;
    const { peerBoot, peerSequence } = live.find(item => item.node === node) ?? row;
    this.#forgotten = { ...this.#forgotten, [node]: { peerBoot, peerSequence } };
    this.#save(FORGOTTEN_NODES_PREFIX + this.#device, this.#forgotten);
    this.#nodes = this.#nodes.filter(item => item.node !== node);
    this.#save(NODE_CACHE_PREFIX + this.#device, this.#nodes);
  }
  /** Merges the device's current snapshot. A node's time only moves when it was heard again. */
  sync(device: string, live: readonly LiveNode[], now: number) {
    this.use(device);
    if (!live.length) return;
    const merged = new Map(this.#nodes.map(node => [node.node, node]));
    const held: Record<string, ForgottenNode> = {};
    let changed = false;
    for (const row of live) {
      const gone = this.#forgotten[row.node];
      if (gone?.peerBoot === row.peerBoot && gone.peerSequence === row.peerSequence) {
        held[row.node] = gone;
        continue;
      }
      const prior = merged.get(row.node);
      if (
        prior &&
        prior.peerSequence === row.peerSequence &&
        prior.peerBoot === row.peerBoot &&
        prior.name === row.name
      )
        continue;
      merged.set(row.node, {
        node: row.node,
        name: row.name,
        peerBoot: row.peerBoot,
        peerSequence: row.peerSequence,
        heardAt: now - row.ageMs,
        ...(row.position
          ? {
              position: {
                latitude: fromWire(row.position.latitude, 90),
                longitude: fromWire(row.position.longitude, 180),
              },
            }
          : {}),
      });
      changed = true;
    }
    // The device's report is complete, so anything missing from it has nothing left to hold back.
    if (Object.keys(held).length !== Object.keys(this.#forgotten).length) {
      this.#forgotten = held;
      this.#save(FORGOTTEN_NODES_PREFIX + device, held);
    }
    if (!changed) return;
    this.#nodes = [...merged.values()]
      .sort((a, b) => b.heardAt - a.heardAt)
      .slice(0, MAX_CACHED_NODES);
    this.#save(NODE_CACHE_PREFIX + device, this.#nodes);
  }
}
