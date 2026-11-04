export type RadioConfig = Readonly<{
  mode: 'off' | 'receive' | 'mesh';
  power: number;
  relay: boolean;
  channels: string;
  channelIds: string;
  preset: 'US915_LAB1';
}>;
export const DEFAULT_CHANNELS = 'Public|||||||';
export const PUBLIC_CHANNEL_ID = 0;
/** IDs below this are reserved: 0 is Public, 1–7 are channels converted from slot numbers. */
export const FIRST_RANDOM_CHANNEL_ID = 0x100;
const NO_CHANNEL = 0xffffffff;
const SLOTS = 8;
const NAMES = /^Public(?:\|[A-Za-z0-9_-]{0,8}){7}$/;
const IDS = /^[0-9a-f]{8}(?:\|[0-9a-f]{8}){7}$/;

export type Channel = Readonly<{ slot: number; id: number; name: string }>;

export function formatChannelId(id: number) {
  return id.toString(16).padStart(8, '0');
}
export function formatChannelIds(ids: readonly number[]) {
  return ids.map(formatChannelId).join('|');
}
export const DEFAULT_CHANNEL_IDS = formatChannelIds(new Array(SLOTS).fill(0));

/** Settings saved before channel IDs keep talking on slot k as ID k (D45). */
export function legacyChannelIds(channels: string) {
  return formatChannelIds(channels.split('|').map((name, slot) => (slot && name ? slot : 0)));
}

/** Same rules as the device: Public is 0; a named slot has a unique ID; an empty slot has 0. */
export function validChannels(channels: string, channelIds: string) {
  if (!NAMES.test(channels) || !IDS.test(channelIds)) return false;
  const names = channels.split('|'),
    ids = channelIds.split('|').map(value => Number.parseInt(value, 16));
  if (ids[0] !== PUBLIC_CHANNEL_ID) return false;
  const seen = new Set<number>();
  for (let slot = 1; slot < SLOTS; slot++) {
    if (!!names[slot] !== (ids[slot] !== 0) || ids[slot] === NO_CHANNEL) return false;
    if (ids[slot] && seen.has(ids[slot])) return false;
    seen.add(ids[slot]);
  }
  return true;
}

/** Named channels in slot order, Public first. */
export function channelList(radio: Pick<RadioConfig, 'channels' | 'channelIds'>): Channel[] {
  const names = radio.channels.split('|'),
    ids = radio.channelIds.split('|').map(value => Number.parseInt(value, 16));
  return names.flatMap((name, slot) => (name ? [{ slot, id: ids[slot] ?? 0, name }] : []));
}

/** A new random channel ID outside the reserved range and unused by `taken`. */
export function newChannelId(
  taken: readonly number[] = [],
  random: () => number = () => crypto.getRandomValues(new Uint32Array(1))[0],
) {
  for (;;) {
    const id = random();
    if (id >= FIRST_RANDOM_CHANNEL_ID && id !== NO_CHANNEL && !taken.includes(id)) return id;
  }
}

/** Returns the radio config with `slot` set to a channel, or emptied when `name` is ''. */
export function withChannel(
  radio: RadioConfig,
  slot: number,
  name: string,
  id: number,
): RadioConfig {
  if (!Number.isInteger(slot) || slot < 1 || slot >= SLOTS) throw new Error('invalid slot');
  const names = radio.channels.split('|'),
    ids = radio.channelIds.split('|');
  names[slot] = name;
  ids[slot] = formatChannelId(name ? id : 0);
  const next = { ...radio, channels: names.join('|'), channelIds: ids.join('|') };
  if (!validChannels(next.channels, next.channelIds)) throw new Error('invalid channel settings');
  return next;
}

export function radioFields(radio?: RadioConfig) {
  if (!radio) return {};
  return {
    radioMode: radio.mode,
    txPower: radio.power,
    relay: radio.relay ? 1 : 0,
    channels: radio.channels,
    channelIds: radio.channelIds,
    preset: radio.preset,
  };
}
export function validRadio(radio: RadioConfig, region: string) {
  return (
    ['off', 'receive', 'mesh'].includes(radio.mode) &&
    Number.isInteger(radio.power) &&
    radio.power >= 0 &&
    radio.power <= 10 &&
    typeof radio.relay === 'boolean' &&
    radio.preset === 'US915_LAB1' &&
    validChannels(radio.channels, radio.channelIds) &&
    (radio.mode === 'off' || region === 'US')
  );
}
