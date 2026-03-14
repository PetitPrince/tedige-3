import { PieceType } from '../types/piece';
import type { Rotation } from '../types/piece';

// Shape encoding: [deltaCol, deltaRow] where:
//   deltaCol = column offset from anchor (rightward = positive)
//   deltaRow = row offset from anchor in ARRAY coords (downward = positive, so row 0 = top of bbox)
// Anchor = top-left of bounding box.
// To convert to game coords (upward positive): game_row = anchor_row - deltaRow
//
// All shapes are stored as their array-coordinate (row-down) offsets from anchor.

type ShapeData = ReadonlyArray<ReadonlyArray<readonly [number, number]>>;

// SRS shapes — 4 rotation states per piece, 4 minos each.
// Bounding boxes: I = 4×4, O = 3×3 (top-right 2×2 used), T/S/Z/J/L = 3×3
export const SRS_SHAPES: Record<PieceType, ShapeData> = {
  [PieceType.I]: [
    [[0,1],[1,1],[2,1],[3,1]],   // state 0: horizontal
    [[2,0],[2,1],[2,2],[2,3]],   // state 1 (CW / R)
    [[0,2],[1,2],[2,2],[3,2]],   // state 2 (180)
    [[1,0],[1,1],[1,2],[1,3]],   // state 3 (CCW / L)
  ],
  [PieceType.O]: [
    [[1,0],[2,0],[1,1],[2,1]],   // all states identical
    [[1,0],[2,0],[1,1],[2,1]],
    [[1,0],[2,0],[1,1],[2,1]],
    [[1,0],[2,0],[1,1],[2,1]],
  ],
  [PieceType.T]: [
    [[1,0],[0,1],[1,1],[2,1]],   // state 0: stem up
    [[1,0],[1,1],[2,1],[1,2]],   // state 1: stem right
    [[0,1],[1,1],[2,1],[1,2]],   // state 2: stem down
    [[1,0],[0,1],[1,1],[1,2]],   // state 3: stem left
  ],
  [PieceType.S]: [
    [[1,0],[2,0],[0,1],[1,1]],   // state 0: spawn
    [[0,0],[0,1],[1,1],[1,2]],   // state 1 (CW)
    [[1,1],[2,1],[0,2],[1,2]],   // state 2 (180)
    [[1,0],[0,1],[1,1],[0,2]],   // state 3 (CCW)
  ],
  [PieceType.Z]: [
    [[0,0],[1,0],[1,1],[2,1]],   // state 0: spawn
    [[1,0],[0,1],[1,1],[0,2]],   // state 1 (CW)
    [[0,1],[1,1],[1,2],[2,2]],   // state 2 (180)
    [[1,0],[0,1],[1,1],[0,2]],   // state 3 (CCW) — same shape as CW, different wall-kick table
  ],
  [PieceType.J]: [
    [[0,0],[0,1],[1,1],[2,1]],
    [[1,0],[2,0],[1,1],[1,2]],
    [[0,1],[1,1],[2,1],[2,2]],
    [[1,0],[1,1],[0,2],[1,2]],
  ],
  [PieceType.L]: [
    [[2,0],[0,1],[1,1],[2,1]],
    [[1,0],[1,1],[1,2],[2,2]],
    [[0,1],[1,1],[2,1],[0,2]],
    [[0,0],[1,0],[1,1],[1,2]],
  ],
} as const;

