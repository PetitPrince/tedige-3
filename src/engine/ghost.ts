import type { ActivePiece } from '../types/piece';
import type { Board } from '../types/board';
import type { RotationSystem } from '../types/rotation-system';

/**
 * Compute where the active piece would land if dropped straight down.
 * Returns a new ActivePiece at the ghost (lock) position.
 */
export function computeGhost(
  piece: ActivePiece,
  board: Board,
  rotSys: RotationSystem,
): ActivePiece {
  let ghost = { ...piece };

  // Drop one row at a time until collision
  while (true) {
    const next = { ...ghost, row: ghost.row - 1 };
    if (rotSys.collides(next, board)) break;
    ghost = next;
  }

  return ghost;
}
