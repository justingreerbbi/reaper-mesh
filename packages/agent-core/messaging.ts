import { Synchronizer } from './sync.ts';
import type { Message } from '../protocol/messages.ts';
import * as recovery from './recovery-data.ts';
import { encodeMessage, validateField } from '../protocol/messages.ts';
import { isEncryptedPayload, isMessagePayload } from '../protocol/encrypted-message.ts';
type Status = Extract<Message, { type: 'messageStatus' }>;
export type Upload = Omit<Extract<Message, { type: 'submit' }>, 'link'>;
export type MessageQuery = Omit<Extract<Message, { type: 'messageQuery' }>, 'link'>;
type Entry = {
  id: string;
  boot: string;
  device: string;
  session: number;
  text: string;
  destination: string;
  channel: number;
  payloadHex?: string;
  chunks: readonly string[];
  part: number;
  attempts: number;
  deadline: number;
  pollAt: number;
  expiresAt: number;
  state: Status['state'];
  messageId?: string;
  reason?: string;
};
export const MAX_MESSAGE_HISTORY = 160;
const MAX_UNRESOLVED_MESSAGES = 32;
function terminal(entry: Pick<Entry, 'state' | 'destination'>) {
  return (
    ['acknowledged', 'failed', 'rejected'].includes(entry.state) ||
    (entry.state === 'transmitted' && entry.destination === 'broadcast')
  );
}
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
export function messageChunks(text: string): readonly string[] {
  const bytes = encoder.encode(text);
  if (
    !bytes.length ||
    bytes.length > 1024 ||
    decoder.decode(bytes) !== text ||
    /[\u0000-\u0008\u000b-\u001f\u007f]/u.test(text)
  )
    throw new Error('message must contain 1–1024 UTF-8 bytes of text');
  return payloadChunksUnchecked(bytes);
}
function payloadChunksUnchecked(bytes: Uint8Array): readonly string[] {
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += 32)
    chunks.push(
      Array.from(bytes.subarray(i, i + 32), byte => byte.toString(16).padStart(2, '0')).join(''),
    );
  return chunks;
}
function fromHex(value: string) {
  if (value.length % 2 || !/^(?:[0-9a-f]{2})+$/u.test(value))
    throw new Error('invalid saved encrypted payload');
  return Uint8Array.from(value.match(/../g)!, byte => Number.parseInt(byte, 16));
}
/** Bounded message upload, same-link retries, and read-only recovery. Never replays on reconnect. */
export class Messaging {
  #entries = new Map<string, Entry>();
  #counter = 0;
  #now = 0;
  #nextPoll = 0;
  readonly sync: Synchronizer;
  readonly incarnation: string;
  constructor(sync: Synchronizer, incarnation: string) {
    this.sync = sync;
    this.incarnation = incarnation;
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(incarnation)) throw new Error('invalid message owner');
  }
  get history() {
    return [...this.#entries.values()].map(({ chunks: _, ...entry }) =>
      Object.freeze({ ...entry }),
    );
  }
  get sendBlockReason(): string | undefined {
    if (this.#counter >= 0xffffffff) return 'Message request sequence exhausted';
    if ([...this.#entries.values()].some(entry => entry.state === 'receiving'))
      return 'Uploading message…';
    if (
      [...this.#entries.values()].filter(entry => !terminal(entry)).length >=
      MAX_UNRESOLVED_MESSAGES
    )
      return '32 messages still have unresolved delivery · check delivery or explicitly delete an unresolved sent message';
    return undefined;
  }
  exportState() {
    return {
      counter: this.#counter,
      entries: this.history.map(
        ({
          session: _,
          part: _part,
          deadline: _deadline,
          pollAt: _poll,
          expiresAt: _expires,
          ...item
        }) => item,
      ),
    };
  }
  restoreState(value: unknown) {
    if (this.sync.state !== 'disconnected' || this.#counter || this.#entries.size)
      throw new Error('restore requires a fresh disconnected message manager');
    const state = recovery.object(value),
      counter = recovery.u32(state.counter);
    const entries = new Map<string, Entry>();
    for (const raw of recovery.list(state.entries, MAX_MESSAGE_HISTORY)) {
      const item = recovery.object(raw);
      const identity = recovery.sequence(item.id, this.incarnation);
      const channel = recovery.u32(item.channel);
      const payloadHex =
        item.payloadHex === undefined ? undefined : recovery.string(item.payloadHex);
      const payload = payloadHex === undefined ? undefined : fromHex(payloadHex);
      const text = payload ? '' : recovery.string(item.text);
      const chunks = payload
        ? isEncryptedPayload(payload, channel)
          ? payloadChunksUnchecked(payload)
          : (() => {
              throw new Error('invalid saved encrypted payload');
            })()
        : messageChunks(text);
      const boot = recovery.id(item.boot);
      const destination = recovery.id(item.destination),
        device = recovery.id(item.device);
      const status = recovery.string(item.state);
      validateField('messageState', status);
      if (channel > 7 || identity.sequence > counter || entries.has(identity.id))
        throw new Error('invalid recovery message sequence/channel');
      const messageId = item.messageId !== undefined ? recovery.id(item.messageId) : undefined;
      const reason = item.reason !== undefined ? recovery.id(item.reason) : undefined;
      if (status === 'acknowledged' && !messageId)
        throw new Error('acknowledged recovery message lacks identity');
      entries.set(identity.id, {
        id: identity.id,
        boot,
        device,
        destination,
        channel,
        text,
        ...(payloadHex ? { payloadHex } : {}),
        chunks,
        session: this.sync.session,
        part: 0,
        attempts: 1,
        deadline: 0,
        pollAt: 0,
        expiresAt: 70000,
        state:
          status === 'receiving' ||
          status === 'queued' ||
          (status === 'transmitted' && destination !== 'broadcast')
            ? 'unknown'
            : (status as Entry['state']),
        messageId,
        reason,
      });
    }
    this.#counter = counter;
    this.#entries = entries;
  }
  send(text: string, destination: string, channel: number, device: string, now: number): Upload {
    return this.#send(text, undefined, destination, channel, device, now);
  }
  sendPayload(
    payload: Uint8Array,
    destination: string,
    channel: number,
    device: string,
    now: number,
  ): Upload {
    if (!isEncryptedPayload(payload, channel))
      throw new Error('encrypted message envelope is invalid or too large');
    const hex = Array.from(payload, value => value.toString(16).padStart(2, '0')).join('');
    return this.#send('', hex, destination, channel, device, now);
  }
  #send(
    text: string,
    payloadHex: string | undefined,
    destination: string,
    channel: number,
    device: string,
    now: number,
  ): Upload {
    this.#time(now);
    const context = this.sync.mutationContext();
    const payload = payloadHex === undefined ? undefined : fromHex(payloadHex);
    const chunks = payload ? payloadChunksUnchecked(payload) : messageChunks(text);
    if (this.sendBlockReason) throw new Error(this.sendBlockReason);
    const entry: Entry = {
      id: `${this.incarnation}:${this.#counter + 1}`,
      boot: context.boot,
      session: context.session,
      device,
      text,
      destination,
      channel,
      ...(payloadHex ? { payloadHex } : {}),
      chunks,
      part: 0,
      attempts: 1,
      deadline: now + 1000,
      pollAt: now + 2000,
      expiresAt: now + 70000,
      state: 'receiving',
    };
    const packet = this.#packet(entry);
    encodeMessage({ ...packet, link: 'validate' }); // Validate before retaining IDs/history.
    // Keep recovery ambiguity; only completed history rolls off, after input validation.
    while (this.#entries.size >= MAX_MESSAGE_HISTORY) {
      const oldest = [...this.#entries.values()].find(terminal);
      if (!oldest) throw new Error('Unresolved message recovery history is full');
      this.#entries.delete(oldest.id);
    }
    this.#counter++;
    this.#entries.set(entry.id, entry);
    return packet;
  }
  receive(session: number, status: Status, now: number): Upload | undefined {
    this.#time(now);
    const entry = this.#entries.get(status.id);
    if (
      !entry ||
      session !== this.sync.session ||
      entry.session !== session ||
      status.boot !== entry.boot ||
      status.boot !== this.sync.boot ||
      ['acknowledged', 'failed', 'rejected'].includes(entry.state) ||
      (entry.state === 'transmitted' && entry.destination === 'broadcast')
    )
      return;
    if (status.messageId && entry.messageId && status.messageId !== entry.messageId) return;
    if (status.state === 'receiving') {
      if (entry.state !== 'receiving') {
        if (entry.state === 'unknown') entry.reason = 'partial-upload-not-resumed';
        return;
      } // Never resume a partial upload on a new link.
      if (!(status.received & (1 << entry.part))) return;
      if (entry.part + 1 === entry.chunks.length) return; // Final acceptance must say queued/rejected.
      entry.part++;
      entry.attempts = 1;
      entry.deadline = now + 1000;
      return this.#packet(entry);
    }
    if (['queued', 'transmitted', 'acknowledged'].includes(status.state)) {
      const mask = entry.chunks.length === 32 ? 0xffffffff : 2 ** entry.chunks.length - 1;
      if (status.received !== mask || !status.messageId) return;
    }
    if (entry.state === 'transmitted' && status.state === 'queued') return;
    entry.state = status.state;
    entry.messageId = status.messageId ?? entry.messageId;
    entry.reason = status.reason;
    entry.pollAt = now + 2000;
  }
  tick(now: number, device?: string): (Upload | MessageQuery)[] {
    this.#time(now);
    const output: (Upload | MessageQuery)[] = [];
    for (const entry of this.#entries.values()) {
      if (
        !['receiving', 'queued', 'transmitted'].includes(entry.state) ||
        (entry.state === 'transmitted' && entry.destination === 'broadcast')
      )
        continue;
      if (now >= entry.expiresAt) {
        entry.state = 'unknown';
        continue;
      }
      if (
        entry.session !== this.sync.session ||
        entry.boot !== this.sync.boot ||
        ['disconnected', 'incompatible'].includes(this.sync.state) ||
        device !== entry.device
      ) {
        entry.state = 'unknown';
        continue;
      }
      if (this.sync.state !== 'ready') {
        if (entry.state === 'receiving') entry.state = 'unknown';
        continue;
      }
      if (entry.state === 'receiving' && now >= entry.deadline) {
        if (entry.attempts >= 3) entry.state = 'unknown';
        else {
          entry.attempts++;
          entry.deadline = now + 1000;
          output.push(this.#packet(entry));
        }
      } else if (entry.state !== 'receiving' && now >= entry.pollAt && now >= this.#nextPoll) {
        this.#nextPoll = now + 500;
        entry.pollAt = now + 2000;
        output.push({ type: 'messageQuery', boot: entry.boot, id: entry.id });
      }
    }
    return output;
  }
  recover(id: string, device: string, now: number): MessageQuery | undefined {
    this.#time(now);
    const context = this.sync.mutationContext();
    const entry = this.#get(id);
    if (device !== entry.device) throw new Error('message belongs to another device');
    if (context.boot !== entry.boot) return;
    entry.session = context.session;
    entry.expiresAt = now + 70000;
    return { type: 'messageQuery', boot: entry.boot, id };
  }
  forget(id: string) {
    if (this.#get(id).state === 'receiving') throw new Error('cannot forget a pending upload');
    this.#entries.delete(id);
  }
  #packet(entry: Entry): Upload {
    return {
      type: 'submit',
      boot: entry.boot,
      id: entry.id,
      channel: entry.channel,
      destination: entry.destination,
      part: entry.part,
      count: entry.chunks.length,
      data: entry.chunks[entry.part],
    };
  }
  #get(id: string) {
    const entry = this.#entries.get(id);
    if (!entry) throw new Error('unknown message ID');
    return entry;
  }
  #time(now: number) {
    if (!Number.isSafeInteger(now) || now < this.#now) throw new Error('invalid monotonic clock');
    this.#now = now;
  }
}
