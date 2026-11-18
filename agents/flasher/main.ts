/**
 * The browser firmware installer. On the ESP32 boards it writes the four images that
 * tools/update-firmware.py writes (bootloader, partition table, OTA data, application) and never
 * the settings, Bluetooth or key partitions, and never erases the chip or changes eFuses. On the
 * T1000-E it sends the application through the board's own bootloader (nrf-dfu.ts).
 */
import '../web/public/theme.css';
import './style.css';
import { ESPLoader, Transport, UnsupportedCommandError } from 'esptool-js';
import {
  type BoardBuild,
  type FirmwareIndex,
  ESP32_EFUSE,
  checkChip,
  checkEsp32Efuses,
  checkSecurityInfo,
  downloadFiles,
  md5Hex,
  parseIndex,
  verifyImage,
  versionOf,
  zip,
} from './firmware.ts';
import { type ByteLink, USB, dfuImage, runningOn, sendDfu } from './nrf-dfu.ts';

const ROM_BAUD = 115200;
const FLASH_BAUD = 460800;
const REPO = 'https://github.com/justingreerbbi/reaper-mesh';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const boardSelect = $<HTMLSelectElement>('board');
const boardDetail = $('board-detail');
const indexStatus = $('index-status');
const installButton = $<HTMLButtonElement>('install');
const downloadButton = $<HTMLButtonElement>('download');
const progress = $('progress');
const progressLabel = $('progress-label');
const progressBar = $('progress-bar');
const result = $('result');
const logDetails = $<HTMLDetailsElement>('log-details');
const logEl = $('log');

const serial = (navigator as Navigator & { serial?: Serial }).serial;
let index: FirmwareIndex | undefined;
let chosen: BoardBuild | undefined;
let busy = false;

function log(line: string) {
  logDetails.hidden = false;
  logEl.textContent += `${line}\n`;
  logEl.scrollTop = logEl.scrollHeight;
}

function setProgress(label: string, fraction?: number) {
  progress.hidden = false;
  progressLabel.textContent = label;
  if (fraction !== undefined) progressBar.style.width = `${Math.round(fraction * 100)}%`;
}

function showResult(tone: 'good' | 'bad', title: string, detail: string, portalLink = false) {
  result.hidden = false;
  result.dataset.tone = tone;
  result.replaceChildren();
  const heading = document.createElement('p');
  const strong = document.createElement('strong');
  strong.textContent = title;
  heading.append(strong);
  const body = document.createElement('p');
  body.className = 'muted small';
  body.textContent = detail;
  result.append(heading, body);
  if (portalLink) {
    const link = document.createElement('a');
    link.className = 'button-link';
    link.href = '../web/';
    link.textContent = 'Open the web portal';
    result.append(link);
  }
}

function refreshButton() {
  installButton.disabled = busy || !chosen || !serial;
  // Downloading needs no USB access, so it works in any browser.
  downloadButton.disabled = busy || !chosen;
  installButton.textContent = busy
    ? 'Installing…'
    : chosen
      ? `Connect and install ${versionOf(chosen.firmware)}`
      : 'Choose a board first';
}

// Both Heltec boards have the same chip, so the installer can't tell them apart; the hint does.
const BOARD_CHOICES = [
  { id: 'heltec-v3', name: 'Heltec WiFi LoRa 32 V3', hint: 'ESP32-S3 · 0.96″ screen' },
  { id: 'heltec-stick-v3', name: 'Heltec Wireless Stick V3', hint: 'ESP32-S3 · tiny 0.49″ screen' },
  { id: 'tbeam-v12', name: 'LILYGO T-Beam V1.2', hint: 'ESP32 · battery holder' },
  {
    id: 't1000-e',
    name: 'Seeed SenseCAP T1000-E',
    hint: 'nRF52840 · card tracker, no screen. Installing over Meshtastic replaces it and erases its data.',
  },
];

function renderBoards() {
  const placeholder = new Option(index ? 'Select your board…' : 'Loading boards…', '');
  placeholder.disabled = true;
  const options = [placeholder];
  for (const { id, name } of BOARD_CHOICES) {
    const build = index?.boards.find(board => board.id === id);
    // The version shows under the list, so a long board name still fits on a phone.
    const label = build ? build.name : `${name} (unavailable)`;
    const option = new Option(label, id);
    option.disabled = !build;
    options.push(option);
  }
  boardSelect.replaceChildren(...options);
  boardSelect.value = chosen?.id ?? '';
  boardSelect.disabled = !index || busy;
  const choice = BOARD_CHOICES.find(board => board.id === chosen?.id);
  boardDetail.hidden = !chosen;
  $('board-hint').textContent = choice?.hint ?? '';
  $('board-version').textContent = chosen ? chosen.firmware : '';
  $('keep-note').textContent =
    chosen?.chip === 'nRF52840'
      ? 'Over Reaper Mesh, settings, Bluetooth pairings and team keys are kept. Over other firmware such as Meshtastic, that firmware and its data are replaced. The first install takes about a minute and a half.'
      : "Your board's settings, Bluetooth pairings and team keys are kept. Only the firmware is replaced.";
}

