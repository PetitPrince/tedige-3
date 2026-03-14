import { PieceType, nextRotation } from '../types/piece';
import type { ActivePiece, PieceShape, Rotation } from '../types/piece';
import type { Board } from '../types/board';
import type { RotationSystem } from '../types/rotation-system';
import { SRS_SHAPES, getShape } from './shapes';
import { defaultCollides } from '../engine/collision';

const SRS_SPAWN_ROW: Record<PieceType, number> = {
  [PieceType.I]: 21,
  [PieceType.O]: 21,
  [PieceType.T]: 21,
  [PieceType.S]: 21,
  [PieceType.Z]: 21,
  [PieceType.J]: 21,
  [PieceType.L]: 21,
};

const SRS_SPAWN_COL: Record<PieceType, number> = {
  [PieceType.I]: 3,
  [PieceType.O]: 3,
  [PieceType.T]: 3,
  [PieceType.S]: 3,
  [PieceType.Z]: 3,
  [PieceType.J]: 3,
  [PieceType.L]: 3,
};

export class SRSRotationSystem implements RotationSystem {
  readonly id = 'srs' as const;
  readonly name = 'SRS (Guideline)';

  getShape(type: PieceType, rotation: Rotation): PieceShape {
    return getShape(SRS_SHAPES, type, rotation);
  }

  collides(piece: ActivePiece, board: Board): boolean {
    return defaultCollides(this, piece, board);
  }

  spawn(type: PieceType, board: Board): ActivePiece | null {
    const piece: ActivePiece = {
      type,
      rotation: 0,
      col: SRS_SPAWN_COL[type],
      row: SRS_SPAWN_ROW[type],
    };
    if (!this.collides(piece, board)) return piece;
    const lower = { ...piece, row: piece.row - 1 };
    if (!this.collides(lower, board)) return lower;
    return null;
  }

  rotate(piece: ActivePiece, direction: 'cw' | 'ccw' | '180', board: Board): ActivePiece | null {
    const toRot = nextRotation(piece.rotation, direction);
    const rotated: ActivePiece = { ...piece, rotation: toRot };
    if (!this.collides(rotated, board)) return rotated;
    return null;
  }
}
