/**
 * Two-board fault injection for encrypted uploads and inbox recovery (roadmap Phase 3, step 3). Stands
 * between the agent and the board to drop chosen frames, and cuts the link, restarts the board or
 * reloads the agent at chosen moments. The other radio shows what really arrived. Throwaway keys.
 * Refuses to run on a board in a real team, and returns each board's network afterward.
 */
import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline';
import { EncryptionVault } from '../agents/web/encryption.ts';
import { Connection } from '../packages/agent-core/connection.ts';
import { proofAt, type Hmac } from '../packages/agent-core/rotation.ts';
import { FrameDecoder, encodeFrame } from '../packages/protocol/framing.ts';
import { decodeMessage, type Message } from '../packages/protocol/messages.ts';

const [python, firstPort, secondPort] = process.argv.slice(2);
if (!python || !firstPort || !secondPort || firstPort === secondPort)
  throw new Error('usage: node tools/hardware-upload-recovery.ts PYTHON PORT_A PORT_B|--self');
// One board messaging its own node: the whole upload and inbox path, with nothing on the air.
const single = secondPort === '--self';

const start = performance.now();
const now = () => Math.floor(performance.now() - start);
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');
const report = (check: string, outcome: unknown) =>
  console.log(JSON.stringify({ at: now(), check, outcome }));
const BRIDGE = `
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
`;
type Submit = Extract<Message, { type: 'submit' }>;
type Filter = (message: Message) => boolean;

