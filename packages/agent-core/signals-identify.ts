/**
 * What a signal most likely is (D61): a category, a maker, a confidence and the reasons, from the
 * reference pack (address prefixes and Bluetooth company IDs), what the signal sends, name patterns,
 * and what the user has taught it. Runs entirely on this computer.
 */
import { airText, type SignalKind, type SignalRecord } from './signals-intel.ts';

export const REFERENCE_PACK_VERSION = 1;

/** The reference pack as published (tools/build-signals-reference.ts builds it). */
export type ReferencePack = Readonly<{
  version: number;
  /** The day it was built, YYYY-MM-DD. */
  built: string;
  /** Sources and their license notices, shown in This app. */
  notice: string;
  makers: readonly string[];
  /**
   * Address prefixes per IEEE registry: space-separated entries of the prefix in upper-case hex
   * (6, 7 or 9 digits) followed by the maker's index in base 36.
   */
  oui: Readonly<{ mal: string; mam: string; mas: string }>;
  bluetoothCompanies: readonly (readonly [number, string])[];
  bluetoothServices: readonly (readonly [string, string])[];
}>;

/** Why a pack can't be used, or undefined when it can. */
export function checkReferencePack(value: unknown): string | undefined {
  const pack = value as ReferencePack;
  if (!pack || typeof pack !== 'object') return 'not an object';
  if (pack.version !== REFERENCE_PACK_VERSION)
    return `version ${String(pack.version)} is not ${REFERENCE_PACK_VERSION}`;
  if (typeof pack.built !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(pack.built))
    return 'bad build date';
  if (typeof pack.notice !== 'string') return 'no notice';
  if (!Array.isArray(pack.makers) || pack.makers.some(m => typeof m !== 'string'))
    return 'bad makers';
  for (const [registry, width] of [
    ['mal', 6],
    ['mam', 7],
    ['mas', 9],
  ] as const) {
    const entries = pack.oui?.[registry];
    if (typeof entries !== 'string') return `no ${registry} registry`;
    const pattern = new RegExp(`^[0-9A-F]{${width}}[0-9a-z]+$`);
    for (const entry of entries ? entries.split(' ') : []) {
      if (!pattern.test(entry)) return `bad ${registry} entry ${entry.slice(0, 20)}`;
      if (parseInt(entry.slice(width), 36) >= pack.makers.length)
        return `${registry} entry ${entry.slice(0, width)} names no maker`;
    }
  }
  if (
    !Array.isArray(pack.bluetoothCompanies) ||
    pack.bluetoothCompanies.some(c => !Number.isInteger(c?.[0]) || typeof c?.[1] !== 'string')
  )
    return 'bad Bluetooth companies';
  if (
    !Array.isArray(pack.bluetoothServices) ||
    pack.bluetoothServices.some(s => !/^[0-9A-F]{4}$/.test(s?.[0]) || typeof s?.[1] !== 'string')
  )
    return 'bad Bluetooth services';
  return undefined;
}

/** A pack made ready for lookups. */
export class Reference {
  readonly built: string;
  readonly notice: string;
  readonly makerCount: number;
  #prefixes = [new Map<string, number>(), new Map<string, number>(), new Map<string, number>()];
  #makers: readonly string[];
  #companies: Map<number, string>;
  #services: Map<string, string>;

  constructor(pack: ReferencePack) {
    this.built = pack.built;
    this.notice = pack.notice;
    this.#makers = pack.makers;
    this.makerCount = pack.makers.length;
    const registries = [pack.oui.mas, pack.oui.mam, pack.oui.mal];
    const widths = [9, 7, 6];
    registries.forEach((entries, i) => {
      for (const entry of entries ? entries.split(' ') : [])
        this.#prefixes[i].set(entry.slice(0, widths[i]), parseInt(entry.slice(widths[i]), 36));
    });
    this.#companies = new Map(pack.bluetoothCompanies.map(([id, name]) => [id, name]));
    this.#services = new Map(pack.bluetoothServices.map(([id, name]) => [id, name]));
  }

