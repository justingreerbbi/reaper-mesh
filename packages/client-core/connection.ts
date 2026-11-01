import { FrameDecoder, encodeFrame } from '../protocol/framing.ts';
import { decodeMessage, encodeMessage, type Message } from '../protocol/messages.ts';
import { Synchronizer, type Config } from './sync.ts';
import { radioFields, validRadio } from '../protocol/radio-config.ts';
import { Messaging } from './messaging.ts';
import { Commands, type ConfigCommand } from './commands.ts';
import { capabilities, writeBlockReason, type Capabilities } from '../protocol/capabilities.ts';

/** Caller-driven serial lifecycle; adapters deliver bytes and drain bounded writes. */
export class Connection {
  readonly sync = new Synchronizer();
  readonly commands: Commands;
  readonly messaging: Messaging;
  #commandDevices = new Map<string, string>();
  device: string | undefined;
  error: string | undefined;
  capabilities: Capabilities | undefined;
  get writeBlockReason() { return writeBlockReason(this.capabilities); }
  #decoder = new FrameDecoder();
  #outgoing: Uint8Array[] = [];
  #link = '';
  #usedLinks = new Set<string>();
  #now = 0;
  #deadline = 0;
  #nextPing = 0;
  #nextHello = 0;
  #hello: Uint8Array = new Uint8Array();
  #ping = 0;
  #awaitingPong = false;
  #request = 0;

  constructor(incarnation: string = crypto.randomUUID()) {
    this.commands = new Commands(this.sync, incarnation);
    this.messaging = new Messaging(this.sync, incarnation);
  }

  get messageBlockReason() {
    if (this.writeBlockReason) return this.writeBlockReason;
    const c = this.capabilities;
    return !c || !(c.features & 8) || c.messageVersion !== 1 || c.maxMessageBytes !== 1024 || !c.messageCapacity
      ? 'device does not support safe message upload' : undefined;
  }
  sendMessage(text: string, destination: string, channel: number, now: number) {
    this.#time(now); if (this.#expired(now)) throw new Error('connection timed out');
    if (this.messageBlockReason) throw new Error(this.messageBlockReason);
    const packet = this.messaging.send(text, destination, channel, this.device!, now);
    this.#send({ ...packet, link: this.#link }); return packet.id;
  }
  recoverMessage(id: string, now: number) {
    if (!this.capabilities || !(this.capabilities.features & 8) || this.capabilities.messageVersion !== 1) throw new Error('device does not support message queries');
    this.#time(now); if (this.#expired(now)) throw new Error('connection timed out');
    const query = this.messaging.recover(id, this.device!, now);
    if (query) this.#send({ ...query, link: this.#link }); return !!query;
  }

  get radioBlockReason() {
    if (this.writeBlockReason) return this.writeBlockReason;
    const c = this.capabilities;
    return !c || !(c.features & 16) || c.radioSchema !== 1 || c.maxChannels !== 8 ? 'device does not support radio configuration v1' : undefined;
  }

