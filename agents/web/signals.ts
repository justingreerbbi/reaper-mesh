/**
 * The signals add-on connection (D60): a XIAO ESP32-C5 plugged into this computer's USB, read
 * through Web Serial (Chrome and Edge) or the desktop app's serial bridge, or a simulated add-on.
 * It is a separate port from the radio and the GPS receiver. The view is in signals-ui.ts.
 *
 * An add-on connected over USB is remembered: it reconnects on the next load, and after being
 * unplugged it reconnects when plugged in again, until Disconnect is clicked. Reconnecting never
 * prompts, and it only picks a port when exactly one could be the add-on.
 */
import { gpsPort } from './gps.ts';
import { wantLocation } from './location.ts';
import { recordReport } from './signals-history.ts';
import { readDevices } from './remembered-devices.ts';
import { SensorSerial } from '../../packages/agent-core/sensor-serial.ts';
import { SensorLink } from '../../packages/agent-core/sensor.ts';
import type { SerialPortLike } from '../../packages/agent-core/serial.ts';
import { SimulatedSensor } from '../../packages/simulator/sensor-device.ts';

/** Espressif's built-in USB serial, which the XIAO ESP32-C5 uses. */
export const ADD_ON_FILTER = { usbVendorId: 0x303a, usbProductId: 0x1001 } as const;

export const SIGNALS_PORT_KEY = 'reaper-mesh.signals-port.v1';
/** How often to look for an unplugged add-on coming back. */
const RETRY_MS = 3000;

type PortInfo = { usbVendorId?: number; usbProductId?: number };
type Port = SerialPortLike & { getInfo?(): PortInfo };
type SignalsSerial = EventTarget & {
  getPorts?(): Promise<Port[]>;
  requestPort(options?: { filters?: PortInfo[]; reaperPurpose?: 'signals' }): Promise<Port>;
};

export type SignalsSource = 'none' | 'usb' | 'simulated';

const serial = (navigator as Navigator & { serial?: SignalsSerial }).serial;
export const signalsSupported = () => !!serial;

let adapter = new SensorSerial(new SensorLink());
let source: SignalsSource = 'none';
let problem = '';
let changed: () => void = () => {};
let radioPort: () => unknown = () => undefined;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let reconnecting = false;

export const signalsLink = () => adapter.link;
export const signalsSource = () => source;
export const signalsProblem = () => problem;
/** The add-on's port, so the radio never reconnects to it. */
export const signalsPort = (): unknown => adapter.port;

export function onSignalsChange(callback: () => void) {
  changed = () => {
    // History records where this computer was, so location is wanted while the add-on is on.
    wantLocation('signals', source !== 'none');
    callback();
  };
  adapter.link.onChange = changed;
}

/** Tells the add-on which port the radio is on, so it is never opened twice. */
export function setSignalsRadioPortSource(read: () => unknown) {
  radioPort = read;
}

function readSaved(): PortInfo | undefined {
  try {
    const saved = JSON.parse(localStorage.getItem(SIGNALS_PORT_KEY) ?? 'null');
    return saved && typeof saved === 'object' ? saved : undefined;
  } catch {
    return undefined;
  }
}
function save(info: PortInfo | undefined) {
  try {
    if (info) localStorage.setItem(SIGNALS_PORT_KEY, JSON.stringify(info));
    else localStorage.removeItem(SIGNALS_PORT_KEY);
  } catch {
    // Only matters for reconnecting after a reload.
  }
}
const sameUsb = (a: PortInfo | undefined, b: PortInfo | undefined) =>
  !!a && !!b && a.usbVendorId === b.usbVendorId && a.usbProductId === b.usbProductId;

function fresh() {
  adapter = new SensorSerial(new SensorLink());
  adapter.link.onChange = changed;
  adapter.link.onReport = recordReport;
  adapter.onLost = () => {
    source = 'none';
    problem = 'The signals add-on was unplugged. It reconnects when plugged in again.';
    changed();
    scheduleRetry();
  };
}

function scheduleRetry() {
  clearTimeout(retryTimer);
  retryTimer = setTimeout(() => {
    retryTimer = undefined;
    if (source !== 'none' || !readSaved()) return;
    void reconnectSignals().then(() => {
      if (source === 'none') scheduleRetry();
    });
  }, RETRY_MS);
}

/**
 * Reopens the remembered add-on without asking, if it is plugged in and was allowed before. It
 * leaves the choice to a click when a remembered radio has the same kind of USB port, or when more
 * than one port could be the add-on.
 */
export async function reconnectSignals() {
  const saved = readSaved();
  if (!serial?.getPorts || !saved || source !== 'none' || reconnecting) return;
  reconnecting = true;
  try {
    if (readDevices(localStorage).some(device => device.kind === 'usb' && sameUsb(device, saved)))
      return;
    const taken = [radioPort(), gpsPort()];
    const candidates = (await serial.getPorts()).filter(
      port => !taken.includes(port) && sameUsb(port.getInfo?.(), saved),
    );
    if (candidates.length === 1 && source === 'none') await connectSignals(candidates[0]);
  } catch {
    // Tried again on the next plug-in.
  } finally {
    reconnecting = false;
  }
}

/** Asks the user for the add-on's port. Call it from a click: browsers require a gesture. */
export async function chooseSignalsPort(): Promise<Port | undefined> {
  if (!serial) {
    problem = 'This browser has no Web Serial. Use Chrome, Edge or the desktop app.';
    changed();
    return undefined;
  }
  try {
    return await serial.requestPort({ filters: [ADD_ON_FILTER], reaperPurpose: 'signals' });
  } catch (error) {
    // Closing the chooser isn't a problem to report.
    if (!(error instanceof DOMException && error.name === 'NotFoundError')) {
      problem = String(error instanceof Error ? error.message : error);
      changed();
    }
    return undefined;
  }
}

export async function connectSignals(port: Port) {
  if (port === radioPort()) {
    problem = 'That port is the radio. Choose the signals add-on.';
    changed();
    return;
  }
  await disconnectSignals();
  fresh();
  problem = '';
  try {
    await adapter.connect(port);
    source = 'usb';
    save(port.getInfo?.() ?? ADD_ON_FILTER);
  } catch (error) {
    problem = /already open|InvalidState/i.test(String(error))
      ? 'That port is already in use, perhaps by the radio.'
      : `Couldn't open the add-on: ${String(error instanceof Error ? error.message : error)}`;
  }
  changed();
}

export async function connectSimulatedSignals() {
  await disconnectSignals();
  fresh();
  problem = '';
  await adapter.connect(new SimulatedSensor().createPort());
  source = 'simulated';
  changed();
}

/** Disconnects. With `forget`, it is not reconnected on the next load or plug-in either. */
export async function disconnectSignals(forget = false) {
  source = 'none';
  if (forget) {
    save(undefined);
    clearTimeout(retryTimer);
    problem = '';
  }
  await adapter.disconnect();
  changed();
}

serial?.addEventListener?.('connect', () => void reconnectSignals());
