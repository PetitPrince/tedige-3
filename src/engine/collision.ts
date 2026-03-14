import { BOARD_COLS, BOARD_TOTAL_ROWS, CellType, getCell } from '../types/board';
import type { Board } from '../types/board';
import type { ActivePiece, MinoOffset } from '../types/piece';
import type { RotationSystem } from '../types/rotation-system';

/**
 * Expand each mino to a 2×2 block (TGM2 big mode).
 * Mino at (deltaCol, deltaRow) in array-down coords expands to the four cells:
 *   (deltaCol*2, deltaRow*2), (deltaCol*2+1, deltaRow*2), (deltaCol*2, deltaRow*2+1), (deltaCol*2+1, deltaRow*2+1)
 */
export function expandMinos(
  shape: readonly MinoOffset[],
  big: boolean,
): readonly MinoOffset[] {
  if (!big) return shape;
  const result: MinoOffset[] = [];
  for (const { deltaCol, deltaRow } of shape) {
    result.push(
      { deltaCol: deltaCol * 2,     deltaRow: deltaRow * 2     },
      { deltaCol: deltaCol * 2 + 1, deltaRow: deltaRow * 2     },
      { deltaCol: deltaCol * 2,     deltaRow: deltaRow * 2 + 1 },
      { deltaCol: deltaCol * 2 + 1, deltaRow: deltaRow * 2 + 1 },
    );
  }
  return result;
}

/**
 * Returns true if the given piece position collides with:
 * - Left/right walls
 * - Floor
 * - Non-empty cells on the board
 *
 * @param minos - Array of mino offsets in ARRAY coords (deltaCol=col right, deltaRow=row down from anchor)
 * @param col   - Anchor column
 * @param row   - Anchor row in GAME coords (0=floor, increases upward)
 *               Internally converted: arrayRow = BOARD_TOTAL_ROWS - 1 - (row + dr_game)
 *               but since shapes store deltaRow in array coords (downward), we do:
 *               arrayRow = (BOARD_TOTAL_ROWS - 1 - row) + dr_array
 */
export function collidesAt(
  board: Board,
  minos: readonly MinoOffset[],
  col: number,
  gameRow: number,
): boolean {
  // anchor in array coords: array row 0 = bottom of board,
  // but our board layout has row 0 = BOTTOM.
  // Since minos are stored as (deltaCol, deltaRow) in ARRAY coords (deltaRow increases downward, toward the floor),
  // the actual board row for a mino is: gameRow - dr_array... wait, let me be precise.
  //
  // Convention in this codebase:
  //   - Board storage: row 0 = floor (bottom), row BOARD_TOTAL_ROWS-1 = top of buffer.
  //   - Shape offsets: deltaRow in array coords means "rows from anchor top-left downward".
  //     So a mino at deltaRow=0 is at the top of the bounding box (highest row index in game coords).
  //     A mino at deltaRow=1 is one row lower = game row = anchor.row - 1? No...
  //
  // Let's re-clarify: piece.row is the TOP-LEFT anchor in game coords.
  // Shapes use "deltaRow in array down" meaning deltaRow=0 = top row of bbox.
  // So mino game row = piece.row + (bbox_height - 1 - dr_array)?
  //
  // Actually, looking at how shapes are defined: for T state 0: [[1,0],[0,1],[1,1],[2,1]]
  // deltaRow=0 means top of bounding box, deltaRow=1 means one below.
  // If piece.row = 19 (top visible), and anchor is top-left:
  //   mino at deltaRow=0 → game row 19 (top row, visible)
  //   mino at deltaRow=1 → game row 18 (one below)
  // So: mino_game_row = piece.row - dr_array (since dr_array increases downward = decreasing game row)

  for (const { deltaCol, deltaRow } of minos) {
    const minoCol = col + deltaCol;
    const minoRow = gameRow - deltaRow; // convert array-down deltaRow to game row (upward positive)

    // Wall collisions
    if (minoCol < 0 || minoCol >= BOARD_COLS) return true;
    // Floor collision
    if (minoRow < 0) return true;
    // Ceiling (above buffer) — allow spawning in buffer
    if (minoRow >= BOARD_TOTAL_ROWS) continue; // above board, no collision

    // Board cell collision
    if (getCell(board, minoCol, minoRow) !== CellType.Empty) return true;
  }
  return false;
}

/** Default collides() implementation shared by all rotation systems. */
export function defaultCollides(rs: RotationSystem, piece: ActivePiece, board: Board): boolean {
  const minos = expandMinos(rs.getShape(piece.type, piece.rotation), !!piece.big);
  return collidesAt(board, minos, piece.col, piece.row);
}
