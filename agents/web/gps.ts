/**
 * A USB GPS receiver as this computer's location source, for a laptop in a vehicle. It is read
 * through Web Serial (Chrome and Edge) or the desktop app's serial bridge, and speaks NMEA 0183,
 * which every consumer receiver does. The receiver is a separate port from the radio.
 *
 * Receivers differ in speed: many USB ones ignore the setting, older ones run at 4800 or 9600 baud.
 * Each is tried in turn until well-formed sentences arrive, and the one that worked is remembered.
 */
import { NmeaReader } from './nmea.ts';
import { publishFix, updateSource } from './location.ts';

export const GPS_PORT_KEY = 'reaper-mesh.gps-port.v1';
const BAUD_RATES = [4800, 9600, 38400, 115200] as const;
/** How long to listen at one speed before trying the next. */
const LISTEN_MS = 2500;
/** No sentence for this long means the receiver has gone quiet or been unplugged. */
const SILENT_MS = 5000;

type PortInfo = { usbVendorId?: number; usbProductId?: number };
type GpsPort = SerialPort & { getInfo(): PortInfo };
type GpsSerial = {
  getPorts(): Promise<GpsPort[]>;
  requestPort(options?: { filters?: PortInfo[]; reaperPurpose?: 'gps' }): Promise<GpsPort>;
};
type Saved = PortInfo & { baudRate?: number };

export type GpsState =
  | { kind: 'off' }
  | { kind: 'connecting'; detail: string }
  | { kind: 'searching'; satellites: number | null }
  | { kind: 'fix'; satellites: number | null }
  | { kind: 'error'; message: string };

const serial = (navigator as Navigator & { serial?: GpsSerial }).serial;
export const gpsSupported = () => !!serial;

let state: GpsState = { kind: 'off' };
let port: GpsPort | undefined;
let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
let run = 0;
let watchdog: ReturnType<typeof setInterval> | undefined;
let changed: () => void = () => {};
let radioPort: () => SerialPort | undefined = () => undefined;

/** Tells the reader which port the radio is on, so it is never opened as a receiver. */
export function setRadioPortSource(source: () => SerialPort | undefined) {
  radioPort = source;
}

export const gpsState = () => state;
/** The port the receiver is on, so the radio never mistakes it for a board. */
export const gpsPort = (): SerialPort | undefined => port;

export function onGpsChange(callback: () => void) {
  changed = callback;
}
function set(next: GpsState) {
  state = next;
  changed();
}

function readSaved(): Saved | undefined {
  try {
    const saved = JSON.parse(localStorage.getItem(GPS_PORT_KEY) ?? 'null');
    return saved && typeof saved === 'object' ? saved : undefined;
  } catch {
    return undefined;
  }
}
function save(info: Saved) {
  try {
    localStorage.setItem(GPS_PORT_KEY, JSON.stringify(info));
  } catch {
    // Only matters for reconnecting after a reload.
  }
}
export const hasSavedGps = () => !!readSaved();

/**
 * Connects to the receiver. With `choose`, the user picks the port (this needs a click); without,
 * it reopens the remembered one if it is plugged in and was allowed before.
 */
export async function connectGps(choose: boolean, options: { retry?: boolean } = {}) {
  if (!serial) {
    set({
      kind: 'error',
      message: 'This browser has no Web Serial. Use Chrome, Edge or the desktop app.',
    });
    return;
  }
  const mine = ++run;
  const exclude = radioPort();
  await closePort();
  const saved = readSaved();
  let chosen: GpsPort | undefined;
  try {
    if (choose) chosen = await serial.requestPort({ reaperPurpose: 'gps' });
    else if (saved)
      chosen = (await serial.getPorts()).find(candidate => {
        const info = candidate.getInfo();
        return (
          candidate !== exclude &&
          info.usbVendorId === saved.usbVendorId &&
          info.usbProductId === saved.usbProductId
        );
      });
  } catch (error) {
    if (mine !== run) return;
    // Closing the chooser isn't a problem to report.
    if (error instanceof DOMException && error.name === 'NotFoundError') set({ kind: 'off' });
    else set({ kind: 'error', message: String(error instanceof Error ? error.message : error) });
    return;
  }
  if (mine !== run) return;
  if (!chosen) {
    if (options.retry) {
      set({ kind: 'error', message: 'The GPS receiver was disconnected. Plug it in again.' });
      scheduleRetry(mine);
    } else set({ kind: 'off' });
    return;
  }
  if (chosen === exclude) {
    set({ kind: 'error', message: 'That port is the radio. Choose the GPS receiver.' });
    return;
  }
  const order = saved?.baudRate
    ? [saved.baudRate, ...BAUD_RATES.filter(rate => rate !== saved.baudRate)]
    : [...BAUD_RATES];
  for (const baudRate of order) {
    if (mine !== run) return;
    set({ kind: 'connecting', detail: `Listening at ${baudRate} baud` });
    try {
      await chosen.open({ baudRate });
    } catch (error) {
      set({
        kind: 'error',
        message: /already open|InvalidState/i.test(String(error))
          ? 'That port is already in use, perhaps by the radio. Choose the GPS receiver.'
          : `Couldn't open the receiver: ${String(error instanceof Error ? error.message : error)}`,
      });
      return;
    }
    port = chosen;
    if (await listen(mine, chosen)) {
      save({ ...chosen.getInfo(), baudRate });
      return;
    }
    await closePort();
  }
  if (mine === run)
    set({
      kind: 'error',
      message: 'No GPS sentences arrived. Check this is a GPS receiver that sends NMEA.',
    });
}

