import { CellType, BOARD_COLS, BOARD_ROWS, createBoard, setCell } from '../types/board';
import type { Board } from '../types/board';

const CHAR_TO_CELL: Partial<Record<string, CellType>> = {
  I: CellType.I, O: CellType.O, T: CellType.T,
  S: CellType.S, Z: CellType.Z, J: CellType.J, L: CellType.L,
  G: CellType.Garbage, X: CellType.Garbage,
  // '.' and '-' (ghost) are intentionally absent → Empty
};

/**
 * Parse a tetris.wiki <playfield> markup string into a Board.
 *
 * Accepts either the full tagged form (<playfield>…</playfield>) or bare rows.
 * Active-piece cells (same letters as board cells) and ghost cells ('-') are
 * all treated as board cells / empty respectively — the markup doesn't
 * distinguish them, so the import gives the full visual state as a board.
 */
export function importWikiMarkup(
  markup: string,
): { board: Board; error: null } | { board: null; error: string } {
  const tagMatch = markup.match(/<playfield>([\s\S]*?)<\/playfield>/i);
  const content = tagMatch ? tagMatch[1] : markup;

  const lines = content
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0);

  if (lines.length === 0) {
    return { board: null, error: 'No rows found in playfield markup.' };
  }

  // Keep at most BOARD_ROWS lines (trim excess from top)
  const rows = lines.length > BOARD_ROWS ? lines.slice(lines.length - BOARD_ROWS) : lines;

  const board = createBoard();

  // rows[0] = topmost visible row  → game row (rows.length - 1)
  // rows[rows.length-1] = floor    → game row 0
  for (let displayRow = 0; displayRow < rows.length; displayRow++) {
    const gameRow = rows.length - 1 - displayRow;
    const line = rows[displayRow];
    for (let col = 0; col < Math.min(line.length, BOARD_COLS); col++) {
      const cellType = CHAR_TO_CELL[line[col].toUpperCase()];
      if (cellType !== undefined) setCell(board, col, gameRow, cellType);
    }
  }

  return { board, error: null };
}
