/** UI projections only. No transport state, message replay, or fabricated timestamps. */
export type Outgoing = Readonly<{ id: string; device: string; destination: string; channel: number; text: string; mapWire?: string; payloadHex?: string; encryptionState?: string; state: string; reason?: string; messageId?: string }>;
export type Incoming = Readonly<{ device: string; origin: string; destination?: string; channel: number; text: string; mapWire?: string; payloadHex?: string; encryptionState?: string; messageId: string }>;
export type Conversation = Readonly<{ key: string; destination: string; channel: number; name: string; preview: string; kind: 'channel' | 'direct' }>;
export function canonicalNode(id: string) { return /^heltec-[0-9a-f]{12}$/.test(id) ? 'node-0000' + id.slice(7) : id; }
export function conversationKey(destination: string, channel: number) { return `${channel}:${canonicalNode(destination)}`; }
export function threadMessages(device: string | undefined, destination: string, channel: number, outgoing: readonly Outgoing[], incoming: readonly Incoming[]) {
  if (!device) return [];
  const received = incoming.filter(m => m.device === device && m.channel === channel && (destination === 'broadcast' ? !m.destination || m.destination === 'broadcast' : canonicalNode(m.origin) === canonicalNode(destination) && !!m.destination && m.destination !== 'broadcast'))
    .map(m => ({ key: `in:${m.origin}:${m.messageId}`, direction: 'incoming' as const, text: m.text, mapWire: m.mapWire, origin: m.origin, status: m.encryptionState === 'decrypted' ? 'Encrypted · received by device' : m.encryptionState ?? 'Received on this channel', entry: undefined, received: m }));
  const sent = outgoing.filter(m => m.device === device && m.channel === channel && canonicalNode(m.destination) === canonicalNode(destination))
    .map(m => ({ key: `out:${m.id}`, direction: 'outgoing' as const, text: m.text, mapWire: m.mapWire, origin: 'You', status: `${m.encryptionState ? `${m.encryptionState} · ` : ''}${deliveryLabel(m)}`, entry: m, received: undefined }));
  return [...received, ...sent];
}
export function deliveryLabel(m: Outgoing) {
  if (m.reason === 'local-delivery') return 'Delivered locally · no radio transmission';
  if (m.state === 'transmitted' && m.destination === 'broadcast') return 'Broadcast transmitted · no recipient ACK';
  return ({ receiving: 'Uploading', queued: 'Queued on device', transmitted: 'Transmitted · delivery unconfirmed', acknowledged: 'Delivered · destination acknowledged', failed: 'Failed', rejected: 'Rejected', unknown: 'Unknown · not resent' } as Record<string, string>)[m.state] ?? 'Unknown';
}
export function conversations(device: string | undefined, channels: string[], peers: readonly { node: string; name: string }[], outgoing: readonly Outgoing[], incoming: readonly Incoming[]): Conversation[] {
  const rows = new Map<string, Conversation>();
  const add = (destination: string, channel: number) => {
    const key = conversationKey(destination, channel); if (rows.has(key)) return;
    const kind = destination === 'broadcast' ? 'channel' : 'direct';
    const name = kind === 'channel' ? channels[channel] || `Channel ${channel}` : canonicalNode(destination) === canonicalNode(device ?? '') ? 'This device' : peers.find(p => canonicalNode(p.node) === canonicalNode(destination))?.name || destination;
    const messages = threadMessages(device, destination, channel, outgoing, incoming);
    rows.set(key, { key, destination, channel, name, kind, preview: messages.at(-1)?.text ?? (kind === 'channel' ? 'No channel traffic yet' : 'Start a conversation') });
  };
  channels.forEach((name, channel) => { if (name) add('broadcast', channel); });
  for (const m of outgoing) if (m.device === device) add(m.destination, m.channel);
  for (const m of incoming) if (m.device === device && m.destination && m.destination !== 'broadcast') add(m.origin, m.channel);
  for (const p of peers) add(p.node, 0);
  return [...rows.values()];
}
/** Volatile drafts are isolated by transport/device/conversation and bounded. */
export class ConversationDrafts {
  #drafts = new Map<string, string>();
  save(key: string, value: string) { this.#drafts.delete(key); if (value) this.#drafts.set(key, value); while (this.#drafts.size > 64) this.#drafts.delete(this.#drafts.keys().next().value!); }
  get(key: string) { return this.#drafts.get(key) ?? ''; }
}
