import {
  decodeMap,
  encodeMap,
  validateMapItem,
  type MapItem,
  type MapOperation,
} from '../../packages/protocol/map-item.ts';
import { parsePlugin, validateFieldValue, type InstalledPlugin, type Plugin } from './plugins.ts';
export const MAP_STORE_KEY = 'reaper-mesh.map-workspace.v1';
export type SharedPayload = {
  origin: string;
  channel: number;
  destination: string;
  text?: string;
  ciphertext?: string;
};
export type SharedRecord = {
  key: string;
  highest: number;
  accepted?: SharedPayload;
  pending?: SharedPayload;
};
type State = { version: 1; local: MapItem[]; shared: SharedRecord[]; plugins: InstalledPlugin[] };
/** Atomic, bounded local workspace. Ciphertext is retained without decrypted map bodies. */
export class MapStore {
  #state: State = { version: 1, local: [], shared: [], plugins: [] };
  private store: Pick<Storage, 'getItem' | 'setItem'>;
  private writable: () => boolean;
  constructor(store: Pick<Storage, 'getItem' | 'setItem'>, writable: () => boolean) {
    this.store = store;
    this.writable = writable;
    const raw = store.getItem(MAP_STORE_KEY);
    if (!raw) return;
    if (raw.length > 2097152) throw Error('Map storage exceeds its limit');
    const x = JSON.parse(raw);
    if (
      x.version !== 1 ||
      !Array.isArray(x.local) ||
      !Array.isArray(x.shared) ||
      !Array.isArray(x.plugins) ||
      x.local.length > 512 ||
      x.shared.length > 1024 ||
      x.plugins.length > 16
    )
      throw Error('Invalid map workspace');
    x.local = x.local.map(validateMapItem);
    const localIds = new Set<string>(),
      sharedIds = new Set<string>(),
      pluginIds = new Set<string>();
    for (const item of x.local) {
      if (localIds.has(item.id)) throw Error('Duplicate map ID');
      localIds.add(item.id);
    }
    for (const row of x.shared) {
      if (
        !row ||
        typeof row.key !== 'string' ||
        row.key.length > 200 ||
        sharedIds.has(row.key) ||
        !Number.isInteger(row.highest) ||
        row.highest < 1 ||
        row.highest > 0xffffffff
      )
        throw Error('Invalid shared map revision');
      sharedIds.add(row.key);
      for (const payload of [row.accepted, row.pending])
        if (payload) {
          if (
            typeof payload.origin !== 'string' ||
            payload.origin.length > 64 ||
            !Number.isInteger(payload.channel) ||
            payload.channel < 0 ||
            payload.channel >= 0xffffffff ||
            typeof payload.destination !== 'string' ||
            payload.destination.length > 64 ||
            (typeof payload.text === 'string') === (typeof payload.ciphertext === 'string')
          )
            throw Error('Invalid shared map source');
          if (
            payload.text !== undefined &&
            (typeof payload.text !== 'string' ||
              new TextEncoder().encode(payload.text).length > 1024)
          )
            throw Error('Invalid shared map text');
          if (payload.text !== undefined) {
            const op = decodeMap(payload.text);
            if (
              !op ||
              row.key !== `${payload.channel}:${payload.origin}:${op.item.id}` ||
              op.item.revision > row.highest ||
              (payload === row.pending && op.item.revision !== row.highest)
            )
              throw Error('Invalid shared map identity');
          }
          if (
            payload.ciphertext !== undefined &&
            (typeof payload.ciphertext !== 'string' ||
              !/^(?:[0-9a-f]{2}){74,1024}$/.test(payload.ciphertext))
          )
            throw Error('Invalid shared map ciphertext');
        }
    }
    for (const p of x.plugins) {
      p.manifest = parsePlugin(JSON.stringify(p.manifest));
      if (
        pluginIds.has(p.manifest.id) ||
        typeof p.enabled !== 'boolean' ||
        !p.settings ||
        typeof p.settings !== 'object' ||
        Array.isArray(p.settings)
      )
        throw Error('Invalid installed plugin');
      pluginIds.add(p.manifest.id);
      for (const [key, value] of Object.entries(p.settings)) {
        const f = p.manifest.settings.find((f: { id: string }) => f.id === key);
        if (!f) throw Error('Unknown plugin setting');
        validateFieldValue(f, value);
      }
    }
    this.#state = x;
  }
  get state(): State {
    return structuredClone(this.#state);
  }
  #commit(next: State) {
    if (!this.writable())
      throw Error('This tab cannot save map changes. Close other Reaper Mesh tabs and reload.');
    if (next.local.length > 512 || next.shared.length > 1024 || next.plugins.length > 16)
      throw Error('Map workspace capacity reached. Export a backup; no data was discarded.');
    const text = JSON.stringify(next);
    if (text.length > 2097152) throw Error('Map workspace exceeds 2 MiB');
    this.store.setItem(MAP_STORE_KEY, text);
    this.#state = next;
  }
  save(item: MapItem) {
    const next = this.state,
      valid = validateMapItem(item),
      prior = next.local.find(x => x.id === item.id);
    if (prior && valid.revision <= prior.revision)
      throw Error('Map item changed. Reopen it before saving.');
    next.local = [...next.local.filter(x => x.id !== item.id), valid];
    this.#commit(next);
  }
  remove(id: string) {
    const next = this.state;
    next.local = next.local.filter(x => x.id !== id);
    this.#commit(next);
  }
  receive(operation: MapOperation, payload: SharedPayload) {
    const item = validateMapItem(operation.item),
      next = this.state;
    if (payload.text !== undefined) {
      const decoded = decodeMap(payload.text);
      if (!decoded || encodeMap(decoded) !== encodeMap(operation))
        throw Error('Conflicting map payload');
    }
    const key = `${payload.channel}:${payload.origin}:${item.id}`;
    let row = next.shared.find(x => x.key === key);
    if (row && item.revision <= row.highest) return false;
    if (!row) {
      row = { key, highest: item.revision };
      next.shared.push(row);
    }
    row.highest = item.revision;
    row.pending = structuredClone(payload);
    this.#commit(next);
    return true;
  }
  decide(key: string, revision: number, accept: boolean, operation: MapOperation) {
    const next = this.state,
      row = next.shared.find(x => x.key === key);
    if (!row?.pending || row.highest !== revision || operation.item.revision !== revision)
      throw Error('Shared item changed. Review its latest version.');
    if (accept) row.accepted = operation.operation === 'put' ? row.pending : undefined;
    row.pending = undefined;
    this.#commit(next);
  }
  hide(key: string) {
    const next = this.state,
      row = next.shared.find(x => x.key === key);
    if (row) row.accepted = undefined;
    this.#commit(next);
  }
  install(manifest: Plugin) {
    const next = this.state,
      prior = next.plugins.find(p => p.manifest.id === manifest.id);
    const settings: InstalledPlugin['settings'] = Object.create(null);
    for (const f of manifest.settings) {
      const value = prior?.settings[f.id] ?? f.default;
      if (value !== undefined) {
        validateFieldValue(f, value);
        settings[f.id] = value;
      }
    }
    next.plugins = [
      ...next.plugins.filter(p => p.manifest.id !== manifest.id),
      {
        manifest: parsePlugin(JSON.stringify(manifest)),
        enabled: prior?.enabled ?? true,
        settings,
      },
    ];
    this.#commit(next);
  }
  plugin(
    id: string,
    action: 'toggle' | 'remove' | 'settings',
    settings?: InstalledPlugin['settings'],
  ) {
    const next = this.state,
      p = next.plugins.find(p => p.manifest.id === id);
    if (!p) throw Error('Unknown plugin');
    if (action === 'remove') next.plugins = next.plugins.filter(row => row.manifest.id !== id);
    else if (action === 'toggle') p.enabled = !p.enabled;
    else {
      const values = Object.create(null);
      for (const field of p.manifest.settings) {
        const value = settings?.[field.id];
        validateFieldValue(field, value);
        values[field.id] = value;
      }
      p.settings = values;
    }
    this.#commit(next);
  }
  export() {
    return JSON.stringify(this.#state, null, 2);
  }
}
