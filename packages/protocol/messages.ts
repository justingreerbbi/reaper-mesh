import schema from './schema.json' with { type: 'json' };
import type { Message } from './messages.generated.ts';
import { MAX_PAYLOAD } from './framing.ts';
export type { Message } from './messages.generated.ts';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
type Descriptor = { tag: number; fields: Record<string, string> };
/** A message schema: message names with their tag and ordered field kinds. */
export type Schema = Record<string, Descriptor>;
/** Largest value of the `bytes` kind, which agents hold as lowercase hex. */
export const MAX_BYTES = 64;

export function validateField(kind: string, value: unknown) {
  if (kind === 'u32') {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 0xffffffff) {
      throw new Error('invalid unsigned integer');
    }
    return;
  }
  if (kind === 'i32') {
    if (
      typeof value !== 'number' ||
      !Number.isInteger(value) ||
      value < -0x80000000 ||
      value > 0x7fffffff
    ) {
      throw new Error('invalid signed integer');
    }
    return;
  }
  if (typeof value !== 'string') throw new Error('invalid string');
  if (kind === 'bytes') {
    if (!/^(?:[0-9a-f]{2})*$/.test(value) || value.length > MAX_BYTES * 2)
      throw new Error('invalid bytes');
    return;
  }
  if (kind === 'id' && !/^[A-Za-z0-9_-]{1,64}$/.test(value)) throw new Error('invalid identity');
  if (kind === 'version' && !/^[A-Za-z0-9._-]{1,64}$/.test(value))
    throw new Error('invalid version');
  if (kind === 'commandId') {
    const match = /^([A-Za-z0-9_-]{1,64}):([1-9][0-9]{0,9})$/.exec(value);
    if (!match || Number(match[2]) > 0xffffffff) throw new Error('invalid command ID');
  }
  if (kind === 'outcome' && !['committed', 'conflict', 'rejected', 'unknown'].includes(value)) {
    throw new Error('invalid command outcome');
  }
  if (kind === 'radioMode' && !['off', 'receive', 'mesh'].includes(value))
    throw new Error('invalid radio mode');
  if (kind === 'channels' && !/^Public(?:\|[A-Za-z0-9_-]{0,8}){7}$/.test(value))
    throw new Error('invalid channels');
  if (kind === 'channelIds' && !/^[0-9a-f]{8}(?:\|[0-9a-f]{8}){7}$/.test(value))
    throw new Error('invalid channel IDs');
  if (kind === 'hex' && !/^(?:[0-9a-f]{2}){1,32}$/.test(value)) throw new Error('invalid chunk');
  if (
    kind === 'messageState' &&
    ![
      'receiving',
      'queued',
      'transmitted',
      'acknowledged',
      'failed',
      'rejected',
      'unknown',
    ].includes(value)
  )
    throw new Error('invalid message state');
  if (kind === 'region' && !['UNSET', 'US', 'EU'].includes(value))
    throw new Error('invalid region');
  if (
    kind === 'label' &&
    (encoder.encode(value).length > 64 || /[\u0000-\u001f\u007f]/u.test(value))
  ) {
    throw new Error('invalid label');
  }
  if (decoder.decode(encoder.encode(value)) !== value) throw new Error('invalid Unicode');
}

/** Draft TLV payload. Field order/tags in schema.json are append-only. */
export function encodeMessage(message: Message): Uint8Array {
  return encodeTlv(schema as Schema, message, MAX_PAYLOAD);
}

export function decodeMessage(payload: Uint8Array): Message {
  return decodeTlv(schema as Schema, payload, MAX_PAYLOAD) as Message;
}

function fromHex(value: string) {
  const output = new Uint8Array(value.length / 2);
  for (let i = 0; i < output.length; i++) output[i] = parseInt(value.slice(2 * i, 2 * i + 2), 16);
  return output;
}

function toHex(bytes: Uint8Array) {
  let output = '';
  for (const byte of bytes) output += byte.toString(16).padStart(2, '0');
  return output;
}

