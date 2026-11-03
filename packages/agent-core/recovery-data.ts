import { validateField } from '../protocol/messages.ts';
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('invalid recovery object');
  return value as Record<string, unknown>;
}
export function list(value: unknown, max = 32): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw new Error('invalid recovery history');
  return value;
}
export function string(value: unknown): string {
  if (typeof value !== 'string') throw new Error('invalid recovery string');
  return value;
}
export function id(value: unknown): string {
  const text = string(value);
  validateField('id', text);
  return text;
}
export function u32(value: unknown): number {
  if (typeof value !== 'number') throw new Error('invalid recovery counter');
  validateField('u32', value);
  return value;
}
export function sequence(value: unknown, owner: string): { id: string; sequence: number } {
  const text = string(value);
  validateField('commandId', text);
  if (!text.startsWith(owner + ':')) throw new Error('recovery owner mismatch');
  return { id: text, sequence: Number(text.slice(owner.length + 1)) };
}
