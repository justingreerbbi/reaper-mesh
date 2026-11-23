/**
 * Identifying signals in the portal (D61): the reference pack (served with the portal, refreshed
 * when online, kept in IndexedDB for offline use), the corrections the user teaches, and optional
 * WiGLE lookups of Wi-Fi networks with the user's own key.
 */
import { element, text } from './dom.ts';
import { history, historyStorage } from './signals-history.ts';
import {
  checkReferencePack,
  identify,
  learnedName,
  Reference,
  CATEGORIES,
  type Category,
  type Identity,
  type LearnedRule,
  type ReferencePack,
} from '../../packages/agent-core/signals-identify.ts';
import type { IdentityOf, SignalRecord } from '../../packages/agent-core/signals-intel.ts';
import { lookupWigle, WigleError, type WigleCredentials } from '../../packages/agent-core/wigle.ts';

export const LEARNED_KEY = 'reaper-mesh.signals-rules.v1';
export const WIGLE_KEY = 'reaper-mesh.wigle.v1';
const PACK_URL = 'signals-reference.v1.json';
const MAX_LEARNED = 500;
/** WiGLE lookups: at most one per this long, and this many a day, from this browser. */
const LOOKUP_SPACING_MS = 15_000;
export const LOOKUPS_PER_DAY = 20;
/** A watched network is looked up again after this long. */
const LOOKUP_AGAIN_MS = 30 * 86_400_000;

let reference: Reference | undefined;
let referenceProblem = '';
let referenceSource: 'served' | 'saved' | '' = '';
let learned: LearnedRule[] = readLearned();
/** Bumped when the pack or the learned rules change, so cached guesses are made again. */
let generation = 0;
const cache = new WeakMap<object, { generation: number; override: unknown; identity: Identity }>();
let changed: () => void = () => {};

export function onIdentityChange(callback: () => void) {
  changed = callback;
}

export function identityOf(record: SignalRecord): Identity {
  const cached = cache.get(record.latest);
  if (cached && cached.generation === generation && cached.override === record.identity)
    return cached.identity;
  const identity = identify(record, reference, learned);
  cache.set(record.latest, { generation, override: record.identity, identity });
  return identity;
}

/** For filters and search. */
export const identityForFilter: IdentityOf = record => {
  const identity = identityOf(record);
  return {
    category: identity.category,
    label: CATEGORIES[identity.category],
    ...(identity.maker ? { maker: identity.maker } : {}),
  };
};

// The reference pack.

export const referenceStatus = () => ({
  built: reference?.built,
  makers: reference?.makerCount ?? 0,
  notice: reference?.notice ?? '',
  source: referenceSource,
  problem: referenceProblem,
});

function use(pack: ReferencePack, source: 'served' | 'saved') {
  reference = new Reference(pack);
  referenceSource = source;
  generation++;
}

/**
 * Uses the saved pack straight away, then asks the portal's server for its copy (revalidating, so
 * an unchanged pack costs little) and keeps it if it is newer. Offline, the saved pack stays.
 */
export async function loadReference() {
  referenceProblem = '';
  try {
    const saved = await historyStorage?.getReference();
    if (saved && !checkReferencePack(saved) && !reference) use(saved as ReferencePack, 'saved');
  } catch {
    // Nothing saved yet, or no IndexedDB.
  }
  changed();
  try {
    const response = await fetch(new URL(PACK_URL, document.baseURI), { cache: 'no-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const pack = (await response.json()) as ReferencePack;
    const problem = checkReferencePack(pack);
    if (problem) throw new Error(problem);
    if (!reference || pack.built >= reference.built) {
      use(pack, 'served');
      await historyStorage?.putReference(pack).catch(() => {});
    }
  } catch (error) {
    referenceProblem = reference
      ? ''
      : `The maker database couldn't be loaded (${error instanceof Error ? error.message : error}). Makers are unknown until it is.`;
  }
  changed();
}

// What the user teaches.

function readLearned(): LearnedRule[] {
  try {
    const saved = JSON.parse(localStorage.getItem(LEARNED_KEY) ?? '[]');
    return Array.isArray(saved)
      ? saved.filter(rule => typeof rule?.name === 'string' && rule.category in CATEGORIES)
      : [];
  } catch {
    return [];
  }
}
function saveLearned() {
  try {
    localStorage.setItem(LEARNED_KEY, JSON.stringify(learned));
  } catch {
    // Lasts until the page closes.
  }
  generation++;
}
export const learnedCount = () => learned.length;

/**
 * Sets what a signal is. With `everyNamed`, every signal of its kind with the same name is taken to
 * be the same thing from now on.
 */
export function correctIdentity(
  record: SignalRecord,
  category: Category,
  maker: string,
  everyNamed: boolean,
) {
  const override = { category, ...(maker.trim() ? { maker: maker.trim().slice(0, 64) } : {}) };
  history.annotate(record.key, { identity: override });
  const name = learnedName(record);
  if (everyNamed && name) {
    learned = [
      { kind: record.kind, name, ...override },
      ...learned.filter(rule => !(rule.kind === record.kind && rule.name === name)),
    ].slice(0, MAX_LEARNED);
    saveLearned();
  }
  changed();
}
export function clearCorrection(record: SignalRecord) {
  history.annotate(record.key, { identity: undefined });
  const name = learnedName(record);
  if (name && learned.some(rule => rule.kind === record.kind && rule.name === name)) {
    learned = learned.filter(rule => !(rule.kind === record.kind && rule.name === name));
    saveLearned();
  }
  changed();
}
export function forgetLearned() {
  learned = [];
  saveLearned();
  changed();
}

// WiGLE.

type WigleSettings = { enabled: boolean; name: string; token: string; day: string; used: number };
function readWigle(): WigleSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(WIGLE_KEY) ?? 'null');
    if (saved && typeof saved === 'object')
      return {
        enabled: saved.enabled === true,
        name: typeof saved.name === 'string' ? saved.name : '',
        token: typeof saved.token === 'string' ? saved.token : '',
        day: typeof saved.day === 'string' ? saved.day : '',
        used: Number.isInteger(saved.used) ? saved.used : 0,
      };
  } catch {
    // Starts off.
  }
  return { enabled: false, name: '', token: '', day: '', used: 0 };
}
let wigle = readWigle();
let wigleProblem = '';
let lastLookup = 0;
let pausedUntil = 0;
const queue: string[] = [];
let busy = false;

