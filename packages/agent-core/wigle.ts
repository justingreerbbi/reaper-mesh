/**
 * Looking up a Wi-Fi network on WiGLE (D61), with the user's own API name and token. A lookup
 * sends WiGLE the network's address. Only used when the user turns lookups on.
 */
import type { NetworkLookup } from './signals-intel.ts';

export type WigleCredentials = Readonly<{ name: string; token: string }>;
type Fetch = (url: string, init: RequestInit) => Promise<Response>;

export class WigleError extends Error {
  /** Lookups should stop for a while (bad key or the daily limit). */
  readonly stop: boolean;
  constructor(message: string, stop: boolean) {
    super(message);
    this.stop = stop;
  }
}

const formatBssid = (hex: string) => hex.toUpperCase().replace(/(..)(?!$)/g, '$1:');
const text = (value: unknown, limit = 64) =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, limit) : undefined;
const degrees = (value: unknown, limit: number) =>
  typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit && value !== 0
    ? value
    : undefined;

/** Reads WiGLE's search answer. Anything malformed counts as not found. */
export function parseWigle(body: unknown, at: number): NetworkLookup {
  const results = (body as { results?: unknown })?.results;
  const first = Array.isArray(results) ? (results[0] as Record<string, unknown>) : undefined;
  if (!first || typeof first !== 'object') return { at, source: 'wigle', found: false };
  const lat = degrees(first.trilat, 90);
  const lon = degrees(first.trilong, 180);
  const where = [text(first.city), text(first.region), text(first.country)]
    .filter(Boolean)
    .join(', ');
  const ssid = text(first.ssid);
  const firstSeen = text(first.firsttime, 32);
  const lastSeen = text(first.lasttime, 32) ?? text(first.lastupdt, 32);
  return {
    at,
    source: 'wigle',
    found: true,
    ...(lat !== undefined && lon !== undefined ? { place: { lat, lon } } : {}),
    ...(ssid ? { ssid } : {}),
    ...(firstSeen ? { firstSeen } : {}),
    ...(lastSeen ? { lastSeen } : {}),
    ...(where ? { where } : {}),
  };
}

export async function lookupWigle(
  address: string,
  credentials: WigleCredentials,
  options: { fetch?: Fetch; now?: () => number } = {},
): Promise<NetworkLookup> {
  const run = options.fetch ?? ((url, init) => fetch(url, init));
  const url = `https://api.wigle.net/api/v2/network/search?netid=${encodeURIComponent(formatBssid(address))}`;
  let response: Response;
  try {
    response = await run(url, {
      headers: {
        Accept: 'application/json',
        Authorization: `Basic ${btoa(`${credentials.name}:${credentials.token}`)}`,
      },
      credentials: 'omit',
    });
  } catch {
    throw new WigleError("Couldn't reach WiGLE. Check the internet connection.", false);
  }
  if (response.status === 401 || response.status === 403)
    throw new WigleError('WiGLE refused the API name or token. Check them in This app.', true);
  if (response.status === 429)
    throw new WigleError("WiGLE's daily lookup limit for this account is used up.", true);
  if (!response.ok) throw new WigleError(`WiGLE answered ${response.status}.`, false);
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new WigleError('WiGLE sent an answer that could not be read.', false);
  }
  return parseWigle(body, (options.now ?? Date.now)());
}
