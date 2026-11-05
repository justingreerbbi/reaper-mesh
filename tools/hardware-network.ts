/** Reads or sets one board's radio network. Choosing Open mode or erasing is explicit, never implied. */
import { openBoard } from './hardware-port.ts';

const [python, port, action = 'status'] = process.argv.slice(2);
if (!python || !port || !['status', 'open', 'erase'].includes(action))
  throw new Error('usage: node tools/hardware-network.ts PYTHON PORT [status|open|erase]');
const board = await openBoard(python, port);
const { connection, adapter } = board;
const wait = async (test: () => boolean) => {
  const until = performance.now() + 8000;
  while (!test()) {
    if (performance.now() > until) throw new Error(`no answer: ${connection.error ?? 'timed out'}`);
    await new Promise(resolve => setTimeout(resolve, 25));
  }
};
try {
  await wait(() => !!connection.network);
  if (action === 'open') {
    adapter.chooseOpenMode();
    await wait(() => connection.network?.networkMode === 1 || connection.network?.state !== 'ok');
  } else if (action === 'erase') {
    adapter.eraseNetwork();
    await wait(() => connection.network?.networkMode === 0 || connection.network?.state !== 'ok');
  }
  await wait(() => !!connection.radioInfo);
  console.log({
    firmware: connection.capabilities?.firmware,
    state: connection.network?.state,
    networkMode: connection.network?.networkMode,
    generation: connection.network?.generation,
    radio: connection.radioInfo?.reason,
  });
} finally {
  await adapter.disconnect();
}
