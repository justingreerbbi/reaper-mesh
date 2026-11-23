/**
 * The agent's side of the signals add-on (D60): one sensor protocol session and a bounded store of
 * what the add-on reports. Transport-independent: an adapter feeds bytes in, calls tick() on a
 * timer, and writes what drain() returns. The contract is docs/reference/sensor-protocol.md.
 */
import { FrameDecoder, SENSOR_ENVELOPE } from '../protocol/framing.ts';
import {
  checkSensorMessage,
  decodeSensorMessage,
  encodeSensorFrame,
  SENSOR_PROTOCOL_VERSION,
  type SensorMessage,
} from '../protocol/sensor-messages.ts';

type Of<T extends SensorMessage['type']> = Extract<SensorMessage, { type: T }>;
export type WifiAp = Of<'wifiAp'>;
export type WifiProbe = Of<'wifiProbe'>;
export type BleDevice = Of<'bleDevice'>;
export type RemoteId = Of<'remoteId'>;
export type SensorStatus = Of<'status'>;
export type SensorWelcome = Of<'welcome'>;
export type PlanStatus = Of<'planStatus'>;
/** A report as kept by the agent: what the add-on sent and when it arrived here. */
export type Seen<T> = T & Readonly<{ receivedAt: number }>;
/** A transmitter in the store: also when this session first heard it. */
export type Heard<T> = Seen<T> & Readonly<{ firstReceivedAt: number }>;
export type SensorPlan = Readonly<{
  profile: number;
  bands: number;
  dwell: number;
  bluetooth: number;
  probes: number;
  channels?: string;
}>;

/**
 * - `negotiating`: hello is being repeated; opening the port restarts the add-on.
 * - `ready`: identified, and status keeps arriving.
 * - `stalled`: identified, but no status for a while.
 * - `incompatible`: the add-on speaks no protocol version this agent knows.
 * - `timeout`: no welcome arrived.
 */
export type SensorState =
  'closed' | 'negotiating' | 'ready' | 'stalled' | 'incompatible' | 'timeout';

export const HELLO_RETRY_MS = 500;
export const NEGOTIATE_MS = 10_000;
/** Status comes every 2 s; three missed in a row means something is wrong. */
export const STALL_MS = 6_500;
/** Most transmitters kept per kind; the one heard least recently is forgotten first. */
export const STORE_LIMITS = Object.freeze({
  wifiAp: 512,
  bleDevice: 512,
  wifiProbe: 256,
  remoteId: 64,
});
/** Leading delimiter, so the add-on's decoder starts clean after anything it printed. */
const DELIMITER = Uint8Array.of(0);

function keep<T extends object>(
  map: Map<string, Heard<T>>,
  key: string,
  message: T,
  receivedAt: number,
  limit: number,
) {
  const firstReceivedAt = map.get(key)?.firstReceivedAt ?? receivedAt;
  map.delete(key); // Re-inserting keeps the map in order of last report.
  map.set(key, { ...message, receivedAt, firstReceivedAt });
  if (map.size > limit) map.delete(map.keys().next().value!);
}

/** What the add-on has reported since it last started. Bounded per kind. */
export class SensorStore {
  readonly wifiAps = new Map<string, Heard<WifiAp>>();
  readonly bleDevices = new Map<string, Heard<BleDevice>>();
  readonly wifiProbes = new Map<string, Heard<WifiProbe>>();
  /** Keyed by UAS ID: a drone may be heard over several transmitters and transports. */
  readonly drones = new Map<string, Heard<RemoteId>>();
  /** Changes on every update, so a view can tell when to redraw. */
  version = 0;

  apply(message: SensorMessage, receivedAt: number) {
    switch (message.type) {
      case 'wifiAp':
        keep(this.wifiAps, message.address, message, receivedAt, STORE_LIMITS.wifiAp);
        break;
      case 'bleDevice':
        keep(this.bleDevices, message.address, message, receivedAt, STORE_LIMITS.bleDevice);
        break;
      case 'wifiProbe':
        keep(this.wifiProbes, message.address, message, receivedAt, STORE_LIMITS.wifiProbe);
        break;
      case 'remoteId':
        keep(this.drones, message.uasId, message, receivedAt, STORE_LIMITS.remoteId);
        break;
      default:
        return;
    }
    this.version++;
  }

  clear() {
    this.wifiAps.clear();
    this.bleDevices.clear();
    this.wifiProbes.clear();
    this.drones.clear();
    this.version++;
  }
}