// ARS shapes (TGM1/TGM2) — key differences from SRS:
// - All pieces spawn with flat side UP (stem/foot pointing DOWN) — Cambridge rotation index 2.
// - State 0 = ARS spawn; state +1 = CW rotation.
// - I, S, Z are 2-state (states 2 & 3 alias to 0 & 1).
// - I piece: horizontal at bbox row 0 (not row 1 as in SRS); vertical at bbox col 0.
// - O piece: 2×2 bounding box (not SRS 3×3).
// - Minos stored in raster order (deltaRow ASC, deltaCol ASC within same deltaRow) for centre-column rule.
//
// Rotation cycle (CW = +1 to state index):
//   state 0 (spawn, flat-top) → +1 → state 1 (CW) → +1 → state 2 (180) → +1 → state 3 (CCW)
// Cambridge state numbering: our 0=Cam2, our 1=Cam3, our 2=Cam0, our 3=Cam1.
export const ARS_SHAPES: Record<PieceType, ShapeData> = {
  // I: 2-state. Horizontal at bbox row 0 (Cambridge pivot = 3rd block from left).
  // Vertical at bbox col 0 (Cambridge pivot = 2nd block from top).
  [PieceType.I]: [
    [[0,0],[1,0],[2,0],[3,0]],   // state 0: horizontal (spawn)
    [[0,0],[0,1],[0,2],[0,3]],   // state 1: vertical (CW)
    [[0,0],[1,0],[2,0],[3,0]],   // state 2 = state 0 (2-state piece)
    [[0,0],[0,1],[0,2],[0,3]],   // state 3 = state 1 (2-state piece)
  ],
  // O: 2×2 bounding box. All states identical.
  [PieceType.O]: [
    [[0,0],[1,0],[0,1],[1,1]],
    [[0,0],[1,0],[0,1],[1,1]],
    [[0,0],[1,0],[0,1],[1,1]],
    [[0,0],[1,0],[0,1],[1,1]],
  ],
  [PieceType.T]: [
    [[0,0],[1,0],[2,0],[1,1]],   // state 0: flat top, stem down (spawn)
    [[1,0],[0,1],[1,1],[1,2]],   // state 1: stem left (CW from spawn)
    [[1,0],[0,1],[1,1],[2,1]],   // state 2: stem up (180)
    [[0,0],[0,1],[1,1],[0,2]],   // state 3: stem right (CCW from spawn)
  ],
  // S, Z: 2-state.
  [PieceType.S]: [
    [[1,0],[2,0],[0,1],[1,1]],   // state 0: horizontal (spawn)
    [[0,0],[0,1],[1,1],[1,2]],   // state 1: vertical (CW)
    [[1,0],[2,0],[0,1],[1,1]],   // state 2 = state 0
    [[0,0],[0,1],[1,1],[1,2]],   // state 3 = state 1
  ],
  [PieceType.Z]: [
    [[0,0],[1,0],[1,1],[2,1]],   // state 0: horizontal (spawn)
    [[1,0],[0,1],[1,1],[0,2]],   // state 1: vertical (CW)
    [[0,0],[1,0],[1,1],[2,1]],   // state 2 = state 0
    [[1,0],[0,1],[1,1],[0,2]],   // state 3 = state 1
  ],
  [PieceType.J]: [
    [[0,0],[1,0],[2,0],[2,1]],   // state 0: flat top, foot right (spawn)
    [[1,0],[1,1],[0,2],[1,2]],   // state 1: vertical, hook bottom-left (CW)
    [[0,0],[0,1],[1,1],[2,1]],   // state 2: flat bottom, foot upper-left (180)
    [[0,0],[1,0],[0,1],[0,2]],   // state 3: vertical, hook top-right (CCW)
  ],
  [PieceType.L]: [
    [[0,0],[1,0],[2,0],[0,1]],   // state 0: flat top, foot left (spawn)
    [[0,0],[1,0],[1,1],[1,2]],   // state 1: vertical, hook top-left (CW)
    [[2,0],[0,1],[1,1],[2,1]],   // state 2: flat bottom, foot upper-right (180)
    [[0,0],[0,1],[0,2],[1,2]],   // state 3: vertical, hook bottom-right (CCW)
  ],
} as const;

// ARS bounding-box display offsets — [col, row] position of the shape's
// top-left occupied cell within the reference 4×4 bounding box.
// Our ARS_SHAPES always start at (0,0), but the reference shapes sit at
// different positions within the bbox. This table encodes that offset
// for correct visual rendering in the palette/popover.
// Derived from: PIVOT_OFFSETS max(dcP)-dcP[R] and max(drP)-drP[R].
export const ARS_BBOX_OFFSET: Record<PieceType, ReadonlyArray<readonly [number, number]>> = {
  [PieceType.I]: [[0,1],[2,0],[0,1],[2,0]],
  [PieceType.O]: [[1,1],[1,1],[1,1],[1,1]],
  [PieceType.T]: [[0,1],[0,0],[0,1],[1,0]],
  [PieceType.S]: [[0,1],[0,0],[0,1],[0,0]],
  [PieceType.Z]: [[0,1],[1,0],[0,1],[1,0]],
  [PieceType.J]: [[0,1],[0,0],[0,1],[1,0]],
  [PieceType.L]: [[0,1],[0,0],[0,1],[1,0]],
};

// NES bounding-box display offsets — [col, row] added to raw shape coords for popover display.
// NES shapes embed their absolute position within the 4×4 display bbox, so most offsets are [0,0].
// O: 2×2 bbox centered in the 4×4 → shift [1,1].
export const NES_BBOX_OFFSET: Record<PieceType, ReadonlyArray<readonly [number, number]>> = {
  [PieceType.I]: [[0,0],[0,0],[0,0],[0,0]],
  [PieceType.O]: [[1,1],[1,1],[1,1],[1,1]],
  [PieceType.T]: [[0,0],[0,0],[0,0],[0,0]],
  [PieceType.S]: [[0,0],[0,0],[0,0],[0,0]],
  [PieceType.Z]: [[0,0],[0,0],[0,0],[0,0]],
  [PieceType.J]: [[0,0],[0,0],[0,0],[0,0]],
  [PieceType.L]: [[0,0],[0,0],[0,0],[0,0]],
};

