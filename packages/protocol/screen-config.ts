/** Board-local screen policy (D44). A timeout of 0 keeps the screen on. */
export type ScreenConfig = Readonly<{ timeout: number; wake: boolean }>;
export const SCREEN_TIMEOUTS = [0, 10, 30, 60, 300] as const;
export function validScreen(value: ScreenConfig) {
  return (
    typeof value.wake === 'boolean' &&
    Number.isInteger(value.timeout) &&
    (value.timeout === 0 || (value.timeout >= 10 && value.timeout <= 3600))
  );
}
export function screenFields(value?: ScreenConfig) {
  return value ? { screenTimeout: value.timeout, screenWake: Number(value.wake) } : {};
}
/** Board-local status LED (D53). Omitting the field keeps the device's value. */
export function ledFields(value?: boolean) {
  return value === undefined ? {} : { ledEnabled: Number(value) };
}
export function readLed(value: { ledEnabled?: number }): boolean | undefined {
  if (value.ledEnabled === undefined) return;
  if (value.ledEnabled !== 0 && value.ledEnabled !== 1) throw new Error('invalid LED setting');
  return value.ledEnabled === 1;
}
export function readScreen(value: {
  screenTimeout?: number;
  screenWake?: number;
}): ScreenConfig | undefined {
  const { screenTimeout, screenWake } = value;
  if (screenTimeout === undefined && screenWake === undefined) return;
  if (
    screenTimeout === undefined ||
    screenWake === undefined ||
    (screenWake !== 0 && screenWake !== 1)
  )
    throw new Error('invalid screen settings');
  const screen = { timeout: screenTimeout, wake: screenWake === 1 };
  if (!validScreen(screen)) throw new Error('invalid screen settings');
  return screen;
}
