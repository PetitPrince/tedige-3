import { describe, it, expect } from 'vitest';
import { spawnPieceOnFrame } from './actions';
import { emptyFrame } from '../types/frame';
import { BOARD_ROWS } from '../types/board';
import type { RotationSystem } from '../types/rotation-system';
import type { ActivePiece, PieceShape } from '../types/piece';

// Numeric literals avoid const-enum esbuild issues in tests
const I = 0, T = 2;

// ── Mock helpers ──────────────────────────────────────────────────────────────

function makeRotSys(
  shape: PieceShape = [],
  collidesAt: (row: number) => boolean = () => false,
): RotationSystem {
  return {
    getShape: () => shape,
    // spawn on any board always returns a piece at col 4, row 21 (buffer — intentionally
    // above visible; spawnPieceOnFrame must correct this)
    spawn: () => ({ type: I as any, rotation: 0, col: 4, row: 21 }),
    collides: (piece) => collidesAt(piece.row),
    rotate: () => null,
  };
}

// Shape with one mino above anchor (deltaRow = -1) and one at anchor (deltaRow = 0)
const SHAPE_TWO_HIGH: PieceShape = [{ deltaCol: 0, deltaRow: 0 }, { deltaCol: 0, deltaRow: -1 }];

// ── spawnPieceOnFrame ─────────────────────────────────────────────────────────

describe('spawnPieceOnFrame', () => {
  it('returns null when every candidate row is blocked', () => {
    const rotSys = makeRotSys([], () => true); // always collides
    expect(spawnPieceOnFrame(emptyFrame(), I as any, 0, rotSys)).toBeNull();
  });

  it('on an empty board, places the topmost mino at the top visible row', () => {
    // shape has mino at deltaRow=-1 (one above anchor) → anchor should land at BOARD_ROWS-2
    // so that the top mino sits at BOARD_ROWS-1
    const rotSys = makeRotSys(SHAPE_TWO_HIGH);
    const result = spawnPieceOnFrame(emptyFrame(), T as any, 0, rotSys);
    expect(result).not.toBeNull();
    // top mino: mino_row = anchor_row - deltaRow = anchor_row - (-1) = anchor_row + 1
    // we want that == BOARD_ROWS - 1 → anchor_row == BOARD_ROWS - 2
    expect(result!.activePiece!.row).toBe(BOARD_ROWS - 2);
  });

  it('on an empty board with a flat shape, anchors at the top visible row', () => {
    // shape with only deltaRow=0 minos → anchor == BOARD_ROWS - 1
    const rotSys = makeRotSys([{ deltaCol: 0, deltaRow: 0 }, { deltaCol: 1, deltaRow: 0 }]);
    const result = spawnPieceOnFrame(emptyFrame(), I as any, 0, rotSys);
    expect(result!.activePiece!.row).toBe(BOARD_ROWS - 1);
  });

  it('pushes above the visible area when the top visible row is blocked', () => {
    // Collision at row BOARD_ROWS-2 (the natural anchor for SHAPE_TWO_HIGH),
    // so the piece should end up one row higher
    const blockedRow = BOARD_ROWS - 2;
    const rotSys = makeRotSys(SHAPE_TWO_HIGH, row => row === blockedRow);
    const result = spawnPieceOnFrame(emptyFrame(), T as any, 0, rotSys);
    expect(result!.activePiece!.row).toBe(blockedRow + 1);
  });

  it('uses the rotation argument', () => {
    const rotSys = makeRotSys();
    const result = spawnPieceOnFrame(emptyFrame(), I as any, 2, rotSys);
    expect(result!.activePiece!.rotation).toBe(2);
  });

  it('uses the col from the rotation system spawn result', () => {
    const rotSys = makeRotSys();
    const result = spawnPieceOnFrame(emptyFrame(), I as any, 0, rotSys);
    expect(result!.activePiece!.col).toBe(4); // col from mock spawn
  });

  it('preserves board, nextQueue and holdPiece from the original frame', () => {
    const frame = { ...emptyFrame(), nextQueue: [1, 2] as any[], holdPiece: 3 as any };
    const result = spawnPieceOnFrame(frame, I as any, 0, makeRotSys());
    expect(result!.nextQueue).toEqual([1, 2]);
    expect(result!.holdPiece).toBe(3);
    expect(result!.board).toBe(frame.board);
  });

  it('replaces an existing activePiece', () => {
    const existing: ActivePiece = { type: T as any, rotation: 1, col: 0, row: 5 };
    const frame = { ...emptyFrame(), activePiece: existing };
    const result = spawnPieceOnFrame(frame, I as any, 0, makeRotSys());
    expect(result!.activePiece).not.toEqual(existing);
  });
});
