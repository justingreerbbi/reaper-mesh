// Shared web agent state: device models, the recovery journal, local message and
// encryption stores, the current error message and the render hook.
import { SimulatedDevice } from '../../packages/simulator/serial-device.ts';
import { SerialAdapter } from '../../packages/agent-core/serial.ts';
import { ConfigModel } from './model.ts';
import { BrowserRecovery } from './recovery.ts';
import { MessageState } from './message-state.ts';
import { AppAccess } from './app-access.ts';
import { EncryptionVault } from './encryption.ts';
import { element } from './dom.ts';

export const mode = element<HTMLSelectElement>('mode');
export const app = document.querySelector('.app') as HTMLElement;
export const manage = element<HTMLDialogElement>('manage');

export const demo = new SimulatedDevice();
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
export const current = () => models[mode.value as keyof typeof models];

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