export class SensorLink {
  state: SensorState = 'closed';
  identity: SensorWelcome | undefined;
  status: Seen<SensorStatus> | undefined;
  plan: PlanStatus | undefined;
  /** Reports that decoded but failed checkSensorMessage, and frames that did not decode. */
  invalid = 0;
  rejected = 0;
  readonly store = new SensorStore();
  onChange: () => void = () => {};
  /** Hears each report that passed the checks, with its arrival time, for history (D61). */
  onReport: (message: SensorMessage, receivedAt: number) => void = () => {};

  #decoder = new FrameDecoder(SENSOR_ENVELOPE);
  #outbox: Uint8Array[] = [];
  #link = '';
  #openedAt = 0;
  #lastHello = 0;
  #lastStatus = 0;
  #request = 0;
  #wallClock: () => number;

  constructor(wallClock: () => number = () => Date.now()) {
    this.#wallClock = wallClock;
  }

  /** Starts a session on a freshly opened port. `link` must be new for every open. */
  open(link: string, now: number) {
    this.#link = link;
    this.#decoder.reset();
    this.#outbox = [];
    this.#openedAt = now;
    this.#lastHello = -Infinity;
    this.invalid = this.rejected = 0;
    this.state = 'negotiating';
    this.tick(now);
    this.onChange();
  }

  close() {
    this.state = 'closed';
    this.#outbox = [];
    this.onChange();
  }

  /** Frames waiting to be written, in order. */
  drain(): Uint8Array[] {
    const frames = this.#outbox;
    this.#outbox = [];
    return frames;
  }

  tick(now: number) {
    if (this.state === 'negotiating') {
      if (now - this.#openedAt >= NEGOTIATE_MS) {
        this.state = 'timeout';
        this.onChange();
      } else if (now - this.#lastHello >= HELLO_RETRY_MS) {
        this.#lastHello = now;
        this.#send({
          type: 'hello',
          link: this.#link,
          minVersion: SENSOR_PROTOCOL_VERSION,
          maxVersion: SENSOR_PROTOCOL_VERSION,
        });
      }
    } else if (this.state === 'ready' && now - this.#lastStatus > STALL_MS) {
      this.state = 'stalled';
      this.onChange();
    }
  }

  /** Asks for a whole new scan plan. Returns its request number, or undefined if not ready. */
  setPlan(plan: SensorPlan): number | undefined {
    if ((this.state !== 'ready' && this.state !== 'stalled') || !this.identity) return undefined;
    const request = (this.#request = (this.#request % 0xffffffff) + 1);
    this.#send({ type: 'planSet', boot: this.identity.boot, request, ...plan });
    return request;
  }

  feed(bytes: Uint8Array, now: number) {
    const counts = this.#decoder.feed(bytes, payload => {
      let message: SensorMessage;
      try {
        message = decodeSensorMessage(payload);
      } catch {
        this.rejected++;
        return;
      }
      this.#receive(message, now);
    });
    this.rejected += counts.rejected;
  }

  #send(message: SensorMessage) {
    this.#outbox.push(DELIMITER, encodeSensorFrame(message));
  }

  #receive(message: SensorMessage, now: number) {
    if (message.type === 'welcome') {
      if (message.link !== this.#link || this.state === 'closed') return; // A stale session.
      if (
        message.minVersion > SENSOR_PROTOCOL_VERSION ||
        message.maxVersion < SENSOR_PROTOCOL_VERSION
      ) {
        this.state = 'incompatible';
        this.identity = message;
        this.onChange();
        return;
      }
      // A different boot means the add-on restarted: what it reported before is gone.
      if (this.identity?.boot !== message.boot) {
        this.store.clear();
        this.plan = undefined;
        this.status = undefined;
      }
      this.identity = message;
      this.state = 'ready';
      this.#lastStatus = now;
      this.onChange();
      return;
    }
    if ((this.state !== 'ready' && this.state !== 'stalled') || !this.identity) return;
    if ('boot' in message && message.boot !== this.identity.boot) return;
    if (checkSensorMessage(message)) {
      this.invalid++;
      return;
    }
    if (message.type === 'status') {
      this.status = { ...message, receivedAt: this.#wallClock() };
      this.#lastStatus = now;
      if (this.state === 'stalled') this.state = 'ready';
    } else if (message.type === 'planStatus') {
      this.plan = message;
    } else {
      const receivedAt = this.#wallClock();
      this.store.apply(message, receivedAt);
      this.onReport(message, receivedAt);
    }
    this.onChange();
  }
}
