/**
 * Shared parts of the three-board desk relay tests (D56): tools/hardware-relay-smoke.ts (Open mode)
 * and tools/hardware-relay-team-smoke.ts (Team mode, a relay-key-only relay, key rotation).
 *
 * The two end boards run the relay test build, which ignores every frame heard straight from its
 * sender, so they hear each other only through the middle board, which runs normal firmware.
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { openBoard } from './hardware-port.ts';
import type { Config } from '../packages/agent-core/sync.ts';

export type Board = Awaited<ReturnType<typeof openBoard>>;
/** A full message is about 0.6 s of airtime; the budget refills at 1% a second. Plus margin. */
export const BUDGET_REFILL_MS = 70000;
const terminal = ['acknowledged', 'failed', 'rejected', 'unknown'];
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export class Bench {
  readonly boards: Board[] = [];
  readonly results: Record<string, unknown>[] = [];
  readonly failures: string[] = [];
  readonly #radio = new Map<Board, Config>();

  /** Opens END_A, RELAY and END_C, and checks each runs the build its role needs. */
  async open(python: string, ports: string[]) {
    if (ports.length !== 3 || new Set(ports).size !== 3) throw new Error('need three ports');
    for (const port of ports) this.boards.push(await openBoard(python, port));
    const [a, relay, c] = this.boards;
    assert.match(this.firmware(a), /-relay-test$/, 'end A must run the relay test build');
    assert.match(this.firmware(c), /-relay-test$/, 'end C must run the relay test build');
    assert.doesNotMatch(this.firmware(relay), /-relay-test$/, 'the relay must run normal firmware');
    assert.equal(new Set(this.boards.map(board => board.connection.device)).size, 3);
    for (const board of this.boards) {
      await this.waitFor(() => !!board.connection.network, 'network status', 10000);
      const config = board.connection.sync.config!;
      assert.equal(config.region, 'US');
      assert.ok(config.radio);
      this.#radio.set(board, config);
    }
    console.log(`End A: ${this.name(a)}\nRelay: ${this.name(relay)}\nEnd C: ${this.name(c)}`);
    return { a, relay, c };
  }

  firmware = (board: Board) => board.connection.capabilities?.firmware ?? '';
  name = (board: Board) => `${board.connection.device} (${this.firmware(board)})`;
  note(result: Record<string, unknown>) {
    this.results.push(result);
    console.log(result);
  }

  async waitFor(test: () => boolean, label: string, timeout = 65000, boards = this.boards) {
    const until = performance.now() + timeout;
    while (!test()) {
      const lost = boards.find(board => board.connection.sync.state === 'disconnected');
      if (lost)
        throw new Error(`${label}: ${this.name(lost)} disconnected (${lost.connection.error})`);
      if (performance.now() > until) throw new Error(`${label}: timed out`);
      await sleep(25);
    }
  }
  /** Waits the whole time and reports whether `test` ever became true. */
  async happens(test: () => boolean, timeout: number) {
    const until = performance.now() + timeout;
    while (performance.now() < until) {
      if (test()) return true;
      await sleep(50);
    }
    return test();
  }
  async refillBudgets() {
    console.log(`Waiting ${BUDGET_REFILL_MS / 1000} s for airtime budgets to refill...`);
    await sleep(BUDGET_REFILL_MS);
  }

  async save(board: Board, config: Config) {
    const id = board.adapter.configure(config);
    const only = [board];
    await this.waitFor(
      () => board.connection.commands.status(id).outcome !== 'pending',
      'save',
      10000,
      only,
    );
    assert.equal(board.connection.commands.status(id).outcome, 'committed');
    await this.waitFor(() => board.connection.sync.state === 'ready', 'resync', 10000, only);
    await this.waitFor(() => !!board.connection.network, 'network status', 10000, only);
  }
  async setRadio(board: Board, change: { relay?: boolean; mode?: 'off' | 'mesh' }) {
    const config = board.connection.sync.config!;
    await this.save(board, {
      ...config,
      radio: { ...config.radio!, mode: 'mesh', level: 'low', ...change },
    });
  }
  async radioReason(board: Board, reason: string, timeout = 10000) {
    await this.waitFor(
      () => board.connection.radioInfo?.reason === reason,
      `${this.name(board)} radio ${reason} (is ${board.connection.radioInfo?.reason})`,
      timeout,
      [board],
    );
  }

  status = (board: Board, id: string) =>
    board.connection.messaging.history.find(item => item.id === id);
  count = (board: Board, test: (item: { text?: string; messageId?: string }) => boolean) =>
    board.connection.inbox.history.filter(test).length;

  /** A direct message through the relay: acknowledged, and delivered once with the exact body. */
  async direct(label: string, sender: Board, receiver: Board, relay: Board, bytes: number) {
    if (bytes > 160) await this.refillBudgets();
    const text = `Reaper relay ${crypto.randomUUID()}: `.padEnd(bytes, 'x');
    const relayedBefore = relay.connection.radioInfo?.transmitted ?? 0;
    const id = sender.adapter.sendMessage(text, receiver.connection.device!, 0);
    await this.waitFor(
      () => terminal.includes(this.status(sender, id)?.state ?? ''),
      `${label}: send outcome`,
    );
    const sent = this.status(sender, id)!;
    const arrived = await this.happens(
      () => this.count(receiver, item => item.messageId === sent.messageId) > 0,
      sent.state === 'acknowledged' ? 10000 : 3000,
    );
    // Give a duplicate time to show up before counting.
    if (arrived) await sleep(3000);
    const copies = receiver.connection.inbox.history.filter(
      item => item.messageId === sent.messageId,
    );
    const ok = sent.state === 'acknowledged' && copies.length === 1 && copies[0].text === text;
    const from = sender.connection.device,
      to = receiver.connection.device;
    if (!ok) this.failures.push(`${label}: ${bytes}-byte direct ${from} -> ${to}`);
    this.note({
      check: label,
      from,
      to,
      bytes,
      sender: sent.state,
      reason: sent.reason,
      copies: copies.length,
      exact: copies[0]?.text === text,
      relayTransmitted: (relay.connection.radioInfo?.transmitted ?? 0) - relayedBefore,
      outcome: ok ? 'pass' : 'FAIL',
    });
    return ok;
  }

  /** A Public broadcast: the other end gets it exactly once; the relay too, if it can read it. */
  async broadcast(
    label: string,
    sender: Board,
    receiver: Board,
    relay: Board,
    relayReads: boolean,
  ) {
    const text = `Reaper relay broadcast ${crypto.randomUUID()}`;
    sender.adapter.sendMessage(text, 'broadcast', 0);
    await this.happens(() => this.count(receiver, item => item.text === text) > 0, 20000);
    await sleep(3000);
    const copies = this.count(receiver, item => item.text === text);
    const atRelay = this.count(relay, item => item.text === text);
    const ok = copies === 1 && atRelay === (relayReads ? 1 : 0);
    const from = sender.connection.device,
      to = receiver.connection.device;
    if (!ok) this.failures.push(`${label}: broadcast ${from} -> ${to}`);
    this.note({ check: label, from, to, copies, atRelay, outcome: ok ? 'pass' : 'FAIL' });
    return ok;
  }

  /** Each board's link and radio counters, for a failure report. */
  diagnose() {
    for (const board of this.boards) {
      const c = board.connection;
      console.error(
        `${this.name(board)}: sync ${c.sync.state}${c.error ? ` (${c.error})` : ''}, ` +
          `radio ${c.radioInfo?.reason ?? c.radioError}, transmitted ${c.radioInfo?.transmitted}, ` +
          `received ${c.radioInfo?.received}, network mode ${c.network?.networkMode} epoch ` +
          `${c.network?.epoch} proven ${c.network?.provenEpoch}, sends ` +
          `[${c.messaging.history.map(item => item.state).join(', ')}], inbox ${c.inbox.history.length}`,
      );
    }
  }

  async report(path: string, extra: Record<string, unknown>) {
    const [a, relay, c] = this.boards;
    await mkdir('build', { recursive: true });
    await writeFile(
      path,
      JSON.stringify(
        {
          time: new Date().toISOString(),
          endA: this.name(a),
          relay: this.name(relay),
          endC: this.name(c),
          passed: this.failures.length === 0,
          ...extra,
          results: this.results,
          note: 'Desk test: the ends ignore direct frames by build. Not a range test.',
        },
        null,
        2,
      ) + '\n',
    );
    if (this.failures.length) {
      process.exitCode = 1;
      console.error(`Failed (${this.failures.length}): ${this.failures.join('; ')}`);
      this.diagnose();
    } else console.log('All checks passed.');
    console.log(`Results in ${path}`);
  }

  /** Puts back each board's radio settings, then closes every session. */
  async close() {
    for (const [board, config] of this.#radio) {
      try {
        if (board.connection.sync.state === 'ready') await this.save(board, config);
      } catch (error) {
        process.exitCode = 1;
        console.error(`Restore the radio settings on ${this.name(board)} by hand:`, error);
      }
    }
    for (const board of this.boards) await board.adapter.disconnect();
  }
}
