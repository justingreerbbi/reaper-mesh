/**
 * Reads NMEA 0183 from a USB GPS receiver: the RMC and GGA sentences every receiver sends, from any
 * constellation (GP, GN, GL, GA, BD). It turns them into one fix per second, or however often the
 * receiver reports. Pure, so the host tests can feed it recorded output.
 */

export type GpsFix = Readonly<{
  latitude: number;
  longitude: number;
  /** Metres above mean sea level, from GGA. */
  altitude: number | null;
  /** Metres per second over the ground, from RMC. */
  speed: number | null;
  /** Direction of travel, degrees from true north, from RMC. */
  course: number | null;
  /** A rough horizontal accuracy in metres from the receiver's HDOP, or null without GGA. */
  accuracy: number | null;
  satellites: number | null;
}>;

/** Roughly what one unit of HDOP means in metres for a consumer receiver. */
const METERS_PER_HDOP = 5;
const KNOTS = 0.514444;

/** The fields of a sentence with a correct checksum, or undefined. */
export function sentenceFields(line: string): string[] | undefined {
  const text = line.trim();
  const match = /^\$([A-Z0-9,.\-+ ]*)\*([0-9A-Fa-f]{2})$/.exec(text.replace(/[^\x20-\x7e]/g, ''));
  if (!match) return undefined;
  let sum = 0;
  for (const char of match[1]) sum ^= char.charCodeAt(0);
  if (sum !== Number.parseInt(match[2], 16)) return undefined;
  return match[1].split(',');
}

/** "4807.038","N" to 48.1173. Empty or malformed fields give undefined. */
function coordinate(value: string, hemisphere: string, degreeDigits: number) {
  if (!/^\d+(\.\d+)?$/.test(value) || value.length < degreeDigits + 2) return undefined;
  const degrees = Number(value.slice(0, degreeDigits));
  const minutes = Number(value.slice(degreeDigits));
  if (minutes >= 60) return undefined;
  const result = degrees + minutes / 60;
  if (hemisphere === 'S' || hemisphere === 'W') return -result;
  if (hemisphere === 'N' || hemisphere === 'E') return result;
  return undefined;
}

const number = (value: string | undefined) =>
  value !== undefined && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null;

type Part = {
  time: string;
  latitude?: number;
  longitude?: number;
  altitude?: number | null;
  speed?: number | null;
  course?: number | null;
  accuracy?: number | null;
  satellites?: number | null;
  rmc?: boolean;
  gga?: boolean;
  /** The receiver said this epoch has no usable fix. */
  void?: boolean;
};

/**
 * Collects RMC and GGA for each reporting time and hands over one fix per time, once both have
 * arrived, or when the next time begins for a receiver that sends only one of them.
 */
export class NmeaReader {
  #buffer = '';
  #pending: Part | undefined;
  /** Any well-formed sentence, so a working receiver without a fix can be told from silence. */
  sentences = 0;
  /** From the last GGA or RMC: whether the receiver has a fix at all. */
  hasFix = false;
  satellites: number | null = null;
  onFix?: (fix: GpsFix) => void;

  /** Feeds raw text from the port. */
  push(text: string) {
    this.#buffer += text;
    // A receiver sends a line at least every second; anything this long is not NMEA.
    if (this.#buffer.length > 4096) this.#buffer = this.#buffer.slice(-512);
    let end: number;
    while ((end = this.#buffer.search(/[\r\n]/)) >= 0) {
      const line = this.#buffer.slice(0, end);
      this.#buffer = this.#buffer.slice(end + 1);
      if (line) this.line(line);
    }
  }

  line(line: string) {
    // Noise or a sentence cut off when the port opened can run into the next one.
    const start = line.lastIndexOf('$');
    const fields = start >= 0 ? sentenceFields(line.slice(start)) : undefined;
    if (!fields) return;
    this.sentences++;
    const kind = fields[0].slice(-3);
    if (kind === 'RMC') this.#rmc(fields);
    else if (kind === 'GGA') this.#gga(fields);
  }

  #part(time: string) {
    if (this.#pending && this.#pending.time !== time) this.#emit();
    this.#pending ??= { time };
    return this.#pending;
  }

  // $GPRMC,hhmmss.ss,A,llll.ll,a,yyyyy.yy,a,speed,course,ddmmyy,...
  #rmc(f: string[]) {
    const part = this.#part(f[1] ?? '');
    part.rmc = true;
    if (f[2] !== 'A') {
      part.void = true;
      this.hasFix = false;
    } else {
      part.latitude ??= coordinate(f[3], f[4], 2);
      part.longitude ??= coordinate(f[5], f[6], 3);
      const knots = number(f[7]);
      part.speed = knots === null ? null : knots * KNOTS;
      part.course = number(f[8]);
    }
    if (part.gga) this.#emit();
  }

  // $GPGGA,hhmmss.ss,llll.ll,a,yyyyy.yy,a,quality,satellites,hdop,altitude,M,...
  #gga(f: string[]) {
    const part = this.#part(f[1] ?? '');
    part.gga = true;
    const quality = number(f[6]);
    this.satellites = number(f[7]);
    part.satellites = this.satellites;
    if (!quality) {
      part.void = true;
      this.hasFix = false;
    } else {
      part.latitude = coordinate(f[2], f[3], 2) ?? part.latitude;
      part.longitude = coordinate(f[4], f[5], 3) ?? part.longitude;
      const hdop = number(f[8]);
      part.accuracy = hdop === null ? null : hdop * METERS_PER_HDOP;
      part.altitude = f[10] === 'M' || f[10] === '' ? number(f[9]) : null;
    }
    if (part.rmc) this.#emit();
  }

  #emit() {
    const part = this.#pending;
    this.#pending = undefined;
    if (!part || part.void || part.latitude === undefined || part.longitude === undefined) return;
    this.hasFix = true;
    this.onFix?.({
      latitude: part.latitude,
      longitude: part.longitude,
      altitude: part.altitude ?? null,
      speed: part.speed ?? null,
      course: part.course ?? null,
      accuracy: part.accuracy ?? null,
      satellites: part.satellites ?? null,
    });
  }
}
