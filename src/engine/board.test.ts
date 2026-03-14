import { describe, it, expect } from 'vitest';
import { boardWithPiece, boardWithFill, boardWithRegion } from './board';
import { createBoard, setCell, getCell, BOARD_COLS, BOARD_TOTAL_ROWS } from '../types/board';
import type { ActivePiece } from '../types/piece';

// PieceType literals: I=0, T=2
// CellType literals: I_CELL=1 (I+1), T_CELL=3 (T+1)
const I_PIECE = 0, T_PIECE = 2;
const I_CELL = 1, T_CELL = 3, Garbage = 8;

function makePiece(type: number, col: number, row: number): ActivePiece {
  return { type: type as any, rotation: 0, col, row };
}

// ── boardWithPiece ─────────────────────────────────────────────────────────────

describe('boardWithPiece', () => {
  it('places a single mino at the anchor cell', () => {
    const result = boardWithPiece(createBoard(), makePiece(I_PIECE, 5, 5), [{ deltaCol: 0, deltaRow: 0 }]);
    expect(getCell(result, 5, 5)).toBe(I_CELL);
  });

  it('uses piece.type+1 as the CellType', () => {
    const result = boardWithPiece(createBoard(), makePiece(T_PIECE, 3, 3), [{ deltaCol: 0, deltaRow: 0 }]);
    expect(getCell(result, 3, 3)).toBe(T_CELL);
  });

  it('deltaCol offset shifts column to the right', () => {
    const result = boardWithPiece(createBoard(), makePiece(I_PIECE, 2, 5), [{ deltaCol: 3, deltaRow: 0 }]);
    expect(getCell(result, 5, 5)).toBe(I_CELL);
    expect(getCell(result, 2, 5)).toBe(0);
  });

  it('deltaRow offset shifts row downward in game coords (deltaRow=1 → gameRow-1)', () => {
    // anchor row=5, deltaRow=1 → mino at row 4
    const result = boardWithPiece(createBoard(), makePiece(I_PIECE, 5, 5), [{ deltaCol: 0, deltaRow: 1 }]);
    expect(getCell(result, 5, 4)).toBe(I_CELL);
    expect(getCell(result, 5, 5)).toBe(0);
  });

  it('existing cells outside the shape are untouched', () => {
    const b = createBoard();
    setCell(b, 0, 0, Garbage as any);
    const result = boardWithPiece(b, makePiece(I_PIECE, 5, 5), [{ deltaCol: 0, deltaRow: 0 }]);
    expect(getCell(result, 0, 0)).toBe(Garbage);
  });

  it('out-of-bounds minos (below floor) are silently skipped', () => {
    // anchor row=0, deltaRow=1 → mino at row -1 (below floor) — must be skipped
    const result = boardWithPiece(createBoard(), makePiece(I_PIECE, 5, 0), [
      { deltaCol: 0, deltaRow: 0 },
      { deltaCol: 0, deltaRow: 1 }, // row -1
    ]);
    expect(getCell(result, 5, 0)).toBe(I_CELL);
    // No crash from the out-of-bounds mino
  });

  it('does not mutate the original board', () => {
    const b = createBoard();
    boardWithPiece(b, makePiece(I_PIECE, 5, 5), [{ deltaCol: 0, deltaRow: 0 }]);
    expect(getCell(b, 5, 5)).toBe(0);
  });
});

// ── boardWithFill ──────────────────────────────────────────────────────────────

describe('boardWithFill', () => {
  it('flood-fills entire empty board from (0,0)', () => {
    const result = boardWithFill(createBoard(), 0, 0, I_CELL as any);
    // Corner opposite from origin should be filled
    expect(getCell(result, BOARD_COLS - 1, BOARD_TOTAL_ROWS - 1)).toBe(I_CELL);
  });

  it('stops at cells of a different type', () => {
    const b = createBoard();
    // Wall along col 5 for every row
    for (let r = 0; r < BOARD_TOTAL_ROWS; r++) setCell(b, 5, r, Garbage as any);
    const result = boardWithFill(b, 0, 0, I_CELL as any);
    // Left side filled
    expect(getCell(result, 0, 0)).toBe(I_CELL);
    // Right side untouched (wall blocked fill)
    expect(getCell(result, 9, 0)).toBe(0);
    // Wall itself unchanged
    expect(getCell(result, 5, 0)).toBe(Garbage);
  });

  it('no-op when target cell already equals fill type', () => {
    const b = createBoard();
    setCell(b, 5, 5, I_CELL as any);
    const result = boardWithFill(b, 5, 5, I_CELL as any);
    // Cell still I_CELL, nothing changed
    expect(getCell(result, 5, 5)).toBe(I_CELL);
    // Adjacent cells still empty
    expect(getCell(result, 4, 5)).toBe(0);
  });

  it('fills only the contiguous region matching the starting cell type', () => {
    const b = createBoard();
    // Two isolated regions — fill one, other stays
    setCell(b, 0, 0, I_CELL as any);
    setCell(b, 9, 0, I_CELL as any);
    // Fill middle (empty) starting from (5, 5)
    const result = boardWithFill(b, 5, 5, T_CELL as any);
    expect(getCell(result, 5, 5)).toBe(T_CELL);
    // The I_CELL islands remain
    expect(getCell(result, 0, 0)).toBe(I_CELL);
    expect(getCell(result, 9, 0)).toBe(I_CELL);
  });

  it('does not mutate the original board', () => {
    const b = createBoard();
    boardWithFill(b, 0, 0, I_CELL as any);
    expect(getCell(b, 0, 0)).toBe(0);
  });
});

// ── boardWithRegion ────────────────────────────────────────────────────────────

describe('boardWithRegion', () => {
  it('fills every cell in the specified rectangle', () => {
    const result = boardWithRegion(createBoard(), 2, 3, 3, 2, T_CELL as any);
    for (let r = 3; r < 5; r++) {
      for (let c = 2; c < 5; c++) {
        expect(getCell(result, c, r)).toBe(T_CELL);
      }
    }
  });

  it('does not affect cells outside the rectangle', () => {
    const result = boardWithRegion(createBoard(), 2, 3, 3, 2, T_CELL as any);
    expect(getCell(result, 1, 3)).toBe(0); // left edge
    expect(getCell(result, 5, 3)).toBe(0); // right edge
    expect(getCell(result, 2, 2)).toBe(0); // below
    expect(getCell(result, 2, 5)).toBe(0); // above
  });

  it('1×1 region sets exactly one cell', () => {
    const result = boardWithRegion(createBoard(), 7, 7, 1, 1, I_CELL as any);
    expect(getCell(result, 7, 7)).toBe(I_CELL);
    expect(getCell(result, 8, 7)).toBe(0);
    expect(getCell(result, 7, 8)).toBe(0);
  });

  it('does not mutate the original board', () => {
    const b = createBoard();
    boardWithRegion(b, 0, 0, 5, 5, I_CELL as any);
    expect(getCell(b, 0, 0)).toBe(0);
  });
});
