/**
 * Signal history (D61) in this browser's IndexedDB: one row per transmitter, keyed by kind and
 * address. Nothing here leaves this computer. A local wipe deletes the whole database.
 */
import type { HistoryStorage, SignalRecord } from '../../packages/agent-core/signals-intel.ts';

export const SIGNALS_DB = 'reaper-mesh-signals';
const STORE = 'signals';
/** The newest reference pack fetched (D61), so identification works offline. */
const REFERENCE = 'reference';

function request<T>(req: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error('Aborted'));
  });
}

export class IndexedDbHistory implements HistoryStorage {
  #db: Promise<IDBDatabase> | undefined;

  #open() {
    this.#db ??= new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open(SIGNALS_DB, 2);
      open.onupgradeneeded = () => {
        if (!open.result.objectStoreNames.contains(STORE))
          open.result.createObjectStore(STORE, { keyPath: 'key' });
        if (!open.result.objectStoreNames.contains(REFERENCE))
          open.result.createObjectStore(REFERENCE);
      };
      open.onsuccess = () => {
        // Another tab deleting the database (a wipe) closes this connection.
        open.result.onversionchange = () => {
          open.result.close();
          this.#db = undefined;
        };
        resolve(open.result);
      };
      open.onerror = () => reject(open.error);
      open.onblocked = () => reject(new Error('Signal history is open in an older tab.'));
    });
    return this.#db;
  }

  async loadAll(): Promise<SignalRecord[]> {
    const db = await this.#open();
    return request(db.transaction(STORE).objectStore(STORE).getAll()) as Promise<SignalRecord[]>;
  }

  async put(records: readonly SignalRecord[]) {
    const db = await this.#open();
    const transaction = db.transaction(STORE, 'readwrite');
    const store = transaction.objectStore(STORE);
    for (const record of records) store.put(record);
    await done(transaction);
  }

  async delete(keys: readonly string[]) {
    const db = await this.#open();
    const transaction = db.transaction(STORE, 'readwrite');
    const store = transaction.objectStore(STORE);
    for (const key of keys) store.delete(key);
    await done(transaction);
  }

  async clear() {
    const db = await this.#open();
    const transaction = db.transaction(STORE, 'readwrite');
    transaction.objectStore(STORE).clear();
    await done(transaction);
  }

  async getReference(): Promise<unknown> {
    const db = await this.#open();
    return request(db.transaction(REFERENCE).objectStore(REFERENCE).get('pack'));
  }

  async putReference(pack: unknown) {
    const db = await this.#open();
    const transaction = db.transaction(REFERENCE, 'readwrite');
    transaction.objectStore(REFERENCE).put(pack, 'pack');
    await done(transaction);
  }
}

/** Deletes the whole history database, for a local wipe. */
export function deleteSignalHistory() {
  return new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(SIGNALS_DB);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve(); // Finishes once other tabs close their connections.
  });
}
