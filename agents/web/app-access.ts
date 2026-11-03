import { EncryptionVault } from './encryption.ts';

const ATTEMPTS_KEY = 'reaper-mesh.app-access.v1';
type Attempts = { failures: number; retryAt: number };
/** Browser-local access gate. Device authorization remains a separate boundary. */
export class AppAccess {
  private connected = false;
  private readonly keys: EncryptionVault;
  private readonly storage: Pick<Storage, 'getItem' | 'setItem'>;
  private readonly now: () => number;
  constructor(
    keys: EncryptionVault,
    storage: Pick<Storage, 'getItem' | 'setItem'>,
    now: () => number = Date.now,
  ) {
    this.keys = keys;
    this.storage = storage;
    this.now = now;
  }
  /** A fresh connection always needs the PIN; disconnect drops key access. */
  requiresUnlock(connected: boolean): boolean {
    if (connected !== this.connected) this.lock();
    this.connected = connected;
    return connected && this.keys.protected && !this.unlocked;
  }
  get setup() {
    return !this.keys.protected;
  }
  get protected() {
    return this.keys.protected;
  }
  get migration() {
    return this.keys.protected && !this.keys.pinConfigured;
  }
  get unlocked() {
    return this.keys.unlocked;
  }
  unlock(pin: string, confirmation = '', legacyPassword = '') {
    if (!/^[0-9]{4,6}$/u.test(pin)) throw new Error('Use 4–6 numbers.');
    if ((this.setup || this.migration) && pin !== confirmation)
      throw new Error('PINs do not match.');
    this.attempt(() => {
      if (this.migration) {
        this.keys.unlock(legacyPassword);
        this.keys.setPin(pin, confirmation);
      } else if (this.setup) this.keys.setPin(pin, confirmation);
      else this.keys.unlock(pin);
    });
  }
  removeProtection(credential: string) {
    if (!this.protected) return;
    this.attempt(() => {
      this.keys.lock();
      this.keys.unlock(credential);
    });
    this.keys.removeProtection();
  }
  private attempt(action: () => void) {
    let attempts: Attempts;
    try {
      const raw = this.storage.getItem(ATTEMPTS_KEY);
      attempts = raw ? JSON.parse(raw) : { failures: 0, retryAt: 0 };
    } catch {
      throw new Error('App access storage is unavailable.');
    }
    if (
      !attempts ||
      !Number.isSafeInteger(attempts.failures) ||
      attempts.failures < 0 ||
      !Number.isSafeInteger(attempts.retryAt) ||
      attempts.retryAt < 0
    )
      throw new Error('App access storage is unavailable.');
    if (this.now() < attempts.retryAt)
      throw new Error(`Try again in ${Math.ceil((attempts.retryAt - this.now()) / 1000)} seconds.`);
    try {
      action();
      this.storage.setItem(ATTEMPTS_KEY, JSON.stringify({ failures: 0, retryAt: 0 }));
    } catch {
      this.keys.lock();
      const failures = Math.min(attempts.failures + 1, 20);
      this.storage.setItem(
        ATTEMPTS_KEY,
        JSON.stringify({
          failures,
          retryAt:
            this.now() + (failures >= 5 ? Math.min(300_000, 30_000 * 2 ** (failures - 5)) : 0),
        }),
      );
      throw new Error('Could not unlock. Check your PIN or existing password.');
    }
  }
  lock() {
    this.keys.lock();
  }
}
