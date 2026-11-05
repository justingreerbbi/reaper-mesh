// App PIN lock, PIN settings and the emergency local data wipe.
import { clearLocalAppData, WIPE_SIGNAL, RECOVERY_LOCK } from './local-data.ts';
import { access, app, encryption, encryptionError, models, recovery, render } from './app-state.ts';
import { element, text } from './dom.ts';
import { invalidateThread } from './messages-ui.ts';
import { endSession } from './connection-ui.ts';
import { closeSecrets } from './channels-ui.ts';
import { closeTeamSecrets } from './network-ui.ts';
import { onPageChange } from './nav.ts';

let localAppStopped = false;
export const isAppStopped = () => localAppStopped;
const stopHooks: (() => void)[] = [];
/** Registers cleanup that runs when the app stops for a local wipe. */
export function onLocalAppStop(hook: () => void) {
  stopHooks.push(hook);
}
export const accessDialog = element<HTMLDialogElement>('app-unlock');
export function renderAccess(active: boolean): boolean {
  const locked = access ? access.requiresUnlock(active) : active;
  if (wipeDialog.open) return true;
  app.inert = locked;
  element('lock-app').hidden = !active || locked || !access?.protected;
  if (locked) {
    for (const dialog of document.querySelectorAll<HTMLDialogElement>('dialog[open]'))
      if (dialog !== accessDialog) dialog.close();
    element('message-history').replaceChildren();
    invalidateThread();
    closeSecrets();
    closeTeamSecrets();
    text(
      'app-unlock-submit',
      access?.setup ? 'Set PIN' : access?.migration ? 'Save PIN' : 'Unlock app',
    );
    text(
      'access-title',
      access?.setup
        ? 'Set your app PIN'
        : access?.migration
          ? 'Switch to an app PIN'
          : 'Unlock Reaper Mesh',
    );
    text(
      'access-description',
      access?.migration
        ? 'Enter your existing key password once, then choose a PIN for the whole app.'
        : access?.setup
          ? 'Choose 4–6 numbers to unlock this app on this browser.'
          : 'Enter your PIN to continue.',
    );
    element('legacy-access').hidden = !access?.migration;
    element('pin-confirmation').hidden = !(access?.setup || access?.migration);
    element<HTMLInputElement>('app-pin-confirm').required = !!(access?.setup || access?.migration);
    element<HTMLButtonElement>('app-unlock-submit').disabled = !access || !recovery.writable;
    if (!access || !recovery.writable)
      text('access-error', encryptionError || 'Open the device-owning tab to unlock the app.');
    if (!accessDialog.open) accessDialog.showModal();
  } else if (accessDialog.open) accessDialog.close();
  return locked;
}

