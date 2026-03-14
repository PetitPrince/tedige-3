import {
  BOARD_COLS, BOARD_TOTAL_ROWS, CellType,
  createBoard, getCell, setCell,
} from '../types/board';
import type { Board } from '../types/board';

export interface LineClearResult {
  board: Board;
  linesCleared: number;
  clearedRows: number[]; // which rows (in game coords) were cleared
}

/**
 * Clear all full rows from the board, shifting remaining rows down.
 * Returns a new board and the count of cleared lines.
 */
export function clearLines(board: Board): LineClearResult {
  const newBoard = createBoard();
  let writeRow = 0;
  let linesCleared = 0;
  const clearedRows: number[] = [];

  for (let r = 0; r < BOARD_TOTAL_ROWS; r++) {
    let full = true;
    for (let c = 0; c < BOARD_COLS; c++) {
      if (getCell(board, c, r) === CellType.Empty) {
        full = false;
        break;
      }
    }

    if (full) {
      linesCleared++;
      clearedRows.push(r);
    } else {
      // Copy this row to writeRow in the new board
      for (let c = 0; c < BOARD_COLS; c++) {
        setCell(newBoard, c, writeRow, getCell(board, c, r));
      }
      writeRow++;
    }
  }

  return { board: newBoard, linesCleared, clearedRows };
}

/**
 * Check if a specific row is full.
 */
export function isRowFull(board: Board, row: number): boolean {
  for (let c = 0; c < BOARD_COLS; c++) {
    if (getCell(board, c, row) === CellType.Empty) return false;
  }
  return true;
}

/**
 * Return the indices of all full rows in the board (game coords, 0=floor).
 */
export function detectFullRows(board: Board): number[] {
  const result: number[] = [];
  for (let r = 0; r < BOARD_TOTAL_ROWS; r++) {
    if (isRowFull(board, r)) result.push(r);
  }
  return result;
}

/**
 * Apply column gravity: each column's non-empty cells fall to the bottom,
 * packing down with no gaps (TGM2-style free fall / item gravity).
 * Returns a new board.
 */
export function freeFall(board: Board): Board {
  const newBoard = createBoard();
  for (let c = 0; c < BOARD_COLS; c++) {
    let destRow = 0;
    for (let r = 0; r < BOARD_TOTAL_ROWS; r++) {
      const cell = getCell(board, c, r);
      if (cell !== CellType.Empty) {
        setCell(newBoard, c, destRow, cell);
        destRow++;
      }
    }
  }
  return newBoard;
}

/**
 * Clear only the specified rows, shifting rows above them down.
 * Returns a new board.
 */
export function clearSpecificRows(board: Board, rows: number[]): Board {
  const rowSet = new Set(rows);
  const newBoard = createBoard();
  let writeRow = 0;
  for (let r = 0; r < BOARD_TOTAL_ROWS; r++) {
    if (rowSet.has(r)) continue;
    for (let c = 0; c < BOARD_COLS; c++) {
      setCell(newBoard, c, writeRow, getCell(board, c, r));
    }
    writeRow++;
  }
  return newBoard;
}