boardSelect.addEventListener('change', () => {
  chosen = index?.boards.find(board => board.id === boardSelect.value);
  result.hidden = true;
  renderBoards();
  refreshButton();
});

async function loadIndex() {
  try {
    const response = await fetch('firmware/index.json', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    index = parseIndex(await response.json());
    indexStatus.textContent = index.boards.length
      ? 'Select the board you have. The installer checks it before writing anything.'
      : 'No firmware has been published yet.';
    const first = index.boards[0];
    if (first) {
      const built = new Date(index.built).toLocaleDateString(undefined, { dateStyle: 'medium' });
      const commit = document.createElement('a');
      commit.href = `${REPO}/commit/${first.sourceCommit}`;
      commit.textContent = first.sourceCommit.slice(0, 7);
      $('build-info').replaceChildren(
        `Built ${built} from commit `,
        commit,
        first.sourceDirty ? ' with uncommitted changes.' : '.',
      );
    }
  } catch (error) {
    index = undefined;
    indexStatus.textContent = `Couldn't load the firmware list (${(error as Error).message}). Reload to try again.`;
  }
  renderBoards();
}

async function download(board: BoardBuild): Promise<{ data: Uint8Array; address: number }[]> {
  const files = [];
  for (const [i, image] of board.images.entries()) {
    setProgress(`Downloading firmware (${i + 1} of ${board.images.length})…`, 0);
    const response = await fetch(`firmware/${image.path}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Couldn't download ${image.path} (HTTP ${response.status}).`);
    const data = new Uint8Array(await response.arrayBuffer());
    await verifyImage(image, data);
    log(`Verified ${image.path} (${data.length} bytes, SHA-256 ${image.sha256.slice(0, 16)}…)`);
    files.push({ data, address: image.offset });
  }
  return files;
}

/** Fails closed unless the connected chip, flash and security state match the chosen board. */
async function checkDevice(loader: ESPLoader, board: BoardBuild) {
  const chip = loader.chip.CHIP_NAME;
  const description = await loader.chip.getChipDescription(loader);
  log(`Found ${description}`);
  let security: string | null;
  if (chip === 'ESP32') {
    // The original ESP32's ROM has no security report, so read the eFuses directly.
    const [word0, word6, secureVersion] = await Promise.all(
      ESP32_EFUSE.words.map(word => loader.readReg(ESP32_EFUSE.base + 4 * word)),
    );
    security = checkEsp32Efuses(word0, word6, secureVersion);
  } else {
    try {
      security = checkSecurityInfo(await loader.getSecurityInfo());
    } catch (error) {
      if (error instanceof UnsupportedCommandError)
        security = 'This board did not report its security state.';
      else throw error;
    }
  }
  if (security) throw new Error(security);
  await loader.runStub();
  await loader.changeBaud();
  const flashSize = await loader.detectFlashSize();
  const problem = checkChip(board, chip, description, flashSize);
  if (problem) throw new Error(problem);
}

function friendly(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/Failed to open serial port|already open|InvalidStateError/i.test(message)) {
    return 'The USB port is busy. Close the web portal or any other app using the board, unplug it and plug it back in, then try again.';
  }
  if (/Failed to connect|timed out|Timeout|sync/i.test(message)) {
    return "Couldn't reach the board's bootloader. Hold the BOOT (PRG) button, tap RESET, release BOOT, then try again.";
  }
  if (/device has been lost|disconnected|NetworkError/i.test(message)) {
    return 'The board was disconnected during the install. Plug it back in and run the install again; it can always be reinstalled.';
  }
  return message;
}

