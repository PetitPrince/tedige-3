export const enum CellType {
  Empty   = 0,
  I       = 1,
  O       = 2,
  T       = 3,
  S       = 4,
  Z       = 5,
  J       = 6,
  L       = 7,
  Garbage = 8,
}

export const CELL_TYPE_COUNT = 9;

export const BOARD_COLS = 10;
export const BOARD_ROWS = 20;   // Visible rows
export const BOARD_BUFFER = 4;  // Hidden buffer rows above visible (spawn zone)
export const BOARD_TOTAL_ROWS = BOARD_ROWS + BOARD_BUFFER; // 24

// Board is a flat Uint8Array of length COLS * TOTAL_ROWS.
// Index = row * COLS + col.
// Row 0 = bottom of the board (floor), row BOARD_TOTAL_ROWS-1 = top of buffer.
export type Board = Uint8Array;

export function createBoard(): Board {
  return new Uint8Array(BOARD_COLS * BOARD_TOTAL_ROWS);
}

export function getCell(board: Board, col: number, row: number): CellType {
  if (col < 0 || col >= BOARD_COLS || row < 0 || row >= BOARD_TOTAL_ROWS) return CellType.Empty;
  return board[row * BOARD_COLS + col] as CellType;
}

export function setCell(board: Board, col: number, row: number, type: CellType): void {
  if (col < 0 || col >= BOARD_COLS || row < 0 || row >= BOARD_TOTAL_ROWS) return;
  board[row * BOARD_COLS + col] = type;
}

export function cloneBoard(board: Board): Board {
  return new Uint8Array(board);
}
