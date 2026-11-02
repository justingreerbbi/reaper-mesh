/** Stable binary envelope framing; cryptographic operations live in the client agent. */
export const ENCRYPTED_MAGIC = new Uint8Array([0x52, 0x4d, 0x45, 0x01]); // RME1
export const ENCRYPTED_SUITE_XCHACHA20_POLY1305 = 1;
export const ENCRYPTED_HEADER_BYTES = 58;
export const ENCRYPTED_TAG_BYTES = 16;
export const MAX_MESSAGE_BYTES = 1024;

export type EncryptedHeader = Readonly<{ channel: number; keyId: string; epoch: number; nonce: Uint8Array; messageId: Uint8Array }>;

export function parseEncryptedHeader(bytes: Uint8Array): EncryptedHeader | undefined {
  if (bytes.length < ENCRYPTED_HEADER_BYTES + ENCRYPTED_TAG_BYTES || bytes.length > MAX_MESSAGE_BYTES ||
      !ENCRYPTED_MAGIC.every((value, index) => bytes[index] === value) ||
      bytes[4] !== ENCRYPTED_SUITE_XCHACHA20_POLY1305 || bytes[5] > 7) return;
  const epoch = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(14, true);
  if (!epoch) return;
  const id = bytes.subarray(6, 14); if (id.every(value => value === 0)) return;
  return { channel: bytes[5], keyId: [...id].map(value => value.toString(16).padStart(2, '0')).join(''), epoch,
    nonce: bytes.slice(18, 42), messageId: bytes.slice(42, 58) };
}

export function isEncryptedPayload(bytes: Uint8Array, channel?: number): boolean {
  const header = parseEncryptedHeader(bytes);
  return !!header && (channel === undefined || header.channel === channel);
}

/** Plain text or a well-framed encrypted envelope; devices can validate framing without keys. */
export function isMessagePayload(bytes: Uint8Array, channel: number): boolean {
  if (bytes.length >= ENCRYPTED_MAGIC.length && ENCRYPTED_MAGIC.every((value, index) => bytes[index] === value)) return isEncryptedPayload(bytes, channel);
  if (!bytes.length || bytes.length > MAX_MESSAGE_BYTES) return false;
  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    return text.length > 0 && !/[\u0000-\u0008\u000b-\u001f\u007f]/u.test(text);
  } catch { return false; }
}
