/**
 * Alerts in the portal (D61): a bar that appears only when there is something to say, a short
 * chirp, and a notification when the portal is out of sight. What raises one is decided in
 * packages/agent-core/signals-alerts.ts.
 */
import { preferences } from './app-state.ts';
import { element } from './dom.ts';
import { away, notify } from './notifications.ts';
import { setText } from './signals-dom.ts';
import { history, onRecorded } from './signals-history.ts';
import { identityOf } from './signals-identity.ts';
import { titleOf } from './signals-panel.ts';
import {
  AlertTracker,
  alertText,
  type AlertKind,
  type SignalAlert,
} from '../../packages/agent-core/signals-alerts.ts';
import { isFollowing, type SignalRecord } from '../../packages/agent-core/signals-intel.ts';

export const ALERT_SOUND_KEY = 'reaper-mesh.signals-alert-sound.v1';
/** The bar clears itself after this long. */
const SHOWN_MS = 30_000;
/** Whether something is moving with the user is worked out at most this often per signal. */
const FOLLOW_CHECK_MS = 30_000;

const tracker = new AlertTracker();
const following = new Map<string, { at: number; value: boolean }>();
/** Alerts not yet looked at, most important first. */
let pending: SignalAlert[] = [];
const PRIORITY: AlertKind[] = ['following', 'watched', 'drone', 'flock', 'ring'];
const PENDING_KEPT = 20;
let hideTimer: ReturnType<typeof setTimeout> | undefined;
let audio: AudioContext | undefined;
let sound = readSound();
let open: (key: string) => void = () => {};
let changed: () => void = () => {};

function readSound() {
  try {
    return localStorage.getItem(ALERT_SOUND_KEY) !== 'off';
  } catch {
    return true;
  }
}
export const alertSound = () => sound;
export function setAlertSound(on: boolean) {
  sound = on;
  try {
    localStorage.setItem(ALERT_SOUND_KEY, on ? 'on' : 'off');
  } catch {
    // Lasts until the page closes.
  }
}

/** Whether a signal is moving with the user, remembered for a while: it is not cheap to work out. */
export function followingNow(record: SignalRecord, now: number) {
  const cached = following.get(record.key);
  if (cached && now - cached.at < FOLLOW_CHECK_MS) return cached.value;
  const value = !record.known && isFollowing(record, now);
  if (following.size > 5000) following.clear();
  following.set(record.key, { at: now, value });
  return value;
}

/** Rising tones: three for the two that matter most, two for the rest. */
const TONES: Record<AlertKind, number[]> = {
  following: [660, 880, 1100],
  watched: [660, 880, 1100],
  drone: [880, 1320],
  flock: [520, 780],
  ring: [520, 780],
};

function chirp(kind: AlertKind) {
  if (!sound || !audio) return;
  const start = audio.currentTime;
  TONES[kind].forEach((pitch, i) => {
    const oscillator = audio!.createOscillator();
    const gain = audio!.createGain();
    const at = start + i * 0.14;
    oscillator.type = 'triangle';
    oscillator.frequency.value = pitch;
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(0.22, at + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.12);
    oscillator.connect(gain).connect(audio!.destination);
    oscillator.start(at);
    oscillator.stop(at + 0.14);
  });
}

function raise(alert: SignalAlert, record: SignalRecord) {
  pending = [...pending.filter(other => other.key !== alert.key), alert]
    .sort((a, b) => PRIORITY.indexOf(a.kind) - PRIORITY.indexOf(b.kind) || b.at - a.at)
    .slice(0, PENDING_KEPT);
  clearTimeout(hideTimer);
  hideTimer = setTimeout(dismiss, SHOWN_MS);
  chirp(alert.kind);
  const message = alertText(alert.kind, titleOf(record, identityOf(record)));
  if (away() && preferences.notifications !== 'off')
    notify('Signals', message, `reaper-mesh:signal:${alert.key}`, () => open(alert.key));
  changed();
}

function dismiss() {
  pending = [];
  clearTimeout(hideTimer);
  changed();
}

export function renderAlert() {
  const bar = element('signals-alert');
  pending = pending.filter(alert => history.records.has(alert.key));
  const first = pending[0];
  bar.hidden = !first;
  if (!first) return;
  const record = history.records.get(first.key)!;
  bar.dataset.kind = first.kind;
  setText(
    element('signals-alert-text'),
    alertText(first.kind, titleOf(record, identityOf(record))) +
      (pending.length > 1 ? ` · +${pending.length - 1} more` : ''),
  );
}

/** `onOpen` selects a signal; `onChange` redraws. */
export function initAlerts(onOpen: (key: string) => void, onChange: () => void) {
  open = onOpen;
  changed = onChange;
  // Show opens the first and moves on to the next; the cross clears them all.
  element('signals-alert-show').addEventListener('click', () => {
    const first = pending.shift();
    if (first) open(first.key);
    changed();
  });
  element('signals-alert-close').addEventListener('click', dismiss);
  // Browsers only let a page make sound after the user has touched it.
  const unlock = () => {
    try {
      audio ??= new AudioContext();
      void audio.resume();
    } catch {
      audio = undefined;
    }
  };
  addEventListener('pointerdown', unlock, { once: true });
  onRecorded((key, _rssi, at, previousSeen) => {
    const record = history.records.get(key);
    if (!record) return;
    const alert = tracker.check(
      record,
      identityOf(record),
      previousSeen,
      at,
      followingNow(record, at),
    );
    if (alert) raise(alert, record);
  });
}
