/**
 * Three-board relay acceptance on one desk, in Team mode (D50, D52, D56). The two end boards run
 * the relay test build, so they hear each other only through the middle board; see
 * tools/hardware-relay-smoke.ts for the Open-mode run and how the bench works.
 *
 * 1. The relay is a full team member: direct messages (one frame and full size) and broadcasts
 *    cross it both ways.
 * 2. The relay holds only the relay key: it forwards what it cannot read, so the same messages
 *    still cross it, and it cannot read the broadcasts.
 * 3. Key rotation through that relay: A advances an epoch, and C, which can't hear A, follows from
 *    the proof the relay forwards. Then the relay's radio is off while A advances twice more; when
 *    it is back, the next proof proves the whole gap for the relay, which forwards it to C.
 *    Messages cross after each step.
 *
 * Uses throwaway random keys. Refuses to run on a board already in a team, and puts each board's
 * network and radio settings back afterwards.
 */
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { Bench, type Board } from './hardware-relay.ts';
import { proofAt, type Hmac } from '../packages/agent-core/rotation.ts';

const [python, ...ports] = process.argv.slice(2);
if (!python || ports.length !== 3)
  throw new Error(
    'usage: node tools/hardware-relay-team-smoke.ts PYTHON END_A_PORT RELAY_PORT END_C_PORT',
  );

const key = () => randomBytes(32).toString('hex');
const hmac: Hmac = (secret, message) => createHmac('sha256', secret).update(message).digest();
const relayChain = key(),
  teamChain = key(),
  proofSeed = key();
const bench = new Bench();
const originalModes = new Map<Board, number>();

