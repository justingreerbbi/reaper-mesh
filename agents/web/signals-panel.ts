/**
 * The panel for one selected signal (D61): what it is, three actions (Hunt, Map, Watch), the key
 * facts, and the rest folded away. Its buttons are built once per selection and only its text is
 * refreshed, so a click never lands on a replaced button while reports stream in.
 */
import { preferences } from './app-state.ts';
import { formatAgo, formatBearing, formatCoordinate, formatHeight, formatSpeed } from './geo.ts';
import { fieldMap } from './map-ui.ts';
import { setView } from './nav.ts';
import { badge, button, el, setText, strength, svg } from './signals-dom.ts';
import {
  airText,
  bandLabel,
  describe,
  formatAddress,
  ID_TYPES,
  KIND_LABELS,
  securityLabel,
  serviceIds,
  serviceLabel,
  TRANSPORTS,
  UA_TYPES,
} from './signals-format.ts';
import { herePlace, history } from './signals-history.ts';
import { huntedKey, startHunt, stopHunt } from './signals-hunt-ui.ts';
import {
  clearCorrection,
  correctIdentity,
  identityOf,
  isLookingUp,
  lookUpWatched,
  requestLookup,
  wigleReady,
} from './signals-identity.ts';
import { placementText } from './signals-radar.ts';
import { confirmSheet, icon } from './ui.ts';
import {
  CATEGORIES,
  KNOWN_DEVICES,
  type Category,
  type Identity,
} from '../../packages/agent-core/signals-identify.ts';
import {
  displayName,
  placementOf,
  strongestPlace,
  type Place,
  type SignalKind,
  type SignalRecord,
} from '../../packages/agent-core/signals-intel.ts';

export const KIND_ICONS: Record<SignalKind, string> = {
  drone: 'drone',
  wifi: 'wifi',
  bluetooth: 'bluetooth',
  probe: 'search',
};

/** What a signal most likely is, in a few words: "Camera · Flock Safety". */
export function whatIs(identity: Identity) {
  const what = identity.device ? KNOWN_DEVICES[identity.device] : CATEGORIES[identity.category];
  return identity.maker && !identity.device ? `${what} · ${identity.maker}` : what;
}

/** The name to show: a known device that sent no name of its own is named for what it is. */
export function titleOf(record: SignalRecord, identity: Identity) {
  if (!record.label && identity.device && record.kind === 'probe')
    return identity.device === 'flock' ? 'Flock camera' : 'Ring device';
  return displayName(record);
}

type Fact = readonly [string, string];
type Parts = {
  key: string;
  name: HTMLElement;
  what: HTMLElement;
  hunt: HTMLButtonElement;
  map: HTMLButtonElement;
  watch: HTMLButtonElement;
  facts: HTMLElement;
  more: HTMLElement;
  why: HTMLElement;
  whySignature: string;
};
let parts: Parts | undefined;
let correcting = false;
let close: () => void = () => {};
let changed: () => void = () => {};

/** `onClose` clears the selection; `onChange` redraws after an edit. */
export function initPanel(onClose: () => void, onChange: () => void) {
  close = onClose;
  changed = onChange;
}

const toLngLat = (place: Place): [number, number] => [place.lon, place.lat];
const wirePlace = (lat?: number, lon?: number): Place | undefined =>
  lat === undefined || lon === undefined ? undefined : { lat: lat / 1e7, lon: lon / 1e7 };

function showOnMap(place: Place) {
  setView('map');
  fieldMap.invalidate();
  fieldMap.showPoint(toLngLat(place));
}

function facts(rows: readonly Fact[]) {
  const list = el('dl', 'signal-facts');
  for (const [label, value] of rows) list.append(el('dt', '', label), el('dd', '', value));
  return list;
}

function when(ms: number, now: number) {
  const date = new Date(ms);
  const today = new Date(now).toDateString() === date.toDateString();
  return `${today ? date.toLocaleTimeString() : date.toLocaleString()} (${formatAgo(ms, now)})`;
}

