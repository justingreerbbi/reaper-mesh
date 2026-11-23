// Small DOM helpers shared by the Signals screen. Text from the air is only ever set as text.
import { icon } from './ui.ts';

const SVG = 'http://www.w3.org/2000/svg';

export function svg<K extends keyof SVGElementTagNameMap>(
  name: K,
  attributes: Record<string, string | number>,
) {
  const node = document.createElementNS(SVG, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  return node;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  name: K,
  className = '',
  ...children: (Node | string)[]
) {
  const node = document.createElement(name);
  if (className) node.className = className;
  node.append(...children);
  return node;
}

export function line(value: string, className = 'muted') {
  return el('small', className, value);
}

export function button(label: string, symbol: string, onClick: () => void, className = 'compact') {
  const control = el('button', className, icon(symbol), label);
  control.type = 'button';
  control.addEventListener('click', onClick);
  return control;
}

export function badge(label: string, tone?: 'warn' | 'good') {
  const span = el('span', 'signal-badge', label);
  if (tone) span.dataset.tone = tone;
  return span;
}

const bars = (rssi: number) => (rssi >= -55 ? 4 : rssi >= -67 ? 3 : rssi >= -80 ? 2 : 1);
/** Signal strength as four bars and the number. */
export function strength(rssi: number) {
  return `${'▮'.repeat(bars(rssi))}${'▯'.repeat(4 - bars(rssi))} ${rssi} dBm`;
}

/** Sets text only when it changed, so screen readers and selections aren't disturbed. */
export function setText(node: Element, value: string) {
  if (node.textContent !== value) node.textContent = value;
}
