import { WIPE_SIGNAL } from './local-data.ts';
import { Connection } from '../../packages/agent-core/connection.ts';
type Store = Pick<Storage, 'getItem' | 'setItem'>;
export const RECOVERY_KEY = 'reaper-mesh.usb-recovery.v1';
/** One writer per browser storage bucket. Loaded counters are never reused on reload. */
export class BrowserRecovery {
  connection: Connection;
  #store: Store | undefined;
  #held: boolean;
  #invalid: string | undefined;
  #text = ''; #last = '';
  #release: (() => void) | undefined;
  private constructor(store: Store | undefined, held: boolean, blocked?: string) {
    this.#store = store; this.#held = held; this.#invalid = blocked;
    this.connection = new Connection();
    try {
      const text = store?.getItem(RECOVERY_KEY);
      if (text) {
        this.#text = this.#last = text;
        if (text.length > 262144) throw new Error('recovery data exceeds its limit');
        this.connection = Connection.fromJournal(JSON.parse(text));
      }
    } catch (error) { this.#invalid = `Saved recovery data cannot be loaded: ${error instanceof Error ? error.message : String(error)}`; }
    this.#bind();
  }
  static unavailable(reason: string) { return new BrowserRecovery(undefined, false, reason); }
  static open(store: Store, locks?: Pick<LockManager, 'request'>): Promise<BrowserRecovery> {
    if (!locks) return Promise.resolve(new BrowserRecovery(store, false, 'This browser cannot lock recovery storage; USB writes are disabled.'));
    return new Promise(resolve => {
      void locks.request<void>('reaper-mesh-usb-recovery-v1', { mode: 'exclusive', ifAvailable: true }, lock => {
        // Load only after lock admission, so another tab cannot change counters between load and acquisition.
        const session = new BrowserRecovery(store, !!lock, lock ? undefined : 'Recovery history is open in another tab. Close that tab and reload to write.');
        if (lock) {
          const held = new Promise<void>(release => { session.#release = release; });
          resolve(session); return held;
        }
        resolve(session);
      }).catch(error => resolve(new BrowserRecovery(store, false, `Recovery lock unavailable: ${String(error)}`)));
    });
  }
  get writable() {
    try { return this.#held && !this.#invalid && !this.#store?.getItem(WIPE_SIGNAL); }
    catch { return false; }
  }
  exportText() { return this.#invalid && this.#text ? this.#text : JSON.stringify(this.connection.exportJournal(), null, 2); }
  retry() { return this.connection.retryRecoveryStorage(); }
  reset() {
    if (this.#store?.getItem(WIPE_SIGNAL)) throw new Error('A local data wipe is in progress.');
    if (!this.#held || !this.#store || this.connection.sync.state !== 'disconnected') throw new Error('Disconnect this console and hold its recovery lock before resetting history.');
    const next = new Connection();
    if (next.commands.incarnation === this.connection.commands.incarnation) throw new Error('fresh agent identity allocation failed');
    const text = JSON.stringify(next.exportJournal()); this.#store.setItem(RECOVERY_KEY, text);
    this.connection = next; this.#text = this.#last = text; this.#invalid = undefined; this.#bind();
  }
  release() { this.#held = false; this.#release?.(); this.#release = undefined; }
  #bind() {
    const connection = this.connection;
    connection.persistence(state => {
      if (!this.writable || connection !== this.connection || !this.#store) throw new Error(this.#invalid ?? 'This console does not own recovery storage.');
      const text = JSON.stringify(state);
      if (text.length > 262144) throw new Error('recovery data exceeds its limit');
      if (text !== this.#last) { this.#store.setItem(RECOVERY_KEY, text); this.#last = this.#text = text; }
    });
  }
}
