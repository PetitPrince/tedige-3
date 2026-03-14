import { describe, it, expect } from 'vitest';
import { clientToCell, primaryTouchCoords } from './canvas-coords';
import { BOARD_ROWS } from '../types/board';

// Helpers ─────────────────────────────────────────────────────────────────────

function rect(left: number, top: number): DOMRect {
  return { left, top, right: left + 999, bottom: top + 999, width: 999, height: 999, x: left, y: top, toJSON: () => ({}) } as DOMRect;
}

function touch(clientX: number, clientY: number): Touch {
  return { clientX, clientY } as Touch;
}

function touchEvent(touches: Touch[], changedTouches: Touch[] = []): TouchEvent {
  return { touches, changedTouches } as unknown as TouchEvent;
}

// ── clientToCell ──────────────────────────────────────────────────────────────

describe('clientToCell', () => {
  const CS = 32; // cell size in pixels
  const R = rect(100, 200); // canvas top-left at (100, 200)

  it('maps top-left pixel of col 0 to col 0', () => {
    const [col] = clientToCell(100, 200, R, CS);
    expect(col).toBe(0);
  });

  it('maps centre of col 0 to col 0', () => {
    const [col] = clientToCell(100 + CS * 0.5, 200, R, CS);
    expect(col).toBe(0);
  });

  it('maps centre of col 5 to col 5', () => {
    const [col] = clientToCell(100 + CS * 5.5, 200, R, CS);
    expect(col).toBe(5);
  });

  it('first pixel of col 1 is still col 1', () => {
    const [col] = clientToCell(100 + CS, 200, R, CS);
    expect(col).toBe(1);
  });

  it('maps top visible row (top of board visually) to row BOARD_ROWS-1', () => {
    // canvasY = 0 → display row 0 → game row = BOARD_ROWS - 1
    const [, row] = clientToCell(100, 200 + CS * 0.5, R, CS);
    expect(row).toBe(BOARD_ROWS - 1);
  });

  it('maps bottom visible row to row 0 (floor)', () => {
    // canvasY just above the last row
    const [, row] = clientToCell(100, 200 + CS * (BOARD_ROWS - 0.5), R, CS);
    expect(row).toBe(0);
  });

  it('maps the centre of display row 3 correctly', () => {
    // display row 3 → game row = BOARD_ROWS - 1 - 3
    const [, row] = clientToCell(100, 200 + CS * 3.5, R, CS);
    expect(row).toBe(BOARD_ROWS - 1 - 3);
  });

  it('returns negative col when clientX is left of the canvas', () => {
    const [col] = clientToCell(90, 200, R, CS);
    expect(col).toBeLessThan(0);
  });

  it('returns negative row when clientY is above the canvas', () => {
    const [, row] = clientToCell(100, 190, R, CS);
    expect(row).toBeGreaterThanOrEqual(BOARD_ROWS);
  });

  it('is not affected by canvas offset — only relative position matters', () => {
    const r1 = rect(0, 0);
    const r2 = rect(500, 800);
    const [c1, r1row] = clientToCell(CS * 3.5, CS * 2.5, r1, CS);
    const [c2, r2row] = clientToCell(500 + CS * 3.5, 800 + CS * 2.5, r2, CS);
    expect(c1).toBe(c2);
    expect(r1row).toBe(r2row);
  });
});

// ── primaryTouchCoords ────────────────────────────────────────────────────────

describe('primaryTouchCoords', () => {
  it('returns coords from the first touch', () => {
    const e = touchEvent([touch(123, 456)]);
    expect(primaryTouchCoords(e)).toEqual({ clientX: 123, clientY: 456 });
  });

  it('uses the first touch when multiple touches are present', () => {
    const e = touchEvent([touch(10, 20), touch(30, 40)]);
    expect(primaryTouchCoords(e)).toEqual({ clientX: 10, clientY: 20 });
  });

  it('falls back to changedTouches when touches is empty', () => {
    const e = touchEvent([], [touch(77, 88)]);
    expect(primaryTouchCoords(e)).toEqual({ clientX: 77, clientY: 88 });
  });

  it('returns null when both touches and changedTouches are empty', () => {
    const e = touchEvent([], []);
    expect(primaryTouchCoords(e)).toBeNull();
  });
});
