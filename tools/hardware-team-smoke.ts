/**
 * Two-board team network check (D50). Uses throwaway random keys, and restores each board's network
 * and radio settings afterward. Refuses to run on a board already in a real team.
 */
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { openBoard } from './hardware-port.ts';
import type { Config } from '../packages/agent-core/sync.ts';
import { proofAt, ratchetChain, type Hmac } from '../packages/agent-core/rotation.ts';

const [python, heltecPort, tbeamPort] = process.argv.slice(2);
if (!python || !heltecPort || !tbeamPort || heltecPort === tbeamPort)
  throw new Error('usage: node tools/hardware-team-smoke.ts PYTHON HELTEC_PORT TBEAM_PORT');
const key = () => randomBytes(32).toString('hex');
const hmac: Hmac = (secret, message) => createHmac('sha256', secret).update(message).digest();
const proofSeed = key();
const fingerprint = (chain: string) =>
  createHmac('sha256', Buffer.from(chain, 'hex'))
    .update('reaper-v2 fingerprint')
    .digest('hex')
    .slice(0, 16);
type Board = Awaited<ReturnType<typeof openBoard>>;
const boards: Board[] = [];
const originals: { config: Config; mode: number }[] = [];
const report = (check: string, outcome: unknown) => console.log(JSON.stringify({ check, outcome }));
async function waitFor(test: () => boolean, what: string, timeout = 10000) {
  const until = performance.now() + timeout;
  while (!test()) {
    if (performance.now() > until) throw new Error(`timed out waiting for ${what}`);
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}
async function network(board: Board, command: () => void, expected: (b: Board) => boolean) {
  await waitFor(() => !!board.connection.network, 'network status');
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
  await waitFor(() => expected(board), 'network change');
  assert.equal(board.connection.network?.state, 'ok');
  await new Promise(resolve => setTimeout(resolve, 300));
}
const erase = (board: Board) =>
  network(
    board,
    () => board.adapter.eraseNetwork(),
    b => b.connection.network?.networkMode === 0,
  );
const fill = (board: Board, generation: number, relayChain: string, deviceKey = key()) =>
  network(
    board,
    () =>
      board.adapter.fillTeam({
        generation,
        epoch: 0,
        relayChain,
        deviceKey,
        proof: proofAt(hmac, proofSeed, 0, 0),
      }),
    b => b.connection.network?.networkMode === 2 && b.connection.network.generation === generation,
  );
const load = (board: Board, generation: number, teamChain: string) =>
  network(
    board,
    () => board.adapter.loadTeamKey({ generation, epoch: 0, teamChain }),
    b => b.connection.network?.teamLoaded === 1,
  );
const reason = (board: Board, expected: string) =>
  waitFor(
    () => board.connection.radioInfo?.reason === expected,
    `radio reason ${expected}, got ${board.connection.radioInfo?.reason}`,
    8000,
  );
async function send(from: Board, to: Board, text: string) {
  const id = from.adapter.sendMessage(text, to.connection.device!, 0);
  const entry = () => from.connection.messaging.history.find(item => item.id === id);
  await waitFor(
    () => ['acknowledged', 'failed', 'rejected', 'unknown'].includes(entry()?.state ?? ''),
    'message outcome',
    75000,
  );
  return entry()!;
}
const inInbox = (board: Board, text: string) =>
  board.connection.inbox.history.some(item => item.text === text);
try {
  boards.push(await openBoard(python, heltecPort));
  boards.push(await openBoard(python, tbeamPort));
  let [heltec] = boards;
  const tbeam = boards[1];
  for (const board of boards) {
    await waitFor(() => !!board.connection.network, 'network status');
    const mode = board.connection.network!.networkMode;
    assert.notEqual(mode, 2, 'this board is already in a team; refusing to replace its keys');
    const config = board.connection.sync.config!;
    assert.equal(config.region, 'US');
    originals.push({ config, mode });
    assert.equal(config.radio?.mode, 'mesh');
  }

  // Silent until a network is chosen.
  for (const board of boards) {
    await erase(board);
    await reason(board, 'network-not-chosen');
  }
  const silent = await send(heltec, tbeam, `silent ${crypto.randomUUID()}`);
  assert.notEqual(silent.state, 'acknowledged');
  report('no network chosen', { sent: silent.state, reason: silent.reason });

  // Relay keys alone: nothing of its own can be sent.
  const relay = key(),
    team = key();
  for (const board of boards) {
    await fill(board, 1, relay);
    await reason(board, 'team-key-needed');
  }
  const relayOnly = await send(heltec, tbeam, `relay ${crypto.randomUUID()}`);
  assert.notEqual(relayOnly.state, 'acknowledged');
  report('relay key only', { sent: relayOnly.state, reason: relayOnly.reason });

  // Same team: delivered both ways.
  for (const board of boards) {
    await load(board, 1, team);
    await reason(board, 'ready');
  }
  assert.equal(
    heltec.connection.network?.teamFingerprint,
    tbeam.connection.network?.teamFingerprint,
  );
  for (const [from, to] of [
    [heltec, tbeam],
    [tbeam, heltec],
  ]) {
    const text = `team ${crypto.randomUUID()}`;
    const sent = await send(from, to, text);
    assert.equal(sent.state, 'acknowledged', sent.reason);
    await waitFor(() => inInbox(to, text), 'team message in inbox', 15000);
    report('same team', { from: from.connection.device, outcome: 'acknowledged+inbox' });
  }

  // Rotation (D52). One agent advances, and the other radio follows from the proof it hears, with
  // its team key carried along and no message lost. Agents hold the only source of proofs.
  const relayAt = (epoch: number) => ratchetChain(hmac, relay, epoch);
  const teamAt = (epoch: number) => ratchetChain(hmac, team, epoch);
  const advance = (board: Board, epoch: number) =>
    network(
      board,
      () => board.adapter.advanceNetwork({ epoch, proof: proofAt(hmac, proofSeed, 0, epoch) }),
      b => b.connection.network?.provenEpoch === epoch,
    );
  const heard = (board: Board, epoch: number) =>
    waitFor(
      () => board.connection.network?.provenEpoch === epoch,
      `epoch ${epoch} on ${board.connection.device}, at ${board.connection.network?.provenEpoch}`,
      20000,
    );
  const messageBoth = async (label: string) => {
    for (const [from, to] of [
      [heltec, tbeam],
      [tbeam, heltec],
    ]) {
      const text = `${label} ${crypto.randomUUID()}`;
      const sent = await send(from, to, text);
      assert.equal(sent.state, 'acknowledged', sent.reason);
      await waitFor(() => inInbox(to, text), `${label} message in inbox`, 15000);
    }
    report(label, 'delivered both ways');
  };
  const proofStarted = performance.now();
  await advance(heltec, 1);
  await heard(tbeam, 1);
  report('proof heard over radio', { milliseconds: Math.round(performance.now() - proofStarted) });
  assert.equal(tbeam.connection.network?.epoch, 1);
  assert.equal(
    heltec.connection.network?.teamFingerprint,
    tbeam.connection.network?.teamFingerprint,
  );
  assert.equal(
    tbeam.connection.network?.relayFingerprint,
    fingerprint(relayAt(0)),
    'the floor keeps the epoch before the proven one',
  );
  assert.equal(tbeam.connection.network?.teamFingerprint, fingerprint(teamAt(1)));
  await messageBoth('after a proof');

  // A wrong proof is refused, and the radio announces nothing.
  await network(
    tbeam,
    () => tbeam.adapter.advanceNetwork({ epoch: 2, proof: key() }),
    b => b.connection.network?.state === 'invalid',
  ).catch(() => undefined);
  assert.equal(tbeam.connection.network?.provenEpoch, 1);
  assert.equal(tbeam.connection.network?.state, 'invalid');
  report('wrong proof', 'refused');

  // A radio that was away catches up alone. Its radio is off while the other advances twice. Then a
  // message's team tag moves it, and the next proof proves the whole gap at once.
  const radioMode = async (board: Board, mode: 'off' | 'mesh') => {
    const config = board.connection.sync.config!;
    const id = board.adapter.configure({ ...config, radio: { ...config.radio!, mode } });
    await waitFor(() => board.connection.commands.status(id).outcome !== 'pending', 'save', 10000);
    assert.equal(board.connection.commands.status(id).outcome, 'committed');
    await waitFor(() => board.connection.sync.state === 'ready', 'resync', 10000);
    await waitFor(() => !!board.connection.network, 'network status', 10000);
  };
  await radioMode(tbeam, 'off');
  await advance(heltec, 2);
  await advance(heltec, 3);
  assert.equal(tbeam.connection.network?.provenEpoch, 1);
  await radioMode(tbeam, 'mesh');
  await reason(tbeam, 'ready');
  const late = `after a gap ${crypto.randomUUID()}`;
  const lateSent = await send(heltec, tbeam, late);
  assert.equal(lateSent.state, 'acknowledged', lateSent.reason);
  await waitFor(() => inInbox(tbeam, late), 'message after a gap', 15000);
  await waitFor(() => tbeam.connection.network?.epoch === 3, 'team key following the team tag');
  assert.equal(tbeam.connection.network?.provenEpoch, 1);
  report('away radio read a newer epoch', { epoch: 3, provenEpoch: 1 });
  await advance(heltec, 4);
  await heard(tbeam, 4);
  assert.equal(tbeam.connection.network?.relayFingerprint, fingerprint(relayAt(3)));
  await messageBoth('after catching up');

  // A radio with only the relay key follows too, and a restart keeps where it got to.
  await heltec.adapter.disconnect();
  boards[0] = await openBoard(python, heltecPort);
  const restarted = boards[0];
  await waitFor(() => !!restarted.connection.network, 'network status after restart');
  assert.equal(restarted.connection.network?.provenEpoch, 4);
  assert.equal(restarted.connection.network?.teamLoaded, 0);
  assert.equal(restarted.connection.network?.epoch, 3);
  await advance(tbeam, 5);
  await heard(restarted, 5);
  report('relay key only followed', {
    epoch: restarted.connection.network?.epoch,
    provenEpoch: restarted.connection.network?.provenEpoch,
  });
  await network(
    restarted,
    () => restarted.adapter.loadTeamKey({ generation: 1, epoch: 5, teamChain: teamAt(5) }),
    b => b.connection.network?.teamLoaded === 1,
  );
  heltec = restarted;
  const reloaded = `after reload ${crypto.randomUUID()}`;
  const reloadedSent = await send(heltec, tbeam, reloaded);
  assert.equal(reloadedSent.state, 'acknowledged', reloadedSent.reason);
  report('team key reloaded at the current epoch', 'delivered');
  for (const board of [heltec, tbeam]) {
    await erase(board);
    await fill(board, 1, relay);
    await load(board, 1, team);
  }

  // A radio holding the stolen relay key, but not the team key, is rejected.
  await fill(tbeam, 1, relay, key());
  await load(tbeam, 1, key());
  const thief = `thief ${crypto.randomUUID()}`;
  const stolen = await send(tbeam, heltec, thief);
  await new Promise(resolve => setTimeout(resolve, 2000));
  assert.notEqual(stolen.state, 'acknowledged');
  assert.ok(!inInbox(heltec, thief));
  report('relay key without team key', { sent: stolen.state, heard: false });

  // A radio from another network: neither can hear the other.
  await fill(tbeam, 1, key());
  await load(tbeam, 1, team);
  const outsider = `outsider ${crypto.randomUUID()}`;
  const other = await send(heltec, tbeam, outsider);
  await new Promise(resolve => setTimeout(resolve, 2000));
  assert.notEqual(other.state, 'acknowledged');
  assert.ok(!inInbox(tbeam, outsider));
  report('other network', { sent: other.state, heard: false });

  // Team key is memory only: a restart leaves relay keys and needs it again.
  await heltec.adapter.disconnect();
  boards[0] = await openBoard(python, heltecPort);
  await waitFor(() => !!boards[0].connection.network, 'network status after restart');
  assert.equal(boards[0].connection.network?.networkMode, 2);
  assert.equal(boards[0].connection.network?.generation, 1);
  report('after reconnect', {
    teamLoaded: boards[0].connection.network?.teamLoaded,
    reason: boards[0].connection.radioInfo?.reason,
  });
} finally {
  for (const [index, board] of boards.entries()) {
    const original = originals[index];
    try {
      if (original && board.connection.sync.state === 'ready') {
        if (original.mode === 1)
          await network(
            board,
            () => board.adapter.chooseOpenMode(),
            b => b.connection.network?.networkMode === 1,
          );
        else await erase(board);
      }
    } catch (error) {
      process.exitCode = 1;
      console.error('Verify this board network by hand:', error);
    }
    await board.adapter.disconnect();
  }
}
