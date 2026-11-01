export type RadioConfig = Readonly<{
  mode: 'off' | 'receive' | 'mesh'; power: number; relay: boolean; channels: string; preset: 'US915_LAB1';
}>;
export const DEFAULT_CHANNELS = 'Public|||||||';
export function radioFields(radio?: RadioConfig) {
  if (!radio) return {};
  return { radioMode: radio.mode, txPower: radio.power, relay: radio.relay ? 1 : 0, channels: radio.channels, preset: radio.preset };
}
export function validRadio(radio: RadioConfig, region: string) {
  return ['off', 'receive', 'mesh'].includes(radio.mode) && Number.isInteger(radio.power) && radio.power >= 0 && radio.power <= 10 &&
    typeof radio.relay === 'boolean' && radio.preset === 'US915_LAB1' && /^Public(?:\|[A-Za-z0-9_-]{0,8}){7}$/.test(radio.channels) &&
    (radio.mode === 'off' || region === 'US');
}
