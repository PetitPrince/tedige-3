import {
  BOARD_COLS, BOARD_TOTAL_ROWS, CellType,
  cloneBoard, createBoard, getCell, setCell,
} from '../types/board';
import type { Board } from '../types/board';
import type { ActivePiece, PieceShape } from '../types/piece';
import { expandMinos } from './collision';

/**
 * Place an active piece's minos onto the board, mutating it.
 * Minos outside the valid range are silently skipped.
 */
export function placePiece(board: Board, piece: ActivePiece, shape: PieceShape): void {
  const cellType = (piece.type + 1) as CellType; // PieceType enum value + 1 = CellType
  const minos = expandMinos(shape, !!piece.big);
  for (const { deltaCol, deltaRow } of minos) {
    const minoCol = piece.col + deltaCol;
    const minoRow = piece.row - deltaRow; // deltaRow is downward in array coords, convert to game row
    setCell(board, minoCol, minoRow, cellType);
  }
}

/**
 * Returns a new board with the piece placed on it (non-mutating).
 */
export function boardWithPiece(board: Board, piece: ActivePiece, shape: PieceShape): Board {
  const next = cloneBoard(board);
  placePiece(next, piece, shape);
  return next;
}

/**
 * Fill a single cell with the given type (non-mutating).
 */
export function boardWithCell(board: Board, col: number, row: number, type: CellType): Board {
  const next = cloneBoard(board);
  setCell(next, col, row, type);
  return next;
}

/**
 * Fill a rectangular region (non-mutating).
 */
export function boardWithRegion(
  board: Board,
  col: number, row: number,
  width: number, height: number,
  type: CellType,
): Board {
  const next = cloneBoard(board);
  for (let r = row; r < row + height; r++) {
    for (let c = col; c < col + width; c++) {
      setCell(next, c, r, type);
    }
  }
  return next;
}

/**
 * Flood-fill starting at (col, row) with the given type.
 * Fills connected empty cells (or cells matching the starting cell's type).
 */
export function boardWithFill(board: Board, col: number, row: number, type: CellType): Board {
  const next = cloneBoard(board);
  const targetType = getCell(next, col, row);
  if (targetType === type) return next;

  const stack: [number, number][] = [[col, row]];
  while (stack.length > 0) {
    const [c, r] = stack.pop()!;
    if (c < 0 || c >= BOARD_COLS || r < 0 || r >= BOARD_TOTAL_ROWS) continue;
    if (getCell(next, c, r) !== targetType) continue;
    setCell(next, c, r, type);
    stack.push([c+1, r], [c-1, r], [c, r+1], [c, r-1]);
  }
  return next;
}
