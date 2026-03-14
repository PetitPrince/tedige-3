import { PieceType, nextRotation } from '../types/piece';
import type { ActivePiece, PieceShape, Rotation } from '../types/piece';
import type { Board } from '../types/board';
import { BOARD_COLS, BOARD_TOTAL_ROWS, CellType, getCell } from '../types/board';
import type { RotationSystem } from '../types/rotation-system';
import { ARS_SHAPES, getShape } from './shapes';
import { defaultCollides } from '../engine/collision';

// ── Shared helpers ────────────────────────────────────────────────────────────

// ARS and TGM3 both treat I, S, Z as 2-state pieces.
function normaliseRotation(type: PieceType, r: Rotation): Rotation {
  if (type === PieceType.I || type === PieceType.S || type === PieceType.Z) {
    return (r % 2) as Rotation;
  }
  return r;
}

// ARS centre-column rule (shared by ARS and TGM3).
//
// Cambridge fires this rule when piece.rotation == 0 or 2 (the HORIZONTAL/flat states).
// Our state numbering: 0 = spawn (horizontal), 2 = 180 (horizontal), 1 = CW (vertical),
// 3 = CCW (vertical).  So the rule fires when rotating FROM states 0 or 2.
//
// Algorithm (mirrors arika.lua / arika_ti.lua):
//   Scan the 4 minos of the TARGET rotation in raster order (top-left first).
//   ARS_SHAPES are stored in that order (deltaRow ASC, deltaCol ASC within same deltaRow).
//   For each mino check whether that board cell is blocked (wall, floor, or stack).
//   First blocked mino decides:
//     deltaCol === pivotCol  (the main column of the target vertical state) → reject rotation.
//     deltaCol !== pivotCol                                                 → break; allow kicks.
//
// Pivot column in the target bounding box:
//   toRotation 1 (arm-left, main column is the RIGHT column): pivotCol = 1
//   toRotation 3 (arm-right, main column is the LEFT column): pivotCol = 0
function centreColumnBlocked(
  type: PieceType,
  toRotation: Rotation,
  col: number,
  gameRow: number,
  board: Board,
): boolean {
  const raw = ARS_SHAPES[type][toRotation];
  const pivotCol = toRotation === 1 ? 1 : 0;
  for (const [deltaCol, deltaRow] of raw) {
    const c = col + deltaCol;
    const r = gameRow - deltaRow;
    const blocked =
      c < 0 || c >= BOARD_COLS ||
      r < 0 ||
      getCell(board, c, r) !== CellType.Empty;
    if (blocked) return deltaCol === pivotCol;
  }
  return false;
}

// Pivot offset from bounding-box anchor for each piece type and rotation state.
// pivot_col = piece.col + dc_piv,  pivot_row = piece.row - dr_piv
// Derived from Cambridge arika.lua block_offsets: pivot at {x=0,y=0},
// so dc_piv = -min_cx,  dr_piv = -min_cy  across all 4 minos of that state.
// States 2 and 3 of 2-state pieces (I,S,Z) mirror states 0 and 1.
const PIVOT_OFFSETS: Record<PieceType, ReadonlyArray<readonly [number, number]>> = {
  [PieceType.I]: [[2,0],[0,1],[2,0],[0,1]],
  [PieceType.O]: [[1,1],[1,1],[1,1],[1,1]],
  [PieceType.T]: [[1,1],[1,2],[1,1],[0,2]],
  [PieceType.S]: [[1,1],[1,2],[1,1],[1,2]],
  [PieceType.Z]: [[1,1],[0,2],[1,1],[0,2]],
  [PieceType.J]: [[1,1],[1,2],[1,1],[0,2]],
  [PieceType.L]: [[1,1],[1,2],[1,1],[0,2]],
};

const SPAWN_COL: Record<PieceType, number> = {
  // O uses a 2×2 bbox (min_dc=0) so leftmost block = spawn_col.
  // Cambridge O spawns with blocks at columns 4–5, so spawn_col = 4.
  [PieceType.I]: 3, [PieceType.O]: 4, [PieceType.T]: 3,
  [PieceType.S]: 3, [PieceType.Z]: 3, [PieceType.J]: 3, [PieceType.L]: 3,
};
const SPAWN_ROW: Record<PieceType, number> = {
  [PieceType.I]: 21, [PieceType.O]: 21, [PieceType.T]: 21,
  [PieceType.S]: 21, [PieceType.Z]: 21, [PieceType.J]: 21, [PieceType.L]: 21,
};

