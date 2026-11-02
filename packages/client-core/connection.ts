import { positionFields, readPosition, validPosition } from '../protocol/position-config.ts';
import { Discovery } from './discovery.ts';
import { discoveryFields, validDiscovery } from '../protocol/discovery-config.ts';
import * as recovery from './recovery-data.ts';
import { FrameDecoder, encodeFrame } from '../protocol/framing.ts';
import { decodeMessage, encodeMessage, type Message } from '../protocol/messages.ts';
import { Synchronizer, type Config } from './sync.ts';
import { radioFields, validRadio } from '../protocol/radio-config.ts';
import { InboxReader } from './inbox.ts';
import { Messaging } from './messaging.ts';
import { Commands, type ConfigCommand } from './commands.ts';
import { capabilities, writeBlockReason, type Capabilities } from '../protocol/capabilities.ts';

/** Caller-driven serial lifecycle; adapters deliver bytes and drain bounded writes. */
export class Connection {
  readonly sync = new Synchronizer();
  readonly commands: Commands;
  readonly messaging: Messaging;
  readonly discovery: Discovery;
  readonly inbox = new InboxReader();
  radioInfo: Extract<Message, { type: 'radioStatus' }> | undefined;
  radioError: string | undefined;
  #radioRequest = 0; #radioPending = 0; #nextRadio = 0; #radioDeadline = 0; #radioTimeouts = 0;
  #commandDevices = new Map<string, string>();
  device: string | undefined;
  error: string | undefined;
  capabilities: Capabilities | undefined;
  recoveryError: string | undefined;
  #persist: ((state: ReturnType<Connection['exportJournal']>) => void) | undefined;
  #checkpointing = false;
  get writeBlockReason() { return this.recoveryError ?? writeBlockReason(this.capabilities); }
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
    this.discovery = new Discovery(incarnation);
    this.messaging = new Messaging(this.sync, incarnation);
  }

  exportJournal() {
    return { version: 1, incarnation: this.commands.incarnation, commands: this.commands.exportState(),
      commandDevices: this.commands.history.map(entry => ({ id: entry.command.id, device: this.#commandDevices.get(entry.command.id) })),
      discovery: this.discovery.exportState(), messages: this.messaging.exportState(), received: this.inbox.history };
  }
  static fromJournal(value: unknown) {
    const state = recovery.object(value);
    if (state.version !== 1) throw new Error('unsupported recovery journal');
    const connection = new Connection(recovery.id(state.incarnation));
    if (state.discovery !== undefined) connection.discovery.restoreState(state.discovery);
    connection.commands.restoreState(state.commands); connection.messaging.restoreState(state.messages); connection.inbox.restoreHistory(state.received);
    const mapping = new Map<string, string>();
    for (const raw of recovery.list(state.commandDevices)) {
      const item = recovery.object(raw); const id = recovery.sequence(item.id, connection.commands.incarnation).id;
      if (mapping.has(id) || !connection.commands.history.some(entry => entry.command.id === id)) throw new Error('invalid recovery device map');
      mapping.set(id, recovery.id(item.device));
    }
    if (mapping.size !== connection.commands.history.length) throw new Error('missing recovery device map');
    connection.#commandDevices = mapping; return connection;
  }
  persistence(save: (state: ReturnType<Connection['exportJournal']>) => void) { this.#persist = save; this.#checkpoint(); }
  retryRecoveryStorage() { this.#checkpoint(); return !this.recoveryError; }
  forgetReceived(device: string, origin: string, messageId: string) { if (this.inbox.forget(device, origin, messageId)) this.#checkpoint(); }
  forgetMessage(id: string) { this.messaging.forget(id); this.#checkpoint(); }
  #checkpoint(strict = false) {
    if (!this.#persist || this.#checkpointing) return;
    this.#checkpointing = true;
    try { this.#persist(this.exportJournal()); this.recoveryError = undefined; }
    catch (error) {
      this.recoveryError = `Recovery storage unavailable: ${error instanceof Error ? error.message : String(error)}`;
      if (strict) { this.close(this.recoveryError); throw new Error(this.recoveryError); }
    } finally { this.#checkpointing = false; }
  }

  get supportsPosition() { return this.supportsDiscovery && this.capabilities?.locationVersion === 1 && !!(this.capabilities.features & 256); }
  get supportsDiscovery() { return this.capabilities?.discoveryVersion === 1 && this.capabilities.nodeCapacity === 32 && !!(this.capabilities.features & 128); }
  discover(now: number) {
    this.#time(now); this.sync.mutationContext();
    if (this.#expired(now) || this.writeBlockReason || !this.supportsDiscovery) throw new Error(this.writeBlockReason ?? 'Discovery unavailable');
    const packet = this.discovery.start({ device: this.device!, boot: this.sync.boot!, session: this.sync.session }, now);
    this.#checkpoint(true); this.#send({ ...packet, link: this.#link }); return packet.id;
  }
  recoverDiscovery(now: number) {
    if (!this.supportsDiscovery) throw new Error('Discovery queries unavailable');
    this.#time(now); this.sync.mutationContext();
    if (this.#expired(now)) return false;
    const packet = this.discovery.recover({ device: this.device!, boot: this.sync.boot!, session: this.sync.session }, now);
    if (packet) this.#send({ ...packet, link: this.#link }); return !!packet;
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
    this.#checkpoint(true); this.#send({ ...packet, link: this.#link }); return packet.id;
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
    if (config.position && (!this.supportsPosition || !validPosition(config.position))) throw new Error('unsupported or invalid position settings');
    if (config.discovery && (!this.supportsDiscovery || !validDiscovery(config.discovery))) throw new Error('unsupported or invalid discovery settings');
    if (config.radio && (this.radioBlockReason || !validRadio(config.radio, config.region))) throw new Error(this.radioBlockReason || 'invalid radio/channel settings');
    const regionMask = { UNSET: 1, US: 2, EU: 4 }[config.region];
    if (!regionMask || !(this.capabilities!.regions & regionMask)) throw new Error('device does not support this region');
    if (new TextEncoder().encode(config.label).length > this.capabilities!.maxLabelBytes) {
      throw new Error('label exceeds device limit');
    }
    // Validate before retaining the command, including runtime callers without TS checks.
    encodeMessage({ type: 'configure', link: this.#link, boot: this.sync.boot!, id: 'validation:1',
      expectedRevision: this.sync.revision, region: config.region, label: config.label, ...positionFields(config.position), ...discoveryFields(config.discovery), ...radioFields(config.radio) } as Message);
    const command = this.commands.submit(config, now);
    this.#commandDevices.set(command.id, this.device!);
    this.#checkpoint(true); this.#sendCommand(command);
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
    this.#commandDevices.delete(id); this.#checkpoint();
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
    this.#radioRequest = this.#radioPending = this.#nextRadio = this.#radioTimeouts = 0;
    this.radioInfo = undefined; this.radioError = undefined;
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
    this.inbox.tick(this.#now); this.radioInfo = undefined; this.radioError = undefined;
    this.discovery.tick(this.#now);
    this.messaging.tick(this.#now); // Disconnect immediately makes pending outcomes uncertain.
    this.#decoder.reset();
    this.#outgoing = [];
    this.error = reason;
    this.device = undefined;
    this.capabilities = undefined; this.#checkpoint();
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
    this.#checkpoint();
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
    const inbox = this.capabilities?.inboxVersion === 1 && this.capabilities?.inboxCapacity && this.capabilities.features & 64;
    const request = this.inbox.tick(now, inbox && this.sync.state === 'ready' ? { device: this.device!, boot: this.sync.boot!, session: this.sync.session } : undefined);
    if (request) this.#send({ ...request, link: this.#link });
    const discovery = this.supportsDiscovery && this.sync.state === 'ready' ? { device: this.device!, boot: this.sync.boot!, session: this.sync.session } : undefined;
    for (const packet of this.discovery.tick(now, discovery)) this.#send({ ...packet, link: this.#link });
    this.#checkpoint();
    if (this.sync.state !== 'ready') return;
    if (this.capabilities && (this.capabilities.features & 32) && this.#radioTimeouts < 3) {
      if (this.#radioPending && now >= this.#radioDeadline) { this.#radioPending = 0; this.radioInfo = undefined; this.radioError = 'radio diagnostics timed out'; this.#radioTimeouts++; this.#nextRadio = now + 1000; }
      if (!this.#radioPending && this.#radioTimeouts < 3 && now >= this.#nextRadio) {
        if (this.#radioRequest === 0xffffffff) { this.#radioTimeouts = 3; this.radioError = 'radio request sequence exhausted'; }
        else { this.#radioPending = ++this.#radioRequest; this.#radioDeadline = now + 2000; this.#send({ type: 'radioQuery', link: this.#link, boot: this.sync.boot!, request: this.#radioPending }); }
      }
    }
    if (!this.#awaitingPong && now >= this.#nextPing) {
      this.#ping++;
      this.#awaitingPong = true;
      this.#deadline = now + 5000;
      this.#send({ type: 'ping', link: this.#link, request: this.#ping });
    }
  }

  drain() { const frames = this.#outgoing; this.#outgoing = []; return frames; }

  #dispatch(message: Message) {
    if (message.type === 'discoveryStatus' || message.type === 'nodeReply') { this.discovery.receive(this.sync.session, message, this.#now); return; }
    if (message.type === 'radioStatus') {
      if (this.#radioPending !== 0 && message.boot === this.sync.boot && message.request === this.#radioPending && message.revision === this.sync.revision) {
        this.radioInfo = message; this.#radioPending = this.#radioTimeouts = 0; this.radioError = undefined; this.#nextRadio = this.#now + 2000;
      }
      return;
    }
    if (message.type === 'inboxHead' || message.type === 'inboxItem' || message.type === 'inboxMissing') {
      if (this.sync.state === 'ready') this.inbox.receive(this.sync.session, message, this.#now);
      return;
    }
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
      let position;
      try { if (this.supportsPosition) position = readPosition(message); } catch { this.close('invalid-position-settings'); return; }
      const value = { ...message, session: this.sync.session,
        config: { region: message.region, label: message.label, ...(position ? { position } : {}),
          ...(message.beacon !== undefined && message.respond !== undefined && message.beaconInterval !== undefined && message.beacon <= 1 && message.respond <= 1 && message.beaconInterval >= 60 && message.beaconInterval <= 3600 ? { discovery: { beacon: !!message.beacon, respond: !!message.respond, interval: message.beaconInterval } } : {}),
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
      if (!this.device || !this.#commandDevices.has(message.id) || this.#commandDevices.get(message.id) !== this.device) return;
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
      this.radioInfo = undefined; this.#radioPending = 0; this.#nextRadio = this.#now;
      this.#request = this.sync.snapshotRequest;
      this.#send({ type: 'sync', link: this.#link, boot: this.sync.boot!, request: this.#request });
    }
  }

  #sendCommand(command: ConfigCommand) {
    this.#send({ type: 'configure', link: this.#link, boot: command.boot, id: command.id,
      expectedRevision: command.expectedRevision, region: command.config.region,
      label: command.config.label, ...positionFields(command.config.position), ...discoveryFields(command.config.discovery), ...radioFields(command.config.radio) } as Message);
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
