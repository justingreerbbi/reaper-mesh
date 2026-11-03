export const WIPE_SIGNAL = 'reaper-mesh.wipe.v1';
export const RECOVERY_LOCK = 'reaper-mesh-usb-recovery-v1';
type LocalStore = Pick<Storage, 'length' | 'key' | 'removeItem'>;
/** Clear only Reaper Mesh data, retaining other applications on the same origin. */
export function clearLocalAppData(store: LocalStore, keepSignal = false): void {
  const keys: string[] = [];
  for (let index = 0; index < store.length; index++) {
    const key = store.key(index);
    if (key?.startsWith('reaper-mesh.') && (!keepSignal || key !== WIPE_SIGNAL)) keys.push(key);
  }
  for (const key of keys) store.removeItem(key);
  for (let index = 0; index < store.length; index++) {
    const key = store.key(index);
    if (key?.startsWith('reaper-mesh.') && (!keepSignal || key !== WIPE_SIGNAL))
      throw new Error('Some local data could not be removed.');
  }
}
