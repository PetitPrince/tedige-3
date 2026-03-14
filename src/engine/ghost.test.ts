import { describe, it, expect } from 'vitest';
import { computeGhost } from './ghost';
import { createBoard, setCell, BOARD_COLS } from '../types/board';
import type { ActivePiece } from '../types/piece';
import type { RotationSystem } from '../types/rotation-system';

// Build a mock RotationSystem that checks floor + single anchor cell on the board.
// Assumes the piece shape is a single mino at (deltaCol=0, deltaRow=0).
function mockRotSys(board: ReturnType<typeof createBoard>): RotationSystem {
  return {
    getShape: () => [{ deltaCol: 0, deltaRow: 0 }],
    spawn: () => null,
    rotate: () => null,
    collides: (piece: ActivePiece) => {
      if (piece.row < 0) return true;
      if (piece.col < 0 || piece.col >= BOARD_COLS) return true;
      if (piece.row >= 24) return false; // above board — no collision
      return board[piece.row * BOARD_COLS + piece.col] !== 0;
    },
  } as unknown as RotationSystem;
}

function makePiece(col: number, row: number): ActivePiece {
  return { type: 0 as any, rotation: 0, col, row };
}

describe('computeGhost', () => {
  it('piece already at floor stays at row 0', () => {
    const b = createBoard();
    const ghost = computeGhost(makePiece(5, 0), b, mockRotSys(b));
    expect(ghost.row).toBe(0);
  });

  it('drops to floor on empty board', () => {
    const b = createBoard();
    const ghost = computeGhost(makePiece(5, 15), b, mockRotSys(b));
    expect(ghost.row).toBe(0);
  });

  it('lands on top of a filled cell in the same column', () => {
    const b = createBoard();
    setCell(b, 5, 3, 1 as any); // obstacle at (col=5, row=3)
    const ghost = computeGhost(makePiece(5, 15), b, mockRotSys(b));
    // Piece stops one row above the obstacle
    expect(ghost.row).toBe(4);
  });

  it('drops through empty columns independently', () => {
    const b = createBoard();
    setCell(b, 3, 5, 1 as any); // obstacle at col=3
    // Piece in a different column — should reach floor
    const ghost = computeGhost(makePiece(7, 15), b, mockRotSys(b));
    expect(ghost.row).toBe(0);
  });

  it('preserves piece col, type, and rotation', () => {
    const b = createBoard();
    const piece: ActivePiece = { type: 2 as any, rotation: 3, col: 7, row: 15 };
    const ghost = computeGhost(piece, b, mockRotSys(b));
    expect(ghost.col).toBe(7);
    expect(ghost.type).toBe(piece.type);
    expect(ghost.rotation).toBe(piece.rotation);
  });

  it('piece already above floor with cell directly below stops immediately', () => {
    const b = createBoard();
    setCell(b, 4, 9, 1 as any); // obstacle directly below piece
    const ghost = computeGhost(makePiece(4, 10), b, mockRotSys(b));
    expect(ghost.row).toBe(10); // cannot move down at all
  });
});