async function network(board: Board, command: () => void, expected: (b: Board) => boolean) {
  await bench.waitFor(() => !!board.connection.network, 'network status', 10000, [board]);
  // A routine status query may be in flight; the command is sent once that has answered.
  for (let attempt = 0; ; attempt++) {
    try {
      command();
      break;
    } catch (error) {
      if (attempt > 40) throw error;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
  await bench.waitFor(() => expected(board), 'network change', 10000, [board]);
  assert.equal(board.connection.network?.state, 'ok');
  await new Promise(resolve => setTimeout(resolve, 300));
}
const erase = (board: Board) =>
  network(
    board,
    () => board.adapter.eraseNetwork(),
    b => b.connection.network?.networkMode === 0,
  );
const fill = (board: Board) =>
  network(
    board,
    () =>
      board.adapter.fillTeam({
        generation: 1,
        epoch: 0,
        relayChain,
        deviceKey: key(),
        proof: proofAt(hmac, proofSeed, 0, 0),
      }),
    b => b.connection.network?.networkMode === 2 && b.connection.network.generation === 1,
  );
const load = (board: Board) =>
  network(
    board,
    () => board.adapter.loadTeamKey({ generation: 1, epoch: 0, teamChain }),
    b => b.connection.network?.teamLoaded === 1,
  );
const advance = (board: Board, epoch: number) =>
  network(
    board,
    () => board.adapter.advanceNetwork({ epoch, proof: proofAt(hmac, proofSeed, 0, epoch) }),
    b => b.connection.network?.provenEpoch === epoch,
  );
/** Waits for a board to reach an epoch from a proof it heard over the radio. */
async function heard(label: string, board: Board, epoch: number, since: number) {
  const ok = await bench.happens(() => board.connection.network?.provenEpoch === epoch, 20000);
  if (!ok) bench.failures.push(`${label}: ${board.connection.device} never reached epoch ${epoch}`);
  bench.note({
    check: label,
    board: board.connection.device,
    provenEpoch: board.connection.network?.provenEpoch,
    epoch: board.connection.network?.epoch,
    milliseconds: Math.round(performance.now() - since),
    outcome: ok ? 'pass' : 'FAIL',
  });
  return ok;
}

try {
  const { a, relay, c } = await bench.open(python, ports);
  for (const board of bench.boards) {
    const mode = board.connection.network!.networkMode;
    assert.notEqual(
      mode,
      2,
      `${bench.name(board)} is already in a team; refusing to replace its keys`,
    );
    originalModes.set(board, mode);
  }
  await bench.setRadio(a, { relay: false });
  await bench.setRadio(c, { relay: false });
  await bench.setRadio(relay, { relay: true });
  for (const board of bench.boards) {
    await erase(board);
    await fill(board);
    await load(board);
    await bench.radioReason(board, 'ready');
  }
  assert.equal(a.connection.network?.teamFingerprint, c.connection.network?.teamFingerprint);

  // 1. A full team member relays.
  for (const bytes of [60, 1024]) {
    await bench.direct('team: member relay', a, c, relay, bytes);
    await bench.direct('team: member relay', c, a, relay, bytes);
  }
  await bench.broadcast('team: member relay', a, c, relay, true);
  await bench.broadcast('team: member relay', c, a, relay, true);

  // 2. A relay with only the relay key forwards what it cannot read.
  await erase(relay);
  await fill(relay);
  await bench.radioReason(relay, 'team-key-needed');
  assert.equal(relay.connection.network?.teamLoaded, 0);
  for (const bytes of [60, 1024]) {
    await bench.direct('team: relay key only', a, c, relay, bytes);
    await bench.direct('team: relay key only', c, a, relay, bytes);
  }
  await bench.broadcast('team: relay key only', a, c, relay, false);
  await bench.broadcast('team: relay key only', c, a, relay, false);

  // 3. Rotation through the relay-key-only relay. C hears A's proof only through the relay.
  let since = performance.now();
  await advance(a, 1);
  await heard('rotation: relay heard the proof', relay, 1, since);
  await heard('rotation: C followed through the relay', c, 1, since);
  await bench.direct('rotation: after epoch 1', a, c, relay, 60);
  await bench.direct('rotation: after epoch 1', c, a, relay, 60);

  // The relay is away while A advances twice; C can't hear those proofs at all.
  await bench.setRadio(relay, { relay: true, mode: 'off' });
  await advance(a, 2);
  await advance(a, 3);
  const stayed = !(await bench.happens(() => (c.connection.network?.provenEpoch ?? 0) > 1, 8000));
  if (!stayed) bench.failures.push('rotation: C advanced while the relay was off');
  bench.note({
    check: 'rotation: relay off, A advanced to 3',
    relayProven: relay.connection.network?.provenEpoch,
    cProven: c.connection.network?.provenEpoch,
    outcome: stayed ? 'pass' : 'FAIL',
  });
  await bench.setRadio(relay, { relay: true, mode: 'mesh' });
  await bench.radioReason(relay, 'team-key-needed');
  // The next proof proves the whole gap for the relay, which forwards it to C.
  since = performance.now();
  await advance(a, 4);
  await heard('rotation: relay caught up after being away', relay, 4, since);
  await heard('rotation: C caught up through the relay', c, 4, since);
  assert.equal(a.connection.network?.teamFingerprint, c.connection.network?.teamFingerprint);
  await bench.direct('rotation: after catching up', a, c, relay, 60);
  await bench.direct('rotation: after catching up', c, a, relay, 60);

  await bench.report('build/relay-team-smoke.json', {
    network: 'team',
    relayRoles: ['member', 'relay key only'],
  });
} catch (error) {
  bench.diagnose();
  throw error;
} finally {
  for (const [board, mode] of originalModes) {
    try {
      if (board.connection.sync.state !== 'ready') continue;
      if (mode === 1)
        await network(
          board,
          () => board.adapter.chooseOpenMode(),
          b => b.connection.network?.networkMode === 1,
        );
      else await erase(board);
    } catch (error) {
      process.exitCode = 1;
      console.error(`Put the network on ${bench.name(board)} back by hand:`, error);
    }
  }
  await bench.close();
}
