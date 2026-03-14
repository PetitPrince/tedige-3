import { BOARD_COLS, BOARD_ROWS, CellType, getCell } from '../types/board';
import { PieceType } from '../types/piece';
import type { Frame } from '../types/frame';
import type { RotationSystem } from '../types/rotation-system';
import { computeGhost } from '../engine/ghost';

const CELL_CHAR: Record<number, string> = {
  [CellType.Empty]:   '.',
  [CellType.I]:       'I',
  [CellType.O]:       'O',
  [CellType.T]:       'T',
  [CellType.S]:       'S',
  [CellType.Z]:       'Z',
  [CellType.J]:       'J',
  [CellType.L]:       'L',
  [CellType.Garbage]: 'G',
};

const PIECE_CHAR: Record<number, string> = {
  [PieceType.I]: 'I',
  [PieceType.O]: 'O',
  [PieceType.T]: 'T',
  [PieceType.S]: 'S',
  [PieceType.Z]: 'Z',
  [PieceType.J]: 'J',
  [PieceType.L]: 'L',
};

/**
 * Convert the current frame to tetris.wiki <playfield> markup.
 *
 * Cell codes:  I O T S Z J L = piece colours,  G = garbage,  . = empty,
 *              - = ghost piece (drawn only where the cell is otherwise empty).
 *
 * All 20 visible rows are always emitted (empty rows are not trimmed).
 */
export function frameToWikiMarkup(frame: Frame, rotSys: RotationSystem): string {
  // grid[displayRow][col], displayRow 0 = top of visible board (game row BOARD_ROWS-1)
  const grid: string[][] = Array.from({ length: BOARD_ROWS }, () =>
    Array<string>(BOARD_COLS).fill('.'),
  );

  // 1. Board stack
  for (let gameRow = 0; gameRow < BOARD_ROWS; gameRow++) {
    const displayRow = BOARD_ROWS - 1 - gameRow;
    for (let col = 0; col < BOARD_COLS; col++) {
      const cell = getCell(frame.board, col, gameRow);
      if (cell !== CellType.Empty) {
        grid[displayRow][col] = CELL_CHAR[cell] ?? 'G';
      }
    }
  }

  // 2. Ghost piece ('-' only over still-empty cells, skipped when at same row as active piece)
  if (frame.activePiece && frame.showGhost) {
    const ghost = computeGhost(frame.activePiece, frame.board, rotSys);
    if (ghost.row !== frame.activePiece.row) {
      const shape = rotSys.getShape(ghost.type, ghost.rotation);
      for (const { deltaCol, deltaRow } of shape) {
        const col = ghost.col + deltaCol;
        const gameRow = ghost.row - deltaRow;
        if (gameRow < 0 || gameRow >= BOARD_ROWS || col < 0 || col >= BOARD_COLS) continue;
        const displayRow = BOARD_ROWS - 1 - gameRow;
        if (grid[displayRow][col] === '.') grid[displayRow][col] = '-';
      }
    }
  }

  // 3. Active piece (overwrites ghost or empty)
  if (frame.activePiece) {
    const { type, rotation, col: pc, row: pr } = frame.activePiece;
    const shape = rotSys.getShape(type, rotation);
    const char = PIECE_CHAR[type] ?? 'G';
    for (const { deltaCol, deltaRow } of shape) {
      const col = pc + deltaCol;
      const gameRow = pr - deltaRow;
      if (gameRow < 0 || gameRow >= BOARD_ROWS || col < 0 || col >= BOARD_COLS) continue;
      const displayRow = BOARD_ROWS - 1 - gameRow;
      grid[displayRow][col] = char;
    }
  }

  const lines = grid.map(row => row.join(''));
  return '<playfield>\n' + lines.join('\n') + '\n</playfield>';
}
