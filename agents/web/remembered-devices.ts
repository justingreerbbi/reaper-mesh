// Devices this browser has connected to, for the connect screen and for rejoining on load.
export const DEVICES_KEY = 'reaper-mesh.devices.v1';
const MAX_REMEMBERED = 8;

export type RememberedDevice = Readonly<{
  /** The device's node ID, so USB and Bluetooth to the same board are one row. */
  id: string;
  /** How it was last reached. */
  kind: 'usb' | 'bluetooth' | 'simulated';
  label?: string;
  /** Web Bluetooth's opaque ID for this browser, and the USB adapter's identity. */
  bluetoothId?: string;
  usbVendorId?: number;
  usbProductId?: number;
  lastConnectedAt: number;
}>;

export function readDevices(store: Pick<Storage, 'getItem'>): RememberedDevice[] {
  try {
    const saved = JSON.parse(store.getItem(DEVICES_KEY) ?? '[]');
    return Array.isArray(saved)
      ? saved.filter(row => typeof row?.id === 'string' && Number.isFinite(row.lastConnectedAt))
      : [];
  } catch {
    return [];
  }
}

export function rememberDevice(
  store: Pick<Storage, 'getItem' | 'setItem'>,
  device: RememberedDevice,
) {
  const list = readDevices(store).filter(row => row.id !== device.id);
  store.setItem(DEVICES_KEY, JSON.stringify([device, ...list].slice(0, MAX_REMEMBERED)));
}

export function forgetDevice(store: Pick<Storage, 'getItem' | 'setItem'>, id: string) {
  store.setItem(DEVICES_KEY, JSON.stringify(readDevices(store).filter(row => row.id !== id)));
}
