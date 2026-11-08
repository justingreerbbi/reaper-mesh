/**
 * Three-board relay acceptance on one desk, in Open mode. Boards on one desk all hear each other,
 * so the two end boards run the relay test build (REAPER_RELAY_TEST=1 bash
 * tools/build-firmware.sh BOARD), which ignores every frame that still has all its hops: frames
 * straight from their sender. The middle board runs normal firmware, so a frame reaches an end
 * board only if the middle board forwarded it (D56).
 *
 * First, with relaying off on the middle board, nothing may get through; that proves the ends
 * really can't hear each other. Then, with relaying on, one-frame and full-size direct messages
 * must be acknowledged both ways and Public broadcasts must arrive, each exactly once. Every board
 * must already be in the same Open network; this never changes networks. Radio settings are
 * restored afterwards. Team mode is tools/hardware-relay-team-smoke.ts.
 *
 * This is the relay logic over real radios, not a range test: the ends are still close together.
 */
import assert from 'node:assert/strict';
import { Bench } from './hardware-relay.ts';

const [python, ...ports] = process.argv.slice(2);
if (!python || ports.length !== 3)
  throw new Error(
    'usage: node tools/hardware-relay-smoke.ts PYTHON END_A_PORT RELAY_PORT END_C_PORT',
  );

const bench = new Bench();
try {
  const { a, relay, c } = await bench.open(python, ports);
  for (const board of bench.boards)
    assert.equal(
      board.connection.network?.networkMode,
      1,
      `${bench.name(board)} must be in Open mode; run tools/hardware-network.ts PORT open first`,
    );
  await bench.setRadio(a, { relay: false });
  await bench.setRadio(c, { relay: false });

  // 1. Relay off: the ends must not reach each other at all.
  await bench.setRadio(relay, { relay: false });
  const blocked = `Reaper relay control ${crypto.randomUUID()}`;
  const blockedId = a.adapter.sendMessage(blocked, c.connection.device!, 0);
  await bench.waitFor(
    () =>
      ['acknowledged', 'failed', 'rejected', 'unknown'].includes(
        bench.status(a, blockedId)?.state ?? '',
      ),
    'blocked direct',
  );
  assert.notEqual(bench.status(a, blockedId)?.state, 'acknowledged', 'A reached C, relaying off');
  assert.equal(
    bench.count(c, item => item.text === blocked),
    0,
    'C heard A with relaying off',
  );
  const quiet = `Reaper relay control broadcast ${crypto.randomUUID()}`;
  const quietId = a.adapter.sendMessage(quiet, 'broadcast', 0);
  assert.equal(
    await bench.happens(() => bench.count(c, item => item.text === quiet) > 0, 15000),
    false,
    'C heard a broadcast from A with relaying off',
  );
  // The relay hears A directly, which proves A was transmitting all along.
  await bench.waitFor(
    () => bench.count(relay, item => item.text === quiet) > 0,
    'relay heard A',
    10000,
  );
  assert.equal(bench.status(a, quietId)?.state, 'transmitted');
  bench.note({
    check: 'relay off: ends isolated',
    direct: 'not acknowledged',
    broadcast: 'not heard',
  });

  // 2. Relay on: direct messages both ways, one radio frame and full size.
  await bench.setRadio(relay, { relay: true });
  for (const bytes of [60, 1024]) {
    await bench.direct('relayed direct', a, c, relay, bytes);
    await bench.direct('relayed direct', c, a, relay, bytes);
  }
  // 3. Relay on: Public broadcasts both ways.
  await bench.broadcast('relayed broadcast', a, c, relay, true);
  await bench.broadcast('relayed broadcast', c, a, relay, true);
  await bench.report('build/relay-smoke.json', { network: 'open' });
} catch (error) {
  bench.diagnose();
  throw error;
} finally {
  await bench.close();
}
