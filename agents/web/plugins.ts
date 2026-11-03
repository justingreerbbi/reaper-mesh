import { boundedText } from '../../packages/protocol/map-item.ts';
export type PluginField = {
  id: string;
  label: string;
  type: 'text' | 'number' | 'boolean' | 'select';
  options?: string[];
  default?: string | number | boolean;
  shared?: boolean;
};
export type PluginType = {
  id: string;
  name: string;
  geometry: 'point' | 'rectangle';
  icon: string;
  defaultColor: string;
  fields: PluginField[];
};
export type Plugin = {
  manifestVersion: 1;
  id: string;
  name: string;
  version: string;
  types: PluginType[];
  settings: PluginField[];
};
export type InstalledPlugin = {
  manifest: Plugin;
  enabled: boolean;
  settings: Record<string, string | number | boolean>;
};
const icons = ['pin', 'flag', 'camp', 'hazard', 'medical', 'observation', 'search'];
const id = (v: unknown): string => {
  if (
    typeof v !== 'string' ||
    !/^[a-z][a-z0-9_-]{0,31}$/.test(v) ||
    ['constructor', 'prototype'].includes(v)
  )
    throw Error('Invalid plugin field/type ID');
  return v;
};
function fields(value: unknown): PluginField[] {
  if (!Array.isArray(value) || value.length > 12) throw Error('At most 12 fields are supported');
  const seen = new Set<string>();
  return value.map(raw => {
    if (!raw || typeof raw !== 'object') throw Error('Invalid field');
    const fieldId = id(raw.id);
    if (seen.has(fieldId)) throw Error('Duplicate field ID');
    seen.add(fieldId);
    if (!['text', 'number', 'boolean', 'select'].includes(raw.type))
      throw Error('Unsupported field type');
    const f: PluginField = {
      id: fieldId,
      label: boundedText(raw.label, 64),
      type: raw.type,
      shared: raw.shared === true,
    };
    if (raw.type === 'select') {
      if (!Array.isArray(raw.options) || !raw.options.length || raw.options.length > 16)
        throw Error('Select requires 1–16 options');
      f.options = raw.options.map((x: unknown) => boundedText(x, 64));
    }
    if (raw.default !== undefined) {
      validateFieldValue(f, raw.default);
      f.default = raw.default;
    }
    return f;
  });
}
export function validateFieldValue(
  f: PluginField,
  value: unknown,
): asserts value is string | number | boolean {
  if (f.type === 'text') boundedText(value, 96);
  else if (f.type === 'select') {
    if (typeof value !== 'string' || !f.options?.includes(value))
      throw Error(`Choose a valid ${f.label}`);
  } else if (
    f.type === 'boolean'
      ? typeof value !== 'boolean'
      : typeof value !== 'number' || !Number.isFinite(value)
  )
    throw Error(`Invalid ${f.label}`);
}
export function parsePlugin(text: string): Plugin {
  if (text.length > 65536) throw Error('Plugin exceeds 64 KiB');
  const x = JSON.parse(text);
  if (
    !x ||
    x.manifestVersion !== 1 ||
    typeof x.id !== 'string' ||
    !/^[a-z][a-z0-9.-]{2,62}$/.test(x.id) ||
    x.id === 'core' ||
    !/^\d+\.\d+\.\d+$/.test(x.version)
  )
    throw Error('Unsupported plugin manifest, ID or version');
  if (!Array.isArray(x.types) || x.types.length > 24)
    throw Error('At most 24 map types are supported');
  const seen = new Set<string>();
  const types = x.types.map((t: any): PluginType => {
    const typeId = id(t.id);
    if (seen.has(typeId)) throw Error('Duplicate type ID');
    seen.add(typeId);
    if (
      !['point', 'rectangle'].includes(t.geometry) ||
      !icons.includes(t.icon) ||
      !/^#[a-fA-F0-9]{6}$/.test(t.defaultColor)
    )
      throw Error('Unsupported geometry, icon or color');
    return {
      id: typeId,
      name: boundedText(t.name, 48),
      geometry: t.geometry,
      icon: t.icon,
      defaultColor: t.defaultColor,
      fields: fields(t.fields ?? []),
    };
  });
  // Unknown executable contributions fail closed rather than pretend to run them.
  if (
    Object.keys(x).some(
      k => !['manifestVersion', 'id', 'name', 'version', 'types', 'settings'].includes(k),
    )
  )
    throw Error('Unsupported plugin contribution');
  return {
    manifestVersion: 1,
    id: x.id,
    name: boundedText(x.name, 64),
    version: x.version,
    types,
    settings: fields(x.settings ?? []),
  };
}
export const BUILTIN_TYPES: PluginType[] = [
  ['point', 'General point', 'pin'],
  ['meeting', 'Meeting point', 'flag'],
  ['camp', 'Camp / base', 'camp'],
  ['hazard', 'Hazard', 'hazard'],
  ['medical', 'Medical assistance', 'medical'],
  ['observation', 'Observation', 'observation'],
  ['area', 'Search area', 'search'],
].map(([id, name, icon]) => ({
  id: `core/${id}`,
  name,
  icon,
  geometry: id === 'area' ? 'rectangle' : 'point',
  defaultColor: '#78c5ab',
  fields: [],
}));
export function availableTypes(plugins: InstalledPlugin[]): PluginType[] {
  return [
    ...BUILTIN_TYPES,
    ...plugins
      .filter(p => p.enabled)
      .flatMap(p => p.manifest.types.map(t => ({ ...t, id: p.manifest.id + '/' + t.id }))),
  ];
}
