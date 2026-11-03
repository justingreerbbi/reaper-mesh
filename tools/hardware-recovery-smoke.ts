/** Physical fault injection: two writes of the current settings, lost replies, and reset. */
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import assert from 'node:assert/strict';
import { Connection } from '../packages/agent-core/connection.ts';
import { FrameDecoder, encodeFrame } from '../packages/protocol/framing.ts';
import { decodeMessage, encodeMessage, type Message } from '../packages/protocol/messages.ts';
const [python, port, confirm] = process.argv.slice(2);
if (!python || !port || confirm !== '--confirm-write') {
  throw new Error('usage: node tools/hardware-recovery-smoke.ts PYTHON PORT --confirm-write');
}
// JSON only controls this local byte bridge. No settings/protocol logic lives in Python.
const child = spawn(
  python,
  [
    '-u',
    '-c',
    `
import serial,sys,threading,json,time
s=serial.Serial(port=None,baudrate=115200,timeout=.05,exclusive=True)
s.dtr=False;s.rts=False;s.port=sys.argv[1];s.open()
lock=threading.Lock()
def output(obj):
 with lock:print(json.dumps(obj),flush=True)
def write():
 for line in sys.stdin:
  msg=json.loads(line)
  if 'hex' in msg:s.write(bytes.fromhex(msg['hex']))
  if msg.get('reset'):
   s.rts=True;time.sleep(.1);s.rts=False;output({'reset':True})
threading.Thread(target=write,daemon=True).start()
try:
 while True:
  data=s.read(256)
  if data:output({'hex':data.hex()})
finally:s.close()
`,
    port,
  ],
  { stdio: ['pipe', 'pipe', 'pipe'] },
);
const agent = new Connection(crypto.randomUUID());
const start = performance.now();
const now = () => Math.floor(performance.now() - start);
let generation = 0,
  link = '',
  dropResult = false,
  dropped = 0,
  resetDone = false,
  sentMutations = 0;
let bridgeError = '';
let readError: unknown;
child.stderr.on('data', bytes => {
  bridgeError += bytes.toString();
});
child.on('error', error => {
  readError = error;
});
const decoder = new FrameDecoder();
const lines = createInterface({ input: child.stdout });
lines.on('line', line => {
  try {
    const value = JSON.parse(line);
    if (value.reset) resetDone = true;
    if (value.hex)
      decoder.feed(Buffer.from(value.hex, 'hex'), payload => {
        const message = decodeMessage(payload);
        if (message.type === 'result' && dropResult) {
          dropped++;
          dropResult = false;
          return;
        }
        agent.receive(generation, encodeFrame(payload), now());
      });
  } catch (error) {
    readError = error;
  }
});
function flush() {
  for (const frame of agent.drain())
    child.stdin.write(JSON.stringify({ hex: Buffer.from(frame).toString('hex') }) + '\n');
}
const timer = setInterval(() => {
  try {
    agent.tick(now());
    flush();
  } catch (error) {
    readError = error;
  }
}, 25);
async function until(test: () => boolean, description: string) {
  const deadline = now() + 7000;
  while (!test()) {
    if (readError) throw readError;
    if (child.exitCode !== null || now() >= deadline)
      throw new Error(description + ': ' + (agent.error || bridgeError || 'timeout'));
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
async function open() {
  decoder.reset();
  link = crypto.randomUUID();
  generation = agent.open(link, now());
  flush();
  await until(() => agent.sync.state === 'ready', 'synchronize');
}
function lostSave() {
  const before = dropped;
  dropResult = true;
  const id = agent.configure({ ...agent.sync.config! }, now());
  sentMutations++;
  flush();
  return { id, before };
}
async function raw(message: Message) {
  child.stdin.write(
    JSON.stringify({ hex: Buffer.from(encodeFrame(encodeMessage(message))).toString('hex') }) +
      '\n',
  );
}
try {
  await open();
  const initial = agent.sync.revision;
  const boot = agent.sync.boot;
  const first = lostSave();
  await until(() => dropped > first.before, 'drop first committed receipt');
  agent.close();
  assert.equal(agent.commands.status(first.id).outcome, 'unknown');
  await open();
  assert.equal(agent.sync.boot, boot);
  assert.equal(agent.sync.revision, initial + 1);
  assert.equal(agent.recover(first.id, now()), true);
  flush();
  await until(
    () => agent.commands.status(first.id).outcome === 'committed' && agent.sync.state === 'ready',
    'query lost receipt',
  );
  assert.equal(agent.sync.revision, initial + 1);
  // Replaying the exact accepted ID on this link must not cause a second commit.
  await raw({
    type: 'configure',
    link,
    boot: boot!,
    id: first.id,
    expectedRevision: initial,
    region: agent.sync.config!.region,
    label: agent.sync.config!.label,
  } as Message);
  // New link snapshot serializes after the duplicate; no sleeps determine correctness.
  agent.close();
  await open();
  assert.equal(agent.sync.revision, initial + 1);
  console.log(
    'Physical lost receipt -> logical reconnect -> query passed; duplicate did not reapply',
  );
  const second = lostSave();
  await until(() => dropped > second.before, 'drop second committed receipt');
  agent.close();
  assert.equal(agent.commands.status(second.id).outcome, 'unknown');
  child.stdin.write(JSON.stringify({ reset: true }) + '\n');
  await until(() => resetDone, 'hardware reset');
  await open();
  assert.notEqual(agent.sync.boot, boot);
  assert.equal(agent.sync.revision, initial + 2);
  assert.equal(agent.recover(second.id, now()), false);
  assert.equal(agent.commands.status(second.id).outcome, 'unknown');
  assert.equal(sentMutations, 2); // Recovery only queried; it never submitted another mutation.
  console.log(
    'Physical lost receipt -> hardware reset passed; persisted settings restored and old outcome remains unknown',
  );
} finally {
  clearInterval(timer);
  agent.close();
  lines.close();
  if (child.exitCode === null && child.signalCode === null) {
    const exited = new Promise<void>(resolve => child.once('exit', () => resolve()));
    child.kill();
    await exited;
  }
}
