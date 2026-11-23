/**
 * Hunt mode in the portal (D61): pick a signal, press Hunt, and the portal beeps faster and higher
 * as its signal gets stronger, with a meter, warmer or colder, and the peak. Web Audio needs the
 * Hunt click to start, and keeps beeping while the portal shows another tab.
 */
import { formatAgo, formatDistance } from './geo.ts';
import { preferences } from './app-state.ts';
import { element } from './dom.ts';
import { history, onRecorded } from './signals-history.ts';
import { closeness, Hunt, type Trend } from '../../packages/agent-core/signals-hunt.ts';
import { displayName } from '../../packages/agent-core/signals-intel.ts';

const BEEP_MS = 60;
const TREND_TEXT: Record<Trend, string> = {
  warmer: 'Warmer',
  colder: 'Colder',
  steady: 'Steady',
  unknown: '',
};

let hunt: Hunt | undefined;
let audio: AudioContext | undefined;
let muted = false;
let beepTimer: ReturnType<typeof setTimeout> | undefined;
let screenTimer: ReturnType<typeof setInterval> | undefined;
let changed: () => void = () => {};
/** Whether the add-on reports the hunted signal quickly (set when it does). */
let fast = false;

export const huntedKey = () => hunt?.key;
export function onHuntChange(callback: () => void) {
  changed = callback;
}

function beep(pitch: number, length: number) {
  if (muted || !audio) return;
  const now = audio.currentTime;
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  oscillator.type = 'sine';
  oscillator.frequency.value = pitch;
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.25, now + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + length / 1000);
  oscillator.connect(gain).connect(audio.destination);
  oscillator.start(now);
  oscillator.stop(now + length / 1000 + 0.02);
  if (!muted && 'vibrate' in navigator) navigator.vibrate?.(length >= 100 ? 15 : 25);
}

function tick() {
  if (!hunt) return;
  const next = hunt.beep(Date.now(), fast);
  beep(next.pitch, next.lost ? 120 : BEEP_MS);
  beepTimer = setTimeout(tick, next.interval);
}

/** Starts hunting a signal. Call it from a click: browsers start audio only after a gesture. */
export function startHunt(key: string) {
  const record = history.records.get(key);
  if (!record) return;
  stopHunt(false);
  const now = Date.now();
  hunt = new Hunt(key, record.kind, now);
  // The last report counts if it is recent, so the beep starts at once.
  if (now - record.lastSeen < 15_000) hunt.feed(record.latest.rssi, record.lastSeen);
  fast = false;
  try {
    audio ??= new AudioContext();
    void audio.resume();
  } catch {
    audio = undefined; // No Web Audio: the meter still works.
  }
  tick();
  screenTimer = setInterval(renderHunt, 250);
  renderHunt();
  changed();
}

export function stopHunt(notify = true) {
  clearTimeout(beepTimer);
  clearInterval(screenTimer);
  hunt = undefined;
  renderHunt();
  if (notify) changed();
}

onRecorded((key, rssi, at) => {
  if (!hunt || key !== hunt.key) return;
  // Reports less than 2 s apart mean the add-on is reporting this signal quickly.
  if (hunt.lastAt !== undefined && at - hunt.lastAt < 2000) fast = true;
  hunt.feed(rssi, at);
});

/** The hunt card above the radar. Built once per hunt, then only its values change. */
export function renderHunt() {
  const card = element('signals-hunt');
  if (!hunt) {
    card.hidden = true;
    card.replaceChildren();
    delete card.dataset.key;
    return;
  }
  const record = history.records.get(hunt.key);
  card.hidden = false;
  if (card.dataset.key !== hunt.key) {
    card.dataset.key = hunt.key;
    card.innerHTML = `
      <div class="hunt-head">
        <strong class="hunt-title"></strong>
        <button type="button" class="compact hunt-mute"></button>
        <button type="button" class="compact danger hunt-stop">Stop</button>
      </div>
      <div class="hunt-reading">
        <span class="hunt-rssi"></span>
        <span class="hunt-trend"></span>
      </div>
      <div class="hunt-meter" role="meter" aria-label="Signal strength" aria-valuemin="0" aria-valuemax="100"><span></span></div>
      <small class="hunt-facts muted"></small>`;
    card.title =
      'Faster, higher beeps mean a stronger signal. Turn slowly: your body blocks it from behind.';
    card.querySelector<HTMLButtonElement>('.hunt-stop')!.onclick = () => stopHunt();
    card.querySelector<HTMLButtonElement>('.hunt-mute')!.onclick = () => {
      muted = !muted;
      renderHunt();
    };
  }
  const now = Date.now();
  const smoothed = hunt.smoothed;
  const lost = hunt.isLost(now, fast);
  const set = (selector: string, value: string) => {
    const node = card.querySelector(selector)!;
    if (node.textContent !== value) node.textContent = value;
  };
  set('.hunt-title', `Hunting ${record ? displayName(record) : 'a signal'}`);
  set('.hunt-mute', muted ? 'Sound on' : 'Mute');
  set('.hunt-rssi', smoothed === undefined ? '—' : `${Math.round(smoothed)} dBm`);
  set('.hunt-trend', lost ? 'Lost' : TREND_TEXT[hunt.trend(now)]);
  card.dataset.trend = lost ? 'lost' : hunt.trend(now);
  const percent = smoothed === undefined ? 0 : Math.round(closeness(smoothed) * 100);
  const meter = card.querySelector<HTMLElement>('.hunt-meter')!;
  meter.setAttribute('aria-valuenow', String(percent));
  meter.querySelector<HTMLElement>('span')!.style.width = `${percent}%`;
  const distance = hunt.distance();
  set(
    '.hunt-facts',
    [
      hunt.peak === undefined ? '' : `Peak ${hunt.peak} dBm`,
      distance === undefined ? '' : `about ${formatDistance(distance, preferences.units)}`,
      hunt.lastAt === undefined ? 'not heard yet' : `heard ${formatAgo(hunt.lastAt, now)}`,
    ]
      .filter(Boolean)
      .join(' · '),
  );
}