const placeText = (place: Place | undefined) =>
  place
    ? formatCoordinate(toLngLat(place), preferences.coordinates)
    : 'Your position was not known';

/** Signal strength over the last hour of sightings, as a small line. */
function sparkline(record: SignalRecord, now: number) {
  const points = record.sightings.filter(s => now - s.at <= 60 * 60_000);
  const width = 240;
  const height = 36;
  const chart = svg('svg', {
    viewBox: `0 0 ${width} ${height}`,
    class: 'signal-spark',
    role: 'img',
    'aria-label': 'Signal strength over the last hour',
  });
  if (points.length < 2) return undefined;
  const path = points
    .map((s, i) => {
      const x = ((s.at - (now - 60 * 60_000)) / (60 * 60_000)) * width;
      const y = ((-30 - Math.max(-100, Math.min(-30, s.rssi))) / 70) * height;
      return `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join('');
  chart.append(svg('path', { d: path, class: 'signal-spark-line' }));
  return chart;
}

/** Everything else known about it, for the folded "More details". */
function moreFacts(record: SignalRecord, now: number): Fact[] {
  const r = record.latest;
  const rows: Fact[] = [
    ['First heard', when(record.firstSeen, now)],
    ['Times heard', String(record.visits)],
    ['Strongest', `${record.bestRssi} dBm`],
    ['Last heard from', placeText(record.lastPlace)],
    ['Strongest from', placeText(strongestPlace(record))],
    ['Sends', `${KIND_LABELS[record.kind]} · ${describe(record)}`],
  ];
  if (r.type === 'wifiAp')
    rows.push(
      ['Address', formatAddress(r.address)],
      ['Security', securityLabel(r.security)],
      ['Band', `${bandLabel(r.band)} channel ${r.channel}`],
    );
  if (r.type === 'bleDevice') {
    rows.push([
      'Address',
      `${formatAddress(r.address)}${record.privateAddress ? ' (changes)' : ''}`,
    ]);
    const services = serviceIds(r.services);
    if (services.length) rows.push(['Services', services.map(serviceLabel).join(', ')]);
  }
  if (r.type === 'wifiProbe')
    rows.push(
      ['Address', `${formatAddress(r.address)}${record.privateAddress ? ' (changes)' : ''}`],
      ['Looking for', airText(r.ssid) || 'Any network'],
    );
  if (r.type === 'remoteId') {
    rows.push(
      ['Aircraft', UA_TYPES[r.uaType] ?? `Type ${r.uaType}`],
      ['ID type', ID_TYPES[r.idType] ?? `Type ${r.idType}`],
      ['Heard over', TRANSPORTS[r.transport] ?? 'Remote ID'],
    );
    if (r.altitude !== undefined)
      rows.push(['Altitude', formatHeight(r.altitude / 10, preferences.units)]);
    if (r.height !== undefined)
      rows.push(['Height', formatHeight(r.height / 10, preferences.units)]);
    if (r.speed !== undefined) rows.push(['Speed', formatSpeed(r.speed / 100, preferences.units)]);
    if (r.heading !== undefined)
      rows.push(['Heading', formatBearing(r.heading / 100, preferences.angles)]);
    const position = wirePlace(r.latitude, r.longitude);
    if (position) rows.push(['Position', placeText(position)]);
    const operator = airText(r.operatorId);
    if (operator) rows.push(['Operator ID', operator]);
    const pilot = wirePlace(r.operatorLatitude, r.operatorLongitude);
    if (pilot) rows.push(['Operator position', placeText(pilot)]);
  }
  if (record.lookup)
    rows.push([
      'WiGLE',
      record.lookup.found
        ? `Seen${record.lookup.where ? ` in ${record.lookup.where}` : ''}${
            record.lookup.ssid ? ` as “${record.lookup.ssid}”` : ''
          }${record.lookup.lastSeen ? `, last ${record.lookup.lastSeen.slice(0, 10)}` : ''}`
        : 'Not in its database',
    ]);
  return rows;
}

/** Whether the signal sent a name a correction could be applied by. */
function hasAirName(record: SignalRecord) {
  const r = record.latest;
  return (
    (r.type === 'wifiAp' && !r.hidden && !!airText(r.ssid)) ||
    (r.type === 'bleDevice' && !!airText(r.name))
  );
}

function correctionForm(record: SignalRecord, identity: Identity) {
  const form = el('form', 'signal-correction');
  const select = el('select');
  select.setAttribute('aria-label', 'What it is');
  for (const [value, label] of Object.entries(CATEGORIES)) {
    const option = el('option', '', label);
    option.value = value;
    select.append(option);
  }
  select.value = identity.category;
  const maker = el('input');
  maker.placeholder = 'Maker (optional)';
  maker.value = identity.maker ?? '';
  maker.maxLength = 64;
  maker.setAttribute('aria-label', 'Maker');
  const every = el('input');
  every.type = 'checkbox';
  const save = el('button', 'primary compact', 'Save');
  save.type = 'submit';
  const cancel = button('Cancel', 'x', () => {
    correcting = false;
    changed();
  });
  form.append(select, maker);
  if (hasAirName(record))
    form.append(
      el(
        'label',
        'toggle-row',
        el('span', '', `All named “${displayName({ ...record, label: undefined })}”`),
        every,
      ),
    );
  form.append(el('div', 'signal-card-actions', save, cancel));
  form.addEventListener('submit', event => {
    event.preventDefault();
    correctIdentity(record, select.value as Category, maker.value, every.checked);
    correcting = false;
    changed();
  });
  return form;
}

/** Why the guess, how to correct it, and WiGLE for Wi-Fi networks. */
function whyBlock(record: SignalRecord, identity: Identity) {
  const box = el('div', 'signal-why');
  const reasons = el('ul', 'signal-reasons');
  for (const reason of identity.reasons) reasons.append(el('li', '', reason));
  box.append(reasons);
  if (correcting) box.append(correctionForm(record, identity));
  else {
    const actions = el(
      'div',
      'signal-card-actions',
      button('Correct', 'pencil', () => {
        correcting = true;
        changed();
      }),
    );
    if (identity.fromUser)
      actions.append(
        button('Use the guess', 'undo-2', () => {
          clearCorrection(record);
          changed();
        }),
      );
    if (record.kind === 'wifi' && wigleReady()) {
      const looking = isLookingUp(record.key);
      const ask = button(looking ? 'Looking up…' : 'Look up on WiGLE', 'search', () =>
        requestLookup(record, true),
      );
      ask.disabled = looking;
      actions.append(ask);
    }
    box.append(actions);
  }
  return box;
}

/** Name, note and tags, built once per selection so typing isn't interrupted. */
function notes(record: SignalRecord) {
  const save = (change: Parameters<typeof history.annotate>[1]) => {
    history.annotate(record.key, change);
    changed();
  };
  const field = (label: string, control: HTMLInputElement | HTMLTextAreaElement) =>
    el('label', 'field', el('span', '', label), control);
  const name = el('input');
  name.value = record.label ?? '';
  name.placeholder = 'Your name for it';
  name.maxLength = 64;
  name.addEventListener('change', () => save({ label: name.value.trim() }));
  const note = el('textarea');
  note.value = record.note ?? '';
  note.placeholder = 'Add a note';
  note.rows = 3;
  note.maxLength = 2000;
  note.addEventListener('change', () => save({ note: note.value.trim() }));
  const tags = el('input');
  tags.value = record.tags?.join(', ') ?? '';
  tags.placeholder = 'Tags, separated by commas';
  tags.addEventListener('change', () =>
    save({
      tags: [
        ...new Set(
          tags.value
            .split(',')
            .map(tag => tag.trim())
            .filter(Boolean),
        ),
      ].slice(0, 12),
    }),
  );
  const forget = button('Forget this signal', 'trash-2', () => {
    void confirmSheet({
      title: 'Forget this signal?',
      body: 'Its history, note and tags are deleted.',
      confirm: 'Forget',
      danger: true,
    }).then(ok => {
      if (!ok) return;
      history.remove(record.key);
      close();
    });
  });
  return el(
    'div',
    'signals-editor',
    field('Name', name),
    field('Note', note),
    field('Tags', tags),
    forget,
  );
}

function fold(title: string, open: boolean, ...children: Node[]) {
  const details = el('details', 'signal-fold', el('summary', '', title), ...children);
  details.open = open;
  return details;
}

function build(panel: HTMLElement, record: SignalRecord): Parts {
  const current = () => history.records.get(record.key);
  const name = el('strong');
  const what = el('div', 'signal-what');
  const hunt = button('Hunt', 'radar', () => {
    if (huntedKey() === record.key) stopHunt();
    else startHunt(record.key);
  });
  hunt.title = 'Beep faster as its signal gets stronger, to find it';
  const map = button('Map', 'map-pin', () => {
    const now = current();
    const target = now && (placementOf(now, herePlace()).place ?? now.lastPlace);
    if (target) showOnMap(target);
  });
  const watch = button('Watch', 'crosshair', () => {
    history.annotate(record.key, { watch: !current()?.watch });
    lookUpWatched();
    changed();
  });
  watch.title = 'Mark it, to find it again with Watched';
  const shut = button('', 'x', close, 'round compact signals-panel-close');
  shut.setAttribute('aria-label', 'Close');
  const factsBox = el('div');
  const more = el('div');
  const why = el('div');
  correcting = false;
  panel.replaceChildren(
    shut,
    el('div', 'signal-card-head', icon(KIND_ICONS[record.kind]), name),
    what,
    el('div', 'signal-card-actions signals-panel-actions', hunt, map, watch),
    factsBox,
    fold('Details', false, more),
    fold('Why', false, why),
    fold('Notes', !!(record.label || record.note || record.tags?.length), notes(record)),
  );
  return {
    key: record.key,
    name,
    what,
    hunt,
    map,
    watch,
    facts: factsBox,
    more,
    why,
    whySignature: '',
  };
}

export function renderPanel(panel: HTMLElement, selected: string | undefined, now: number) {
  const record = selected ? history.records.get(selected) : undefined;
  if (!record) {
    panel.hidden = true;
    parts = undefined;
    return;
  }
  panel.hidden = false;
  const p = parts?.key === record.key ? parts : (parts = build(panel, record));
  const identity = identityOf(record);
  const placement = placementOf(record, herePlace());

  setText(p.name, titleOf(record, identity));
  p.what.replaceChildren(
    el('span', '', whatIs(identity)),
    badge(
      identity.fromUser ? 'Yours' : identity.confidence,
      identity.fromUser ? 'good' : undefined,
    ),
  );
  const hunting = huntedKey() === record.key;
  p.hunt.replaceChildren(icon('radar'), hunting ? 'Stop' : 'Hunt');
  p.hunt.className = hunting ? 'compact danger' : 'primary compact';
  p.map.disabled = !(placement.place ?? record.lastPlace);
  p.watch.replaceChildren(icon('crosshair'), record.watch ? 'Watching' : 'Watch');
  p.watch.setAttribute('aria-pressed', String(!!record.watch));

  p.facts.replaceChildren(
    facts([
      ['Where', placementText(placement)],
      ['Signal', strength(record.latest.rssi)],
      ['Heard', formatAgo(record.lastSeen, now)],
    ]),
  );
  const spark = sparkline(record, now);
  const moreChildren: Node[] = spark ? [spark] : [];
  moreChildren.push(facts(moreFacts(record, now)));
  p.more.replaceChildren(...moreChildren);

  // This block has buttons and a form: rebuilt only when what it shows changes.
  const whySignature = JSON.stringify([
    identity,
    correcting,
    isLookingUp(record.key),
    wigleReady(),
  ]);
  if (whySignature !== p.whySignature) {
    p.whySignature = whySignature;
    p.why.replaceChildren(whyBlock(record, identity));
  }
}