async function install() {
  const board = chosen;
  if (!board || !serial || busy) return;
  if (board.chip === 'nRF52840') return installNrf(board);
  let port: SerialPort;
  try {
    port = await serial.requestPort();
  } catch {
    return; // The chooser was closed.
  }
  busy = true;
  result.hidden = true;
  logEl.textContent = '';
  renderBoards();
  refreshButton();
  let transport: Transport | undefined;
  try {
    const files = await download(board);
    setProgress('Connecting to the board…', 0);
    transport = new Transport(port, false);
    const loader = new ESPLoader({
      transport,
      baudrate: FLASH_BAUD,
      romBaudrate: ROM_BAUD,
      terminal: { clean() {}, writeLine: log, write: line => log(line.trimEnd()) },
    });
    await loader.detectChip('default_reset');
    setProgress('Checking the board…', 0);
    await checkDevice(loader, board);
    const total = files.reduce((sum, file) => sum + file.data.length, 0);
    const before = files.map((_, i) =>
      files.slice(0, i).reduce((sum, file) => sum + file.data.length, 0),
    );
    await loader.writeFlash({
      fileArray: files,
      // Keep the bootloader header exactly as built and verified.
      flashMode: 'keep',
      flashFreq: 'keep',
      flashSize: 'keep',
      eraseAll: false,
      compress: true,
      calculateMD5Hash: md5Hex,
      reportProgress: (fileIndex, written, size) => {
        const done = before[fileIndex] + (written / size) * files[fileIndex].data.length;
        setProgress(`Writing firmware… ${Math.round((done / total) * 100)}%`, done / total);
      },
    });
    setProgress('Restarting the board…', 1);
    await loader.after('hard_reset');
    showResult(
      'good',
      `Installed ${board.firmware}`,
      'The board verified every image and restarted. Your settings, pairings and keys were kept. Open the portal and connect to confirm the new version.',
      true,
    );
    progress.hidden = true;
  } catch (error) {
    log(`Stopped: ${error instanceof Error ? error.message : String(error)}`);
    progress.hidden = true;
    showResult('bad', 'Install stopped', friendly(error));
  } finally {
    await transport?.disconnect().catch(() => {});
    busy = false;
    renderBoards();
    refreshButton();
  }
}

/** A byte link over an open Web Serial port. A background loop collects whatever arrives. */
function serialLink(port: SerialPort): ByteLink & { close(): Promise<void> } {
  const writer = port.writable!.getWriter();
  const reader = port.readable!.getReader();
  const queue: Uint8Array[] = [];
  let wake: (() => void) | undefined;
  let closed = false;
  void (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) queue.push(value);
        wake?.();
      }
    } catch {
      // The port closed or the board restarted.
    }
    closed = true;
    wake?.();
  })();
  return {
    write: bytes => writer.write(bytes),
    async read(timeoutMs) {
      if (!queue.length && !closed) {
        await new Promise<void>(resolve => {
          const timer = setTimeout(resolve, timeoutMs);
          wake = () => {
            clearTimeout(timer);
            resolve();
          };
        });
        wake = undefined;
      }
      return queue.shift() ?? null;
    },
    async close() {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
      writer.releaseLock();
      await port.close().catch(() => {});
    },
  };
}

/** Waits for a click on a button in the result box, which gives the browser a user gesture. */
function askToContinue(title: string, detail: string, label: string): Promise<void> {
  showResult('good', title, detail);
  const button = document.createElement('button');
  button.className = 'primary wide';
  button.type = 'button';
  button.textContent = label;
  result.append(button);
  return new Promise(resolve =>
    button.addEventListener('click', () => {
      result.hidden = true;
      resolve();
    }),
  );
}

