import type { ActivePiece, PieceShape, PieceType, Rotation } from './piece';
import type { Board } from './board';

export interface RotationSystem {
  readonly id: 'srs' | 'ars' | 'tgm3';
  readonly name: string;

  /** Get the 4 mino offsets for a piece in a given rotation state. */
  getShape(type: PieceType, rotation: Rotation): PieceShape;

  /** Spawn a new piece on the board. Returns null if spawn is blocked (top-out). */
  spawn(type: PieceType, board: Board): ActivePiece | null;

  /** Attempt a rotation. Returns new ActivePiece if any kick succeeds, null if all fail. */
  rotate(piece: ActivePiece, direction: 'cw' | 'ccw' | '180', board: Board): ActivePiece | null;

  /** Returns true if the piece in given state collides with board cells or walls/floor. */
  collides(piece: ActivePiece, board: Board): boolean;
}
