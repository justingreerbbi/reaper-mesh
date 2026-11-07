import { SimulatedNetwork } from './network-device.ts';
import { FrameDecoder, encodeFrame } from '../protocol/framing.ts';
import { decodeMessage, encodeMessage, type Message } from '../protocol/messages.ts';
import { encodeMap } from '../protocol/map-item.ts';
import type { SerialPortLike } from '../agent-core/serial.ts';

const hex = (text: string) =>
  Array.from(new TextEncoder().encode(text), byte => byte.toString(16).padStart(2, '0')).join('');
const fixed = (degrees: number, limit: number) => Math.round((degrees + limit) * 1e7);

export const FIELD_DEVICE_ID = 'node-00000000a1b2c3d4';

type Node = {
  node: string;
  peerBoot: string;
  peerSequence: number;
  name: string;
  ageMs: number;
  latitude?: number;
  longitude?: number;
};
type Sent = {
  destination: string;
  count: number;
  received: number;
  state: string;
  messageId?: string;
};
type InboxItem = {
  sequence: number;
  origin: string;
  messageId: string;
  channel: number;
  destination?: string;
  data: string;
};

/**
 * A pretend radio with messaging, discovery and positions, for trying the portal with no hardware.
 * It answers over the real frame format and codec, so everything above the port runs as it would
 * on a board. It models the protocol's replies, not RF. Nothing here shows how a radio behaves.
 * Mirrors the mobile app's simulated device. SimulatedDevice stays the smaller recovery reference.
 */
export class FieldDevice {
  boot = 'b0000000000000000000000000000001';
  revision = 3;
  sequence = 3;
  /** Faults for trying recovery: the next save's reply is lost, or the link drops after it commits. */
  nextFault: 'none' | 'lose-result' | 'disconnect' = 'none';
  readOnly = false;
  config: Record<string, unknown> = {
    region: 'US',
    label: 'Reaper Dash',
    radioMode: 'mesh',
    txLevel: 1,
    txBoost: 0,
    relay: 1,
    channels: 'Public|Team||||||',
    channelIds: '00000000|9c41e2a7|00000000|00000000|00000000|00000000|00000000|00000000',
    preset: 'US915_LAB1',
    beacon: 1,
    respond: 1,
    beaconInterval: 300,
    shareLocation: 1,
    positionSource: 1,
    latitude: fixed(39.7392, 90),
    longitude: fixed(-104.9903, 180),
    screenTimeout: 60,
    screenWake: 1,
    ledEnabled: 0,
  };
  nodes: Node[] = [
    {
      node: 'node-00000000bb01e7f2',
      peerBoot: 'c1000000000000000000000000000001',
      peerSequence: 7,
      name: 'Alpha 1',
      ageMs: 18000,
      latitude: fixed(39.7481, 90),
      longitude: fixed(-104.9752, 180),
    },
    {
      node: 'node-00000000bb02a491',
      peerBoot: 'c2000000000000000000000000000001',
      peerSequence: 4,
      name: 'Bravo 2',
      ageMs: 94000,
      latitude: fixed(39.7255, 90),
      longitude: fixed(-105.0121, 180),
    },
    {
      node: 'node-00000000bb03c05d',
      peerBoot: 'c3000000000000000000000000000001',
      peerSequence: 2,
      name: 'Relay Ridge',
      ageMs: 412000,
    },
  ];
  #messages = new Map<string, Sent>();
  #inbox: InboxItem[] = [];
  #receipts = new Map<string, string>();
  #counter = 0;
  #tx = 12;
  #rx = 48;
  #discovery: string | undefined;
  #pairingOpenedAt = 0;
  network = new SimulatedNetwork();
  #scenarioStarted = false;
  #drop: (() => void) | undefined;
  #live = false;
  /** How quickly scripted traffic arrives. Tests pass 0 to run it on the next tick. */
  readonly #pace: number;

