import { describe, it, expect } from 'vitest';
import { collidesAt, expandMinos } from './collision';
import { createBoard, setCell, BOARD_COLS, BOARD_TOTAL_ROWS } from '../types/board';
import type { MinoOffset } from '../types/piece';

// Single mino at anchor (deltaCol=0, deltaRow=0)
const SINGLE: MinoOffset[] = [{ deltaCol: 0, deltaRow: 0 }];

// ── collidesAt ─────────────────────────────────────────────────────────────────

describe('collidesAt', () => {
  it('no collision on empty board at safe position', () => {
    expect(collidesAt(createBoard(), SINGLE, 5, 5)).toBe(false);
  });

  it('floor collision: gameRow < 0', () => {
    expect(collidesAt(createBoard(), SINGLE, 5, -1)).toBe(true);
  });

  it('left wall collision: col < 0', () => {
    expect(collidesAt(createBoard(), SINGLE, -1, 5)).toBe(true);
  });

  it('right wall collision: col >= BOARD_COLS', () => {
    expect(collidesAt(createBoard(), SINGLE, BOARD_COLS, 5)).toBe(true);
  });

  it('rightmost valid column is not a collision', () => {
    expect(collidesAt(createBoard(), SINGLE, BOARD_COLS - 1, 5)).toBe(false);
  });

  it('occupied cell collision', () => {
    const b = createBoard();
    setCell(b, 5, 5, 1 as any); // I cell
    expect(collidesAt(b, SINGLE, 5, 5)).toBe(true);
  });

  it('mino above buffer (gameRow >= BOARD_TOTAL_ROWS) is allowed — no collision', () => {
    expect(collidesAt(createBoard(), SINGLE, 5, BOARD_TOTAL_ROWS)).toBe(false);
  });

  it('multi-mino piece: collision when any mino hits occupied cell', () => {
    const b = createBoard();
    setCell(b, 6, 5, 1 as any);
    const minos: MinoOffset[] = [{ deltaCol: 0, deltaRow: 0 }, { deltaCol: 1, deltaRow: 0 }];
    // anchor (5,5) clear; mino (6,5) occupied
    expect(collidesAt(b, minos, 5, 5)).toBe(true);
  });

  it('multi-mino piece: no collision when all minos are clear', () => {
    const minos: MinoOffset[] = [{ deltaCol: 0, deltaRow: 0 }, { deltaCol: 1, deltaRow: 0 }, { deltaCol: 2, deltaRow: 0 }];
    expect(collidesAt(createBoard(), minos, 3, 5)).toBe(false);
  });

  it('deltaRow=1 moves mino one row downward in game coords', () => {
    // anchor row=5, deltaRow=1 → mino game row = 5-1 = 4
    const b = createBoard();
    setCell(b, 5, 4, 1 as any);
    const minos: MinoOffset[] = [{ deltaCol: 0, deltaRow: 1 }];
    expect(collidesAt(b, minos, 5, 5)).toBe(true);
  });

  it('deltaCol offset shifts mino column', () => {
    // anchor col=3, deltaCol=2 → mino col = 5
    const b = createBoard();
    setCell(b, 5, 5, 1 as any);
    const minos: MinoOffset[] = [{ deltaCol: 2, deltaRow: 0 }];
    expect(collidesAt(b, minos, 3, 5)).toBe(true);
  });
});

// ── expandMinos ────────────────────────────────────────────────────────────────

describe('expandMinos', () => {
  it('big=false returns the original array reference unchanged', () => {
    const shape: MinoOffset[] = [{ deltaCol: 1, deltaRow: 2 }];
    expect(expandMinos(shape, false)).toBe(shape);
  });

  it('big=true expands each mino to four 2×2 cells', () => {
    const shape: MinoOffset[] = [{ deltaCol: 0, deltaRow: 0 }];
    const expanded = expandMinos(shape, true);
    expect(expanded).toHaveLength(4);
    expect(expanded).toContainEqual({ deltaCol: 0, deltaRow: 0 });
    expect(expanded).toContainEqual({ deltaCol: 1, deltaRow: 0 });
    expect(expanded).toContainEqual({ deltaCol: 0, deltaRow: 1 });
    expect(expanded).toContainEqual({ deltaCol: 1, deltaRow: 1 });
  });

  it('big=true mino at (1,2) expands to correct offset block', () => {
    const shape: MinoOffset[] = [{ deltaCol: 1, deltaRow: 2 }];
    const expanded = expandMinos(shape, true);
    expect(expanded).toHaveLength(4);
    expect(expanded).toContainEqual({ deltaCol: 2, deltaRow: 4 });
    expect(expanded).toContainEqual({ deltaCol: 3, deltaRow: 4 });
    expect(expanded).toContainEqual({ deltaCol: 2, deltaRow: 5 });
    expect(expanded).toContainEqual({ deltaCol: 3, deltaRow: 5 });
  });

  it('big=true with two minos produces eight cells', () => {
    const shape: MinoOffset[] = [{ deltaCol: 0, deltaRow: 0 }, { deltaCol: 1, deltaRow: 0 }];
    const expanded = expandMinos(shape, true);
    expect(expanded).toHaveLength(8);
  });
});
