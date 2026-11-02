import { validCoordinates, type PositionReport } from '../protocol/position-config.ts';
import type { Message } from '../protocol/messages.ts';
import * as recovery from './recovery-data.ts';
type Context = { device: string; boot: string; session: number };
type Status = Extract<Message, { type: 'discoveryStatus' }>;
type Reply = Extract<Message, { type: 'nodeReply' }>;
type Discover = Omit<Extract<Message, { type: 'discover' }>, 'link'>;
type Packet = Discover | Omit<Extract<Message, { type: 'nodeQuery' }>, 'link'>;
export type KnownNode = Readonly<{ node: string; peerBoot: string; peerSequence: number; name: string; position?: PositionReport; ageMs: number; receivedAt: number }>;
type Attempt = { id: string; device: string; boot: string; state: string; replies: number; sequence: number };
/** Separate node snapshots/request namespace. Never retries a discovery mutation. */
export class Discovery {
  readonly incarnation: string;
  #displayDevice: string | undefined;
  #counter = 0; #context: Context | undefined; #request = 0; #generation = 0; #cursor = 0; #total = 0;
  #partial: KnownNode[] = []; #nodes: readonly KnownNode[] = [];
  #pending: { packet: Packet; deadline: number; attempts: number } | undefined;
  #next = 0; #pollAt = 0; #until = 0;
  last: Attempt | undefined; error: string | undefined;
  constructor(owner: string) { this.incarnation = owner; }
  get nodes() { return this.#nodes; }
  exportState() { return { counter: this.#counter, last: this.last }; }
  restoreState(value: unknown) {
    const state = recovery.object(value); this.#counter = recovery.u32(state.counter);
    if (state.last !== undefined) {
      const item = recovery.object(state.last), id = recovery.sequence(item.id, this.incarnation);
      if (id.sequence > this.#counter) throw new Error('discovery counter regressed');
      const status = recovery.id(item.state);
      if (!['collecting', 'complete', 'failed', 'unknown', 'blocked', 'cooldown', 'busy', 'rejected', 'owner-capacity'].includes(status) || recovery.u32(item.replies) > 32) throw new Error('invalid discovery recovery outcome');
      this.last = { id: id.id, device: recovery.id(item.device), boot: recovery.id(item.boot), state: status === 'collecting' ? 'unknown' : status,
        replies: recovery.u32(item.replies), sequence: recovery.u32(item.sequence) };
    }
  }
  start(context: Context, now: number): Discover {
    if (this.last?.state === 'collecting') throw new Error('discovery already collecting');
    if (this.#counter === 0xffffffff) throw new Error('discovery request counter exhausted');
    this.last = { id: `${this.incarnation}:${++this.#counter}`, device: context.device, boot: context.boot, state: 'collecting', replies: 0, sequence: 0 };
    this.#pollAt = now + 2000; this.#until = now + 30000;
    return { type: 'discover', boot: context.boot, id: this.last.id, action: 1 };
  }
  recover(context: Context, now: number): Discover | undefined {
    const entry = this.last; if (!entry) throw new Error('no discovery request');
    if (entry.device !== context.device) throw new Error('discovery belongs to another device');
    if (entry.boot !== context.boot) return;
    this.#pollAt = now + 2000; this.#until = now + 30000;
    return { type: 'discover', boot: context.boot, id: entry.id, action: 0 };
  }
  tick(now: number, context?: Context): Packet[] {
    const packets: Packet[] = [];
    if (!context || context.session !== this.#context?.session || context.boot !== this.#context?.boot || context.device !== this.#context?.device) {
      this.#pending = undefined; this.#partial = []; this.#generation = this.#cursor = 0; this.#next = now;
      if (!context || (this.#context && (context.boot !== this.#context.boot || context.device !== this.#context.device))) {
        if (this.last?.state === 'collecting') this.last.state = 'unknown';
      }
      if (context && context.device !== this.#displayDevice) { this.#nodes = []; this.#displayDevice = context.device; }
      this.#context = context; this.error = undefined;
    }
    if (!context) return packets;
    if (this.last?.state === 'collecting') {
      if (now >= this.#until) this.last.state = 'unknown';
      else if (now >= this.#pollAt) { this.#pollAt = now + 2000; if (this.last.boot === context.boot && this.last.device === context.device) packets.push({ type: 'discover', boot: context.boot, id: this.last.id, action: 0 }); }
    }
    if (this.error) return packets;
    if (this.#pending) {
      if (now >= this.#pending.deadline) {
        if (this.#pending.attempts >= 3) { this.error = 'node snapshot timed out; reconnect to retry'; this.#pending = undefined; }
        else { this.#pending.attempts++; this.#pending.deadline = now + 1000; packets.push(this.#pending.packet); }
      }
    } else if (now >= this.#next) {
      if (this.#request === 0xffffffff) { this.error = 'node request counter exhausted'; return packets; }
      const packet: Packet = { type: 'nodeQuery', boot: context.boot, request: ++this.#request, generation: this.#generation, cursor: this.#cursor };
      this.#pending = { packet, deadline: now + 1000, attempts: 1 }; packets.push(packet);
    }
    return packets;
  }
  receive(session: number, message: Status | Reply, now: number) {
    const context = this.#context; if (!context || context.session !== session || message.boot !== context.boot) return;
    if (message.type === 'discoveryStatus') {
      const entry = this.last;
      if (!entry || entry.device !== context.device || entry.boot !== message.boot || entry.id !== message.id || !['collecting', 'unknown'].includes(entry.state) ||
          !['collecting', 'complete', 'failed', 'unknown', 'blocked', 'cooldown', 'busy', 'rejected', 'owner-capacity'].includes(message.state) || message.replies > 32 ||
          (entry.sequence && message.sequence && message.sequence !== entry.sequence)) return;
      Object.assign(entry, { state: message.state, replies: message.replies, sequence: message.sequence || entry.sequence }); return;
    }
    const pending = this.#pending?.packet;
    if (!pending || pending.type !== 'nodeQuery' || pending.request !== message.request || message.total > 32 || message.cursor !== pending.cursor) return;
    if (message.state === 'changed') { this.#generation = this.#cursor = 0; this.#partial = []; this.#pending = undefined; this.#next = now + 250; return; }
    if (message.state === 'head' && !pending.generation && !pending.cursor) {
      if (message.total && !message.generation) return;
      this.#total = message.total; this.#generation = message.generation; this.#cursor = 0; this.#partial = [];
    } else if (message.state === 'item' && message.generation === this.#generation && message.total === this.#total &&
        message.node !== undefined && message.peerBoot !== undefined && message.peerSequence !== undefined && message.name !== undefined && message.ageMs !== undefined) {
      if (!/^node-[0-9a-f]{16}$/.test(message.node) || ['node-0000000000000000', 'node-ffffffffffffffff'].includes(message.node) || !/^[0-9a-f]{32}$/.test(message.peerBoot) || /^0+$/.test(message.peerBoot) || !message.peerSequence || this.#partial.some(node => node.node === message.node)) return;
      const fields = [message.positionSource, message.latitude, message.longitude, message.positionAgeMs];
      let position: PositionReport | undefined;
      if (fields.some(v => v !== undefined)) {
        if (message.positionSource !== 1 || message.latitude === undefined || message.longitude === undefined || message.positionAgeMs !== 0 || !validCoordinates(message.latitude, message.longitude)) return;
        position = Object.freeze({ source: 1, latitude: message.latitude, longitude: message.longitude, ageMs: 0 });
      }
      this.#partial.push(Object.freeze({ ...(position ? { position } : {}), node: message.node, peerBoot: message.peerBoot, peerSequence: message.peerSequence, name: message.name, ageMs: message.ageMs, receivedAt: now })); this.#cursor++;
    } else return;
    this.#pending = undefined; this.#next = now;
    if (this.#cursor === this.#total) { this.#nodes = Object.freeze([...this.#partial]); this.#generation = this.#cursor = 0; this.#next = now + 2000; }
  }
}
