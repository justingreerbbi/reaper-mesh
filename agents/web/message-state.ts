import { canonicalNode, conversationKey, type Incoming } from './conversations.ts';
export const MESSAGE_UI_KEY = 'reaper-mesh.message-ui.v1';
type Store = Pick<Storage, 'getItem' | 'setItem'>;
type Flags = { read: boolean; deleted: boolean };
export function receivedKey(source: string, message: Incoming) { return JSON.stringify([source, message.device, 'in', canonicalNode(message.origin), message.messageId]); }
export function sentKey(source: string, device: string, id: string) { return JSON.stringify([source, device, 'out', id]); }
export function messageScope(source: string, device: string) { return JSON.stringify([source, device]); }
function threadKey(scope: string, key: string) { return JSON.stringify([scope, key]); }
export function inConversation(message: Incoming, device: string, destination: string, channel: number) {
  return message.device === device && message.channel === channel && (destination === 'broadcast'
    ? !message.destination || message.destination === 'broadcast'
    : canonicalNode(message.origin) === canonicalNode(destination) && !!message.destination && message.destination !== 'broadcast');
}
/** Presentation metadata only. Never writes transport state or emits device commands. */
export class MessageState {
  #records = new Map<string, Flags>();
  #hidden = new Set<string>();
  #store: Store;
  #writable: () => boolean;
  #initial = true;
  constructor(store: Store, writable: () => boolean = () => true) {
    this.#store = store; this.#writable = writable;
    const raw = store.getItem(MESSAGE_UI_KEY); if (!raw) return;
    if (raw.length > 2097152) throw Error('Message UI history exceeds its limit.');
    const value = JSON.parse(raw);
    if (value?.version !== 1 || !Array.isArray(value.records) || value.records.length > 4096 || !Array.isArray(value.hidden) || value.hidden.length > 1024) throw Error('Invalid message UI history.');
    for (const row of value.records) {
      if (!Array.isArray(row) || row.length !== 3 || typeof row[0] !== 'string' || row[0].length > 512 || typeof row[1] !== 'boolean' || typeof row[2] !== 'boolean' || this.#records.has(row[0])) throw Error('Invalid message UI entry.');
      this.#records.set(row[0], { read: row[1], deleted: row[2] });
    }
    for (const key of value.hidden) { if (typeof key !== 'string' || key.length > 512 || this.#hidden.has(key)) throw Error('Invalid hidden conversation.'); this.#hidden.add(key); }
    this.#initial = false;
  }
  #commit(records: Map<string, Flags>, hidden = this.#hidden) {
    if (!this.#writable()) throw Error('This tab does not own message history. Close the other portal tab and reload.');
    if (records.size > 4096 || hidden.size > 1024) throw Error('Local message management is full. Export history before clearing browser storage.');
    const raw = JSON.stringify({ version: 1, records: [...records].map(([key, flags]) => [key, flags.read, flags.deleted]), hidden: [...hidden] });
    if (raw.length > 2097152) throw Error('Message UI history exceeds its limit.');
    this.#store.setItem(MESSAGE_UI_KEY, raw); // Publish only after storage succeeds.
    this.#records = records; this.#hidden = hidden;
  }
  /** Only the first install baselines existing history as read; later reloads retain unread state. */
  observe(sources: readonly { source: string; messages: readonly Incoming[] }[], active?: { source: string; device: string; destination: string; channel: number }) {
    const next = new Map(this.#records); let changed = false;
    for (const { source, messages } of sources) for (const message of messages) {
      const key = receivedKey(source, message), prior = next.get(key);
      const read = this.#initial || !!(active && active.source === source && inConversation(message, active.device, active.destination, active.channel));
      if (!prior) { next.set(key, { read, deleted: false }); changed = true; }
      else if (read && !prior.read && !prior.deleted) { next.set(key, { ...prior, read: true }); changed = true; }
    }
    if (changed || this.#initial) this.#commit(next);
    this.#initial = false;
  }
  deleted(key: string) { return !!this.#records.get(key)?.deleted; }
  unread(source: string, messages: readonly Incoming[]) {
    const seen = new Set<string>();
    return messages.filter(m => { const key = receivedKey(source, m), f = this.#records.get(key); if (!f || f.read || f.deleted || seen.has(key)) return false; seen.add(key); return true; });
  }
  remove(keys: readonly string[], conversation?: { scope: string; key: string }) {
    const next = new Map(this.#records), hidden = new Set(this.#hidden);
    for (const key of keys) next.set(key, { read: true, deleted: true });
    if (conversation) hidden.add(threadKey(conversation.scope, conversation.key));
    this.#commit(next, hidden);
  }
  hidden(scope: string, key: string) { return this.#hidden.has(threadKey(scope, key)); }
  reopen(scope: string, key: string) { const id = threadKey(scope, key); if (!this.#hidden.has(id)) return; const hidden = new Set(this.#hidden); hidden.delete(id); this.#commit(new Map(this.#records), hidden); }
  markRead(source: string, messages: readonly Incoming[]) {
    const next = new Map(this.#records); let changed = false;
    for (const m of messages) { const key = receivedKey(source, m), prior = next.get(key); if (!prior?.read) { next.set(key, { read: true, deleted: prior?.deleted ?? false }); changed = true; } }
    if (changed) this.#commit(next);
  }
}
