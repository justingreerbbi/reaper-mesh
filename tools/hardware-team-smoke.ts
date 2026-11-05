/**
 * Two-board team network check (D50). Uses throwaway random keys, and restores each board's network
 * and radio settings afterward. Refuses to run on a board already in a real team.
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { openBoard } from './hardware-port.ts';
import type { Config } from '../packages/agent-core/sync.ts';

const [python, heltecPort, tbeamPort] = process.argv.slice(2);
if (!python || !heltecPort || !tbeamPort || heltecPort === tbeamPort)
  throw new Error('usage: node tools/hardware-team-smoke.ts PYTHON HELTEC_PORT TBEAM_PORT');
const key = () => randomBytes(32).toString('hex');
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
    () => board.adapter.fillTeam({ generation, epoch: 0, relayChain, deviceKey }),
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
  const [heltec, tbeam] = boards;
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
