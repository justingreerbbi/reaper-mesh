/**
 * Keeps the screen on while the map follows this computer or a track is recording, when the "Keep
 * screen on" setting allows it. A laptop in a vehicle would otherwise dim, lock or sleep partway
 * through a drive, and a sleeping computer records nothing.
 *
 * In a browser this is the Screen Wake Lock API, which the browser releases whenever the tab is
 * hidden, so it is asked for again when the tab comes back. The desktop app asks the system
 * instead (its `keep_awake` command), which also stops the computer itself sleeping.
 */

type TauriCore = { invoke<T>(command: string, args?: unknown): Promise<T> };
type WakeLock = {
  release(): Promise<void>;
  addEventListener(type: 'release', cb: () => void): void;
};
type WakeLockApi = { request(type: 'screen'): Promise<WakeLock> };

const core = (window as unknown as { __TAURI__?: { core?: TauriCore } }).__TAURI__?.core;
const wakeLock = (navigator as Navigator & { wakeLock?: WakeLockApi }).wakeLock;

const reasons = new Set<string>();
let allowed = true;
let held: WakeLock | undefined;
let asking = false;
let desktopOn = false;

/** Whether this browser or app can keep the screen on at all. */
export const canKeepAwake = () => !!core || !!wakeLock;

export function setKeepAwakeAllowed(on: boolean) {
  if (on === allowed) return;
  allowed = on;
  void apply();
}

/** Says whether `reason` (following, recording) needs the screen kept on. */
export function keepAwake(reason: string, on: boolean) {
  const before = reasons.size;
  if (on) reasons.add(reason);
  else reasons.delete(reason);
  if (reasons.size !== before) void apply();
}

async function apply() {
  const wanted = allowed && reasons.size > 0;
  if (core) {
    if (wanted === desktopOn) return;
    desktopOn = wanted;
    try {
      await core.invoke('keep_awake', { on: wanted });
    } catch {
      // An older desktop build without the command; the screen follows the system settings.
    }
    return;
  }
  if (!wakeLock) return;
  if (!wanted) {
    const lock = held;
    held = undefined;
    await lock?.release().catch(() => {});
    return;
  }
  if (held || asking || document.visibilityState !== 'visible') return;
  asking = true;
  try {
    const lock = await wakeLock.request('screen');
    lock.addEventListener('release', () => {
      if (held === lock) held = undefined;
    });
    held = lock;
    // Turned off while the request was on its way.
    if (!(allowed && reasons.size > 0)) await apply();
  } catch {
    // Refused, for example on low battery. Nothing to show; the screen follows the system.
  } finally {
    asking = false;
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') void apply();
});
