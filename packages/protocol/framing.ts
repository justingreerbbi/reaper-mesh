/** USB envelope draft v1. Payload bytes are opaque until schema decoding is added. */
export const MAX_PAYLOAD = 2048;
const HEADER = 6;
const CHECKSUM = 4;
const MAX_RAW = HEADER + MAX_PAYLOAD + CHECKSUM;
export const MAX_ENCODED = MAX_RAW + Math.floor(MAX_RAW / 254) + 1;

/** CRC-32/ISO-HDLC: reflected polynomial, init/final xor 0xffffffff. */
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function cobsEncode(raw: Uint8Array): Uint8Array {
  if (raw.length > MAX_RAW) throw new Error('raw frame too large');
  const output = new Uint8Array(raw.length + Math.floor(raw.length / 254) + 1);
  let codeIndex = 0;
  let cursor = 1;
  let code = 1;
  for (const byte of raw) {
    if (byte === 0) {
      output[codeIndex] = code;
      codeIndex = cursor++;
      code = 1;
    } else {
      output[cursor++] = byte;
      if (++code === 255) {
        output[codeIndex] = code;
        codeIndex = cursor++;
        code = 1;
      }
    }
  }
  output[codeIndex] = code;
  return output.slice(0, cursor);
}

export function cobsDecode(encoded: Uint8Array): Uint8Array {
  if (!encoded.length || encoded.length > MAX_ENCODED) throw new Error('invalid COBS length');
  const output = new Uint8Array(MAX_RAW);
  let cursor = 0;
  let count = 0;
  while (cursor < encoded.length) {
    const code = encoded[cursor++];
    if (code === 0 || cursor + code - 1 > encoded.length) throw new Error('invalid COBS block');
    for (let i = 1; i < code; i++) {
      const byte = encoded[cursor++];
      if (byte === 0 || count >= MAX_RAW) throw new Error('invalid COBS data');
      output[count++] = byte;
    }
    if (code < 255 && cursor < encoded.length) {
      if (count >= MAX_RAW) throw new Error('decoded frame too large');
      output[count++] = 0;
    }
  }
  return output.slice(0, count);
}

export function encodeFrame(payload: Uint8Array): Uint8Array {
  if (payload.length < 1 || payload.length > MAX_PAYLOAD) throw new Error('invalid payload length');
  const raw = new Uint8Array(HEADER + payload.length + CHECKSUM);
  raw.set([0x52, 0x4d, 1, 0]); // RM, envelope version, reserved flags.
  const view = new DataView(raw.buffer);
  view.setUint16(4, payload.length, true);
  raw.set(payload, HEADER);
  view.setUint32(raw.length - CHECKSUM, crc32(raw.subarray(0, -CHECKSUM)), true);
  const encoded = cobsEncode(raw);
  const framed = new Uint8Array(encoded.length + 1);
  framed.set(encoded);
  return framed; // Uint8Array initialization supplies the trailing zero delimiter.
}

export function decodeFrame(encoded: Uint8Array): Uint8Array {
  const raw = cobsDecode(encoded);
  if (
    raw.length < HEADER + 1 + CHECKSUM ||
    raw[0] !== 0x52 ||
    raw[1] !== 0x4d ||
    raw[2] !== 1 ||
    raw[3] !== 0
  )
    throw new Error('unsupported envelope');
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const length = view.getUint16(4, true);
  if (length < 1 || length > MAX_PAYLOAD || raw.length !== HEADER + length + CHECKSUM) {
    throw new Error('invalid declared length');
  }
  if (view.getUint32(raw.length - CHECKSUM, true) !== crc32(raw.subarray(0, -CHECKSUM))) {
    throw new Error('checksum mismatch');
  }
  return raw.slice(HEADER, HEADER + length);
}

/** Fixed receive buffer. Discard oversized input until a delimiter before resuming. */
export class FrameDecoder {
  #buffer = new Uint8Array(MAX_ENCODED);
  #length = 0;
  #discarding = false;
  get bufferedBytes() {
    return this.#length;
  }

  reset() {
    this.#length = 0;
    this.#discarding = false;
  }

  /** Deliver each payload immediately; caller owns downstream queue/backpressure limits. */
  feed(chunk: Uint8Array, onPayload: (payload: Uint8Array) => void) {
    let accepted = 0;
    let rejected = 0;
    for (const byte of chunk) {
      if (byte === 0) {
        if (this.#discarding) {
          this.reset();
          continue;
        }
        if (!this.#length) continue; // Empty delimiters provide harmless alignment.
        const length = this.#length;
        this.#length = 0;
        let payload: Uint8Array;
        try {
          payload = decodeFrame(this.#buffer.subarray(0, length));
        } catch {
          rejected++;
          continue;
        }
        accepted++;
        onPayload(payload);
      } else if (!this.#discarding) {
        if (this.#length === MAX_ENCODED) {
          this.#length = 0;
          this.#discarding = true;
          rejected++;
        } else this.#buffer[this.#length++] = byte;
      }
    }
    return { accepted, rejected };
  }
}