  /** The maker registered for an address (hex), most specific registry first. */
  maker(address: string) {
    const hex = address.toUpperCase();
    for (const [i, width] of [9, 7, 6].entries()) {
      const at = this.#prefixes[i].get(hex.slice(0, width));
      if (at !== undefined) return this.#makers[at];
    }
    return undefined;
  }
  company(id: number) {
    return this.#companies.get(id);
  }
  service(uuid: string) {
    return this.#services.get(uuid.toUpperCase());
  }
}

export const CATEGORIES = {
  drone: 'Drone',
  tracker: 'Tracker',
  phone: 'Phone or tablet',
  computer: 'Computer or accessory',
  'access-point': 'Router or access point',
  hotspot: 'Hotspot',
  camera: 'Camera',
  printer: 'Printer',
  tv: 'TV or media player',
  audio: 'Headphones or speaker',
  wearable: 'Watch or fitness device',
  vehicle: 'Vehicle',
  sensor: 'Sensor or beacon',
  'smart-home': 'Smart home or IoT device',
  unknown: 'Unknown',
} as const;
export type Category = keyof typeof CATEGORIES;

/** Device families recognised by their own signatures, which the Signals filters can pick out. */
export const KNOWN_DEVICES = {
  flock: 'Flock Safety device',
  ring: 'Ring doorbell or camera',
} as const;
export type KnownDevice = keyof typeof KNOWN_DEVICES;
export type Confidence = 'high' | 'medium' | 'low';

export type Identity = Readonly<{
  category: Category;
  maker?: string;
  confidence: Confidence;
  reasons: readonly string[];
  /** The user said so, rather than the rules guessing. */
  fromUser: boolean;
  /** A known device family it matches. */
  device?: KnownDevice;
}>;

/** The user's correction for one signal. */
export type IdentityOverride = Readonly<{ category: Category; maker?: string }>;
/** A correction the user applied to every signal of a kind with a given name (lower case). */
export type LearnedRule = Readonly<{
  kind: SignalKind;
  name: string;
  category: Category;
  maker?: string;
}>;

type Evidence = {
  category?: Category;
  maker?: string;
  device?: KnownDevice;
  weight: number;
  reason: string;
};