function spawnPiece(type: PieceType, board: Board, collides: (p: ActivePiece) => boolean): ActivePiece | null {
  const piece: ActivePiece = { type, rotation: 0, col: SPAWN_COL[type], row: SPAWN_ROW[type] };
  if (!collides(piece)) return piece;
  const lower = { ...piece, row: piece.row - 1 };
  if (!collides(lower)) return lower;
  return null;
}

// ── ARS (TGM1/2) ──────────────────────────────────────────────────────────────
// Wall kicks: right then left for J/L/T; centre-column rule for J/L/T.
// I, S, Z, O never kick.

export class ARSRotationSystem implements RotationSystem {
  readonly id = 'ars' as const;
  readonly name = 'ARS (TGM1/2)';

  getShape(type: PieceType, rotation: Rotation): PieceShape {
    return getShape(ARS_SHAPES, type, normaliseRotation(type, rotation));
  }

  collides(piece: ActivePiece, board: Board): boolean {
    return defaultCollides(this, piece, board);
  }

  spawn(type: PieceType, board: Board): ActivePiece | null {
    return spawnPiece(type, board, p => this.collides(p, board));
  }

  rotate(piece: ActivePiece, direction: 'cw' | 'ccw' | '180', board: Board): ActivePiece | null {
    const toRot   = nextRotation(piece.rotation, direction);
    const normTo   = normaliseRotation(piece.type, toRot);
    const normFrom = normaliseRotation(piece.type, piece.rotation);

    // 2-state pieces: 180 is a no-op visually.
    if (normTo === normFrom) return { ...piece, rotation: toRot };

    // 1. Basic rotation with pivot-preserving position adjustment.
    //    Cambridge keeps the pivot mino at the same board cell; we keep the
    //    bounding-box anchor, so we compensate with a col/row offset.
    const [fromDcP, fromDrP] = PIVOT_OFFSETS[piece.type][piece.rotation];
    const [toDcP,   toDrP  ] = PIVOT_OFFSETS[piece.type][toRot];
    const base: ActivePiece = {
      ...piece,
      rotation: toRot,
      col: piece.col + fromDcP - toDcP,
      row: piece.row + toDrP  - fromDrP,
    };
    if (!this.collides(base, board)) return base;

    // 2. I, S, Z, O never kick in ARS.
    if (piece.type === PieceType.I || piece.type === PieceType.O ||
        piece.type === PieceType.S || piece.type === PieceType.Z) return null;

    // 3. Centre-column rule — only for J/L/T and only when rotating FROM a
    //    horizontal state (our states 0 and 2, matching Cambridge's states 2 and 0).
    const fromIsHorizontal = piece.rotation === 0 || piece.rotation === 2;
    if (
      fromIsHorizontal &&
      (piece.type === PieceType.J || piece.type === PieceType.L || piece.type === PieceType.T) &&
      centreColumnBlocked(piece.type, normTo, base.col, base.row, board)
    ) return null;

    // 4. Try right kick (+1 col) then left kick (−1 col) from the pivot-adjusted position.
    for (const deltaCol of [1, -1]) {
      const c: ActivePiece = { ...base, col: base.col + deltaCol };
      if (!this.collides(c, board)) return c;
    }
    return null;
  }
}

// ── Touching check for TGM3 kicks ─────────────────────────────────────────────
// Returns true if any piece cell is orthogonally adjacent to an occupied board
// cell or the floor. This matches the reference isTouching() semantics.
function isTouching(piece: ActivePiece, shape: PieceShape, board: Board): boolean {
  for (const { deltaCol, deltaRow } of shape) {
    const col = piece.col + deltaCol;
    const row = piece.row - deltaRow;
    // Touching the floor
    if (row === 0) return true;
    // Check orthogonal neighbours for stack cells
    for (const [nc, nr] of [[col-1,row],[col+1,row],[col,row-1],[col,row+1]] as const) {
      if (nc >= 0 && nc < BOARD_COLS && nr >= 0 && nr < BOARD_TOTAL_ROWS &&
          getCell(board, nc, nr) !== CellType.Empty) {
        return true;
      }
    }
  }
  return false;
}

