/** UI projections only. No transport state, message replay, or fabricated timestamps. */
export type Outgoing = Readonly<{
  id: string;
  device: string;
  destination: string;
  channel: number;
  text: string;
  mapWire?: string;
  payloadHex?: string;
  encryptionState?: string;
  state: string;
  reason?: string;
  messageId?: string;
}>;
export type Incoming = Readonly<{
  device: string;
  origin: string;
  destination?: string;
  channel: number;
  text: string;
  mapWire?: string;
  payloadHex?: string;
  encryptionState?: string;
  messageId: string;
}>;
export type Conversation = Readonly<{
  key: string;
  destination: string;
  channel: number;
  name: string;
  preview: string;
  kind: 'channel' | 'direct';
}>;
export function canonicalNode(id: string) {
  return /^heltec-[0-9a-f]{12}$/.test(id) ? 'node-0000' + id.slice(7) : id;
}
export function conversationKey(destination: string, channel: number) {
  return `${channel}:${canonicalNode(destination)}`;
}
export function threadMessages(
  device: string | undefined,
  destination: string,
  channel: number,
  outgoing: readonly Outgoing[],
  incoming: readonly Incoming[],
) {
  if (!device) return [];
  const received = incoming
    .filter(
      m =>
        m.device === device &&
        m.channel === channel &&
        (destination === 'broadcast'
          ? !m.destination || m.destination === 'broadcast'
          : canonicalNode(m.origin) === canonicalNode(destination) &&
            !!m.destination &&
            m.destination !== 'broadcast'),
    )
    .map(m => ({
      key: `in:${m.origin}:${m.messageId}`,
      direction: 'incoming' as const,
      text: m.text,
      mapWire: m.mapWire,
      origin: m.origin,
      status:
        m.encryptionState === 'decrypted'
          ? 'Encrypted · received by device'
          : (m.encryptionState ?? 'Received on this channel'),
      entry: undefined,
      received: m,
    }));
  const sent = outgoing
    .filter(
      m =>
        m.device === device &&
        m.channel === channel &&
        canonicalNode(m.destination) === canonicalNode(destination),
    )
    .map(m => ({
      key: `out:${m.id}`,
      direction: 'outgoing' as const,
      text: m.text,
      mapWire: m.mapWire,
      origin: 'You',
      status: `${m.encryptionState ? `${m.encryptionState} · ` : ''}${deliveryLabel(m)}`,
      entry: m,
      received: undefined,
    }));
  return [...received, ...sent];
}
export function deliveryLabel(m: Outgoing) {
  if (m.reason === 'local-delivery') return 'Delivered locally · no radio transmission';
  if (m.state === 'transmitted' && m.destination === 'broadcast')
    return 'Broadcast transmitted · no recipient ACK';
  return (
    (
      {
        receiving: 'Uploading',
        queued: 'Queued on device',
        transmitted: 'Transmitted · delivery unconfirmed',
        acknowledged: 'Delivered · destination acknowledged',
        failed: 'Failed',
        rejected: 'Rejected',
        unknown: 'Unknown · not resent',
      } as Record<string, string>
    )[m.state] ?? 'Unknown'
  );
}
/**
 * Icon, color and wording for a sent message. Transmitted is not delivery, and acknowledged means
 * the destination device accepted it, not that anyone read it. Same wording as the mobile app.
 */
export function deliveryOf(m: Outgoing): {
  icon: 'pending' | 'sent' | 'done' | 'failed' | 'unknown';
  tone: 'good' | 'muted' | 'bad' | 'warn';
  label: string;
} {
  if (m.reason === 'local-delivery')
    return { icon: 'done', tone: 'good', label: 'Delivered locally, no radio transmission' };
  if (m.state === 'transmitted' && m.destination === 'broadcast')
    return {
      icon: 'sent',
      tone: 'good',
      label: 'Broadcast sent. Broadcasts have no acknowledgment',
    };
  switch (m.state) {
    case 'receiving':
      return { icon: 'pending', tone: 'muted', label: 'Sending to device' };
    case 'queued':
      return { icon: 'pending', tone: 'muted', label: 'Queued on device' };
    case 'transmitted':
      return { icon: 'sent', tone: 'muted', label: 'Transmitted, delivery not confirmed' };
    case 'acknowledged':
      return { icon: 'done', tone: 'good', label: 'Delivered to the destination device' };
    case 'failed':
      return { icon: 'failed', tone: 'bad', label: `Failed${m.reason ? `: ${m.reason}` : ''}` };
    case 'rejected':
      return { icon: 'failed', tone: 'bad', label: `Rejected${m.reason ? `: ${m.reason}` : ''}` };
    default:
      return { icon: 'unknown', tone: 'warn', label: 'Outcome unknown. It was not sent again' };
  }
}
/** A channel the device uses: its on-air ID (D45) and local name. */
export type ChannelName = Readonly<{ id: number; name: string }>;
export function channelLabel(channels: readonly ChannelName[], id: number) {
  return channels.find(channel => channel.id === id)?.name ?? `Channel ${id.toString(16)}`;
}
export function conversations(
  device: string | undefined,
  channels: readonly ChannelName[],
  peers: readonly { node: string; name: string }[],
  outgoing: readonly Outgoing[],
  incoming: readonly Incoming[],
): Conversation[] {
  const rows = new Map<string, Conversation>();
  const add = (destination: string, channel: number) => {
    const key = conversationKey(destination, channel);
    if (rows.has(key)) return;
    const kind = destination === 'broadcast' ? 'channel' : 'direct';
    const name =
      kind === 'channel'
        ? channelLabel(channels, channel)
        : canonicalNode(destination) === canonicalNode(device ?? '')
          ? 'This device'
          : peers.find(p => canonicalNode(p.node) === canonicalNode(destination))?.name ||
            destination;
    const messages = threadMessages(device, destination, channel, outgoing, incoming);
    rows.set(key, {
      key,
      destination,
      channel,
      name,
      kind,
      preview: messages.at(-1)?.text ?? (kind === 'channel' ? 'No messages yet' : 'Direct message'),
    });
  };
  for (const channel of channels) add('broadcast', channel.id);
  for (const m of outgoing) if (m.device === device) add(m.destination, m.channel);
  for (const m of incoming)
    if (m.device === device && m.destination && m.destination !== 'broadcast')
      add(m.origin, m.channel);
  for (const p of peers) add(p.node, 0);
  return [...rows.values()];
}
/** Volatile drafts are isolated by transport/device/conversation and bounded. */
export class ConversationDrafts {
  #drafts = new Map<string, string>();
  save(key: string, value: string) {
    this.#drafts.delete(key);
    if (value) this.#drafts.set(key, value);
    while (this.#drafts.size > 64) this.#drafts.delete(this.#drafts.keys().next().value!);
  }
  get(key: string) {
    return this.#drafts.get(key) ?? '';
  }
}
