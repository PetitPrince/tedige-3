import { PieceType } from '../types/piece';
import type { Rotation, ActivePiece } from '../types/piece';
import { SRS_SHAPES, ARS_SHAPES, NES_SHAPES } from '../rotation/shapes';

export type ShapeTable = typeof SRS_SHAPES;

/**
 * Given the actual mino cell positions and a target shape table,
 * find the (rotation, anchor) in that table that matches the positions exactly.
 *
 * Anchor conventions (shared by both systems):
 *   anchor = top-left of bounding box (in game coords, row increases upward)
 *   mino game col = anchor.col + deltaCol
 *   mino game row = anchor.row - deltaRow  (deltaRow=0 at bbox top, increasing downward)
 */
export function findActivePiece(
  type: PieceType,
  positions: { x: number; y: number }[],
  shapes: ShapeTable,
): ActivePiece | null {
  const posSet = new Set(positions.map(p => `${p.x},${p.y}`));
  const p0 = positions[0]; // seed: one known mino cell

  for (let r = 0; r < 4; r++) {
    const shape = shapes[type][r];
    // Try matching p0 against each offset in this rotation's shape.
    // If p0 corresponds to offset (deltaCol0, deltaRow0), the anchor is:
    //   col = p0.x - deltaCol0,  row = p0.y + deltaRow0
    for (const [deltaCol0, deltaRow0] of shape) {
      const col = p0.x - deltaCol0;
      const row = p0.y + deltaRow0;
      let ok = true;
      for (const [deltaCol, deltaRow] of shape) {
        if (!posSet.has(`${col + deltaCol},${row - deltaRow}`)) { ok = false; break; }
      }
      if (ok) return { type, rotation: r as Rotation, col, row };
    }
  }
  return null;
}

export function getShapeTable(rotationSystem: string): ShapeTable {
  return rotationSystem === 'ars' ? ARS_SHAPES
    : rotationSystem === 'nes' ? NES_SHAPES
    : SRS_SHAPES;
}