// ── TGM3 (Ti) ────────────────────────────────────────────────────────────────
// Extends ARS with:
//   - I wall kicks: rotating vert→horiz, if touching stack, try +1, +2, -1, -2 col
//   - I floor kicks: rotating horiz→vert, if touching stack/floor, try -1, -2 row up
//   - T floor kicks: from CW/CCW states, try -1 row up (after standard kicks fail)
//   - S, Z, O: no kicks
//   - J, L, T: centre-column rule + right/left kicks (same as ARS)

export class TGM3RotationSystem implements RotationSystem {
  readonly id = 'tgm3' as const;
  readonly name = 'TGM3 (Ti)';

  getShape(type: PieceType, rotation: Rotation): PieceShape {
    return getShape(ARS_SHAPES, type, normaliseRotation(type, rotation));
  }

  collides(piece: ActivePiece, board: Board): boolean {
    return defaultCollides(this, piece, board);
  }

  spawn(type: PieceType, board: Board): ActivePiece | null {
    return spawnPiece(type, board, p => this.collides(p, board));
  }

  rotate(piece: ActivePiece, direction: 'cw' | 'ccw' | '180', board: Board): ActivePiece | null {
    const toRot   = nextRotation(piece.rotation, direction);
    const normTo   = normaliseRotation(piece.type, toRot);
    const normFrom = normaliseRotation(piece.type, piece.rotation);

    if (normTo === normFrom) return { ...piece, rotation: toRot };

    // Bounding-box-preserving position adjustment.
    const [fromDcP, fromDrP] = PIVOT_OFFSETS[piece.type][piece.rotation];
    const [toDcP,   toDrP  ] = PIVOT_OFFSETS[piece.type][toRot];
    const base: ActivePiece = {
      ...piece,
      rotation: toRot,
      col: piece.col + fromDcP - toDcP,
      row: piece.row + toDrP  - fromDrP,
    };
    if (!this.collides(base, board)) return base;

    // S, Z, O: no kicks.
    if (piece.type === PieceType.S || piece.type === PieceType.Z ||
        piece.type === PieceType.O) return null;

    // ── I-piece: TGM3 special kicks ─────────────────────────────────────────
    if (piece.type === PieceType.I) {
      const fromShape = this.getShape(piece.type, piece.rotation);
      if (!isTouching(piece, fromShape, board)) return null;

      if (normTo === 0) {
        // Wall kicks (vert→horiz): try +1, +2, -1, -2 col
        for (const deltaCol of [1, 2, -1, -2]) {
          const c: ActivePiece = { ...base, col: base.col + deltaCol };
          if (!this.collides(c, board)) return c;
        }
      } else {
        // Floor kicks (horiz→vert): try 1 up, 2 up
        for (const deltaRow of [1, 2]) {
          const c: ActivePiece = { ...base, row: base.row + deltaRow };
          if (!this.collides(c, board)) return c;
        }
      }
      return null;
    }

    // ── J, L, T: centre-column rule + right/left kicks ──────────────────────
    const fromIsHorizontal = piece.rotation === 0 || piece.rotation === 2;
    if (
      fromIsHorizontal &&
      (piece.type === PieceType.J || piece.type === PieceType.L || piece.type === PieceType.T) &&
      centreColumnBlocked(piece.type, normTo, base.col, base.row, board)
    ) return null;

    // Standard right/left kicks
    for (const deltaCol of [1, -1]) {
      const c: ActivePiece = { ...base, col: base.col + deltaCol };
      if (!this.collides(c, board)) return c;
    }

    // ── T floor kick: from CW/CCW (vertical) states, try 1 up ──────────────
    if (piece.type === PieceType.T && !fromIsHorizontal) {
      const up: ActivePiece = { ...base, row: base.row + 1 };
      if (!this.collides(up, board)) return up;
    }

    return null;
  }
}
