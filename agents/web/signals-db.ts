/**
 * The signals database (D61) in this browser's IndexedDB: the history of every transmitter, the
 * newest reference pack, and monitoring logs. Nothing here leaves this computer. A local wipe
 * deletes the whole database.
 */
import type { HistoryStorage, SignalRecord } from '../../packages/agent-core/signals-intel.ts';
import type { LogRow, LogSession, LogStorage } from '../../packages/agent-core/signals-log.ts';

export const SIGNALS_DB = 'reaper-mesh-signals';
const STORE = 'signals';
/** The newest reference pack fetched, so identification works offline. */
const REFERENCE = 'reference';
const LOG_SESSIONS = 'log-sessions';
/** Chunks of log rows, keyed by [session, chunk number]. */
const LOG_ROWS = 'log-rows';

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

let database: Promise<IDBDatabase> | undefined;
function open() {
  database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const opening = indexedDB.open(SIGNALS_DB, 3);
    opening.onupgradeneeded = () => {
      const db = opening.result;
      const names = db.objectStoreNames;
      if (!names.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'key' });
      if (!names.contains(REFERENCE)) db.createObjectStore(REFERENCE);
      if (!names.contains(LOG_SESSIONS)) db.createObjectStore(LOG_SESSIONS, { keyPath: 'id' });
      if (!names.contains(LOG_ROWS)) db.createObjectStore(LOG_ROWS);
    };
    opening.onsuccess = () => {
      // Another tab deleting the database (a wipe) closes this connection.
      opening.result.onversionchange = () => {
        opening.result.close();
        database = undefined;
      };
      resolve(opening.result);
    };
    opening.onerror = () => {
      database = undefined;
      reject(opening.error);
    };
    opening.onblocked = () => reject(new Error('The signals database is open in an older tab.'));
  });
  return database;
}

export class IndexedDbHistory implements HistoryStorage {
  async loadAll(): Promise<SignalRecord[]> {
    const db = await open();
    return request(db.transaction(STORE).objectStore(STORE).getAll()) as Promise<SignalRecord[]>;
  }

  async put(records: readonly SignalRecord[]) {
    const db = await open();
    const transaction = db.transaction(STORE, 'readwrite');
    const store = transaction.objectStore(STORE);
    for (const record of records) store.put(record);
    await done(transaction);
  }

  async delete(keys: readonly string[]) {
    const db = await open();
    const transaction = db.transaction(STORE, 'readwrite');
    const store = transaction.objectStore(STORE);
    for (const key of keys) store.delete(key);
    await done(transaction);
  }

  async clear() {
    const db = await open();
    const transaction = db.transaction(STORE, 'readwrite');
    transaction.objectStore(STORE).clear();
    await done(transaction);
  }

  async getReference(): Promise<unknown> {
    const db = await open();
    return request(db.transaction(REFERENCE).objectStore(REFERENCE).get('pack'));
  }

  async putReference(pack: unknown) {
    const db = await open();
    const transaction = db.transaction(REFERENCE, 'readwrite');
    transaction.objectStore(REFERENCE).put(pack, 'pack');
    await done(transaction);
  }
}

export class IndexedDbLogs implements LogStorage {
  async listSessions(): Promise<LogSession[]> {
    const db = await open();
    return request(db.transaction(LOG_SESSIONS).objectStore(LOG_SESSIONS).getAll()) as Promise<
      LogSession[]
    >;
  }

  async putSession(session: LogSession) {
    const db = await open();
    const transaction = db.transaction(LOG_SESSIONS, 'readwrite');
    transaction.objectStore(LOG_SESSIONS).put(session);
    await done(transaction);
  }

  async appendRows(session: string, chunk: number, rows: readonly LogRow[]) {
    const db = await open();
    const transaction = db.transaction(LOG_ROWS, 'readwrite');
    transaction.objectStore(LOG_ROWS).put(rows, [session, chunk]);
    await done(transaction);
  }

  async readRows(session: string): Promise<LogRow[]> {
    const db = await open();
    const range = IDBKeyRange.bound([session, 0], [session, Number.MAX_SAFE_INTEGER]);
    const chunks = (await request(
      db.transaction(LOG_ROWS).objectStore(LOG_ROWS).getAll(range),
    )) as LogRow[][];
    return chunks.flat();
  }

  async deleteSession(session: string) {
    const db = await open();
    const transaction = db.transaction([LOG_SESSIONS, LOG_ROWS], 'readwrite');
    transaction.objectStore(LOG_SESSIONS).delete(session);
    transaction
      .objectStore(LOG_ROWS)
      .delete(IDBKeyRange.bound([session, 0], [session, Number.MAX_SAFE_INTEGER]));
    await done(transaction);
  }
}

/** Deletes the whole signals database, for a local wipe. */
export function deleteSignalHistory() {
  return new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(SIGNALS_DB);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve(); // Finishes once other tabs close their connections.
  });
}