/** The bootloader's port: already allowed, or chosen by the person once it has appeared. */
async function bootloaderPort(): Promise<SerialPort> {
  const find = async () =>
    (await serial!.getPorts()).find(port => runningOn(port.getInfo()) === 'bootloader');
  // It appears within a second; after that, it needs the person's permission.
  for (let waited = 0; waited < 3000; waited += 250) {
    const port = await find();
    if (port) return port;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  // A newly seen USB device needs the person's permission once.
  await askToContinue(
    'The T1000-E is in its bootloader',
    'It shows up as a new USB device, so your browser needs your permission once. Choose the port named T1000_E.',
    'Choose the bootloader port',
  );
  return serial!.requestPort({ filters: [...USB.bootloaders] });
}

/**
 * Installs the T1000-E (D57). Whatever it runs, a 1200-baud open and close restarts it into its
 * bootloader's serial DFU mode; the application is then sent through that. Running Reaper keeps its
 * settings, keys and pairings. Other firmware's data is blanked, because Reaper never erases storage
 * it cannot read.
 */
async function installNrf(board: BoardBuild) {
  let port: SerialPort;
  try {
    port = await serial!.requestPort({
      filters: [...USB.choose],
    });
  } catch {
    return; // The chooser was closed.
  }
  busy = true;
  result.hidden = true;
  logEl.textContent = '';
  renderBoards();
  refreshButton();
  let link: (ByteLink & { close(): Promise<void> }) | undefined;
  try {
    const [file] = await download(board);
    const running = runningOn(port.getInfo());
    log(
      `The chosen port is ${running === 'reaper' ? 'Reaper Mesh' : running === 'bootloader' ? 'the bootloader' : 'other firmware'}.`,
    );
    let fresh = running === 'other';
    if (running === 'bootloader') {
      // The bootloader cannot say what it was running, so ask. Keeping is the safe answer.
      fresh = window.confirm(
        'This T1000-E is already in its bootloader, so the installer cannot tell what it was running.\n\n' +
          "OK: it ran other firmware, such as Meshtastic. Erase that firmware's old data.\n" +
          'Cancel: it ran Reaper Mesh. Keep its settings, keys and pairings.',
      );
    } else {
      setProgress('Restarting the T1000-E into its bootloader…', 0);
      await port.open({ baudRate: 1200 });
      await port.close();
      port = await bootloaderPort();
    }
    log(
      fresh
        ? 'First install: blanking the data areas.'
        : 'Update: keeping settings, keys and pairings.',
    );
    const image = dfuImage(file.data, fresh);
    await port.open({ baudRate: 115200, bufferSize: 4096, flowControl: 'none' });
    link = serialLink(port);
    const eraseSeconds = Math.ceil(image.length / 4096 / 11);
    await sendDfu(link, image, (stage, fraction) => {
      if (stage === 'erasing')
        setProgress(`Erasing the old firmware (about ${eraseSeconds} seconds)…`, 0);
      else if (stage === 'writing')
        setProgress(`Writing firmware… ${Math.round(fraction * 100)}%`, fraction);
      else setProgress('Checking and restarting…', 1);
    });
    log(`Sent ${image.length} bytes; the bootloader checked the image and is starting it.`);
    showResult(
      'good',
      `Installed ${board.firmware}`,
      fresh
        ? 'The T1000-E restarted into Reaper Mesh with fresh settings. Open the portal, connect over USB and choose a radio network.'
        : 'The T1000-E restarted into Reaper Mesh. Your settings, pairings and keys were kept. Open the portal and connect to confirm the new version.',
      true,
    );
    progress.hidden = true;
  } catch (error) {
    log(`Stopped: ${error instanceof Error ? error.message : String(error)}`);
    progress.hidden = true;
    showResult('bad', 'Install stopped', friendlyNrf(error));
  } finally {
    await link?.close();
    busy = false;
    renderBoards();
    refreshButton();
  }
}

function friendlyNrf(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/Failed to open serial port|already open|InvalidStateError/i.test(message)) {
    return 'The USB port is busy. Close the web portal or any other app using the T1000-E, unplug it and plug it back in, then try again.';
  }
  if (/stopped answering|device has been lost|disconnected|NetworkError/i.test(message)) {
    return 'The T1000-E stopped answering during the install. Its bootloader is never changed, so run the install again. If it no longer shows a port, hold its button while plugging it in, then choose the port named T1000_E.';
  }
  return message;
}

/** Saves the chosen build as a zip: the verified images, a README with the esptool command, notices. */
async function downloadFirmware() {
  const board = chosen;
  if (!board || !index || busy) return;
  busy = true;
  result.hidden = true;
  logEl.textContent = '';
  renderBoards();
  refreshButton();
  try {
    const images = (await download(board)).map(file => file.data);
    setProgress('Adding licenses…', 0);
    const notices = [];
    for (const [i, path] of index.notices.entries()) {
      const response = await fetch(`firmware/${path}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`Couldn't download ${path} (HTTP ${response.status}).`);
      notices.push({ path, data: new Uint8Array(await response.arrayBuffer()) });
      setProgress('Adding licenses…', (i + 1) / index.notices.length);
    }
    const installerUrl = new URL('./', location.href).href;
    const files = await downloadFiles(board, images, notices, installerUrl, REPO);
    const name = `${board.firmware}.zip`;
    const url = URL.createObjectURL(
      new Blob([zip(files) as Uint8Array<ArrayBuffer>], { type: 'application/zip' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    log(`Saved ${name} (${files.length} files)`);
    progress.hidden = true;
    showResult(
      'good',
      `Downloaded ${name}`,
      "It holds the four images, checked against their published hashes, and a README with the esptool command to write them. Don't erase the whole chip: that deletes your settings and keys.",
    );
  } catch (error) {
    log(`Stopped: ${error instanceof Error ? error.message : String(error)}`);
    progress.hidden = true;
    showResult('bad', 'Download stopped', error instanceof Error ? error.message : String(error));
  } finally {
    busy = false;
    renderBoards();
    refreshButton();
  }
}

if (!serial) $('unsupported').hidden = false;
installButton.addEventListener('click', () => void install());
downloadButton.addEventListener('click', () => void downloadFirmware());
refreshButton();
void loadIndex();
