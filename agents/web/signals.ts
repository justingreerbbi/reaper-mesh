/**
 * The signals add-on connection (D60): a XIAO ESP32-C5 plugged into this computer's USB, read
 * through Web Serial (Chrome and Edge) or the desktop app's serial bridge, or a simulated add-on.
 * It is a separate port from the radio and the GPS receiver. The view is in signals-ui.ts.
 */
import { SensorSerial } from '../../packages/agent-core/sensor-serial.ts';
import { SensorLink } from '../../packages/agent-core/sensor.ts';
import type { SerialPortLike } from '../../packages/agent-core/serial.ts';
import { SimulatedSensor } from '../../packages/simulator/sensor-device.ts';

/** Espressif's built-in USB serial, which the XIAO ESP32-C5 uses. */
export const ADD_ON_FILTER = { usbVendorId: 0x303a, usbProductId: 0x1001 } as const;

type Port = SerialPortLike & { getInfo?(): { usbVendorId?: number; usbProductId?: number } };
type SignalsSerial = {
  requestPort(options?: {
    filters?: { usbVendorId?: number; usbProductId?: number }[];
    reaperPurpose?: 'signals';
  }): Promise<Port>;
};

export type SignalsSource = 'none' | 'usb' | 'simulated';

const serial = (navigator as Navigator & { serial?: SignalsSerial }).serial;
export const signalsSupported = () => !!serial;

let adapter = new SensorSerial(new SensorLink());
let source: SignalsSource = 'none';
let problem = '';
let changed: () => void = () => {};
let radioPort: () => unknown = () => undefined;

export const signalsLink = () => adapter.link;
export const signalsSource = () => source;
export const signalsProblem = () => problem;
/** The add-on's port, so the radio never reconnects to it. */
export const signalsPort = (): unknown => adapter.port;

export function onSignalsChange(callback: () => void) {
  changed = callback;
  adapter.link.onChange = callback;
}

/** Tells the add-on which port the radio is on, so it is never opened twice. */
export function setSignalsRadioPortSource(read: () => unknown) {
  radioPort = read;
}

function fresh() {
  adapter = new SensorSerial(new SensorLink());
  adapter.link.onChange = changed;
  adapter.onLost = () => {
    source = 'none';
    problem = 'The signals add-on was disconnected.';
    changed();
  };
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

export async function disconnectSignals() {
  source = 'none';
  await adapter.disconnect();
  changed();
}
