import * as recovery from './recovery-data.ts';
import { messageChunks } from './messaging.ts';
import type { Message } from '../protocol/messages.ts';
import { isEncryptedPayload } from '../protocol/encrypted-message.ts';
type Query = Omit<Extract<Message, { type: 'inboxQuery' }>, 'link'>;
type Read = Omit<Extract<Message, { type: 'inboxRead' }>, 'link'>;
type Reply = Extract<Message, { type: 'inboxHead' | 'inboxItem' | 'inboxMissing' }>;
type Context = Readonly<{ device: string; boot: string; session: number }>;
export type ReceivedMessage = Readonly<{ device: string; boot: string; sequence: number; origin: string; destination?: string; messageId: string; channel: number; text: string; payloadHex?: string }>;
/** Separate inbox sequence; never shares configuration event counters or executes mutations. */
export class InboxReader {
  #history: ReceivedMessage[] = [];
  get history(): readonly ReceivedMessage[] { return [...this.#history]; }
  /** Local history only; keep stream cursors and partial reads unchanged. */
  forget(device: string, origin: string, messageId: string) {
    const previous = this.#history.length;
    this.#history = this.#history.filter(m => m.device !== device || m.origin !== origin || m.messageId !== messageId);
    return this.#history.length !== previous;
  }
  gap = false; error: string | undefined;
  #context: Context | undefined;
  #cursor = 0; #latest = 0; #request = 0; #next = 0; #now = 0;
  #pending: { packet: Query | Read; deadline: number; attempts: number } | undefined;
  #partial: { sequence: number; origin: string; destination?: string; messageId: string; channel: number; count: number; part: number; data: string } | undefined;
  restoreHistory(value: unknown) {
    if (this.#history.length || this.#context) throw new Error('restore requires a fresh inbox reader');
    const history: ReceivedMessage[] = [];
    for (const raw of recovery.list(value)) {
      const item = recovery.object(raw); const channel = recovery.u32(item.channel);
      const payloadHex = item.payloadHex === undefined ? undefined : recovery.string(item.payloadHex);
      let text = '';
      if (payloadHex) {
        if (!/^(?:[0-9a-f]{2})+$/u.test(payloadHex) || !isEncryptedPayload(Uint8Array.from(payloadHex.match(/../g)!, byte => Number.parseInt(byte, 16)), channel)) throw new Error('invalid saved encrypted inbox payload');
      } else { text = recovery.string(item.text); messageChunks(text); }
      const entry: ReceivedMessage = Object.freeze({ device: recovery.id(item.device), boot: recovery.id(item.boot),
        origin: recovery.id(item.origin), ...(item.destination === undefined ? {} : { destination: recovery.id(item.destination) }), messageId: recovery.id(item.messageId), sequence: recovery.u32(item.sequence), channel, text, ...(payloadHex ? { payloadHex } : {}) });
      if (!entry.sequence || entry.channel > 7 || history.some(previous => previous.device === entry.device && previous.origin === entry.origin && previous.messageId === entry.messageId)) throw new Error('invalid recovery inbox history');
      history.push(entry);
    }
    this.#history = history;
  }
  tick(now: number, context?: Context): Query | Read | undefined {
    this.#time(now);
    if (!context) { this.#pending = undefined; this.#partial = undefined; this.#next = now; return; }
    if (!this.#context || context.session !== this.#context.session) {
      if (!this.#context || context.device !== this.#context.device || context.boot !== this.#context.boot) { this.#cursor = this.#latest = 0; this.gap = false; }
      this.#context = { ...context }; this.#pending = undefined; this.#partial = undefined; this.#next = now; this.error = undefined;
    }
    if (context.device !== this.#context.device || context.boot !== this.#context.boot) return;
    if (this.error) return;
    if (this.#pending) {
      if (now < this.#pending.deadline) return;
      if (this.#pending.attempts >= 3) { this.error = 'inbox recovery timed out; reconnect to retry'; this.#pending = undefined; return; }
      this.#pending.attempts++; this.#pending.deadline = now + 1000; return this.#pending.packet;
    }
    if (now < this.#next) return;
    if (this.#request >= 0xffffffff) { this.error = 'inbox request sequence exhausted'; return; }
    const request = ++this.#request;
    const packet: Query | Read = this.#cursor < this.#latest ? { type: 'inboxRead', boot: context.boot, request,
      sequence: this.#cursor + 1, part: this.#partial?.part ?? 0 } : { type: 'inboxQuery', boot: context.boot, request };
    this.#pending = { packet, deadline: now + 1000, attempts: 1 }; return packet;
  }
  receive(session: number, reply: Reply, now: number) {
    this.#time(now); const pending = this.#pending;
    if (!pending || !this.#context || session !== this.#context.session || reply.boot !== this.#context.boot || reply.request !== pending.packet.request || this.error) return;
    if (reply.type === 'inboxHead') {
      if (pending.packet.type !== 'inboxQuery' || reply.latest - reply.oldest + 1 > 32 || (reply.latest === 0 ? reply.oldest !== 0 : reply.oldest < 1 || reply.oldest > reply.latest)) return;
      if (reply.latest < this.#cursor) { this.error = 'device inbox counter moved backwards'; return; }
      if (reply.oldest && this.#cursor + 1 < reply.oldest) { this.gap = true; this.#cursor = reply.oldest - 1; }
      this.#latest = reply.latest; this.#pending = undefined; this.#next = now + (this.#cursor < this.#latest ? 0 : 2000); return;
    }
    if (pending.packet.type !== 'inboxRead' || reply.sequence !== pending.packet.sequence) return;
    if (reply.type === 'inboxMissing') {
      this.#pending = undefined; this.#partial = undefined; this.#latest = this.#cursor; this.#next = now + 500; this.gap = true; return;
    }
    if (reply.part !== pending.packet.part || !reply.count || reply.count > 32 || reply.part >= reply.count ||
        reply.channel > 7 || (reply.part + 1 < reply.count && reply.data.length !== 64)) return;
    if (!reply.part) this.#partial = { sequence: reply.sequence, origin: reply.origin, ...(reply.destination === undefined ? {} : { destination: reply.destination }), messageId: reply.messageId, channel: reply.channel, count: reply.count, part: 0, data: '' };
    const part = this.#partial;
    if (!part || part.sequence !== reply.sequence || part.origin !== reply.origin || part.messageId !== reply.messageId ||
        part.channel !== reply.channel || part.destination !== reply.destination || part.count !== reply.count || part.part !== reply.part) return;
    if (part.data.length + reply.data.length > 2048) { this.error = 'inbox message exceeds limit'; return; }
    part.data += reply.data; part.part++;
    if (part.part === part.count) {
      try {
        const bytes = Uint8Array.from(part.data.match(/../g) ?? [], hex => parseInt(hex, 16));
        const isEncrypted = isEncryptedPayload(bytes, part.channel);
        const text = isEncrypted ? undefined : new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
        if (!bytes.length || (text !== undefined && /[\u0000-\u0008\u000b-\u001f\u007f]/u.test(text))) throw new Error();
        if (!isEncrypted && text !== undefined) messageChunks(text);
        const previous = this.#history.find(item => item.device === this.#context!.device && item.origin === part.origin && item.messageId === part.messageId);
        const payloadHex = isEncrypted ? Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('') : undefined;
        if (previous && (previous.channel !== part.channel || previous.destination !== part.destination || previous.text !== (text ?? '') || previous.payloadHex !== payloadHex)) { this.error = 'conflicting inbox identity'; return; }
        if (!previous) {
          if (this.#history.length === 32) this.#history.shift();
          this.#history.push(Object.freeze({ device: this.#context.device, boot: this.#context.boot, sequence: part.sequence,
            origin: part.origin, ...(part.destination === undefined ? {} : { destination: part.destination }), messageId: part.messageId, channel: part.channel,
            text: text ?? '', ...(payloadHex ? { payloadHex } : {}) }));
        }
      } catch { this.error = 'invalid received UTF-8 message'; return; }
      this.#cursor = part.sequence; this.#partial = undefined;
    }
    this.#pending = undefined; this.#next = now + (this.#cursor < this.#latest ? 0 : 2000);
  }
  #time(now: number) { if (!Number.isSafeInteger(now) || now < this.#now) throw new Error('invalid monotonic clock'); this.#now = now; }
}