/**
 * Reads the port. Resolves true once well-formed NMEA arrives (the reading then carries on in the
 * background), or false if nothing does within LISTEN_MS at this speed.
 */
function listen(mine: number, chosen: GpsPort) {
  const nmea = new NmeaReader();
  const decoder = new TextDecoder();
  let heardAt = Date.now();
  nmea.onFix = fix => {
    publishFix({
      lngLat: [fix.longitude, fix.latitude],
      at: Date.now(),
      accuracy: fix.accuracy,
      altitude: fix.altitude,
      speed: fix.speed,
      course: fix.course,
      source: 'gps',
    });
  };
  return new Promise<boolean>(resolve => {
    let settled = false;
    const settle = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    const timer = setTimeout(() => settle(false), LISTEN_MS);
    const current = chosen.readable?.getReader();
    if (!current) return settle(false);
    reader = current;
    void (async () => {
      try {
        while (mine === run) {
          const { value, done } = await current.read();
          if (done) break;
          nmea.push(decoder.decode(value, { stream: true }));
          if (nmea.sentences === 0) continue;
          heardAt = Date.now();
          if (!settled) {
            clearTimeout(timer);
            settle(true);
            startWatchdog(mine, () => heardAt);
          }
          const next: GpsState = nmea.hasFix
            ? { kind: 'fix', satellites: nmea.satellites }
            : { kind: 'searching', satellites: nmea.satellites };
          if (
            next.kind !== state.kind ||
            ('satellites' in state && state.satellites !== next.satellites)
          )
            set(next);
        }
      } catch {
        // Unplugged, or closed by closePort.
      }
      if (!settled) {
        clearTimeout(timer);
        settle(false);
      } else if (mine === run) {
        await closePort();
        set({ kind: 'error', message: 'The GPS receiver was disconnected.' });
        scheduleRetry(mine);
      }
    })();
  });
}

function startWatchdog(mine: number, heardAt: () => number) {
  clearInterval(watchdog);
  watchdog = setInterval(() => {
    if (mine !== run) return clearInterval(watchdog);
    if (Date.now() - heardAt() > SILENT_MS && state.kind !== 'error')
      set({ kind: 'error', message: 'The GPS receiver stopped sending. Check the cable.' });
  }, 1000);
}

/** A receiver unplugged by a bump in a vehicle comes back on its own when plugged in again. */
function scheduleRetry(mine: number) {
  setTimeout(() => {
    if (mine === run && state.kind === 'error') void connectGps(false, { retry: true });
  }, 3000);
}

async function closePort() {
  clearInterval(watchdog);
  const current = reader;
  reader = undefined;
  try {
    await current?.cancel();
  } catch {
    // Already gone.
  }
  current?.releaseLock();
  const open = port;
  port = undefined;
  try {
    await open?.close();
  } catch {
    // Already closed or unplugged.
  }
}

/** Disconnects, and with `forget` stops reconnecting to it on the next load. */
export async function disconnectGps(forget = false) {
  run++;
  await closePort();
  if (forget)
    try {
      localStorage.removeItem(GPS_PORT_KEY);
    } catch {
      // Nothing to forget.
    }
  set({ kind: 'off' });
  updateSource();
}
