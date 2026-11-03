/** Agent application payload over unchanged UTF-8 message transport. */
export const MAP_PREFIX = 'RMAP1:';
export type MapItem = {
  id: string;
  revision: number;
  geometry: 'point' | 'rectangle';
  type: string;
  color: string;
  name: string;
  note: string;
  coordinates: number[];
  metadata: Record<string, string | number | boolean>;
};
export type MapOperation = { operation: 'put' | 'withdraw'; item: MapItem };
const encoder = new TextEncoder();
export function boundedText(value: unknown, max: number): string {
  if (
    typeof value !== 'string' ||
    encoder.encode(value).length > max ||
    /[\u0000-\u001f\u007f]/u.test(value) ||
    new TextDecoder().decode(encoder.encode(value)) !== value
  )
    throw Error('Invalid or oversized text');
  return value;
}
export function validateMapItem(value: unknown): MapItem {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid map item');
  const x = value as MapItem;
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(x.id) ||
    !Number.isInteger(x.revision) ||
    x.revision < 1 ||
    x.revision > 0xffffffff ||
    !['point', 'rectangle'].includes(x.geometry)
  )
    throw Error('Invalid item identity, revision or geometry');
  if (!/^[a-z0-9][a-z0-9./_-]{0,95}$/.test(x.type) || !/^#[a-fA-F0-9]{6}$/.test(x.color))
    throw Error('Invalid map type or color');
  const name = boundedText(x.name, 48),
    note = boundedText(x.note, 160);
  if (!name.trim()) throw Error('Name is required');
  const c = x.coordinates;
  if (
    !Array.isArray(c) ||
    c.length !== (x.geometry === 'point' ? 2 : 4) ||
    c.some((v, i) => !Number.isInteger(v) || v < 0 || v > (i % 2 ? 3600000000 : 1800000000))
  )
    throw Error('Invalid map coordinates');
  if (x.geometry === 'rectangle' && (c[0] <= c[2] || c[1] >= c[3]))
    throw Error(
      'Area must have northwest and southeast corners; date-line crossing is unsupported',
    );
  if (
    !x.metadata ||
    typeof x.metadata !== 'object' ||
    Array.isArray(x.metadata) ||
    Object.keys(x.metadata).length > 12
  )
    throw Error('Invalid item metadata');
  const metadata: MapItem['metadata'] = Object.create(null);
  for (const [key, v] of Object.entries(x.metadata)) {
    if (
      !/^[a-z][a-z0-9_-]{0,31}$/.test(key) ||
      ['__proto__', 'constructor', 'prototype'].includes(key)
    )
      throw Error('Invalid metadata field');
    if (typeof v === 'string') boundedText(v, 96);
    else if (typeof v !== 'boolean' && (typeof v !== 'number' || !Number.isFinite(v)))
      throw Error('Invalid metadata value');
    metadata[key] = v;
  }
  return {
    id: x.id,
    revision: x.revision,
    geometry: x.geometry,
    type: x.type,
    color: x.color.toLowerCase(),
    name,
    note,
    coordinates: [...c],
    metadata,
  };
}
export function encodeMap(operation: MapOperation, limit = 1024): string {
  if (!['put', 'withdraw'].includes(operation.operation)) throw Error('Unsupported map operation');
  const text =
    MAP_PREFIX +
    JSON.stringify({ operation: operation.operation, item: validateMapItem(operation.item) });
  if (encoder.encode(text).length > limit)
    throw Error(`Map item exceeds the ${limit}-byte message budget. Shorten its note or metadata.`);
  return text;
}
export function decodeMap(text: string): MapOperation | undefined {
  if (!text.startsWith(MAP_PREFIX)) return;
  if (encoder.encode(text).length > 1024) throw Error('Oversized map payload');
  const x = JSON.parse(text.slice(MAP_PREFIX.length));
  if (!x || !['put', 'withdraw'].includes(x.operation)) throw Error('Unsupported map operation');
  return { operation: x.operation, item: validateMapItem(x.item) };
}