/** One board and its agent, with every frame in both directions visible and droppable. */
class Rig {
  agent = new Connection();
  name = '';
  /** Return false to lose the frame. */
  onTx: Filter = () => true;
  onRx: Filter = () => true;
  submits: { id: string; part: number; data: string; attempt: number }[] = [];
  /** Everything decoded in either direction, for the plaintext scan. */
  seen: string[] = [];
  #child!: ChildProcessWithoutNullStreams;
  #session = 0;
  #rx = new FrameDecoder();
  #tx = new FrameDecoder();
  #resets = 0;
  #failure: unknown;
  #stderr = '';
  #timer: ReturnType<typeof setInterval>;
  readonly port: string;
  constructor(port: string) {
    this.port = port;
    this.#spawn();
    this.#timer = setInterval(() => {
      try {
        this.agent.tick(now());
        this.flush();
      } catch (error) {
        this.#failure = error;
      }
    }, 25);
  }
  #spawn() {
    this.#child = spawn(python, ['-u', '-c', BRIDGE, this.port], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.#child.stderr.on('data', bytes => (this.#stderr += bytes.toString()));
    createInterface({ input: this.#child.stdout }).on('line', line => {
      try {
        const value = JSON.parse(line);
        if (value.reset) this.#resets++;
        if (value.hex)
          this.#rx.feed(Buffer.from(value.hex, 'hex'), payload => {
            const message = decodeMessage(payload);
            this.seen.push(JSON.stringify(message));
            if (this.onRx(message)) this.agent.receive(this.#session, encodeFrame(payload), now());
          });
      } catch (error) {
        this.#failure = error;
      }
    });
  }
  flush() {
    for (const frame of this.agent.drain()) {
      let keep = true;
      this.#tx.feed(frame, payload => {
        const message = decodeMessage(payload);
        this.seen.push(JSON.stringify(message));
        if (message.type === 'submit') {
          const { id, part, data } = message as Submit;
          this.submits.push({
            id,
            part,
            data,
            attempt: this.submits.filter(item => item.id === id && item.part === part).length + 1,
          });
        }
        keep = this.onTx(message);
      });
      if (keep && this.#child.exitCode === null)
        this.#child.stdin.write(JSON.stringify({ hex: hex(frame) }) + '\n');
    }
  }
  async until(test: () => boolean, what: string, ms = 12000) {
    const deadline = performance.now() + ms;
    while (!test()) {
      if (this.#failure) throw this.#failure;
      if (this.#child.exitCode !== null)
        throw new Error(`${this.port}: serial bridge stopped: ${this.#stderr.slice(-200)}`);
      if (performance.now() > deadline)
        throw new Error(
          `${this.name || this.port}: timed out on ${what} (${this.agent.error ?? 'no agent error'}; bridge: ${this.#stderr.slice(-200) || 'running'})`,
        );
      await sleep(10);
    }
  }
  /** A new logical link. A board that has just restarted can take a moment to answer. */
  async open() {
    this.#rx.reset();
    this.#tx.reset();
    for (let attempt = 0; ; attempt++) {
      this.#session = this.agent.open(crypto.randomUUID(), now());
      this.flush();
      try {
        await this.until(() => this.agent.sync.state === 'ready', 'synchronize', 7000);
        break;
      } catch (error) {
        if (attempt >= 2) throw error;
        this.agent.close();
      }
    }
    this.name = this.agent.device ?? this.name;
    await this.until(() => !!this.agent.network, 'network status');
  }
  closeLink() {
    this.agent.close();
  }
  /** What a browser reload does: nothing survives but the saved journal. */
  reload() {
    const saved = JSON.parse(JSON.stringify(this.agent.exportJournal()));
    this.agent.close();
    this.agent = Connection.fromJournal(saved);
    return saved;
  }
  async restartBoard() {
    const before = this.#resets;
    this.#child.stdin.write(JSON.stringify({ reset: true }) + '\n');
    await this.until(() => this.#resets > before, 'board reset');
    await sleep(1500);
  }
  /** Lets go of the serial port and takes it again, as closing and reopening the portal does. */
  async reopenPort() {
    await this.stop();
    await sleep(300);
    this.#spawn();
    await sleep(1200);
  }
  async stop() {
    if (this.#child.exitCode !== null || this.#child.signalCode !== null) return;
    const exited = new Promise<void>(resolve => this.#child.once('exit', () => resolve()));
    this.#child.kill();
    await exited;
  }
  async shutdown() {
    clearInterval(this.#timer);
    this.agent.close();
    await this.stop();
  }
  entry(id: string) {
    return this.agent.messaging.history.find(item => item.id === id)!;
  }
  sendsAfter(id: string, count: number) {
    return this.submits.filter(item => item.id === id).length - count;
  }
  copies(payloadHex: string) {
    return this.agent.inbox.history.filter(item => item.payloadHex === payloadHex).length;
  }
  async network(send: () => void, done: () => boolean, what: string) {
    await this.until(() => !this.agent.networkBusy, 'free');
    send();
    this.flush();
    await this.until(done, what);
    await this.until(() => !this.agent.networkBusy, 'free');
  }
}

const firstRig = new Rig(firstPort);
const rigs = single ? [firstRig, firstRig] : [firstRig, new Rig(secondPort)];
const memory = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
};
const hmac: Hmac = (secret, message) => createHmac('sha256', secret).update(message).digest();
const vaults = [new EncryptionVault(memory()), new EncryptionVault(memory())];
const plaintexts: string[] = [];
const settled = ['acknowledged', 'failed', 'rejected', 'unknown'];

/** A new message. Plaintext stays here, and everything on the wire is scanned for it afterward. */
function seal(sender: number, to: Rig, bytes: number) {
  const body = `secret ${crypto.randomUUID()} `.padEnd(bytes, 'x');
  plaintexts.push(body);
  const envelope = vaults[sender].encrypt(body, 0, rigs[sender].agent.device!, to.agent.device!);
  return { body, envelope, payloadHex: hex(envelope) };
}
function send(from: Rig, to: Rig, envelope: Uint8Array) {
  const id = from.agent.sendMessagePayload(envelope, to.agent.device!, 0, now());
  from.flush();
  return id;
}
const outcome = (rig: Rig, id: string) =>
  rig.until(() => settled.includes(rig.entry(id)?.state), `outcome of ${id}`, 75000);
/** Exactly one exact copy arrives, and it opens with the key. */
async function delivered(to: Rig, sender: Rig, receiver: number, sealed: ReturnType<typeof seal>) {
  await to.until(() => to.copies(sealed.payloadHex) > 0, 'copy in the inbox', 20000);
  await sleep(1500);
  assert.equal(to.copies(sealed.payloadHex), 1, 'more than one copy arrived');
  const item = to.agent.inbox.history.find(entry => entry.payloadHex === sealed.payloadHex)!;
  assert.equal(item.text, '');
  const opened = vaults[receiver].decrypt(
    sealed.envelope,
    0,
    item.origin,
    item.destination ?? 'broadcast',
    `${item.device}:${item.origin}:${item.messageId}`,
  );
  assert.deepEqual(opened, { state: 'decrypted', text: sealed.body });
}
async function neverArrives(to: Rig, payloadHex: string, ms = 8000) {
  await sleep(ms);
  assert.equal(to.copies(payloadHex), 0, 'a message arrived that should not have');
}
async function atMostOneCopy(to: Rig, payloadHex: string, ms = 8000) {
  await sleep(ms);
  const copies = to.copies(payloadHex);
  assert.ok(copies <= 1, `${copies} copies arrived`);
  return copies;
}
/** Stops the upload after this many parts have gone through. */
function loseAfter(rig: Rig, parts: number) {
  let reached = false;
  rig.onTx = message => {
    if (message.type !== 'submit') return true;
    if ((message as Submit).part >= parts) reached = true;
    return !reached;
  };
  return () => reached;
}
const clear = (...list: Rig[]) => {
  for (const rig of list) {
    rig.onTx = () => true;
    rig.onRx = () => true;
  }
};

async function scenarios(a: number, label: string) {
  const b = 1 - a;
  const from = rigs[a],
    to = rigs[b];
  const say = (check: string, result: unknown) =>
    report(`${label}, ${from.name}: ${check}`, result);

  // A lost chunk on a working link is sent again, byte for byte.
  {
    const sealed = seal(a, to, 200);
    let dropped = false;
    from.onTx = message => {
      if (message.type === 'submit' && (message as Submit).part === 2 && !dropped) {
        dropped = true;
        return false;
      }
      return true;
    };
    const id = send(from, to, sealed.envelope);
    await outcome(from, id);
    clear(from);
    assert.equal(from.entry(id).state, 'acknowledged', from.entry(id).reason);
    const part2 = from.submits.filter(item => item.id === id && item.part === 2);
    assert.ok(part2.length >= 2, 'the lost chunk was not sent again');
    assert.ok(
      part2.every(item => item.data === part2[0].data),
      'a retry changed the ciphertext',
    );
    assert.equal(from.entry(id).payloadHex, sealed.payloadHex);
    await delivered(to, from, b, sealed);
    say('lost chunk retried identically', { sends: part2.length, copies: 1 });
  }

  // A lost reply: the board already has the chunk, and the repeat changes nothing.
  {
    const sealed = seal(a, to, 200);
    let dropped = false;
    from.onRx = message => {
      if (
        message.type === 'messageStatus' &&
        !dropped &&
        message.state === 'receiving' &&
        message.received === 7
      ) {
        dropped = true;
        return false;
      }
      return true;
    };
    const id = send(from, to, sealed.envelope);
    await outcome(from, id);
    clear(from);
    assert.ok(dropped);
    assert.equal(from.entry(id).state, 'acknowledged', from.entry(id).reason);
    await delivered(to, from, b, sealed);
    say('lost chunk reply', { copies: 1 });
  }

  // The link is cut partway. Nothing is sent again on the new link, and nothing is delivered.
  {
    const sealed = seal(a, to, 200);
    const reached = loseAfter(from, 3);
    const id = send(from, to, sealed.envelope);
    await from.until(reached, 'upload to reach part 3');
    const sent = from.submits.filter(item => item.id === id).length;
    from.closeLink();
    clear(from);
    assert.equal(from.entry(id).state, 'unknown');
    await from.open();
    assert.equal(from.agent.recoverMessage(id, now()), true);
    from.flush();
    await from.until(
      () => from.entry(id).reason === 'partial-upload-not-resumed',
      'partial report',
    );
    assert.equal(from.entry(id).state, 'unknown');
    await neverArrives(to, sealed.payloadHex);
    // The board has given up on it by now, and says so when asked.
    assert.equal(from.agent.recoverMessage(id, now()), true);
    from.flush();
    await from.until(() => from.entry(id).state === 'failed', 'expiry report');
    assert.equal(from.entry(id).reason, 'expired');
    assert.equal(from.sendsAfter(id, sent), 0, 'chunks were sent on the new link');
    assert.equal(from.entry(id).payloadHex, sealed.payloadHex);
    say('link cut mid-upload', { state: 'failed', reason: 'expired', resent: 0, copies: 0 });
  }

  // The agent reloads partway, keeping the ciphertext and never the plaintext.
  {
    const sealed = seal(a, to, 200);
    const reached = loseAfter(from, 3);
    const id = send(from, to, sealed.envelope);
    await from.until(reached, 'upload to reach part 3');
    const sent = from.submits.filter(item => item.id === id).length;
    const saved = JSON.stringify(from.reload());
    clear(from);
    assert.ok(saved.includes(sealed.payloadHex), 'the journal lost the ciphertext');
    assert.ok(!saved.includes(sealed.body), 'the journal holds the plaintext');
    assert.equal(from.entry(id).state, 'unknown');
    assert.equal(from.entry(id).text, '');
    assert.equal(from.entry(id).payloadHex, sealed.payloadHex);
    await from.open();
    assert.equal(from.agent.recoverMessage(id, now()), true);
    from.flush();
    await from.until(
      () => from.entry(id).reason === 'partial-upload-not-resumed',
      'partial report',
    );
    await neverArrives(to, sealed.payloadHex);
    assert.equal(from.sendsAfter(id, sent), 0, 'chunks were sent after the reload');
    say('reload mid-upload', { resent: 0, copies: 0, ciphertextKept: true, plaintextSaved: false });
  }

  // The board restarts partway. The old boot's outcome can't be known, so it stays unknown.
  {
    const sealed = seal(a, to, 200);
    const reached = loseAfter(from, 3);
    const id = send(from, to, sealed.envelope);
    await from.until(reached, 'upload to reach part 3');
    const sent = from.submits.filter(item => item.id === id).length;
    const boot = from.agent.sync.boot;
    from.closeLink();
    clear(from);
    await from.restartBoard();
    await from.open();
    assert.notEqual(from.agent.sync.boot, boot, 'the board did not restart');
    assert.equal(from.agent.recoverMessage(id, now()), false);
    assert.equal(from.entry(id).state, 'unknown');
    await reload(a);
    await neverArrives(to, sealed.payloadHex);
    assert.equal(from.sendsAfter(id, sent), 0, 'chunks were sent after the restart');
    say('board restart mid-upload', { state: 'unknown', resent: 0, copies: 0 });
  }

  // Taking the port away partway and coming back.
  {
    const sealed = seal(a, to, 200);
    const reached = loseAfter(from, 3);
    const id = send(from, to, sealed.envelope);
    await from.until(reached, 'upload to reach part 3');
    const sent = from.submits.filter(item => item.id === id).length;
    const boot = from.agent.sync.boot;
    from.closeLink();
    clear(from);
    await from.reopenPort();
    await from.open();
    const sameBoot = from.agent.sync.boot === boot;
    assert.equal(from.agent.recoverMessage(id, now()), sameBoot);
    from.flush();
    if (!sameBoot) await reload(a);
    await neverArrives(to, sealed.payloadHex);
    assert.equal(from.sendsAfter(id, sent), 0, 'chunks were sent after reopening the port');
    say('port closed mid-upload', { sameBoot, resent: 0, copies: 0 });
  }

  // The whole upload lands but the acceptance is lost. Asking settles it, with no second send.
  {
    const sealed = seal(a, to, 200);
    from.onRx = message => message.type !== 'messageStatus' || message.state === 'receiving';
    const id = send(from, to, sealed.envelope);
    await from.until(
      () =>
        from.submits.filter(item => item.id === id).length >=
        Math.ceil(sealed.envelope.length / 32),
      'all chunks to go',
    );
    const sent = from.submits.filter(item => item.id === id).length;
    await sleep(300);
    from.closeLink();
    clear(from);
    assert.equal(from.entry(id).state, 'unknown');
    await from.open();
    assert.equal(from.agent.recoverMessage(id, now()), true);
    from.flush();
    await delivered(to, from, b, sealed);
    await from.until(
      () => from.entry(id).state === 'acknowledged',
      'acknowledgement after recovery',
      20000,
    );
    assert.equal(from.sendsAfter(id, sent), 0, 'it was sent a second time');
    say('lost acceptance recovered by asking', { state: 'acknowledged', resent: 0, copies: 1 });
  }

  // The board restarts just after accepting. The message may or may not have gone, once at most.
  {
    const sealed = seal(a, to, 200);
    let accepted = false;
    from.onRx = message => {
      if (message.type === 'messageStatus' && message.state === 'queued') accepted = true;
      return true;
    };
    const id = send(from, to, sealed.envelope);
    await from.until(() => accepted, 'acceptance');
    const sent = from.submits.filter(item => item.id === id).length;
    from.closeLink();
    clear(from);
    await from.restartBoard();
    await from.open();
    assert.equal(from.agent.recoverMessage(id, now()), false);
    assert.equal(from.entry(id).state, 'unknown');
    await reload(a);
    const copies = await atMostOneCopy(to, sealed.payloadHex);
    assert.equal(from.sendsAfter(id, sent), 0, 'it was sent a second time');
    say('board restart after acceptance', { state: 'unknown', resent: 0, copies });
  }

  // The receiver loses its link while reading an inbox item, and reads it again afterward.
  {
    const sealed = seal(a, to, 200);
    let lost = 0;
    to.onRx = message => {
      if (message.type !== 'inboxItem') return true;
      lost++;
      return false;
    };
    const id = send(from, to, sealed.envelope);
    await outcome(from, id);
    assert.equal(from.entry(id).state, 'acknowledged', from.entry(id).reason);
    await to.until(() => lost > 0, 'inbox read to be lost', 20000);
    assert.equal(to.copies(sealed.payloadHex), 0);
    to.closeLink();
    clear(to);
    await to.open();
    await delivered(to, from, b, sealed);
    // And a reload and a new link don't bring a second copy.
    to.reload();
    await to.open();
    await reload(b);
    await sleep(3000);
    assert.equal(to.copies(sealed.payloadHex), 1, 'recovery added a second copy');
    say('inbox read interrupted', { copies: 1, exact: true });
  }

  // The receiver restarts before reading: the message is gone from its memory, and nothing is made up.
  {
    const sealed = seal(a, to, 200);
    let lost = 0;
    to.onRx = message => {
      if (message.type !== 'inboxItem') return true;
      lost++;
      return false;
    };
    const id = send(from, to, sealed.envelope);
    await outcome(from, id);
    assert.equal(from.entry(id).state, 'acknowledged', from.entry(id).reason);
    await to.until(() => lost > 0, 'inbox read to be lost', 20000);
    to.closeLink();
    clear(to);
    await to.restartBoard();
    await to.open();
    await reload(b);
    await neverArrives(to, sealed.payloadHex, 4000);
    assert.equal(from.entry(id).state, 'acknowledged');
    say('receiver restart before reading', {
      senderSees: 'acknowledged',
      copies: 0,
      note: 'an ACK means the radio accepted it, not that anyone read it',
    });
  }

  // Everything still works afterward, at the largest size.
  {
    const sealed = seal(a, to, 947);
    assert.equal(sealed.envelope.length, 1024);
    const id = send(from, to, sealed.envelope);
    await outcome(from, id);
    assert.equal(from.entry(id).state, 'acknowledged', from.entry(id).reason);
    await delivered(to, from, b, sealed);
    say('largest message afterward', { bytes: 1024, copies: 1 });
  }
}

let team: { relay: string; team: string; seed: string } | undefined;
/** A restarted member needs its team key back before it can send again. */
async function reload(index: number) {
  if (!team) return;
  const rig = rigs[index];
  const keys = team;
  await rig.network(
    () => rig.agent.loadTeamKey({ generation: 1, epoch: 0, teamChain: keys.team }, now()),
    () => rig.agent.network?.teamLoaded === 1,
    'team key',
  );
  await rig.until(() => rig.agent.radioInfo?.reason === 'ready', 'radio ready', 10000);
}
async function chooseNetwork(rig: Rig, mode: 'open' | 'team') {
  if (mode === 'open')
    return rig.network(
      () => rig.agent.chooseOpenMode(now()),
      () => rig.agent.network?.networkMode === 1,
      'Open mode',
    );
  const keys = team!;
  await rig.network(
    () =>
      rig.agent.fillTeam(
        {
          generation: 1,
          epoch: 0,
          relayChain: keys.relay,
          deviceKey: randomBytes(32).toString('hex'),
          proof: proofAt(hmac, keys.seed, 0, 0),
        },
        now(),
      ),
    () => rig.agent.network?.networkMode === 2,
    'team',
  );
  await reload(rigs.indexOf(rig));
}

const originals: number[] = [];
try {
  for (const rig of rigs) {
    await rig.open();
    const mode = rig.agent.network!.networkMode;
    assert.notEqual(mode, 2, 'this board is already in a team; refusing to replace its keys');
    originals.push(mode);
    const config = rig.agent.sync.config!;
    assert.equal(config.region, 'US');
    assert.equal(config.radio?.mode, 'mesh');
  }
  vaults[0].unlock('upload recovery test one', 'upload recovery test one');
  vaults[1].unlock('upload recovery test two', 'upload recovery test two');
  vaults[0].generate(0);
  vaults[1].importBundle(vaults[0].exportBundle(0), 0);

  for (const rig of rigs) await chooseNetwork(rig, 'open');
  await rigs[0].until(() => rigs[0].agent.radioInfo?.reason === 'ready', 'radio ready');
  await rigs[1].until(() => rigs[1].agent.radioInfo?.reason === 'ready', 'radio ready');
  await scenarios(0, 'Open');
  if (!single) await scenarios(1, 'Open');

  if (!single) {
    team = {
      relay: randomBytes(32).toString('hex'),
      team: randomBytes(32).toString('hex'),
      seed: randomBytes(32).toString('hex'),
    };
    for (const rig of rigs) await chooseNetwork(rig, 'team');
    await scenarios(0, 'Team');

    // A restarted member has no team key. Sending fails plainly, and nothing goes out in the clear.
    {
      const [from, to] = rigs;
      from.closeLink();
      await from.restartBoard();
      await from.open();
      await from.until(() => from.agent.radioInfo?.reason === 'team-key-needed', 'team key lost');
      const sealed = seal(0, to, 200);
      const id = send(from, to, sealed.envelope);
      await outcome(from, id);
      assert.equal(from.entry(id).state, 'failed');
      assert.equal(from.entry(id).reason, 'team-key-needed');
      await neverArrives(to, sealed.payloadHex, 4000);
      report('Team: sending with the team key lost', { state: 'failed', copies: 0 });
      await reload(0);
    }
  }

  // Nothing crossed either USB link, or reached a journal, in the clear.
  for (const rig of rigs) {
    const journal = JSON.stringify(rig.agent.exportJournal());
    for (const body of plaintexts) {
      const asHex = Buffer.from(body).toString('hex').slice(0, 64);
      for (const text of [...rig.seen, journal]) {
        assert.ok(!text.includes(body.slice(0, 44)), 'plaintext on the wire or in a journal');
        assert.ok(!text.includes(asHex), 'plaintext as hex on the wire or in a journal');
      }
    }
  }
  report('no plaintext on the wire or in a journal', {
    messages: plaintexts.length,
    framesScanned: rigs.reduce((total, rig) => total + rig.seen.length, 0),
  });
} finally {
  team = undefined;
  for (const [index, rig] of [...new Set(rigs)].entries()) {
    try {
      clear(rig);
      if (rig.agent.sync.state !== 'ready') await rig.open();
      if (originals[index] === 1) await chooseNetwork(rig, 'open');
      else if (originals[index] === 0)
        await rig.network(
          () => rig.agent.eraseNetwork(now()),
          () => rig.agent.network?.networkMode === 0,
          'erase',
        );
    } catch (error) {
      process.exitCode = 1;
      console.error('Check this board network by hand:', error);
    }
    await rig.shutdown();
  }
}