  constructor(options: { pace?: number; scenario?: boolean } = {}) {
    this.#pace = options.pace ?? 1;
    if (options.scenario === false) this.#scenarioStarted = true;
  }

  /** Drops the link the way losing range or the cable would. The device stays as it was. */
  drop() {
    this.#drop?.();
  }
  /** Reboots: settings stay, and volatile receipts go with a new boot identity. */
  reboot() {
    this.boot = `b${(Number.parseInt(this.boot.slice(-8), 16) + 1).toString(16).padStart(31, '0')}`;
    this.#receipts.clear();
    this.#messages.clear();
    this.drop();
  }
  /** Lets a message arrive as though heard on the radio. */
  receiveRadio(fields: {
    origin: string;
    text?: string;
    payloadHex?: string;
    channel?: number;
    destination?: string;
  }) {
    this.#inbox.push({
      sequence: this.#inbox.length + 1,
      origin: fields.origin,
      messageId: `m-${this.boot.slice(-6)}-${++this.#counter}`,
      channel: fields.channel ?? 0,
      ...(fields.destination ? { destination: fields.destination } : {}),
      data: fields.payloadHex ?? hex(fields.text ?? ''),
    });
    this.#rx++;
  }

  #later(callback: () => void, ms: number) {
    setTimeout(() => {
      if (this.#live) callback();
    }, ms * this.#pace);
  }

  #scenario() {
    if (this.#scenarioStarted) return;
    this.#scenarioStarted = true;
    this.#later(
      () =>
        this.receiveRadio({
          origin: 'node-00000000bb01e7f2',
          text: 'Alpha on station at the north gate.',
        }),
      2500,
    );
    this.#later(
      () =>
        this.receiveRadio({
          origin: 'node-00000000bb02a491',
          text: encodeMap({
            operation: 'put',
            item: {
              id: '5f0b7a52-8f6e-4f0e-9d2b-1a7c3e9d4b10',
              revision: 2,
              geometry: 'point',
              type: 'core/point',
              color: '#b2dda3',
              name: 'Rally point',
              note: 'Regroup here at 1800.',
              coordinates: [fixed(39.7442, 90), fixed(-105.0015, 180)],
              metadata: {},
            },
          }),
        }),
      6000,
    );
    this.#later(
      () =>
        this.receiveRadio({
          origin: 'node-00000000bb01e7f2',
          destination: FIELD_DEVICE_ID,
          text: 'Can you confirm your position?',
        }),
      11000,
    );
  }

  createPort(): SerialPortLike {
    let input!: ReadableStreamDefaultController<Uint8Array>;
    let link: string | undefined;
    const decoder = new FrameDecoder();
    const send = (message: Record<string, unknown>) => {
      if (!this.#live) return;
      input.enqueue(encodeFrame(encodeMessage({ link, ...message } as Message)));
    };
    const disconnect = () => {
      if (!this.#live) return;
      this.#live = false;
      input.error(new Error('simulated disconnect'));
    };
    return {
      readable: new ReadableStream({
        start(controller) {
          input = controller;
        },
        cancel: () => {
          this.#live = false;
        },
      }),
      writable: new WritableStream({
        write: bytes => {
          if (!this.#live) throw new Error('simulated port closed');
          decoder.feed(bytes, payload => {
            const message = decodeMessage(payload);
            if (message.type === 'hello') link = message.link;
            else if (message.link !== link) return;
            this.#handle(message, send, disconnect);
          });
        },
      }),
      open: async () => {
        if (this.#drop) throw new Error('simulated device already connected');
        this.#live = true;
        this.#drop = disconnect;
      },
      close: async () => {
        this.#live = false;
        if (this.#drop === disconnect) this.#drop = undefined;
      },
    };
  }

  #handle(
    message: Message,
    send: (message: Record<string, unknown>) => void,
    disconnect: () => void,
  ) {
    const boot = this.boot;
    switch (message.type) {
      case 'hello':
        send({
          type: 'welcome',
          device: FIELD_DEVICE_ID,
          boot,
          minVersion: 1,
          maxVersion: 1,
          configSchema: 1,
          // Every feature through Bluetooth pairing, or only the read-only minimum.
          features: this.readOnly ? 2 : 32767 | 65536 | 131072,
          maxPayload: 2048,
          receiptCapacity: 32,
          ownerCapacity: 8,
          ownerAdmitted: 1,
          regions: 7,
          maxLabelBytes: 64,
          firmware: 'simulator-field-1',
          radioVersion: 2,
          messageVersion: 1,
          maxMessageBytes: 1024,
          messageCapacity: 8,
          radioSchema: 1,
          maxChannels: 8,
          inboxVersion: 1,
          inboxCapacity: 8,
          discoveryVersion: 1,
          nodeCapacity: 32,
          locationVersion: 1,
          screenVersion: 1,
          channelIdVersion: 1,
        });
        this.#scenario();
        return;
      case 'sync':
        send({
          type: 'snapshot',
          boot,
          request: message.request,
          sequence: this.sequence,
          revision: this.revision,
          ...this.config,
        });
        return;
      case 'ping':
        send({ type: 'pong', boot, request: message.request });
        return;
      case 'configure':
        this.#configure(message, send, disconnect);
        return;
      case 'query':
        send({
          type: 'result',
          boot,
          id: message.id,
          outcome: this.#receipts.get(message.id) ?? 'unknown',
          revision: this.revision,
        });
        return;
      case 'submit':
        this.#submit(message, send);
        return;
      case 'messageQuery':
        this.#messageStatus(message.id, send);
        return;
      case 'radioQuery':
        send({
          type: 'radioStatus',
          boot,
          request: message.request,
          state: this.config.radioMode === 'off' ? 'off' : 'ready',
          reason: this.config.radioMode === 'off' ? 'disabled' : (this.network.reason ?? 'ready'),
          probe: 1,
          transmitted: this.#tx,
          received: this.#rx,
          revision: this.revision,
          heapFree: 148320,
          stackFree: 2912,
        });
        return;
      case 'inboxQuery':
        send({
          type: 'inboxHead',
          boot,
          request: message.request,
          oldest: this.#inbox.length ? 1 : 0,
          latest: this.#inbox.length,
        });
        return;
      case 'inboxRead': {
        const item = this.#inbox.find(row => row.sequence === message.sequence);
        if (!item) {
          send({
            type: 'inboxMissing',
            boot,
            request: message.request,
            sequence: message.sequence,
          });
          return;
        }
        const chunks = item.data.match(/.{1,64}/g) ?? [''];
        send({
          type: 'inboxItem',
          boot,
          request: message.request,
          sequence: item.sequence,
          origin: item.origin,
          messageId: item.messageId,
          channel: item.channel,
          part: message.part,
          count: chunks.length,
          data: chunks[message.part],
          ...(item.destination ? { destination: item.destination } : {}),
        });
        return;
      }
      case 'discover':
        if (message.action === 1) {
          this.#discovery = 'collecting';
          this.#later(() => {
            this.#discovery = 'complete';
          }, 3000);
        }
        send({
          type: 'discoveryStatus',
          boot,
          id: message.id,
          state: this.#discovery ?? 'unknown',
          replies: this.#discovery === 'complete' ? this.nodes.length : 0,
          sequence: 1,
        });
        return;
      case 'nodeQuery':
        this.#nodeQuery(message, send);
        return;
      case 'networkQuery':
      case 'networkFill':
      case 'teamLoad':
      case 'networkErase':
      case 'networkAdvance':
        send({ ...this.network.handle(message), boot });
        return;
      case 'pairingRequest': {
        if (message.open === 1) this.#pairingOpenedAt = Date.now();
        const seconds = this.#pairingOpenedAt
          ? 120 - Math.floor((Date.now() - this.#pairingOpenedAt) / 1000)
          : 0;
        const open = seconds > 0;
        send({
          type: 'pairingStatus',
          boot,
          request: message.request,
          state: open ? 'open' : 'closed',
          seconds: Math.max(0, seconds),
          bonds: 0,
          ...(open ? { name: 'Reaper-SIM0' } : {}),
        });
        return;
      }
      default:
    }
  }

  #configure(
    message: Extract<Message, { type: 'configure' }>,
    send: (message: Record<string, unknown>) => void,
    disconnect: () => void,
  ) {
    const reply = (outcome: string) =>
      send({ type: 'result', boot: this.boot, id: message.id, outcome, revision: this.revision });
    const prior = this.#receipts.get(message.id);
    if (prior) return reply(prior);
    if (this.readOnly) return reply('rejected');
    const fault = this.nextFault;
    this.nextFault = 'none';
    if (message.expectedRevision !== this.revision) {
      this.#receipts.set(message.id, 'conflict');
      return reply('conflict');
    }
    const fields: Record<string, unknown> = { ...message };
    for (const key of ['type', 'link', 'boot', 'id', 'expectedRevision']) delete fields[key];
    this.config = { ...this.config, ...fields };
    this.revision++;
    this.sequence++;
    this.#receipts.set(message.id, 'committed');
    if (fault === 'disconnect') return disconnect();
    if (fault === 'lose-result') return;
    reply('committed');
    send({
      type: 'event',
      boot: this.boot,
      sequence: this.sequence,
      revision: this.revision,
      ...this.config,
    });
  }

  #submit(
    message: Extract<Message, { type: 'submit' }>,
    send: (message: Record<string, unknown>) => void,
  ) {
    let entry = this.#messages.get(message.id);
    if (!entry) {
      entry = {
        destination: message.destination,
        count: message.count,
        received: 0,
        state: 'receiving',
      };
      this.#messages.set(message.id, entry);
    }
    entry.received = (entry.received | (2 ** message.part)) >>> 0; // Unsigned: up to 32 chunks.
    if (entry.received === 2 ** entry.count - 1 && entry.state === 'receiving') {
      const sent = entry;
      sent.state = 'queued';
      sent.messageId = `m-${this.boot.slice(-6)}-${++this.#counter}`;
      this.#later(() => {
        sent.state = 'transmitted';
        this.#tx++;
        if (sent.destination !== 'broadcast')
          this.#later(() => {
            sent.state = 'acknowledged';
            this.#messageStatus(message.id, send);
          }, 300);
        this.#messageStatus(message.id, send);
      }, 200);
    }
    this.#messageStatus(message.id, send);
  }

  #messageStatus(id: string, send: (message: Record<string, unknown>) => void) {
    const entry = this.#messages.get(id);
    send({
      type: 'messageStatus',
      boot: this.boot,
      id,
      state: entry?.state ?? 'unknown',
      received: entry?.received ?? 0,
      ...(entry?.messageId ? { messageId: entry.messageId } : {}),
    });
  }

  #nodeQuery(
    message: Extract<Message, { type: 'nodeQuery' }>,
    send: (message: Record<string, unknown>) => void,
  ) {
    const base = {
      type: 'nodeReply',
      boot: this.boot,
      request: message.request,
      generation: 1,
      cursor: message.cursor,
      total: this.nodes.length,
    };
    if (message.generation === 0 && message.cursor === 0) {
      send({ ...base, state: 'head' });
      return;
    }
    const row = this.nodes[message.cursor];
    if (!row) {
      send({ ...base, state: 'changed' });
      return;
    }
    send({
      ...base,
      state: 'item',
      node: row.node,
      peerBoot: row.peerBoot,
      peerSequence: row.peerSequence,
      name: row.name,
      ageMs: row.ageMs,
      ...(row.latitude !== undefined
        ? {
            positionSource: 1,
            latitude: row.latitude,
            longitude: row.longitude,
            positionAgeMs: 0,
          }
        : {}),
    });
  }
}
