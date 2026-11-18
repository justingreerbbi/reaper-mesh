/**
 * Installs a T1000-E from this computer with the browser installer's own serial DFU code
 * (agents/flasher/nrf-dfu.ts), logging every step. For bring-up and for checking the installer
 * against a real bootloader.
 *
 * usage: node tools/hardware-t1000e-install.ts PYTHON PORT APP.bin [--fresh]
 *   PORT is the T1000-E's port, running any firmware or already in its bootloader.
 *   --fresh blanks the data areas, for a first install over other firmware.
 */
import { spawn, execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { type ByteLink, dfuImage, sendDfu } from '../agents/flasher/nrf-dfu.ts';

const [python, port, app, ...flags] = process.argv.slice(2);
if (!python || !port || !app) {
  throw new Error('usage: node tools/hardware-t1000e-install.ts PYTHON PORT APP.bin [--fresh]');
}
const fresh = flags.includes('--fresh');
const started = Date.now();
const log = (line: string) => console.log(`${((Date.now() - started) / 1000).toFixed(2)}s ${line}`);

/** Serial ports with their USB IDs, from pyserial. */
function ports(): { device: string; vid: number | null; pid: number | null }[] {
  const out = execFileSync(python, [
    '-c',
    'import json,serial.tools.list_ports as l;print(json.dumps([[p.device,p.vid,p.pid] for p in l.comports()]))',
  ]).toString();
  return (JSON.parse(out) as [string, number | null, number | null][]).map(
    ([device, vid, pid]) => ({
      device,
      vid,
      pid,
    }),
  );
}
const isBootloader = (p: { vid: number | null; pid: number | null }) =>
  p.pid === 0x0057 && (p.vid === 0x2886 || p.vid === 0x239a);

let target = ports().find(p => p.device === port);
if (!target) throw new Error(`${port} is not connected`);
log(`${port}: VID 0x${target.vid?.toString(16)} PID 0x${target.pid?.toString(16)}`);
if (!isBootloader(target)) {
  log('Opening at 1200 baud and closing, to restart into the bootloader');
  execFileSync(python, [
    '-c',
    'import serial,sys,time;s=serial.Serial(sys.argv[1],1200);time.sleep(.1);s.close()',
    port,
  ]);
  let found;
  for (let i = 0; i < 40 && !found; i++) {
    await new Promise(resolve => setTimeout(resolve, 250));
    found = ports().find(isBootloader);
  }
  if (!found) throw new Error('The bootloader port did not appear');
  target = found;
  log(
    `Bootloader: ${target.device} VID 0x${target.vid?.toString(16)} PID 0x${target.pid?.toString(16)}`,
  );
}

const child = spawn(
  python,
  [
    '-u',
    '-c',
    `
import serial,sys,threading,time
s=serial.Serial(sys.argv[1],115200,timeout=.02)
time.sleep(.1)
def write():
 while True:
  data=sys.stdin.buffer.read1(4096)
  if not data:return
  s.write(data)
threading.Thread(target=write,daemon=True).start()
while True:
 data=s.read(256)
 if data:sys.stdout.buffer.write(data);sys.stdout.buffer.flush()
`,
    target.device,
  ],
  { stdio: ['pipe', 'pipe', 'inherit'] },
);
const queue: Uint8Array[] = [];
let wake: (() => void) | undefined;
child.stdout.on('data', (bytes: Buffer) => {
  queue.push(new Uint8Array(bytes));
  wake?.();
});
const link: ByteLink = {
  async write(bytes) {
    child.stdin.write(bytes);
  },
  async read(timeoutMs) {
    if (!queue.length) {
      await new Promise<void>(resolve => {
        const timer = setTimeout(resolve, timeoutMs);
        wake = () => {
          clearTimeout(timer);
          resolve();
        };
      });
      wake = undefined;
    }
    const bytes = queue.shift() ?? null;
    if (bytes) log(`  <- ${Buffer.from(bytes).toString('hex')}`);
    return bytes;
  },
};
await new Promise(resolve => setTimeout(resolve, 300));
const image = dfuImage(new Uint8Array(readFileSync(app)), fresh);
log(`Sending ${image.length} bytes (${fresh ? 'first install, data areas blanked' : 'update'})`);
let last = '';
try {
  await sendDfu(link, image, (stage, fraction) => {
    const line = `${stage} ${Math.floor(fraction * 10) * 10}%`;
    if (line !== last) log((last = line));
  });
  log('Done: the bootloader acknowledged the stop packet');
} finally {
  child.kill();
}
await new Promise(resolve => setTimeout(resolve, 3000));
log(`Ports now: ${JSON.stringify(ports().filter(p => p.vid))}`);
