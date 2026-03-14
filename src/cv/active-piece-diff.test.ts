import { describe, it, expect } from 'vitest';
import { CellType, BOARD_ROWS } from '../types/board';
import { PieceType } from '../types/piece';
import { diffDetectActivePiece, findFloatingPiece } from './active-piece-diff';

const COLS = 10;
const ROWS = 20;

function makeGrid(): CellType[][] {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(CellType.Empty));
}

describe('diffDetectActivePiece', () => {
  it('returns null when no cells differ (0 candidates)', () => {
    const grid = makeGrid();
    const baseline = makeGrid();
    const { activePiece, candidateCount } = diffDetectActivePiece(grid, baseline, 'ars');
    expect(activePiece).toBeNull();
    expect(candidateCount).toBe(0);
  });

  it('detects a T-piece from 4 new cells (ARS)', () => {
    const baseline = makeGrid();
    const current = makeGrid();
    // ARS T-piece spawn (rotation 0): TTT / _T_
    // display rows 0-1, cols 3-5
    current[0][3] = CellType.T;
    current[0][4] = CellType.T;
    current[0][5] = CellType.T;
    current[1][4] = CellType.T;

    const { activePiece, boardCells, candidateCount } = diffDetectActivePiece(current, baseline, 'ars');
    expect(candidateCount).toBe(4);
    expect(activePiece).not.toBeNull();
    expect(activePiece!.type).toBe(PieceType.T);
    expect(activePiece!.col).toBe(3);
    expect(activePiece!.row).toBe(BOARD_ROWS - 1);
    // Active piece cells removed from board
    expect(boardCells[0][3]).toBe(CellType.Empty);
    expect(boardCells[0][4]).toBe(CellType.Empty);
    expect(boardCells[0][5]).toBe(CellType.Empty);
    expect(boardCells[1][4]).toBe(CellType.Empty);
  });

  it('returns null when 4 new cells have mixed types', () => {
    const baseline = makeGrid();
    const current = makeGrid();
    current[0][0] = CellType.T;
    current[0][1] = CellType.T;
    current[1][0] = CellType.T;
    current[1][1] = CellType.S; // mixed

    const { activePiece, candidateCount } = diffDetectActivePiece(current, baseline, 'ars');
    expect(candidateCount).toBe(4);
    expect(activePiece).toBeNull();
  });

  it('returns null when below minCells (3 new cells)', () => {
    const baseline = makeGrid();
    const current = makeGrid();
    current[0][0] = CellType.T;
    current[0][1] = CellType.T;
    current[1][0] = CellType.T;

    const { activePiece, candidateCount } = diffDetectActivePiece(current, baseline, 'ars');
    expect(candidateCount).toBe(3);
    expect(activePiece).toBeNull();
  });

  it('returns null when above maxCells=4 with 5 new cells', () => {
    const baseline = makeGrid();
    const current = makeGrid();
    current[0][0] = CellType.T;
    current[0][1] = CellType.T;
    current[0][2] = CellType.T;
    current[1][0] = CellType.T;
    current[1][1] = CellType.T;

    const { activePiece, candidateCount } = diffDetectActivePiece(current, baseline, 'ars', 4, 4);
    expect(candidateCount).toBe(5);
    expect(activePiece).toBeNull();
  });

  it('attempts match when maxCells raised to 5', () => {
    const baseline = makeGrid();
    const current = makeGrid();
    // 5 scattered cells of same type — no valid piece shape
    current[0][0] = CellType.T;
    current[0][2] = CellType.T;
    current[0][4] = CellType.T;
    current[2][0] = CellType.T;
    current[2][4] = CellType.T;

    const { activePiece, candidateCount } = diffDetectActivePiece(current, baseline, 'ars', 4, 5);
    expect(candidateCount).toBe(5);
    // Scattered cells don't form any piece shape
    expect(activePiece).toBeNull();
  });

  it('does not count cells present in both current and baseline', () => {
    const baseline = makeGrid();
    baseline[ROWS - 1][0] = CellType.J;
    baseline[ROWS - 1][1] = CellType.J;

    const current = makeGrid();
    current[ROWS - 1][0] = CellType.J; // same as baseline — not a candidate
    current[ROWS - 1][1] = CellType.J;

    const { candidateCount } = diffDetectActivePiece(current, baseline, 'ars');
    expect(candidateCount).toBe(0);
  });

  it('detects I-piece in SRS', () => {
    const baseline = makeGrid();
    const current = makeGrid();
    // SRS I-piece rotation 0: horizontal at row 5, cols 2-5
    current[5][2] = CellType.I;
    current[5][3] = CellType.I;
    current[5][4] = CellType.I;
    current[5][5] = CellType.I;

    const { activePiece, boardCells } = diffDetectActivePiece(current, baseline, 'srs');
    expect(activePiece).not.toBeNull();
    expect(activePiece!.type).toBe(PieceType.I);
    for (let c = 2; c <= 5; c++) {
      expect(boardCells[5][c]).toBe(CellType.Empty);
    }
  });
});