function saveWigle() {
  try {
    localStorage.setItem(WIGLE_KEY, JSON.stringify(wigle));
  } catch {
    // Lasts until the page closes.
  }
}
const today = () => new Date().toISOString().slice(0, 10);
const credentials = (): WigleCredentials | undefined =>
  wigle.enabled && wigle.name && wigle.token ? { name: wigle.name, token: wigle.token } : undefined;

export const wigleReady = () => !!credentials();
export const wigleStatus = () => ({
  enabled: wigle.enabled,
  configured: !!(wigle.name && wigle.token),
  usedToday: wigle.day === today() ? wigle.used : 0,
  problem: wigleProblem,
  queued: queue.length,
});
export const isLookingUp = (key: string) => queue.includes(key);

/** Queues a lookup of a Wi-Fi network. `byUser` puts it first. */
export function requestLookup(record: SignalRecord, byUser = false) {
  if (record.kind !== 'wifi' || !credentials() || queue.includes(record.key)) return;
  if (byUser) queue.unshift(record.key);
  else queue.push(record.key);
  void drain();
  changed();
}

/** Watched networks not looked up recently are looked up on their own. */
export function lookUpWatched(now = Date.now()) {
  if (!credentials()) return;
  for (const record of history.records.values())
    if (
      record.kind === 'wifi' &&
      record.watch &&
      (!record.lookup || now - record.lookup.at > LOOKUP_AGAIN_MS)
    )
      requestLookup(record);
}

async function drain() {
  if (busy) return;
  busy = true;
  try {
    while (queue.length) {
      const creds = credentials();
      if (!creds) break;
      const now = Date.now();
      if (now < pausedUntil) break;
      if (wigle.day !== today()) {
        wigle.day = today();
        wigle.used = 0;
      }
      if (wigle.used >= LOOKUPS_PER_DAY) {
        wigleProblem = `This browser's ${LOOKUPS_PER_DAY} lookups for today are used. More tomorrow.`;
        break;
      }
      const wait = lastLookup + LOOKUP_SPACING_MS - now;
      if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
      const key = queue[0];
      const record = history.records.get(key);
      if (!record) {
        queue.shift();
        continue;
      }
      lastLookup = Date.now();
      wigle.used++;
      saveWigle();
      try {
        const lookup = await lookupWigle(record.id, creds);
        history.annotate(key, { lookup });
        wigleProblem = '';
      } catch (error) {
        wigleProblem = error instanceof Error ? error.message : String(error);
        if (error instanceof WigleError && error.stop) {
          pausedUntil = Date.now() + 3600_000;
          queue.length = 0;
          break;
        }
      }
      queue.shift();
      changed();
    }
  } finally {
    busy = false;
    changed();
  }
}

// The Signals card in This app.

export function renderSignalsSettings() {
  const status = referenceStatus();
  text(
    'signals-reference-status',
    status.problem ||
      (status.built
        ? `Maker database from ${status.built}: ${status.makers.toLocaleString()} makers${
            status.source === 'saved' ? ' (the copy saved on this computer)' : ''
          }.`
        : 'Loading the maker database…'),
  );
  text('signals-reference-notice', status.notice);
  text(
    'signals-learned-status',
    learned.length
      ? `${learned.length} correction${learned.length === 1 ? '' : 's'} applied by name.`
      : 'No corrections applied by name.',
  );
  element<HTMLButtonElement>('signals-forget-learned').disabled = !learned.length;
  const w = wigleStatus();
  element<HTMLInputElement>('wigle-enabled').checked = w.enabled;
  element('wigle-fields').hidden = !w.enabled;
  text(
    'wigle-status',
    w.problem ||
      (w.enabled && !w.configured
        ? 'Add your WiGLE API name and token.'
        : w.enabled
          ? `${w.usedToday} of ${LOOKUPS_PER_DAY} lookups used today${w.queued ? `; ${w.queued} waiting` : ''}.`
          : ''),
  );
}

export function initSignalsSettings() {
  element('signals-reference-update').addEventListener('click', () => void loadReference());
  element('signals-forget-learned').addEventListener('click', forgetLearned);
  const name = element<HTMLInputElement>('wigle-name');
  const token = element<HTMLInputElement>('wigle-token');
  name.value = wigle.name;
  token.value = wigle.token;
  element<HTMLInputElement>('wigle-enabled').addEventListener('change', event => {
    wigle.enabled = (event.target as HTMLInputElement).checked;
    if (!wigle.enabled) queue.length = 0;
    wigleProblem = '';
    pausedUntil = 0;
    saveWigle();
    lookUpWatched();
    changed();
  });
  const saveCredentials = () => {
    wigle.name = name.value.trim();
    wigle.token = token.value.trim();
    wigleProblem = '';
    pausedUntil = 0;
    saveWigle();
    lookUpWatched();
    changed();
  };
  name.addEventListener('change', saveCredentials);
  token.addEventListener('change', saveCredentials);
}
