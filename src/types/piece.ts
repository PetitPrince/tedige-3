export const enum PieceType {
  I = 0,
  O = 1,
  T = 2,
  S = 3,
  Z = 4,
  J = 5,
  L = 6,
}

export const ALL_PIECE_TYPES: PieceType[] = [0, 1, 2, 3, 4, 5, 6];
export const PIECE_NAMES = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'] as const;
export type PieceName = (typeof PIECE_NAMES)[number];

// Rotation states: 0=spawn, 1=CW (R state), 2=180, 3=CCW (L state)
export type Rotation = 0 | 1 | 2 | 3;

export interface MinoOffset {
  deltaCol: number; // delta column (positive = right)
  deltaRow: number; // delta row    (positive = up in game space / toward top of board)
}

// The four mino positions of a piece in one rotation state.
// Offsets are relative to the piece's anchor (top-left of bounding box).
export type PieceShape = [MinoOffset, MinoOffset, MinoOffset, MinoOffset];

export interface ActivePiece {
  type: PieceType;
  rotation: Rotation;
  col: number;  // anchor column (0-indexed from left)
  row: number;  // anchor row (0-indexed from bottom of board, i.e., game coordinates)
  big?: boolean; // each mino occupies a 2×2 footprint (TGM2 big / DEATH item)
}

export function nextRotation(r: Rotation, dir: 'cw' | 'ccw' | '180'): Rotation {
  if (dir === 'cw')  return ((r + 1) % 4) as Rotation;
  if (dir === 'ccw') return ((r + 3) % 4) as Rotation;
  return ((r + 2) % 4) as Rotation;
}