// SRS bounding-box display offsets — [col, row] added to raw shape coords for popover display.
// SRS shapes already encode their position within the 4×4 (I) or 3×3 (others) bbox,
// so most offsets are [0,0]. Exceptions:
//   O: shape uses cols 1-2 of a 3×3; shift +1 col to right-center it in the 4×4 display.
//   S/Z CW: vertical form sits at cols 0-1; shift +1 col to center it.
export const SRS_BBOX_OFFSET: Record<PieceType, ReadonlyArray<readonly [number, number]>> = {
  [PieceType.I]: [[0,0],[0,0],[0,0],[0,0]],
  [PieceType.O]: [[0,1],[0,1],[0,1],[0,1]],
  [PieceType.T]: [[0,0],[0,0],[0,0],[0,0]],
  [PieceType.S]: [[0,0],[1,0],[0,0],[0,0]],
  [PieceType.Z]: [[0,0],[1,0],[0,0],[0,0]],
  [PieceType.J]: [[0,0],[0,0],[0,0],[0,0]],
  [PieceType.L]: [[0,0],[0,0],[0,0],[0,0]],
};

// NES Tetris shapes — 4 rotation states per piece.
// I, S, Z are 2-state (states 2 & 3 duplicate 0 & 1).
// O is 1-state (all 4 identical). T, J, L have 4 distinct states.
// Spawn anchor = top-left of bounding box.
export const NES_SHAPES: Record<PieceType, ShapeData> = {
  // I: 2-state. Horizontal at bbox row 2 of a 4×4; vertical at bbox col 2.
  [PieceType.I]: [
    [[0,2],[1,2],[2,2],[3,2]],   // state 0: horizontal (spawn)
    [[2,0],[2,1],[2,2],[2,3]],   // state 1: vertical (CW)
    [[0,2],[1,2],[2,2],[3,2]],   // state 2 = state 0
    [[2,0],[2,1],[2,2],[2,3]],   // state 3 = state 1
  ],
  [PieceType.O]: [
    [[0,0],[1,0],[0,1],[1,1]],
    [[0,0],[1,0],[0,1],[1,1]],
    [[0,0],[1,0],[0,1],[1,1]],
    [[0,0],[1,0],[0,1],[1,1]],
  ],
  [PieceType.T]: [
    [[0,1],[1,1],[2,1],[1,2]],   // state 0: flat top, stem down (spawn)
    [[1,0],[1,1],[2,1],[1,2]],   // state 1: stem right (CW)
    [[1,0],[0,1],[1,1],[2,1]],   // state 2: stem up (180)
    [[1,0],[0,1],[1,1],[1,2]],   // state 3: stem left (CCW)
  ],
  // S, Z: 2-state.
  [PieceType.S]: [
    [[1,1],[2,1],[0,2],[1,2]],   // state 0: horizontal (spawn)
    [[1,0],[1,1],[2,1],[2,2]],   // state 1: vertical (CW)
    [[1,1],[2,1],[0,2],[1,2]],   // state 2 = state 0
    [[1,0],[1,1],[2,1],[2,2]],   // state 3 = state 1
  ],
  [PieceType.Z]: [
    [[0,1],[1,1],[1,2],[2,2]],   // state 0: horizontal (spawn)
    [[2,0],[1,1],[2,1],[1,2]],   // state 1: vertical (CW)
    [[0,1],[1,1],[1,2],[2,2]],   // state 2 = state 0
    [[2,0],[1,1],[2,1],[1,2]],   // state 3 = state 1
  ],
  [PieceType.J]: [
    [[0,1],[1,1],[2,1],[2,2]],   // state 0: flat top, hook bottom-right (spawn)
    [[1,0],[2,0],[1,1],[1,2]],   // state 1: vertical, hook top-right (CW)
    [[0,0],[0,1],[1,1],[2,1]],   // state 2: flat bottom, hook top-left (180)
    [[1,0],[1,1],[0,2],[1,2]],   // state 3: vertical, hook bottom-left (CCW)
  ],
  [PieceType.L]: [
    [[0,1],[1,1],[2,1],[0,2]],   // state 0: flat top, hook bottom-left (spawn)
    [[1,0],[1,1],[1,2],[2,2]],   // state 1: vertical, hook bottom-right (CW)
    [[2,0],[0,1],[1,1],[2,1]],   // state 2: flat bottom, hook top-right (180)
    [[0,0],[1,0],[1,1],[1,2]],   // state 3: vertical, hook top-left (CCW)
  ],
} as const;

export function getShape(
  shapes: Record<PieceType, ShapeData>,
  type: PieceType,
  rotation: Rotation,
): import('../types/piece').PieceShape {
  const raw = shapes[type][rotation];
  return [
    { deltaCol: raw[0][0], deltaRow: raw[0][1] },
    { deltaCol: raw[1][0], deltaRow: raw[1][1] },
    { deltaCol: raw[2][0], deltaRow: raw[2][1] },
    { deltaCol: raw[3][0], deltaRow: raw[3][1] },
  ];
}