describe('findFloatingPiece', () => {
  it('detects a floating T-piece (empty below)', () => {
    const grid = makeGrid();
    // T-piece at top, floating (empty below)
    grid[0][3] = CellType.T;
    grid[0][4] = CellType.T;
    grid[0][5] = CellType.T;
    grid[1][4] = CellType.T;

    const result = findFloatingPiece(grid, 'ars');
    expect(result).not.toBeNull();
    expect(result!.activePiece.type).toBe(PieceType.T);
    expect(result!.cells).toHaveLength(4);
  });

  it('returns null for piece resting on the floor', () => {
    const grid = makeGrid();
    // O-piece at very bottom
    grid[ROWS - 2][4] = CellType.O;
    grid[ROWS - 2][5] = CellType.O;
    grid[ROWS - 1][4] = CellType.O;
    grid[ROWS - 1][5] = CellType.O;

    const result = findFloatingPiece(grid, 'srs');
    expect(result).toBeNull();
  });

  it('returns null for piece resting on other cells', () => {
    const grid = makeGrid();
    // Stack cells on the floor
    grid[ROWS - 1][3] = CellType.J;
    grid[ROWS - 1][4] = CellType.J;
    grid[ROWS - 1][5] = CellType.J;
    // T-piece resting on top of the stack (no empty below any cell)
    grid[ROWS - 2][3] = CellType.T;
    grid[ROWS - 2][4] = CellType.T;
    grid[ROWS - 2][5] = CellType.T;
    grid[ROWS - 3][4] = CellType.T;

    // The T cells at row ROWS-2 all have filled cells below (row ROWS-1)
    // The T cell at ROWS-3 has T at ROWS-2 below it (same color, part of group? no — connected component includes all 4 T cells)
    // Actually the cell at ROWS-3,col=4 has ROWS-2,col=4 = T which is same group.
    // So we need to check: every cell in the group has a non-empty cell below OR is on the floor.
    // ROWS-2,col=3: below is ROWS-1,col=3 = J (not empty) → not floating for this cell
    // ROWS-2,col=4: below is ROWS-1,col=4 = J → not floating
    // ROWS-2,col=5: below is ROWS-1,col=5 = J → not floating
    // ROWS-3,col=4: below is ROWS-2,col=4 = T → not floating (not empty)
    // isFloating requires at least one cell to have empty below → false
    const result = findFloatingPiece(grid, 'ars');
    expect(result).toBeNull();
  });

  it('finds only the floating group when multiple groups exist', () => {
    const grid = makeGrid();
    // Stack (non-floating): J cells on the floor — more than 4, so won't match anyway
    for (let c = 0; c < 6; c++) grid[ROWS - 1][c] = CellType.J;

    // Floating T-piece in the middle of the board
    grid[10][3] = CellType.T;
    grid[10][4] = CellType.T;
    grid[10][5] = CellType.T;
    grid[11][4] = CellType.T;

    const result = findFloatingPiece(grid, 'ars');
    expect(result).not.toBeNull();
    expect(result!.activePiece.type).toBe(PieceType.T);
  });

  it('returns null when no 4-cell groups exist', () => {
    const grid = makeGrid();
    // 3 cells only
    grid[5][3] = CellType.S;
    grid[5][4] = CellType.S;
    grid[6][4] = CellType.S;

    const result = findFloatingPiece(grid, 'srs');
    expect(result).toBeNull();
  });
});