/** Patterns in network and device names: [pattern, category, maker, weight]. */
const NAME_RULES: readonly (readonly [RegExp, Category, string | undefined, number])[] = [
  [/\b(dji|mavic|tello|phantom|osmo)\b/i, 'drone', 'DJI', 3],
  [/\b(skydio|anafi|parrot|autel|evo ii)\b/i, 'drone', undefined, 3],
  [/\b(airtag|smarttag|chipolo|tile)\b/i, 'tracker', undefined, 3],
  [/\biphone\b/i, 'phone', 'Apple', 3],
  [/\bipad\b/i, 'phone', 'Apple', 3],
  [/\b(galaxy|pixel|oneplus|moto [a-z]|xperia|redmi|android)\b/i, 'phone', undefined, 3],
  [
    /\b(macbook|imac|mac mini|laptop|desktop|thinkpad|surface|chromebook)\b|-pc\b/i,
    'computer',
    undefined,
    3,
  ],
  [/\b(keyboard|mouse|trackpad|mx (master|keys)|logi)\b/i, 'computer', undefined, 2],
  [
    /\b(watch|fitbit|forerunner|fenix|venu|vivo(active|smart)|whoop|oura|amazfit|mi band|polar)\b/i,
    'wearable',
    undefined,
    3,
  ],
  [
    /\b(airpods|beats|buds|jbl|bose|sony wh|wf-|headphones?|earbuds|speaker|soundbar|sonos|jabra|sennheiser)\b/i,
    'audio',
    undefined,
    3,
  ],
  [
    /\b(roku|chromecast|fire ?tv|apple ?tv|bravia|vizio|\[tv\]|smart ?tv|lg webos)\b/i,
    'tv',
    undefined,
    3,
  ],
  [
    /\b(tesla|model [3sxy]|ford|toyota|honda|chevy|gmc|onstar|subaru|hyundai|kia|bmw|audi|mercedes|vw|volkswagen|jeep|ram|rivian|uconnect|carplay|my ?car|obd)\b/i,
    'vehicle',
    undefined,
    3,
  ],
  [
    /\b(gopro|dashcam|dash cam|70mai|viofo|blackvue|arlo|wyze ?cam|eufy|ring|reolink|blink|camera|cam)\b/i,
    'camera',
    undefined,
    2,
  ],
  [
    /\b(ruuvi|govee|switchbot|thermo|hygro|lywsd|atc_|ibs-th|inkbird|qingping|sensor|beacon)\b/i,
    'sensor',
    undefined,
    2,
  ],
  [
    /\b(hue|nest|ecobee|kasa|tuya|smartlife|shelly|esp[-_]?\w*|tasmota|wemo|echo|alexa|google home|meross|lifx)\b/i,
    'smart-home',
    undefined,
    2,
  ],
  [
    /^direct-\w\w-hp|\b(hp[- ]print|officejet|laserjet|deskjet|envy|epson|canon|brother|xerox)\b/i,
    'printer',
    undefined,
    3,
  ],
  [/^direct-/i, 'printer', undefined, 1],
  [/\b(hotspot|'s iphone|’s iphone|mifi|jetpack|nighthawk m)\b/i, 'hotspot', undefined, 3],
  [
    /^(xfinity|xfinitywifi|attwifi|att-?[a-z0-9]{3}|spectrum|myspectrumwifi|cox ?wifi|verizon|fios|netgear|linksys|tp-?link|asus|orbi|eero|google ?wifi|nest ?wifi|ubnt|ubiquiti|unifi|optimum|centurylink|frontier|starlink)/i,
    'access-point',
    undefined,
    3,
  ],
];
const NAME_MAKERS: readonly (readonly [RegExp, string])[] = [
  [/\b(iphone|ipad|macbook|airpods|apple)\b/i, 'Apple'],
  [/\bgalaxy\b/i, 'Samsung'],
  [/\bpixel\b/i, 'Google'],
  [/^direct-\w\w-hp|\bhp\b/i, 'HP'],
  [/\btesla\b/i, 'Tesla'],
  [/\bgopro\b/i, 'GoPro'],
  [/\b(netgear|orbi|nighthawk)\b/i, 'Netgear'],
  [/\btp-?link\b/i, 'TP-Link'],
  [/\b(ubnt|ubiquiti|unifi)\b/i, 'Ubiquiti'],
  [/\beero\b/i, 'eero'],
  [/\bstarlink\b/i, 'Starlink'],
  [/\bxfinity/i, 'Comcast Xfinity'],
  [/\bgarmin|forerunner|fenix|venu\b/i, 'Garmin'],
  [/\bfitbit\b/i, 'Fitbit'],
];
/** Makers whose devices are mostly one kind: [pattern, category, weight]. */
const MAKER_RULES: readonly (readonly [RegExp, Category, number])[] = [
  [/\b(sz dji|dji|autel|skydio|parrot)\b/i, 'drone', 3],
  [/\b(gopro|hikvision|dahua|reolink|axis communications|arlo|wyze)\b/i, 'camera', 2],
  [
    /\b(hp inc|hewlett[- ]packard|seiko epson|canon|brother industries|xerox|lexmark|kyocera|ricoh)\b/i,
    'printer',
    2,
  ],
  [/\b(garmin|fitbit|polar electro|suunto|whoop|oura|huami|zepp|amazfit)\b/i, 'wearable', 2],
  [
    /\b(bose|harman|sennheiser|sonos|skullcandy|bang & olufsen|jabra|gn audio|sony home)\b/i,
    'audio',
    2,
  ],
  [/\b(roku|vizio|hisense|tcl|lg electronics|nintendo|sony interactive)\b/i, 'tv', 1],
  [/\b(tesla|continental automotive|denso|visteon|alps alpine|lg innotek)\b/i, 'vehicle', 2],
  [
    /\b(espressif|tuya|signify|philips lighting|ecobee|shelly|lifx|tp-link systems|ring llc)\b/i,
    'smart-home',
    2,
  ],
  [/\b(ruuvi|govee|switchbot|qingping|inkbird|tile|chipolo)\b/i, 'sensor', 2],
  [
    /\b(raspberry pi|intel corporate|dell|lenovo|microsoft|azurewave|liteon|hon hai|quanta|compal|wistron)\b/i,
    'computer',
    2,
  ],
  [
    /\b(apple|samsung electronics|xiaomi|oneplus|motorola mobility|huawei device|oppo|vivo mobile|google)\b/i,
    'phone',
    1,
  ],
  [
    /\b(ubiquiti|cisco|aruba|ruckus|netgear|arris|technicolor|sagemcom|eero|juniper|meraki|fortinet|cambium|mikrotik|zyxel|d-link|linksys|actiontec|askey|sercomm|calix|commscope|extreme networks|space exploration)\b/i,
    'access-point',
    2,
  ],
];
/** Bluetooth services that say what a device is: [UUID, category, weight, reason]. */
const SERVICE_RULES: readonly (readonly [string, Category, number, string])[] = [
  ['FFFA', 'drone', 5, 'sends Remote ID'],
  ['FD6F', 'phone', 3, 'sends exposure notifications, which phones do'],
  ['180D', 'wearable', 2, 'has a heart rate service'],
  ['1826', 'wearable', 2, 'has a fitness machine service'],
  ['183E', 'wearable', 2, 'has a physical activity service'],
  ['1812', 'computer', 2, 'is a keyboard, mouse or other input device'],
  ['FE2C', 'audio', 1, 'supports Google Fast Pair, mostly headphones'],
  ['184E', 'audio', 2, 'supports LE Audio'],
  ['1844', 'audio', 2, 'supports LE Audio volume control'],
  ['181A', 'sensor', 2, 'has an environmental sensing service'],
  ['FCD2', 'sensor', 3, 'sends BTHome sensor data'],
  ['FEAA', 'sensor', 2, 'is an Eddystone beacon'],
  ['FEED', 'tracker', 4, 'is a Tile'],
  ['FEEC', 'tracker', 4, 'is a Tile'],
  ['FD5A', 'tracker', 4, 'is a Samsung SmartTag'],
];
const TRACKERS: Record<number, string> = {
  1: 'Apple',
  2: 'Tile',
  3: 'Samsung',
  4: 'Google',
};
/** ANSI/CTA-2063 serial numbers start with the maker's code. */
const UAS_MAKERS: Record<string, string> = { '1581': 'DJI' };

// Known device families. Sources: the flock-you project's signature lists (colonelpanichacks),
// the IEEE registry and the Bluetooth SIG assigned numbers; see the signals intelligence design.

/** The one prefix registered to Flock Safety itself. */
const FLOCK_OUI = 'b41e52';
/**
 * Prefixes of the Wi-Fi modules Flock cameras use (Liteon, USI). Other products use them too, so
 * they count only with the camera's habit of searching for any network on 2.4 GHz.
 */
const FLOCK_MODULE_OUIS = new Set(
  (
    '70c94e 3c9180 d8f3bc 803049 145afc 744ca1 9c2f9d c03532 940853 e4aaea f46add e00af6 ' +
    '24b2b9 00f48d d03957 e8d0fc b81ea4 700894 5800e3 5c93a2 646e69 14b5cd 083a88 e04f43'
  ).split(' '),
);
/** Bluetooth company ID in Flock battery packs' adverts (registered to XUNTONG). */
const FLOCK_COMPANY = 0x09c8;
/** Prefixes registered to Ring LLC. */
const RING_OUIS = new Set(
  '00b463 187f88 242bd6 343ea4 50e467 54e019 5c475e 649a63 90486c 9c7613 ac9fc3 c4dbad cc3bfb'.split(
    ' ',
  ),
);

function knownDevices(record: SignalRecord): Evidence[] {
  const r = record.latest;
  const found: Evidence[] = [];
  const prefix = record.kind === 'drone' || record.privateAddress ? '' : record.id.slice(0, 6);
  const flock = (weight: number, reason: string) =>
    found.push({ device: 'flock', category: 'camera', maker: 'Flock Safety', weight, reason });
  const ring = (weight: number, reason: string) =>
    found.push({ device: 'ring', category: 'camera', maker: 'Ring', weight, reason });

  if (prefix === FLOCK_OUI) flock(6, 'Its address is registered to Flock Safety');
  if (RING_OUIS.has(prefix)) ring(5, 'Its address is registered to Ring');
  if (r.type === 'wifiAp') {
    const ssid = airText(r.ssid);
    if (/^flock(-[0-9a-f]{6})?$/i.test(ssid)) flock(6, 'Its network name is a Flock camera’s');
    if (/^ring[- ](setup[- ])?[0-9a-f]{2,6}$/i.test(ssid))
      ring(4, 'Its network name is a Ring device’s in setup mode');
  }
  if (r.type === 'wifiProbe' && !airText(r.ssid) && r.band === 1 && FLOCK_MODULE_OUIS.has(prefix))
    flock(3, 'It searches for any network from a Wi-Fi module Flock cameras use');
  if (r.type === 'bleDevice') {
    const name = airText(r.name);
    if (/^penguin-\d{10}$/i.test(name) || /^fs ext battery/i.test(name))
      flock(6, 'Its name is a Flock battery pack’s');
    else if (/pigvision/i.test(name)) flock(4, 'Its name has been used by Flock devices');
    if (r.manufacturer === FLOCK_COMPANY)
      flock(4, 'Its Bluetooth data has the company ID Flock battery packs use');
    // A Raven gunshot detector advertises services 0x3100 to 0x3500.
    let raven = 0;
    for (let i = 0; r.services && i + 4 <= r.services.length; i += 4) {
      const uuid = parseInt(r.services.slice(i + 2, i + 4) + r.services.slice(i, i + 2), 16);
      if (uuid >= 0x3100 && uuid <= 0x3500 && uuid % 0x100 === 0) raven++;
    }
    if (raven) flock(raven > 1 ? 5 : 3, 'It advertises a Flock Raven gunshot detector’s services');
    if (/^ring[- ]/i.test(name)) ring(2, 'Its name starts with Ring');
  }
  return found;
}

function nameOf(record: SignalRecord) {
  const r = record.latest;
  if (r.type === 'wifiAp') return airText(r.ssid);
  if (r.type === 'bleDevice') return airText(r.name);
  if (r.type === 'remoteId') return airText(r.uasId);
  return '';
}

/** The name a learned rule matches: the network or device name, in lower case. */
export const learnedName = (record: SignalRecord) => nameOf(record).toLowerCase();

function evidence(record: SignalRecord, reference?: Reference): Evidence[] {
  const r = record.latest;
  const found: Evidence[] = [];
  switch (record.kind) {
    case 'drone':
      found.push({ category: 'drone', weight: 5, reason: 'It sends Remote ID' });
      break;
    case 'wifi':
      found.push({
        category: 'access-point',
        weight: 1,
        reason: 'Wi-Fi networks are mostly routers or access points',
      });
      break;
    case 'probe':
      found.push({
        category: 'phone',
        weight: 1,
        reason: 'Devices searching for networks are mostly phones and laptops',
      });
      break;
    case 'bluetooth':
      break;
  }
  if (record.privateAddress) {
    if (record.kind === 'wifi')
      found.push({
        category: 'hotspot',
        weight: 1,
        reason: 'A locally assigned address: often a phone hotspot or a router’s second network',
      });
    else if (record.kind === 'bluetooth')
      found.push({
        category: 'phone',
        weight: 1,
        reason: 'A changing address, which phones, tablets and laptops use',
      });
  } else if (record.kind !== 'drone' && reference) {
    const maker = reference.maker(record.id);
    if (maker) {
      found.push({ maker, weight: 2, reason: `Its address belongs to ${maker}` });
      for (const [pattern, category, weight] of MAKER_RULES)
        if (pattern.test(maker)) {
          found.push({ category, weight, reason: `${maker} mostly makes devices of this kind` });
          break;
        }
    }
  }
  if (r.type === 'bleDevice') {
    if (r.tracker !== undefined)
      found.push({
        category: 'tracker',
        maker: TRACKERS[r.tracker],
        weight: 6,
        reason: 'It advertises as an item tracker',
      });
    if (r.manufacturer !== undefined) {
      const company = reference?.company(r.manufacturer);
      if (company)
        found.push({ maker: company, weight: 3, reason: `Its Bluetooth data is from ${company}` });
      if (r.manufacturer === 0x004c && r.tracker === undefined)
        found.push({
          category: 'phone',
          weight: 1,
          reason: 'Apple Bluetooth: an iPhone, iPad, Mac, Watch or AirPods',
        });
      if (company)
        for (const [pattern, category, weight] of MAKER_RULES)
          if (pattern.test(company)) {
            found.push({
              category,
              weight,
              reason: `${company} mostly makes devices of this kind`,
            });
            break;
          }
    }
    const services = new Set<string>();
    for (let i = 0; r.services && i + 4 <= r.services.length; i += 4)
      services.add((r.services.slice(i + 2, i + 4) + r.services.slice(i, i + 2)).toUpperCase());
    for (const [uuid, category, weight, reason] of SERVICE_RULES)
      if (services.has(uuid)) found.push({ category, weight, reason: `It ${reason}` });
  }
  if (r.type === 'remoteId') {
    const maker = UAS_MAKERS[airText(r.uasId).slice(0, 4)];
    if (maker) found.push({ maker, weight: 3, reason: `Its serial number is from ${maker}` });
  }
  const name = nameOf(record);
  if (name && record.kind !== 'probe') {
    for (const [pattern, category, maker, weight] of NAME_RULES)
      if (pattern.test(name)) {
        found.push({
          category,
          maker,
          weight,
          reason: `Its name looks like a ${CATEGORIES[category].toLowerCase()}`,
        });
        break;
      }
    for (const [pattern, maker] of NAME_MAKERS)
      if (pattern.test(name)) {
        found.push({ maker, weight: 1, reason: `Its name suggests ${maker}` });
        break;
      }
  }
  return found;
}

/**
 * The best guess for a signal. The user's own correction wins, then a rule they taught for its
 * name, then the evidence: the category with the most weight, the maker with the most.
 */
export function identify(
  record: SignalRecord & { identity?: IdentityOverride },
  reference?: Reference,
  learned: readonly LearnedRule[] = [],
): Identity {
  if (record.identity)
    return { ...record.identity, confidence: 'high', reasons: ['You set this'], fromUser: true };
  const name = learnedName(record);
  const rule = name ? learned.find(l => l.kind === record.kind && l.name === name) : undefined;
  if (rule)
    return {
      category: rule.category,
      ...(rule.maker ? { maker: rule.maker } : {}),
      confidence: 'high',
      reasons: [`You said signals named “${nameOf(record)}” are this`],
      fromUser: true,
    };
  const found = [...knownDevices(record), ...evidence(record, reference)];
  const score = new Map<Category, number>();
  const makers = new Map<string, number>();
  for (const e of found) {
    if (e.category) score.set(e.category, (score.get(e.category) ?? 0) + e.weight);
    if (e.maker) makers.set(e.maker, (makers.get(e.maker) ?? 0) + e.weight);
  }
  let category: Category = 'unknown';
  let best = 0;
  for (const [candidate, weight] of score)
    if (weight > best) {
      category = candidate;
      best = weight;
    }
  let maker: string | undefined;
  let makerWeight = 0;
  for (const [candidate, weight] of makers)
    if (weight > makerWeight) {
      maker = candidate;
      makerWeight = weight;
    }
  let device: KnownDevice | undefined;
  let deviceWeight = 0;
  for (const e of found)
    if (e.device && e.weight > deviceWeight) {
      device = e.device;
      deviceWeight = e.weight;
    }
  const reasons = found.filter(e => !e.category || e.category === category).map(e => e.reason);
  return {
    category,
    ...(maker ? { maker } : {}),
    ...(device ? { device } : {}),
    confidence: best >= 4 ? 'high' : best >= 2 ? 'medium' : 'low',
    reasons: reasons.length ? reasons : ['Nothing it sends says what it is'],
    fromUser: false,
  };
}
