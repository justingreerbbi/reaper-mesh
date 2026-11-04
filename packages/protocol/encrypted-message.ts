/** Stable binary envelope framing; cryptographic operations live in the agent. */
export const ENCRYPTED_MAGIC = new Uint8Array([0x52, 0x4d, 0x45, 0x02]); // RME2
export const ENCRYPTED_SUITE_XCHACHA20_POLY1305 = 1;
/** RME2 layout (D45): magic, suite, channel ID (LE32), key ID, epoch (LE32), nonce, message ID. */
export const ENCRYPTED_OFFSETS = Object.freeze({
  suite: 4,
  channel: 5,
  keyId: 9,
  epoch: 17,
  nonce: 21,
  messageId: 45,
});
export const ENCRYPTED_HEADER_BYTES = 61;
export const ENCRYPTED_TAG_BYTES = 16;
export const MAX_MESSAGE_BYTES = 1024;

export type EncryptedHeader = Readonly<{
  channel: number;
  keyId: string;
  epoch: number;
  nonce: Uint8Array;
  messageId: Uint8Array;
}>;

export function parseEncryptedHeader(bytes: Uint8Array): EncryptedHeader | undefined {
  const at = ENCRYPTED_OFFSETS;
  if (
    bytes.length < ENCRYPTED_HEADER_BYTES + ENCRYPTED_TAG_BYTES ||
    bytes.length > MAX_MESSAGE_BYTES ||
    !ENCRYPTED_MAGIC.every((value, index) => bytes[index] === value) ||
    bytes[at.suite] !== ENCRYPTED_SUITE_XCHACHA20_POLY1305
  )
    return;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const epoch = view.getUint32(at.epoch, true);
  if (!epoch) return;
  const id = bytes.subarray(at.keyId, at.epoch);
  if (id.every(value => value === 0)) return;
  return {
    channel: view.getUint32(at.channel, true),
    keyId: [...id].map(value => value.toString(16).padStart(2, '0')).join(''),
    epoch,
    nonce: bytes.slice(at.nonce, at.messageId),
    messageId: bytes.slice(at.messageId, ENCRYPTED_HEADER_BYTES),
  };
}

export function isEncryptedPayload(bytes: Uint8Array, channel?: number): boolean {
  const header = parseEncryptedHeader(bytes);
  return !!header && (channel === undefined || header.channel === channel);
}

/** Plain text or a well-framed encrypted envelope; devices can validate framing without keys. */
export function isMessagePayload(bytes: Uint8Array, channel: number): boolean {
  // Any envelope version is checked as an envelope, so an older RME1 is rejected, not taken as text.
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x4d &&
    bytes[2] === 0x45 &&
    bytes[3] < 32
  )
    return isEncryptedPayload(bytes, channel);
  if (!bytes.length || bytes.length > MAX_MESSAGE_BYTES) return false;
  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    return text.length > 0 && !/[\u0000-\u0008\u000b-\u001f\u007f]/u.test(text);
  } catch {
    return false;
  }
}
