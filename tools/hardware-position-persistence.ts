/** Explicit saved-position/reboot check with RF sharing disabled throughout. */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile } from 'node:fs/promises';
import { openBoard } from './hardware-port.ts';
import type { Config } from '../packages/agent-core/sync.ts';
const execute = promisify(execFile);
const [python, heltec, tbeam] = process.argv.slice(2);
if (!python || !heltec || !tbeam || heltec === tbeam)
  throw Error('usage: node tools/hardware-position-persistence.ts PYTHON HELTEC_PORT TBEAM_PORT');
const evidence: {
  device: string;
  firmware: string;
  changedBoot: boolean;
  position: Config['position'];
}[] = [];
for (const [index, port] of [heltec, tbeam].entries()) {
  let board = await openBoard(python, port);
  const original = board.connection.sync.config!,
    previousBoot = board.connection.sync.boot;
  assert.equal(board.connection.supportsPosition, true);
  const save = async (config: Config) => {
    const id = board.adapter.configure(config),
      until = performance.now() + 8000;
    while (
      board.connection.commands.status(id).outcome === 'pending' ||
      board.connection.sync.state !== 'ready'
    ) {
      if (performance.now() > until || board.connection.sync.state === 'disconnected')
        throw Error('position persistence save interrupted; reconcile before restoring');
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert.equal(board.connection.commands.status(id).outcome, 'committed');
    assert.deepEqual(board.connection.sync.config?.position, config.position);
  };
  try {
    const position = {
      share: false,
      source: 1 as const,
      latitude: index ? 0 : 900000000,
      longitude: index ? 3600000000 : 1800000000,
    };
    await save({ ...original, position });
    await board.adapter.disconnect();
    await execute(
      python,
      [
        '-m',
        'esptool',
        '--chip',
        index ? 'esp32' : 'esp32s3',
        '--port',
        port,
        '--baud',
        '115200',
        'read_mac',
      ],
      { timeout: 30000 },
    );
    board = await openBoard(python, port);
    assert.notEqual(board.connection.sync.boot, previousBoot);
    assert.deepEqual(board.connection.sync.config?.position, position);
    evidence.push({
      device: board.connection.device!,
      firmware: board.connection.capabilities!.firmware,
      changedBoot: true,
      position,
    });
    console.log(
      'Saved fixed position survived actual reboot, RF sharing disabled:',
      board.connection.device,
    );
  } finally {
    // Restore via an authoritative fresh session even if an auxiliary read or reset failed.
    await board.adapter.disconnect();
    board = await openBoard(python, port);
    try {
      await save(original);
    } finally {
      await board.adapter.disconnect();
    }
  }
}
await writeFile(
  'build/tbeam-v12/position-persistence.json',
  JSON.stringify({ time: new Date().toISOString(), evidence }, null, 2) + '\n',
);
