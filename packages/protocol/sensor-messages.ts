// Sensor protocol v1: the signals add-on's link to an app (D60). It uses the node protocol's
// envelope with the RS magic and the same TLV codec, from sensor-schema.json. The contract is
// docs/reference/sensor-protocol.md.
import sensorSchema from './sensor-schema.json' with { type: 'json' };
import type { SensorMessage } from './sensor-messages.generated.ts';
import { decodeFrame, encodeFrame, SENSOR_ENVELOPE } from './framing.ts';
import { decodeTlv, encodeTlv, type Schema } from './messages.ts';
export type { SensorMessage } from './sensor-messages.generated.ts';

/** The sensor protocol version this agent speaks. */
export const SENSOR_PROTOCOL_VERSION = 1;
export const SENSOR_MAX_PAYLOAD = SENSOR_ENVELOPE.maxPayload;

/** `welcome.capabilities` bits. */
export const SensorCapability = Object.freeze({
  wifi24: 1 << 0,
  wifi5: 1 << 1,
  bluetooth: 1 << 2,
  bluetoothLongRange: 1 << 3,
  remoteId: 1 << 4,
  probeCapture: 1 << 5,
});

/** `planSet.bands` bits, and the `band` code in observations (1 or 2). */
export const Band = Object.freeze({ ghz24: 1, ghz5: 2 });

/** `planSet.profile` codes. */
export const Profile = Object.freeze({ balanced: 0, drones: 1, wifi: 2, bluetooth: 3 });

/** `planStatus.state` values. */
export const PLAN_STATES = ['applied', 'invalid', 'unsupported'] as const;

/** `wifiAp.security` bits. Zero means an open network. */
export const Security = Object.freeze({
  wep: 1 << 0,
  wpa: 1 << 1,
  wpa2: 1 << 2,
  wpa3: 1 << 3,
  enterprise: 1 << 4,
  owe: 1 << 5,
});

/** `bleDevice.addressType` codes. */
export const AddressType = Object.freeze({
  public: 0,
  randomStatic: 1,
  resolvablePrivate: 2,
  nonResolvablePrivate: 3,
});

/** `bleDevice.phy` codes. */
export const Phy = Object.freeze({ le1m: 1, le2m: 2, coded: 3 });

/** `bleDevice.tracker` codes. */
export const Tracker = Object.freeze({ appleFindMy: 1, tile: 2, samsung: 3, googleFindHub: 4 });

/** `remoteId.transport` codes. */
export const RemoteIdTransport = Object.freeze({
  bluetoothLegacy: 1,
  bluetoothLongRange: 2,
  wifiBeacon: 3,
  wifiNan: 4,
});

export function encodeSensorMessage(message: SensorMessage): Uint8Array {
  return encodeTlv(sensorSchema as Schema, message, SENSOR_MAX_PAYLOAD);
}

export function decodeSensorMessage(payload: Uint8Array): SensorMessage {
  return decodeTlv(sensorSchema as Schema, payload, SENSOR_MAX_PAYLOAD) as SensorMessage;
}

/** One complete frame, with its trailing delimiter. */
export function encodeSensorFrame(message: SensorMessage): Uint8Array {
  return encodeFrame(encodeSensorMessage(message), SENSOR_ENVELOPE);
}

export function decodeSensorFrame(encoded: Uint8Array): SensorMessage {
  return decodeSensorMessage(decodeFrame(encoded, SENSOR_ENVELOPE));
}

const MAX_LATITUDE = 900_000_000;
const MAX_LONGITUDE = 1_800_000_000;
const byteLength = (hex: string) => hex.length / 2;

/**
 * Checks what the codec cannot: lengths and ranges with a meaning. Returns the first problem, or
 * undefined. The codec accepts these messages, so an agent calls this before using one and counts
 * a failure instead of showing it. Code tables (bands, PHYs, transports, trackers, plan states)
 * stay open: a value this agent does not know is shown as unknown, not rejected, so a newer
 * add-on keeps working with an older agent.
 */
export function checkSensorMessage(message: SensorMessage): string | undefined {
  const rssi = (value: number) => value >= -128 && value <= 127;
  switch (message.type) {
    case 'planSet':
    case 'planStatus':
      if (message.bands === 0) return 'no bands';
      if (message.bluetooth > 1 || message.probes > 1) return 'invalid switch';
      if (message.dwell < 20 || message.dwell > 10_000) return 'invalid dwell';
      return message.channels !== undefined && byteLength(message.channels) === 0
        ? 'empty channel list'
        : undefined;
    case 'wifiAp':
      if (byteLength(message.address) !== 6) return 'invalid address';
      if (byteLength(message.ssid) > 32) return 'invalid SSID';
      if (message.hidden > 1) return 'invalid hidden flag';
      if (![message.rssi, message.rssiMin, message.rssiMax].every(rssi)) return 'invalid RSSI';
      return message.rssiMin > message.rssiMax ? 'invalid RSSI range' : undefined;
    case 'wifiProbe':
      if (byteLength(message.address) !== 6) return 'invalid address';
      if (message.ssid !== undefined && byteLength(message.ssid) > 32) return 'invalid SSID';
      return rssi(message.rssi) ? undefined : 'invalid RSSI';
    case 'bleDevice':
      if (byteLength(message.address) !== 6) return 'invalid address';
      if (![message.rssi, message.rssiMin, message.rssiMax].every(rssi)) return 'invalid RSSI';
      if (message.rssiMin > message.rssiMax) return 'invalid RSSI range';
      if (message.manufacturer !== undefined && message.manufacturer > 0xffff)
        return 'invalid manufacturer';
      return message.services !== undefined && byteLength(message.services) % 2
        ? 'invalid services'
        : undefined;
    case 'remoteId':
      if (byteLength(message.uasId) < 1 || byteLength(message.uasId) > 20) return 'invalid UAS ID';
      if (!rssi(message.rssi)) return 'invalid RSSI';
      if (message.address !== undefined && byteLength(message.address) !== 6)
        return 'invalid address';
      if ((message.latitude === undefined) !== (message.longitude === undefined))
        return 'incomplete position';
      if ((message.operatorLatitude === undefined) !== (message.operatorLongitude === undefined))
        return 'incomplete operator position';
      for (const value of [message.latitude, message.operatorLatitude])
        if (value !== undefined && Math.abs(value) > MAX_LATITUDE) return 'invalid latitude';
      for (const value of [message.longitude, message.operatorLongitude])
        if (value !== undefined && Math.abs(value) > MAX_LONGITUDE) return 'invalid longitude';
      if (message.heading !== undefined && message.heading >= 36_000) return 'invalid heading';
      return message.operatorId !== undefined && byteLength(message.operatorId) > 20
        ? 'invalid operator ID'
        : undefined;
    default:
      return undefined;
  }
}
