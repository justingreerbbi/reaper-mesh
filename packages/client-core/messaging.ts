import { Synchronizer } from './sync.ts';
import type { Message } from '../protocol/messages.ts';
import { encodeMessage } from '../protocol/messages.ts';
type Status = Extract<Message, { type: 'messageStatus' }>;
export type Upload = Omit<Extract<Message, { type: 'submit' }>, 'link'>;
export type MessageQuery = Omit<Extract<Message, { type: 'messageQuery' }>, 'link'>;
type Entry = {
  id: string; boot: string; device: string; session: number; text: string; destination: string; channel: number;
  chunks: readonly string[]; part: number; attempts: number; deadline: number; pollAt: number; expiresAt: number;
  state: Status['state']; messageId?: string; reason?: string;
};
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
/** Bounded message upload, same-link retries, and read-only recovery. Never replays on reconnect. */
export class Messaging {
  #entries = new Map<string, Entry>();
  #counter = 0; #now = 0; #nextPoll = 0;
  readonly sync: Synchronizer;
  readonly incarnation: string;
  constructor(sync: Synchronizer, incarnation: string) {
    this.sync = sync; this.incarnation = incarnation;
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(incarnation)) throw new Error('invalid message owner');
  }
  get history() { return [...this.#entries.values()].map(({ chunks: _, ...entry }) => Object.freeze({ ...entry })); }
  send(text: string, destination: string, channel: number, device: string, now: number): Upload {
    this.#time(now); const context = this.sync.mutationContext();
    const bytes = encoder.encode(text);
    if (!bytes.length || bytes.length > 1024 || decoder.decode(bytes) !== text || /[\u0000-\u0008\u000b-\u001f\u007f]/u.test(text)) throw new Error('message must contain 1–1024 UTF-8 bytes of text');
    if (this.#entries.size >= 32 || this.#counter >= 0xffffffff) throw new Error('message history or sequence exhausted');
    if ([...this.#entries.values()].some(entry => entry.state === 'receiving')) throw new Error('message upload already pending');
    const chunks: string[] = [];
    for (let i = 0; i < bytes.length; i += 32) chunks.push(Array.from(bytes.subarray(i, i + 32), byte => byte.toString(16).padStart(2, '0')).join(''));
    const entry: Entry = { id: `${this.incarnation}:${this.#counter + 1}`, boot: context.boot, session: context.session,
      device, text, destination, channel, chunks, part: 0, attempts: 1, deadline: now + 1000,
      pollAt: now + 2000, expiresAt: now + 70000, state: 'receiving' };
    const packet = this.#packet(entry);
    encodeMessage({ ...packet, link: 'validate' }); // Validate before retaining IDs/history.
    this.#counter++; this.#entries.set(entry.id, entry); return packet;
  }
  receive(session: number, status: Status, now: number): Upload | undefined {
    this.#time(now); const entry = this.#entries.get(status.id);
    if (!entry || session !== this.sync.session || entry.session !== session || status.boot !== entry.boot ||
        status.boot !== this.sync.boot || ['acknowledged', 'failed', 'rejected'].includes(entry.state)) return;
    if (status.messageId && entry.messageId && status.messageId !== entry.messageId) return;
    if (status.state === 'receiving') {
      if (entry.state !== 'receiving') return; // Never resume a partial upload on a new link.
      if (!(status.received & (1 << entry.part))) return;
      if (entry.part + 1 === entry.chunks.length) return; // Final acceptance must say queued/rejected.
      entry.part++; entry.attempts = 1; entry.deadline = now + 1000;
      return this.#packet(entry);
    }
    if (['queued', 'transmitted', 'acknowledged'].includes(status.state)) {
      const mask = entry.chunks.length === 32 ? 0xffffffff : (2 ** entry.chunks.length - 1);
      if (status.received !== mask || !status.messageId) return;
    }
    if (entry.state === 'transmitted' && status.state === 'queued') return;
    entry.state = status.state; entry.messageId = status.messageId ?? entry.messageId; entry.reason = status.reason;
    entry.pollAt = now + 2000;
  }
  tick(now: number, device?: string): (Upload | MessageQuery)[] {
    this.#time(now); const output: (Upload | MessageQuery)[] = [];
    for (const entry of this.#entries.values()) {
      if (!['receiving', 'queued', 'transmitted'].includes(entry.state)) continue;
      if (now >= entry.expiresAt) { entry.state = 'unknown'; continue; }
      if (entry.session !== this.sync.session || entry.boot !== this.sync.boot || this.sync.state !== 'ready' || device !== entry.device) {
        entry.state = 'unknown'; continue;
      }
      if (entry.state === 'receiving' && now >= entry.deadline) {
        if (entry.attempts >= 3) entry.state = 'unknown';
        else { entry.attempts++; entry.deadline = now + 1000; output.push(this.#packet(entry)); }
      } else if (entry.state !== 'receiving' && now >= entry.pollAt && now >= this.#nextPoll) {
        this.#nextPoll = now + 500; entry.pollAt = now + 2000;
        output.push({ type: 'messageQuery', boot: entry.boot, id: entry.id });
      }
    }
    return output;
  }
  recover(id: string, device: string, now: number): MessageQuery | undefined {
    this.#time(now); const context = this.sync.mutationContext(); const entry = this.#get(id);
    if (device !== entry.device) throw new Error('message belongs to another device');
    if (context.boot !== entry.boot) return;
    entry.session = context.session;
    return { type: 'messageQuery', boot: entry.boot, id };
  }
  forget(id: string) {
    if (this.#get(id).state === 'receiving') throw new Error('cannot forget a pending upload');
    this.#entries.delete(id);
  }
  #packet(entry: Entry): Upload {
    return { type: 'submit', boot: entry.boot, id: entry.id, channel: entry.channel,
      destination: entry.destination, part: entry.part, count: entry.chunks.length, data: entry.chunks[entry.part] };
  }
  #get(id: string) { const entry = this.#entries.get(id); if (!entry) throw new Error('unknown message ID'); return entry; }
  #time(now: number) { if (!Number.isSafeInteger(now) || now < this.#now) throw new Error('invalid monotonic clock'); this.#now = now; }
}
