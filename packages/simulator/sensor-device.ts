// A simulated signals add-on (D60) that speaks the sensor protocol over a byte stream, for host
// tests and, once the Signals view exists, the portal's Simulator mode. It hears a fixed,
// deterministic scene: three access points, a phone probing for a network, two Bluetooth devices
// and one drone flying a circle while broadcasting Remote ID. Nothing here is real radio data.
import type { SerialPortLike } from '../agent-core/serial.ts';
import { FrameDecoder, SENSOR_ENVELOPE } from '../protocol/framing.ts';
import {
  AddressType,
  Band,
  checkSensorMessage,
  decodeSensorMessage,
  encodeSensorFrame,
  Phy,
  Profile,
  RemoteIdTransport,
  Security,
  SENSOR_MAX_PAYLOAD,
  SENSOR_PROTOCOL_VERSION,
  SensorCapability,
  Tracker,
  type SensorMessage,
} from '../protocol/sensor-messages.ts';

type Plan = Readonly<{
  profile: number;
  bands: number;
  dwell: number;
  bluetooth: number;
  probes: number;
  channels?: string;
}>;

/** Probe capture starts off (privacy default); everything else is on. */
export const DEFAULT_PLAN: Plan = Object.freeze({
  profile: Profile.balanced,
  bands: Band.ghz24 | Band.ghz5,
  dwell: 150,
  bluetooth: 1,
  probes: 0,
});
/** Reports waiting to be read are bounded; the oldest are dropped and counted. */
export const OUTBOX_LIMIT = 64;
const STATUS_INTERVAL = 2000;
const REPORT_INTERVAL = 1000;
const ALL_CAPABILITIES = Object.values(SensorCapability).reduce((all, bit) => all | bit, 0);
const ascii = (text: string) =>
  [...new TextEncoder().encode(text)].map(byte => byte.toString(16).padStart(2, '0')).join('');

const accessPoints = [
  {
    address: '02a1b2c3d4e5',
    ssid: ascii('Field Net'),
    hidden: 0,
    channel: 36,
    band: Band.ghz5,
    security: Security.wpa2,
    rssi: -61,
  },
  {
    address: '02a1b2c3d4e6',
    ssid: '',
    hidden: 1,
    channel: 6,
    band: Band.ghz24,
    security: Security.wpa2 | Security.wpa3,
    rssi: -80,
  },
  {
    address: '02a1b2c3d4e7',
    ssid: ascii('Cafe Guest'),
    hidden: 0,
    channel: 11,
    band: Band.ghz24,
    security: 0,
    rssi: -74,
  },
] as const;
const probers = [
  {
    address: 'da0011223344',
    ssid: ascii('Home'),
    channel: 1,
    band: Band.ghz24,
    rssi: -72,
  },
  // A Flock camera searching for any network, and a Ring doorbell (see signals-identify.ts).
  { address: '70c94e7f68ff', channel: 6, band: Band.ghz24, rssi: -72 },
  { address: '649a63000a01', channel: 1, band: Band.ghz24, rssi: -68 },
];
const bluetoothDevices = [
  {
    address: 'c0ffee000001',
    addressType: AddressType.randomStatic,
    phy: Phy.le1m,
    rssi: -66,
    manufacturer: 0x004c,
    tracker: Tracker.appleFindMy,
  },
  {
    address: '001a7d000002',
    addressType: AddressType.public,
    phy: Phy.coded,
    rssi: -88,
    name: ascii('Thermo'),
    services: '1a18',
  },
] as const;
// The drone circles 200 m around this point at 10 m/s; its operator stands at the centre.
const CENTER = { latitude: 390_000_000, longitude: -1_050_000_000 };
const RADIUS_DEGREES = 200 / 111_320;

export class SimulatedSensor {
  readonly sensor: string;
  readonly firmware = 'sim-0';
  boot: string;
  plan: Plan = DEFAULT_PLAN;
  capabilities = ALL_CAPABILITIES;
  #bootCount = 0;
  #started: number;
  #link: string | undefined;
  #decoder = new FrameDecoder(SENSOR_ENVELOPE);
  #outbox: Uint8Array[] = [];
  #nextStatus = 0;
  #nextReport = 0;
  #counts = new Map<string, number>();
  #sent = 0;
  #dropped = 0;
  #wifiFrames = 0;
  #bleReports = 0;
  #remoteIdReports = 0;

