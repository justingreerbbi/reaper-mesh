/**
 * The text behind a channel QR code. These are the same RMCH1 invites and RMKEY1 key bundles the
 * mobile app uses, so a code made in either can be scanned or pasted in the other.
 */
import { INVITE_PREFIX, formatInvite, parseInvite } from './channel-invite.ts';
import { KEY_BUNDLE_PREFIX, parseKeyBundle } from './encryption.ts';

export type ChannelCode = Readonly<{
  id: number;
  /** Null for a key on its own, which belongs to a channel the device already has. */
  name: string | null;
  key?: string;
  keyOnly: boolean;
}>;

/** Reads a scanned or pasted code. Throws with a message fit to show the user. */
export function parseChannelCode(text: string): ChannelCode {
  const value = text.trim();
  if (value.startsWith(INVITE_PREFIX)) {
    const invite = parseInvite(value);
    // An invite's key gets checked now, not after the channel has been added to the device.
    if (invite.key) parseKeyBundle(invite.key);
    return {
      id: invite.id,
      name: invite.name,
      ...(invite.key ? { key: invite.key } : {}),
      keyOnly: false,
    };
  }
  if (value.startsWith(KEY_BUNDLE_PREFIX)) {
    const bundle = parseKeyBundle(value);
    if (bundle.channel === undefined)
      throw new Error("This key doesn't say which channel it's for.");
    return { id: bundle.channel, name: null, key: value, keyOnly: true };
  }
  throw new Error("This isn't a Reaper Mesh channel code.");
}

type Vault = { hasKey(channel: number): boolean; exportBundle(channel: number): string };

/**
 * The code to share for a channel. Public has no invite because every device already has it, so
 * only its key can be shared. Returns null if there's nothing to share.
 */
export function shareCodeFor(channel: { id: number; name: string }, vault?: Vault) {
  const hasKey = !!vault?.hasKey(channel.id);
  if (channel.id === 0) return hasKey ? vault!.exportBundle(0) : null;
  return formatInvite({
    id: channel.id,
    name: channel.name,
    ...(hasKey ? { key: vault!.exportBundle(channel.id) } : {}),
  });
}

/** What joining a code would do, given the channels on the device. Throws if it can't be joined. */
export function planJoin(
  code: ChannelCode,
  channels: readonly { slot: number; id: number; name: string }[],
) {
  const existing = code.id === 0 ? channels[0] : channels.find(row => row.id === code.id);
  if (code.keyOnly && !existing) throw new Error('Join this channel before adding its key.');
  if (existing) return { existing, slot: existing.slot };
  if (channels.some(row => row.name === code.name))
    throw new Error(`You already have a different channel named ${code.name}.`);
  const used = new Set(channels.map(row => row.slot));
  const slot = Array.from({ length: 7 }, (_, index) => index + 1).find(index => !used.has(index));
  if (slot === undefined) throw new Error('All 8 channel slots are in use.');
  return { existing: undefined, slot };
}