function fieldBytes(kind: string, value: unknown) {
  if (kind === 'u32' || kind === 'i32') {
    const data = new Uint8Array(4);
    const view = new DataView(data.buffer);
    if (kind === 'u32') view.setUint32(0, value as number, true);
    else view.setInt32(0, value as number, true);
    return data;
  }
  if (kind === 'bytes') return fromHex(value as string);
  return encoder.encode(value as string);
}

/** Encodes any schema's message. Each schema has its own payload limit. */
export function encodeTlv(
  messages: Schema,
  message: Readonly<{ type: string }>,
  maxPayload: number,
): Uint8Array {
  const descriptor = Object.hasOwn(messages, message.type) ? messages[message.type] : undefined;
  if (!descriptor) throw new Error('unknown message');
  const record = message as unknown as Record<string, unknown>;
  if (
    (message.type === 'hello' || message.type === 'welcome') &&
    (record.minVersion as number) > (record.maxVersion as number)
  ) {
    throw new Error('invalid version range');
  }
  const chunks: Uint8Array[] = [Uint8Array.of(1, descriptor.tag)];
  let tag = 0;
  let total = 2;
  for (const [name, descriptorKind] of Object.entries(descriptor.fields)) {
    ++tag;
    const kind = descriptorKind.replace(/\?$/, '');
    const value = record[name];
    if (value === undefined && descriptorKind.endsWith('?')) continue;
    validateField(kind, value);
    const data = fieldBytes(kind, value);
    const field = new Uint8Array(3 + data.length);
    field[0] = tag;
    new DataView(field.buffer).setUint16(1, data.length, true);
    field.set(data, 3);
    chunks.push(field);
    total += field.length;
  }
  if (total > maxPayload) throw new Error('message too large');
  const output = new Uint8Array(total);
  let cursor = 0;
  for (const chunk of chunks) {
    output.set(chunk, cursor);
    cursor += chunk.length;
  }
  return output;
}

/** Decodes any schema's message into a frozen object. */
export function decodeTlv(
  messages: Schema,
  payload: Uint8Array,
  maxPayload: number,
): Readonly<{ type: string }> {
  if (payload.length < 2 || payload.length > maxPayload || payload[0] !== 1) {
    throw new Error('unsupported payload');
  }
  const match = Object.entries(messages).find(([, descriptor]) => descriptor.tag === payload[1]);
  if (!match) throw new Error('unknown message type');
  const [type, descriptor] = match;
  const fields = Object.entries(descriptor.fields);
  const output: Record<string, unknown> = { type };
  const seen = new Set<number>();
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  for (let cursor = 2; cursor < payload.length;) {
    if (cursor + 3 > payload.length) throw new Error('truncated field');
    const tag = payload[cursor];
    const length = view.getUint16(cursor + 1, true);
    cursor += 3;
    if (!tag || seen.has(tag) || cursor + length > payload.length) throw new Error('invalid field');
    seen.add(tag);
    const field = fields[tag - 1];
    if (field) {
      const [name, descriptorKind] = field;
      const kind = descriptorKind.replace(/\?$/, '');
      if ((kind === 'u32' || kind === 'i32') && length !== 4)
        throw new Error('invalid integer width');
      const value =
        kind === 'u32'
          ? view.getUint32(cursor, true)
          : kind === 'i32'
            ? view.getInt32(cursor, true)
            : kind === 'bytes'
              ? toHex(payload.subarray(cursor, cursor + length))
              : decoder.decode(payload.subarray(cursor, cursor + length));
      validateField(kind, value);
      output[name] = value;
    }
    cursor += length;
  }
  if (fields.some(([name, kind]) => !kind.endsWith('?') && !(name in output)))
    throw new Error('missing required field');
  if (
    (type === 'hello' || type === 'welcome') &&
    (output.minVersion as number) > (output.maxVersion as number)
  ) {
    throw new Error('invalid version range');
  }
  return Object.freeze(output) as Readonly<{ type: string }>;
}
