import { describe, it, expect } from 'vitest';
import { clearLines, detectFullRows, freeFall, clearSpecificRows } from './line-clear';
import { createBoard, setCell, getCell, BOARD_COLS } from '../types/board';

// CellType numeric literals
const I = 1, T = 3, Garbage = 8;

function fillRow(board: ReturnType<typeof createBoard>, row: number, type = I): void {
  for (let c = 0; c < BOARD_COLS; c++) setCell(board, c, row, type as any);
}

// ── detectFullRows ─────────────────────────────────────────────────────────────

describe('detectFullRows', () => {
  it('returns [] for empty board', () => {
    expect(detectFullRows(createBoard())).toEqual([]);
  });

  it('returns the index of a single full row', () => {
    const b = createBoard();
    fillRow(b, 0);
    expect(detectFullRows(b)).toEqual([0]);
  });

  it('returns multiple non-adjacent full row indices in order', () => {
    const b = createBoard();
    fillRow(b, 0);
    fillRow(b, 3);
    fillRow(b, 7);
    expect(detectFullRows(b)).toEqual([0, 3, 7]);
  });

  it('does not include a row with a single hole', () => {
    const b = createBoard();
    fillRow(b, 0);
    setCell(b, 0, 0, 0 as any); // punch a hole
    expect(detectFullRows(b)).toEqual([]);
  });
});

// ── clearLines ─────────────────────────────────────────────────────────────────

describe('clearLines', () => {
  it('empty board: 0 lines cleared, empty clearedRows', () => {
    const { linesCleared, clearedRows } = clearLines(createBoard());
    expect(linesCleared).toBe(0);
    expect(clearedRows).toEqual([]);
  });

  it('clears a single full row and shifts cells above down', () => {
    const b = createBoard();
    fillRow(b, 0, I);
    setCell(b, 0, 1, T as any); // lone cell above cleared row
    const { board, linesCleared } = clearLines(b);
    expect(linesCleared).toBe(1);
    // T cell from row 1 should have dropped to row 0
    expect(getCell(board, 0, 0)).toBe(T);
    expect(getCell(board, 1, 0)).toBe(0);
  });

  it('clears multiple adjacent full rows', () => {
    const b = createBoard();
    fillRow(b, 0);
    fillRow(b, 1);
    setCell(b, 3, 2, T as any);
    const { board, linesCleared } = clearLines(b);
    expect(linesCleared).toBe(2);
    // T cell from row 2 shifts down by 2
    expect(getCell(board, 3, 0)).toBe(T);
    expect(getCell(board, 3, 1)).toBe(0);
  });

  it('clears multiple non-adjacent full rows, shifting correctly', () => {
    const b = createBoard();
    fillRow(b, 0);
    setCell(b, 5, 1, T as any); // partial, stays
    fillRow(b, 2);
    const { board, linesCleared } = clearLines(b);
    expect(linesCleared).toBe(2);
    // row 1 (partial, T at col 5) shifts down to row 0
    expect(getCell(board, 5, 0)).toBe(T);
  });

  it('mixed full and partial rows: only full rows removed', () => {
    const b = createBoard();
    fillRow(b, 0);
    setCell(b, 5, 1, T as any); // partial
    const { board, linesCleared } = clearLines(b);
    expect(linesCleared).toBe(1);
    expect(getCell(board, 5, 0)).toBe(T);
  });

  it('reports which rows were cleared', () => {
    const b = createBoard();
    fillRow(b, 0);
    fillRow(b, 5);
    const { clearedRows } = clearLines(b);
    expect(clearedRows).toEqual([0, 5]);
  });
});

// ── freeFall ───────────────────────────────────────────────────────────────────

describe('freeFall', () => {
  it('floating cell drops to column floor', () => {
    const b = createBoard();
    setCell(b, 0, 5, I as any);
    const result = freeFall(b);
    expect(getCell(result, 0, 0)).toBe(I);
    expect(getCell(result, 0, 5)).toBe(0);
  });

  it('columns are independent of each other', () => {
    const b = createBoard();
    setCell(b, 0, 3, I as any);
    setCell(b, 1, 7, T as any);
    const result = freeFall(b);
    expect(getCell(result, 0, 0)).toBe(I);
    expect(getCell(result, 1, 0)).toBe(T);
  });

  it('stacked cells in the same column remain stacked from the floor', () => {
    const b = createBoard();
    setCell(b, 0, 5, I as any);
    setCell(b, 0, 6, T as any);
    const result = freeFall(b);
    expect(getCell(result, 0, 0)).toBe(I);
    expect(getCell(result, 0, 1)).toBe(T);
  });

  it('empty board stays empty', () => {
    const b = createBoard();
    const result = freeFall(b);
    expect(Array.from(result)).toEqual(Array.from(b));
  });
});

// ── clearSpecificRows ──────────────────────────────────────────────────────────

describe('clearSpecificRows', () => {
  it('removes exactly the specified rows and shifts above rows down', () => {
    const b = createBoard();
    setCell(b, 0, 0, I as any);
    setCell(b, 0, 1, T as any);
    setCell(b, 0, 2, Garbage as any);
    const result = clearSpecificRows(b, [1]);
    // row 0 (I) stays at row 0; row 2 (Garbage) shifts to row 1
    expect(getCell(result, 0, 0)).toBe(I);
    expect(getCell(result, 0, 1)).toBe(Garbage);
  });

  it('removes a row even if it is not full', () => {
    const b = createBoard();
    setCell(b, 3, 0, I as any);
    const result = clearSpecificRows(b, [0]);
    expect(getCell(result, 3, 0)).toBe(0);
  });

  it('empty rows list returns an equivalent board', () => {
    const b = createBoard();
    setCell(b, 0, 0, T as any);
    const result = clearSpecificRows(b, []);
    expect(getCell(result, 0, 0)).toBe(T);
  });

  it('does not mutate the original board', () => {
    const b = createBoard();
    setCell(b, 0, 0, I as any);
    clearSpecificRows(b, [0]);
    expect(getCell(b, 0, 0)).toBe(I);
  });
});
