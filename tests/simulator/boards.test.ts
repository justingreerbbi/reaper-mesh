import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { BOARDS, listNames, makers } from '../../agents/boards.ts';
import { SUPPORTED } from '../../agents/flasher/firmware.ts';

// docs/contributing/adding-a-board.md lists everything a board touches. These checks fail when a
// board is in agents/boards.json but missing from one of those places, or the other way round.
const read = (path: string) => readFileSync(path, 'utf8');
const section = (text: string, heading: string) => {
  const start = text.indexOf(`\n## ${heading}\n`);
  assert.ok(start >= 0, `missing section: ${heading}`);
  const end = text.indexOf('\n## ', start + 1);
  return text.slice(start, end < 0 ? undefined : end);
};

test('every board entry is complete and unique', () => {
  assert.ok(BOARDS.length > 0);
  assert.equal(new Set(BOARDS.map(board => board.id)).size, BOARDS.length);
  for (const board of BOARDS) {
    assert.match(board.id, /^[a-z0-9]+(-[a-z0-9]+)*$/, board.id);
    assert.ok(['supported', 'experimental'].includes(board.status), board.id);
    for (const key of ['name', 'maker', 'processor', 'radio', 'summary', 'installHint'] as const)
      assert.ok(board[key].trim(), `${board.id} is missing ${key}`);
    assert.ok(board.highlights.length >= 1 && board.highlights.length <= 3, board.id);
  }
});

test('every board has a page and a row in the board list', () => {
  const index = read('docs/boards/README.md');
  for (const board of BOARDS) {
    const page = `docs/boards/${board.id}.md`;
    assert.ok(existsSync(page), `${page} is missing`);
    assert.ok(read(page).startsWith(`# ${board.name}\n`), `${page} must be titled ${board.name}`);
    assert.ok(index.includes(`[${board.name}](${board.id}.md)`), `${board.id} has no row`);
  }
});

test('the installer has safety rules for exactly the listed boards', () => {
  assert.deepEqual(Object.keys(SUPPORTED).sort(), BOARDS.map(board => board.id).sort());
  for (const board of BOARDS) assert.equal(SUPPORTED[board.id].chip, board.processor, board.id);
});

test('CI builds every board, and Status reports on every board', () => {
  const ci = read('.github/workflows/checks.yml');
  const boards = section(read('docs/overview/status.md'), 'Boards');
  for (const board of BOARDS) {
    assert.ok(ci.includes(board.id), `CI does not build ${board.id}`);
    assert.ok(boards.includes(`(../boards/${board.id}.md)`), `Status has no row for ${board.id}`);
  }
});

test('the transmit power and button tables cover every board', () => {
  const power = section(read('docs/reference/radio-configuration.md'), 'Transmit power');
  const buttons = section(read('docs/reference/device-display.md'), 'Buttons');
  for (const board of BOARDS) {
    assert.ok(power.includes(board.name), `no transmit power row for ${board.name}`);
    assert.ok(buttons.includes(board.name), `no button row for ${board.name}`);
  }
});

test('board names and makers read as a sentence', () => {
  assert.equal(listNames(['A']), 'A');
  assert.equal(listNames(['A', 'B', 'C']), 'A, B and C');
  assert.deepEqual(
    makers([
      { ...BOARDS[0], maker: 'X' },
      { ...BOARDS[0], maker: 'Y' },
      { ...BOARDS[0], maker: 'X' },
    ]),
    ['X', 'Y'],
  );
});