  constructor(options: { sensor?: string; now?: number } = {}) {
    this.sensor = options.sensor ?? 'sensor-sim';
    this.#started = options.now ?? 0;
    this.boot = this.#newBoot();
  }

  /** Restarts: a new boot ID, the default plan, and no session until the next hello. */
  reboot(now: number) {
    this.boot = this.#newBoot();
    this.plan = DEFAULT_PLAN;
    this.#started = now;
    this.#link = undefined;
    this.#decoder.reset();
    this.#outbox = [];
    this.#counts.clear();
    this.#sent = this.#dropped = this.#wifiFrames = this.#bleReports = this.#remoteIdReports = 0;
  }

  /** Bytes from the app. Invalid frames are dropped, as on the add-on. */
  write(bytes: Uint8Array, now: number) {
    this.#decoder.feed(bytes, payload => {
      let message: SensorMessage;
      try {
        message = decodeSensorMessage(payload);
      } catch {
        return;
      }
      this.#receive(message, now);
    });
  }

  /** Queues every report due by now. Call it as often as the app's clock moves. */
  tick(now: number) {
    if (this.#link === undefined) return;
    if (now >= this.#nextReport) {
      this.#nextReport = now + REPORT_INTERVAL;
      for (const message of this.#scene(now)) this.#send(message);
    }
    if (now >= this.#nextStatus) {
      this.#nextStatus = now + STATUS_INTERVAL;
      this.#send({
        type: 'status',
        boot: this.boot,
        at: this.#at(now),
        profile: this.plan.profile,
        band: this.plan.bands & Band.ghz5 ? Band.ghz5 : Band.ghz24,
        channel: this.plan.bands & Band.ghz5 ? 36 : 6,
        wifiFrames: this.#wifiFrames,
        bleReports: this.#bleReports,
        remoteIdReports: this.#remoteIdReports,
        sent: this.#sent,
        dropped: this.#dropped,
        evicted: 0,
      });
    }
  }

  /** Takes every queued frame, in order, as one byte stream. */
  read(): Uint8Array {
    const output = Uint8Array.from(this.#outbox.flatMap(frame => [...frame]));
    this.#outbox = [];
    return output;
  }

  /**
   * A serial port onto this add-on, for the portal's Simulator mode and host tests. Opening it
   * restarts the add-on, as opening the XIAO's USB port does. `now` is milliseconds.
   */
  createPort(now: () => number = () => Math.floor(performance.now())): SerialPortLike {
    let input: ReadableStreamDefaultController<Uint8Array> | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;
    const pump = () => {
      this.tick(now());
      const bytes = this.read();
      if (bytes.length) input?.enqueue(bytes);
    };
    const port: SerialPortLike = {
      readable: null,
      writable: null,
      open: async () => {
        this.reboot(now());
        port.readable = new ReadableStream<Uint8Array>({
          start: controller => {
            input = controller;
          },
        });
        port.writable = new WritableStream<Uint8Array>({
          write: chunk => {
            this.write(chunk, now());
            pump();
          },
        });
        timer = setInterval(pump, 100);
      },
      close: async () => {
        clearInterval(timer);
        try {
          input?.close();
        } catch {
          // Already closed by the reader.
        }
        input = undefined;
        port.readable = port.writable = null;
      },
    };
    return port;
  }

  #newBoot() {
    return `boot-sim-${++this.#bootCount}`;
  }

  #at(now: number) {
    return Math.max(0, Math.floor(now - this.#started)) >>> 0;
  }

  #send(message: SensorMessage) {
    if (this.#outbox.length === OUTBOX_LIMIT) {
      this.#outbox.shift();
      this.#dropped++;
    }
    this.#outbox.push(encodeSensorFrame(message));
    this.#sent++;
  }

  #receive(message: SensorMessage, now: number) {
    if (message.type === 'hello') {
      // The newest hello takes over the session.
      this.#link = message.link;
      this.#nextStatus = this.#nextReport = now;
      this.#send({
        type: 'welcome',
        link: message.link,
        sensor: this.sensor,
        boot: this.boot,
        minVersion: SENSOR_PROTOCOL_VERSION,
        maxVersion: SENSOR_PROTOCOL_VERSION,
        firmware: this.firmware,
        capabilities: this.capabilities,
        maxFrame: SENSOR_MAX_PAYLOAD,
      });
      return;
    }
    if (message.type !== 'planSet' || this.#link === undefined) return;
    const { type: _type, boot, request, ...requested } = message;
    let state: 'applied' | 'invalid' | 'unsupported' = 'applied';
    if (boot !== this.boot || checkSensorMessage(message)) state = 'invalid';
    else if (
      (requested.probes && !(this.capabilities & SensorCapability.probeCapture)) ||
      (requested.bands & Band.ghz5 && !(this.capabilities & SensorCapability.wifi5)) ||
      requested.profile > Profile.bluetooth
    )
      state = 'unsupported';
    if (state === 'applied') this.plan = Object.freeze(requested);
    this.#send({ type: 'planStatus', boot: this.boot, request, state, ...this.plan });
  }

  #count(key: string) {
    const count = (this.#counts.get(key) ?? 0) + 1;
    this.#counts.set(key, count);
    return count;
  }

  #hearsChannel(band: number, channel: number) {
    if (!(this.plan.bands & band)) return false;
    const channels = this.plan.channels;
    if (channels === undefined) return true;
    for (let i = 0; i < channels.length; i += 2)
      if (parseInt(channels.slice(i, i + 2), 16) === channel) return true;
    return false;
  }

  #scene(now: number): SensorMessage[] {
    const at = this.#at(now);
    const output: SensorMessage[] = [];
    const dronesOnly = this.plan.profile === Profile.drones;
    const wifi = this.plan.profile !== Profile.bluetooth;
    const bluetooth = this.plan.bluetooth === 1 && this.plan.profile !== Profile.wifi;
    if (wifi && !dronesOnly) {
      for (const ap of accessPoints) {
        if (!this.#hearsChannel(ap.band, ap.channel)) continue;
        this.#wifiFrames++;
        output.push({
          type: 'wifiAp',
          boot: this.boot,
          at,
          ...ap,
          rssiMin: ap.rssi - 6,
          rssiMax: ap.rssi + 4,
          count: this.#count(ap.address),
        });
      }
      for (const prober of probers) {
        if (!this.plan.probes || !this.#hearsChannel(prober.band, prober.channel)) continue;
        this.#wifiFrames++;
        output.push({
          type: 'wifiProbe',
          boot: this.boot,
          at,
          ...prober,
          count: this.#count(prober.address),
        });
      }
    }
    if (bluetooth && !dronesOnly) {
      for (const device of bluetoothDevices) {
        this.#bleReports++;
        output.push({
          type: 'bleDevice',
          boot: this.boot,
          at,
          ...device,
          rssiMin: device.rssi - 5,
          rssiMax: device.rssi + 3,
          count: this.#count(device.address),
        });
      }
    }
    // The drone broadcasts over Bluetooth, and over a Wi-Fi beacon on channel 6.
    const transport = bluetooth
      ? RemoteIdTransport.bluetoothLegacy
      : wifi && this.#hearsChannel(Band.ghz24, 6)
        ? RemoteIdTransport.wifiBeacon
        : undefined;
    if (transport !== undefined) {
      this.#remoteIdReports++;
      const angle = ((now / 1000) * 10) / 200; // 10 m/s on a 200 m radius, in radians.
      const scale = Math.cos((CENTER.latitude / 1e7) * (Math.PI / 180));
      output.push({
        type: 'remoteId',
        boot: this.boot,
        at,
        transport,
        uasId: ascii('1581F0SIMULATED'),
        idType: 1,
        uaType: 2,
        rssi: -58,
        latitude: Math.round(CENTER.latitude + Math.sin(angle) * RADIUS_DEGREES * 1e7),
        longitude: Math.round(CENTER.longitude + (Math.cos(angle) * RADIUS_DEGREES * 1e7) / scale),
        altitude: 17_000,
        height: 600,
        speed: 1000,
        // Counter-clockwise from the east: the course is the angle measured west of north.
        heading: Math.round((((((-angle * 180) / Math.PI) % 360) + 360) % 360) * 100) % 36_000,
        operatorLatitude: CENTER.latitude,
        operatorLongitude: CENTER.longitude,
        operatorId: ascii('USA0SIMULATOR'),
      });
    }
    return output;
  }
}