export function renderPinSettings() {
  const protectedKeys = !!access?.protected;
  text(
    'pin-setting-status',
    protectedKeys
      ? 'PIN protection is on'
      : 'PIN protection is off · keys are saved without a password',
  );
  element('pin-current-field').hidden = !protectedKeys;
  element('pin-new-fields').hidden = protectedKeys;
  element('pin-enable').hidden = protectedKeys;
  element('pin-remove').hidden = !protectedKeys;
  element<HTMLInputElement>('pin-new').required = !protectedKeys;
  element<HTMLInputElement>('pin-new-confirm').required = !protectedKeys;
  for (const id of ['pin-enable', 'pin-remove'])
    element<HTMLButtonElement>(id).disabled = !access || !recovery.writable;
}
function clearPinFields() {
  for (const id of ['pin-current', 'pin-new', 'pin-new-confirm'])
    element<HTMLInputElement>(id).value = '';
}
const wipeDialog = element<HTMLDialogElement>('wipe-local-dialog');
export function stopLocalApp() {
  localAppStopped = true;
  // Stops the render timer and clears in-memory message state.
  for (const hook of stopHooks) hook();
  recovery.release();
  encryption?.dispose();
  for (const input of document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
    'input, textarea',
  ))
    if (!wipeDialog.contains(input)) input.value = '';
  app.replaceChildren();
  app.inert = true;
  for (const dialog of document.querySelectorAll<HTMLDialogElement>('dialog[open]'))
    if (dialog !== wipeDialog) dialog.close();
  document.title = 'Reaper Mesh · Local data';
}
export async function disconnectLocalApp() {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.allSettled([models.usb.adapter.disconnect(), models.demo.adapter.disconnect()]),
      new Promise<void>(resolve => {
        timeout = setTimeout(resolve, 1500);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}
export function resetLanding(wiped = false) {
  location.replace(
    new URL(wiped ? 'local-data-cleared.html' : 'local-session-closed.html', location.href).href,
  );
}

export function initAccess() {
  accessDialog.addEventListener('cancel', event => event.preventDefault());
  accessDialog.addEventListener('close', () => {
    for (const id of ['app-pin', 'app-pin-confirm', 'legacy-password'])
      element<HTMLInputElement>(id).value = '';
    text('access-error', '');
  });
  element('app-unlock-form').addEventListener('submit', event => {
    event.preventDefault();
    try {
      if (!access) throw Error('App access is unavailable.');
      access.unlock(
        element<HTMLInputElement>('app-pin').value,
        element<HTMLInputElement>('app-pin-confirm').value,
        element<HTMLInputElement>('legacy-password').value,
      );
      for (const id of ['app-pin', 'app-pin-confirm', 'legacy-password'])
        element<HTMLInputElement>(id).value = '';
      text('access-error', '');
      render();
    } catch (e) {
      text('access-error', e instanceof Error ? e.message : 'Could not unlock.');
      element<HTMLInputElement>('app-pin').value = '';
      element<HTMLInputElement>('app-pin').focus();
    }
  });
  element('lock-app').addEventListener('click', () => {
    access?.lock();
    render();
  });
  element('locked-disconnect').addEventListener('click', async () => {
    try {
      await endSession();
    } catch {
      text('access-error', 'Could not disconnect. Try again.');
    } finally {
      access?.lock();
      render();
    }
  });
  element('pin-settings-form').addEventListener('submit', event => {
    event.preventDefault();
    try {
      if (!access || access.protected) throw Error('PIN settings are unavailable.');
      access.unlock(
        element<HTMLInputElement>('pin-new').value,
        element<HTMLInputElement>('pin-new-confirm').value,
      );
      clearPinFields();
      text('pin-settings-result', 'PIN protection enabled.');
      render();
    } catch (e) {
      text(
        'pin-settings-result',
        e instanceof Error ? e.message : 'Could not enable PIN protection.',
      );
    }
  });
  element('pin-remove').addEventListener('click', () => {
    try {
      if (!access) throw Error('PIN settings are unavailable.');
      access.removeProtection(element<HTMLInputElement>('pin-current').value);
      clearPinFields();
      text('pin-settings-result', 'PIN protection removed. Your keys are kept.');
      render();
    } catch (e) {
      clearPinFields();
      text(
        'pin-settings-result',
        e instanceof Error ? e.message : 'Could not remove PIN protection.',
      );
      render();
    }
  });
  onPageChange(left => {
    if (left === 'app') clearPinFields();
  });
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-wipe-local]'))
    button.addEventListener('click', () => {
      element<HTMLInputElement>('wipe-confirmation').value = '';
      element<HTMLButtonElement>('wipe-confirm').disabled = true;
      text('wipe-result', '');
      wipeDialog.showModal();
    });
  element('wipe-confirmation').addEventListener('input', () => {
    element<HTMLButtonElement>('wipe-confirm').disabled =
      element<HTMLInputElement>('wipe-confirmation').value !== 'WIPE';
  });
  element('wipe-cancel').addEventListener('click', () => wipeDialog.close());
  wipeDialog.addEventListener('cancel', event => {
    if (localAppStopped) event.preventDefault();
  });
  window.addEventListener('storage', event => {
    if (event.key !== WIPE_SIGNAL || !event.newValue || localAppStopped) return;
    stopLocalApp();
    try {
      clearLocalAppData(sessionStorage);
    } catch {
      /* The initiating tab reports any persistent storage failures. */
    }
    void disconnectLocalApp().finally(() => resetLanding());
  });
  element('wipe-local-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (element<HTMLInputElement>('wipe-confirmation').value !== 'WIPE') return;
    element<HTMLButtonElement>('wipe-confirm').disabled = true;
    element<HTMLButtonElement>('wipe-cancel').disabled = true;
    try {
      // The marker blocks checkpoints immediately, before other tabs process the event.
      localStorage.setItem(WIPE_SIGNAL, crypto.randomUUID());
      stopLocalApp();
      text('wipe-result', 'Disconnecting and clearing local data…');
      await disconnectLocalApp();
      const erase = () => {
        clearLocalAppData(sessionStorage);
        clearLocalAppData(localStorage, true);
        localStorage.removeItem(WIPE_SIGNAL);
      };
      if (navigator.locks)
        await navigator.locks.request(
          RECOVERY_LOCK,
          { mode: 'exclusive', signal: AbortSignal.timeout(5000) },
          erase,
        );
      else erase(); // Without Web Locks, BrowserRecovery never admits any writer.
      resetLanding(true);
    } catch {
      text(
        'wipe-result',
        'Wipe could not finish. Close other Reaper Mesh tabs, then try again. The app remains stopped.',
      );
      element<HTMLButtonElement>('wipe-confirm').disabled = false;
    }
  });
}
