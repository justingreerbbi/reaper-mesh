// Shared web agent state: device models, the recovery journal, local message and
// encryption stores, preferences, the current error message and the render hook.
import type { BleBluetooth } from '../../packages/agent-core/ble.ts';
import { SerialAdapter } from '../../packages/agent-core/serial.ts';
import type { Connection } from '../../packages/agent-core/connection.ts';
import type { Config } from '../../packages/agent-core/sync.ts';
import { FieldDevice } from '../../packages/simulator/field-device.ts';
import { ConfigModel } from './model.ts';
import { BrowserRecovery } from './recovery.ts';
import { MessageState } from './message-state.ts';
import { AppAccess } from './app-access.ts';
import { EncryptionVault } from './encryption.ts';
import { NodeCache } from './node-cache.ts';
import { readPreferences, writePreferences, type Preferences } from './preferences.ts';

/** Which model the app is showing: a real device (USB or Bluetooth), or the simulated one. */
export const mode: { value: 'usb' | 'demo' } = { value: 'usb' };
/** How the device source connects. USB and Bluetooth reach one device and share its history. */
export const openLink: { transport: 'usb' | 'ble' } = { transport: 'usb' };
/** A browser can expose the API and still have it switched off, which only shows up on use. */
export function bluetoothProblem(error: unknown) {
  const text = String(error);
  return /globally disabled/i.test(text)
    ? 'This browser has Web Bluetooth switched off. In Brave, turn on the Web Bluetooth API in brave://flags and relaunch, or use Chrome or Edge.'
    : text;
}
export const bluetooth = (navigator as Navigator & { bluetooth?: BleBluetooth }).bluetooth;
export const bluetoothHelp =
  'This browser has no Web Bluetooth. Chrome and Edge include it; in Brave it may need turning on in brave://flags. Safari does not support it.';
export const app = document.querySelector('.app') as HTMLElement;

export const demo = new FieldDevice();
export let recovery: BrowserRecovery;
try {
  recovery = await BrowserRecovery.open(localStorage, navigator.locks);
} catch (error) {
  recovery = BrowserRecovery.unavailable(`Recovery storage unavailable: ${String(error)}`);
}
export const models = {
  demo: new ConfigModel(),
  usb: new ConfigModel(new SerialAdapter(recovery.connection)),
};
export let messageState: MessageState | undefined,
  messageStateError = '';
try {
  messageState = new MessageState(localStorage, () => recovery.writable);
} catch (e) {
  messageStateError = `Message management unavailable: ${String(e)}`;
}
export let encryption: EncryptionVault | undefined,
  encryptionError = '';
try {
  encryption = new EncryptionVault(localStorage, () => recovery.writable);
} catch (e) {
  encryptionError = `Encryption state unavailable: ${String(e)}`;
}
export const access = encryption ? new AppAccess(encryption, localStorage) : undefined;
export const current = () => models[mode.value];
export const nodeCache = new NodeCache(localStorage, () => recovery.writable);

export const preferences: Preferences = readPreferences(localStorage);
export function setPreference<K extends keyof Preferences>(key: K, value: Preferences[K]) {
  preferences[key] = value;
  try {
    writePreferences(localStorage, preferences);
  } catch {
    // Still applies for this session.
  }
  applyTheme();
  render();
}
export function applyTheme() {
  const day = preferences.theme === 'day';
  document.documentElement.dataset.theme = day ? 'day' : 'night';
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', day ? '#e9e9e6' : '#050505');
}

let lastConfig: { source: string; config: Config } | undefined;
/**
 * The device's settings, or the last ones it reported while the link is down, so channel names and
 * status stay readable. Anything that writes must use the live connection instead.
 */
export function knownConfig() {
  const { sync } = current().adapter.connection;
  if (sync.state === 'ready' && sync.config) {
    lastConfig = { source: mode.value, config: sync.config };
    return sync.config;
  }
  return lastConfig?.source === mode.value ? lastConfig.config : undefined;
}

/** What can be written back. Sections the firmware can't accept are left out, which keeps them. */
export function writableConfig(connection: Connection): Config {
  const { region, label, radio, position, discovery, screen } = connection.sync.config!;
  return {
    region,
    label,
    ...(radio && !connection.radioBlockReason ? { radio } : {}),
    ...(position && connection.supportsPosition ? { position } : {}),
    ...(discovery && connection.supportsDiscovery ? { discovery } : {}),
    ...(screen && connection.supportsScreen ? { screen } : {}),
  };
}

export function setMessageStateError(message: string) {
  messageStateError = message;
}
/** Drops local message management when the app stops for a local wipe. */
export function disposeMessageState() {
  messageState = undefined;
}

let error = '';
export const currentError = () => error;
export function clearError() {
  error = '';
}
export function setError(message: string) {
  error = message;
}

let renderer = () => {};
/** main.ts installs the full render pass; UI modules call render() after changing state. */
export function setRenderer(fn: () => void) {
  renderer = fn;
}
export function render() {
  renderer();
}
export const showError = (value: unknown) => {
  error = value instanceof Error ? value.message : String(value);
  render();
};
