// The map's track panel: record where this computer goes, save it as GPX, clear it.
import { preferences, render, track } from './app-state.ts';
import { element, text } from './dom.ts';
import { formatDistance, formatDuration, formatTime, type LngLat } from './geo.ts';
import { keepAwake } from './keep-awake.ts';
import { currentFix, locationProblem, onFix, wantLocation } from './location.ts';
import { toGpx, trackLines } from './trail.ts';
import { confirmSheet, downloadBlob } from './ui.ts';
import { onLocalAppStop } from './access-ui.ts';

let open = false;
let lines: LngLat[][] = [];
let linesRevision = -1;
let notify: (message: string | undefined) => void = () => {};

/** The recorded track's lines, recomputed only when it changes. */
export function trackLinesToDraw() {
  if (linesRevision !== track.revision) {
    linesRevision = track.revision;
    lines = trackLines(track.points);
  }
  return lines;
}

const pad = (n: number) => String(n).padStart(2, '0');
function stamp(at: number) {
  const d = new Date(at);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function begin() {
  track.start();
  wantLocation('track', true);
  keepAwake('track', true);
  // A fix already in hand starts the track where this computer is now.
  const fix = currentFix();
  if (fix) record(fix);
  render();
}

function record(fix: NonNullable<ReturnType<typeof currentFix>>) {
  if (!track.recording) return;
  track.append([
    {
      longitude: fix.lngLat[0],
      latitude: fix.lngLat[1],
      accuracy: fix.accuracy,
      altitude: fix.altitude,
      time: fix.at,
    },
  ]);
}

async function start() {
  if (track.points.length < 2) return begin();
  const replace = await confirmSheet({
    title: 'Start a new track?',
    body: `This replaces the current track (${formatDistance(track.length, preferences.units)}). Save it first if you need to keep it.`,
    confirm: 'Start new',
    danger: true,
  });
  if (replace) begin();
}

function stop() {
  track.stop();
  wantLocation('track', false);
  keepAwake('track', false);
  render();
}

async function clear() {
  const sure = await confirmSheet({
    title: 'Clear this track?',
    body: "It's removed from this browser.",
    confirm: 'Clear',
    danger: true,
  });
  if (!sure) return;
  if (track.recording) stop();
  track.clear();
  render();
}

function save() {
  const when = stamp(track.startedAt);
  downloadBlob(
    `reaper-track-${when.replace(' ', '-')}.gpx`,
    new Blob([toGpx(track.points, `Reaper Mesh track ${when}`)], { type: 'application/gpx+xml' }),
  );
  notify(undefined);
}

export function renderTrack() {
  const button = element('map-track');
  button.classList.toggle('is-active', open || track.recording);
  const label = track.recording ? 'Track, recording' : 'Track';
  button.setAttribute('aria-label', label);
  button.title = label;
  button.classList.toggle('is-recording', track.recording);
  element('map-track-panel').hidden = !open;
  if (!open) return;
  const recorded = track.points.length > 1;
  text(
    'track-state',
    recorded
      ? `${track.recording ? 'Recording' : 'Track'} · ${formatDistance(track.length, preferences.units)} · ${formatDuration(track.endedAt - track.startedAt)}`
      : track.recording
        ? 'Recording · waiting for location'
        : 'No track recorded',
  );
  const usb = preferences.locationSource === 'gps';
  text(
    'track-detail',
    track.recording
      ? locationProblem() ||
          (usb
            ? 'Recording from the USB GPS while this page stays open.'
            : 'Recording while this page stays open and in front.')
      : recorded
        ? `Started ${formatTime(track.startedAt)}, ended ${formatTime(track.endedAt)}.`
        : 'Records where this computer goes while the page is open.',
  );
  element('track-start').hidden = track.recording;
  element('track-stop').hidden = !track.recording;
  element('track-save').hidden = !recorded;
  element('track-clear').hidden = !recorded && !track.recording;
}

export function initTrack(showMessage: (message: string | undefined) => void) {
  notify = showMessage;
  onFix(record);
  element('map-track').addEventListener('click', () => {
    open = !open;
    render();
  });
  element('track-close').addEventListener('click', () => {
    open = false;
    render();
  });
  element('track-start').addEventListener('click', () => void start());
  element('track-stop').addEventListener('click', stop);
  element('track-save').addEventListener('click', save);
  element('track-clear').addEventListener('click', () => void clear());
  onLocalAppStop(() => {
    if (track.recording) track.stop();
    keepAwake('track', false);
  });
}