  configure(config: Config, now: number) {
    this.#time(now);
    if (this.#expired(now)) throw new Error('connection timed out');
    this.sync.mutationContext();
    const blocked = this.writeBlockReason;
    if (blocked) throw new Error(blocked);
    if (config.radio && (this.radioBlockReason || !validRadio(config.radio, config.region))) throw new Error(this.radioBlockReason || 'invalid radio/channel settings');
    const regionMask = { UNSET: 1, US: 2, EU: 4 }[config.region];
    if (!regionMask || !(this.capabilities!.regions & regionMask)) throw new Error('device does not support this region');
    if (new TextEncoder().encode(config.label).length > this.capabilities!.maxLabelBytes) {
      throw new Error('label exceeds device limit');
    }
    // Validate before retaining the command, including runtime callers without TS checks.
    encodeMessage({ type: 'configure', link: this.#link, boot: this.sync.boot!, id: 'validation:1',
      expectedRevision: this.sync.revision, region: config.region, label: config.label, ...radioFields(config.radio) } as Message);
    const command = this.commands.submit(config, now);
    this.#commandDevices.set(command.id, this.device!);
    this.#sendCommand(command);
    return command.id;
  }

  recover(id: string, now: number) {
    this.#time(now);
    if (this.#expired(now)) throw new Error('connection timed out');
    if (this.#commandDevices.get(id) !== this.device) throw new Error('command belongs to another device');
    if (!this.capabilities || !(this.capabilities.features & 2)) throw new Error('device does not support result queries');
    const query = this.commands.recover(id);
    if (query) this.#send({ type: 'query', link: this.#link, ...query });
    return !!query;
  }

  forget(id: string) {
    this.commands.forget(id);
    this.#commandDevices.delete(id);
  }

  open(link: string, now: number) {
    this.#time(now);
    // Bound remembered generations; adapters should create a new manager before exhaustion.
    if (this.#usedLinks.size >= 1024 || this.#usedLinks.has(link)) throw new Error('use a fresh link identity');
    const hello = encodeFrame(encodeMessage({ type: 'hello', link, minVersion: 1, maxVersion: 1,
      owner: this.commands.incarnation }));
    this.close();
    this.#usedLinks.add(link);
    this.#link = link;
    const session = this.sync.connect();
    this.error = undefined;
    this.device = undefined;
    this.capabilities = undefined;
    this.#request = 0;
    this.#ping = 0;
    this.#awaitingPong = false;
    this.#deadline = now + 5000;
    this.#nextHello = now + 500;
    this.#hello = hello;
    this.#outgoing.push(Uint8Array.of(0), hello);
    return session;
  }

  close(reason?: string) {
    this.sync.disconnect();
    this.commands.tick(this.#now);
    this.messaging.tick(this.#now); // Disconnect immediately makes pending outcomes uncertain.
    this.#decoder.reset();
    this.#outgoing = [];
    this.error = reason;
    this.device = undefined;
    this.capabilities = undefined;
  }

  receive(session: number, bytes: Uint8Array, now: number) {
    if (session !== this.sync.session || this.sync.state === 'disconnected') return;
    this.#time(now);
    if (this.#expired(now)) return;
    this.#decoder.feed(bytes, payload => {
      if (session !== this.sync.session) return;
      let message: Message;
      try { message = decodeMessage(payload); } catch { return; }
      if (message.link !== this.#link) return;
      this.#dispatch(message);
    });
  }

  tick(now: number) {
    this.#time(now);
    if (this.#expired(now)) return;
    if (this.sync.state === 'negotiating' && now >= this.#nextHello) {
      this.#nextHello = now + 500;
      // Retry only discovery: USB open may reset the board and lose the first hello.
      // Do not accumulate retries behind a stalled writer or extend the deadline.
      if (this.#outgoing.length === 0) {
        const frame = new Uint8Array(this.#hello.length + 1);
        frame.set(this.#hello, 1);
        this.#outgoing.push(frame);
      }
    }
    for (const retry of this.commands.tick(now)) this.#sendCommand(retry);
    for (const packet of this.messaging.tick(now, this.device)) this.#send({ ...packet, link: this.#link });
    if (this.sync.state !== 'ready') return;
    if (!this.#awaitingPong && now >= this.#nextPing) {
      this.#ping++;
      this.#awaitingPong = true;
      this.#deadline = now + 5000;
      this.#send({ type: 'ping', link: this.#link, request: this.#ping });
    }
  }

  drain() { const frames = this.#outgoing; this.#outgoing = []; return frames; }

  #dispatch(message: Message) {
    if (message.type === 'messageStatus') {
      const next = this.messaging.receive(this.sync.session, message, this.#now);
      if (next) this.#send({ ...next, link: this.#link });
      return;
    }
    if (message.type === 'error' && (this.sync.state === 'negotiating' || message.boot === this.sync.boot)) {
      this.close(message.code === 'storage-unavailable' ? 'device storage unavailable; recovery required' : `device error: ${message.code}`);
      return;
    }
    if (message.type === 'welcome' && this.sync.state === 'negotiating') {
      this.#outgoing = []; // Retire any unsent discovery retry before synchronization.
      this.device = message.device;
      this.capabilities = capabilities(message);
      const compatible = this.sync.hello(this.sync.session, message.boot, message.minVersion, message.maxVersion);
      if (!compatible) { this.#outgoing = []; return; }
      this.#deadline = this.#now + 5000;
    } else if (message.type === 'snapshot' || message.type === 'event') {
      if (message.boot !== this.sync.boot) return;
      const value = { ...message, session: this.sync.session,
        config: { region: message.region, label: message.label,
          ...(message.radioMode !== undefined && message.txPower !== undefined && message.relay !== undefined && message.channels !== undefined && message.preset === 'US915_LAB1' && message.relay <= 1 && message.txPower <= 10 ?
            { radio: { mode: message.radioMode, power: message.txPower, relay: message.relay === 1, channels: message.channels, preset: 'US915_LAB1' as const } } : {}) } };
      const wasReady = this.sync.state === 'ready';
      if (message.type === 'snapshot') this.sync.snapshot({ ...value, request: message.request });
      else this.sync.event(value);
      if (this.sync.state === 'ready' && !wasReady) {
        this.#awaitingPong = false;
        this.#nextPing = this.#now + 2000;
        this.#deadline = this.#now + 7000;
      } else if (wasReady && this.sync.state === 'synchronizing') {
        this.#deadline = this.#now + 5000;
        this.#awaitingPong = false;
      }
    } else if (message.type === 'result') {
      if (this.#commandDevices.get(message.id) !== this.device) return;
      const accepted = this.commands.receive(this.sync.session, message);
      // A receipt does not carry authoritative config. Reconcile even if its event was lost.
      const outcome = this.commands.status(message.id).outcome;
      if (accepted && this.sync.state === 'ready' && ['committed', 'conflict'].includes(outcome)) {
        this.sync.resynchronize();
        this.#deadline = this.#now + 5000;
        this.#awaitingPong = false;
      }
    } else if (message.type === 'pong' && this.sync.state === 'ready' &&
        this.#awaitingPong && message.request === this.#ping) {
      if (message.boot !== this.sync.boot) { this.close('device rebooted; reconnect required'); return; }
      this.#awaitingPong = false;
      this.#nextPing = this.#now + 2000;
      this.#deadline = this.#now + 7000;
    }
    if (this.sync.state === 'synchronizing' && this.sync.snapshotRequest !== this.#request) {
      this.commands.tick(this.#now);
      this.messaging.tick(this.#now, this.device);
      this.#request = this.sync.snapshotRequest;
      this.#send({ type: 'sync', link: this.#link, boot: this.sync.boot!, request: this.#request });
    }
  }

  #sendCommand(command: ConfigCommand) {
    this.#send({ type: 'configure', link: this.#link, boot: command.boot, id: command.id,
      expectedRevision: command.expectedRevision, region: command.config.region,
      label: command.config.label, ...radioFields(command.config.radio) } as Message);
  }

  #send(message: Message) {
    if (this.#outgoing.length >= 8) { this.close('outgoing queue full'); return; }
    this.#outgoing.push(encodeFrame(encodeMessage(message)));
  }

  #expired(now: number) {
    if (['negotiating', 'synchronizing', 'ready'].includes(this.sync.state) && now >= this.#deadline) {
      this.close('connection timed out');
      return true;
    }
    return false;
  }

  #time(now: number) {
    if (!Number.isSafeInteger(now) || now < this.#now) throw new Error('invalid monotonic clock');
    this.#now = now;
  }
}
