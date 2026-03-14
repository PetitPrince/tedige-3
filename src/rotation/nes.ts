import { PieceType, nextRotation } from '../types/piece';
import type { ActivePiece, PieceShape, Rotation } from '../types/piece';
import type { Board } from '../types/board';
import type { RotationSystem } from '../types/rotation-system';
import { BOARD_ROWS, BOARD_BUFFER } from '../types/board';
import { NES_SHAPES, getShape } from './shapes';
import { defaultCollides } from '../engine/collision';

const NES_SPAWN_COL: Record<PieceType, number> = {
  [PieceType.I]: 3,
  [PieceType.O]: 4,
  [PieceType.T]: 3,
  [PieceType.S]: 3,
  [PieceType.Z]: 3,
  [PieceType.J]: 3,
  [PieceType.L]: 3,
};

export class NESRotationSystem implements RotationSystem {
  readonly id = 'nes' as const;
  readonly name = 'NES';

  getShape(type: PieceType, rotation: Rotation): PieceShape {
    return getShape(NES_SHAPES, type, rotation);
  }

  collides(piece: ActivePiece, board: Board): boolean {
    return defaultCollides(this, piece, board);
  }

  spawn(type: PieceType, board: Board): ActivePiece | null {
    const piece: ActivePiece = {
      type,
      rotation: 0,
      col: NES_SPAWN_COL[type],
      row: BOARD_ROWS + BOARD_BUFFER - 1,
    };
    if (!this.collides(piece, board)) return piece;
    const lower = { ...piece, row: piece.row - 1 };
    return this.collides(lower, board) ? null : lower;
  }

  rotate(piece: ActivePiece, direction: 'cw' | 'ccw' | '180', board: Board): ActivePiece | null {
    const toRot = nextRotation(piece.rotation, direction);
    const rotated: ActivePiece = { ...piece, rotation: toRot };
    return this.collides(rotated, board) ? null : rotated;
  }
}
