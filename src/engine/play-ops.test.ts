import { describe, it, expect } from 'vitest';
import { movePiece, hardDrop, holdPiece as holdOp } from './play-ops';
import { emptyFrame } from '../types/frame';
import { createBoard, setCell, getCell, BOARD_COLS } from '../types/board';
import type { ActivePiece } from '../types/piece';
import type { RotationSystem } from '../types/rotation-system';

// PieceType literals: I=0, T=2
const I = 0, T = 2;

// Minimal mock RotationSystem.
// Shape: single mino at (deltaCol=0, deltaRow=0).
// collides: checks floor, walls, and single anchor cell on board.
// spawn: always returns a new piece at col=4, row=19.
function makeRotSys(): RotationSystem {
  return {
    getShape: () => [{ deltaCol: 0, deltaRow: 0 }],
    spawn: (type: any) => ({ type, rotation: 0 as const, col: 4, row: 19 }),
    rotate: () => null,
    collides: (piece: ActivePiece, board: any) => {
      if (piece.row < 0) return true;
      if (piece.col < 0 || piece.col >= BOARD_COLS) return true;
      if (piece.row >= 24) return false;
      return board[piece.row * BOARD_COLS + piece.col] !== 0;
    },
  } as unknown as RotationSystem;
}

function frameWithPiece(col: number, row: number, type = I) {
  return {
    ...emptyFrame(),
    activePiece: { type: type as any, rotation: 0 as const, col, row },
  };
}

// ── movePiece ──────────────────────────────────────────────────────────────────

describe('movePiece', () => {
  it('valid move returns updated frame with new position', () => {
    const frame = frameWithPiece(5, 10);
    const result = movePiece(frame, -1, 0, makeRotSys()); // move left
    expect(result).not.toBeNull();
    expect(result!.activePiece!.col).toBe(4);
    expect(result!.activePiece!.row).toBe(10);
  });

  it('blocked by left wall returns null', () => {
    const frame = frameWithPiece(0, 10);
    expect(movePiece(frame, -1, 0, makeRotSys())).toBeNull();
  });

  it('blocked by right wall returns null', () => {
    const frame = frameWithPiece(BOARD_COLS - 1, 10);
    expect(movePiece(frame, 1, 0, makeRotSys())).toBeNull();
  });

  it('blocked by floor returns null', () => {
    const frame = frameWithPiece(5, 0);
    expect(movePiece(frame, 0, -1, makeRotSys())).toBeNull();
  });

  it('blocked by occupied cell returns null', () => {
    const b = createBoard();
    setCell(b, 4, 10, 1 as any);
    const frame = { ...frameWithPiece(5, 10), board: b };
    expect(movePiece(frame, -1, 0, makeRotSys())).toBeNull();
  });

  it('no active piece returns null', () => {
    expect(movePiece(emptyFrame(), 1, 0, makeRotSys())).toBeNull();
  });

  it('does not mutate the source frame', () => {
    const frame = frameWithPiece(5, 10);
    movePiece(frame, -1, 0, makeRotSys());
    expect(frame.activePiece!.col).toBe(5);
  });
});

// ── hardDrop ───────────────────────────────────────────────────────────────────

describe('hardDrop', () => {
  it('returns null when no active piece', () => {
    expect(hardDrop(emptyFrame(), makeRotSys())).toBeNull();
  });

  it('piece lands at row 0 on empty board', () => {
    const frame = frameWithPiece(5, 15);
    const result = hardDrop(frame, makeRotSys());
    expect(result).not.toBeNull();
    // After locking at row 0 and clearing (no full row), cell at (5,0) is set
    expect(getCell(result!.nextFrame.board, 5, 0)).toBe(1); // I_CELL
  });

  it('piece stops on top of an existing cell', () => {
    const b = createBoard();
    setCell(b, 5, 3, 1 as any); // obstacle at row 3
    const frame = { ...frameWithPiece(5, 15), board: b };
    const result = hardDrop(frame, makeRotSys());
    expect(getCell(result!.nextFrame.board, 5, 4)).toBe(1); // locked one above obstacle
  });

  it('full row is cleared after lock', () => {
    const b = createBoard();
    // Fill row 0 except col 5
    for (let c = 0; c < BOARD_COLS; c++) {
      if (c !== 5) setCell(b, c, 0, 1 as any);
    }
    // Piece at col 5 will drop to row 0 and complete the line
    const frame = { ...frameWithPiece(5, 15), board: b };
    const result = hardDrop(frame, makeRotSys());
    // Row 0 was cleared — all cells in row 0 should now be 0
    for (let c = 0; c < BOARD_COLS; c++) {
      expect(getCell(result!.nextFrame.board, c, 0)).toBe(0);
    }
  });

  it('queue shifts and next piece is spawned', () => {
    const frame = {
      ...frameWithPiece(5, 15, I),
      nextQueue: [T as any, I as any],
    };
    const result = hardDrop(frame, makeRotSys());
    expect(result!.nextFrame.activePiece?.type).toBe(T);
    expect(result!.nextFrame.nextQueue).toEqual([I]);
  });

  it('no next piece spawned when queue is empty', () => {
    const frame = frameWithPiece(5, 15);
    const result = hardDrop(frame, makeRotSys());
    expect(result!.nextFrame.activePiece).toBeUndefined();
  });
});

// ── holdPiece ──────────────────────────────────────────────────────────────────

describe('holdPiece', () => {
  it('returns null when no active piece', () => {
    expect(holdOp(emptyFrame(), makeRotSys())).toBeNull();
  });

  it('empty hold: active piece goes to hold, queue shifts in new active', () => {
    const frame = {
      ...frameWithPiece(5, 15, I),
      nextQueue: [T as any],
      holdPiece: undefined,
    };
    const result = holdOp(frame, makeRotSys());
    expect(result).not.toBeNull();
    expect(result!.holdPiece).toBe(I);
    expect(result!.activePiece?.type).toBe(T);
    expect(result!.nextQueue).toEqual([]);
  });

  it('empty hold with empty queue returns null', () => {
    const frame = { ...frameWithPiece(5, 15, I), nextQueue: [], holdPiece: undefined };
    expect(holdOp(frame, makeRotSys())).toBeNull();
  });

  it('occupied hold: active and hold are swapped', () => {
    const frame = {
      ...frameWithPiece(5, 15, I),
      holdPiece: T as any,
    };
    const result = holdOp(frame, makeRotSys());
    expect(result).not.toBeNull();
    expect(result!.holdPiece).toBe(I);
    expect(result!.activePiece?.type).toBe(T);
  });

  it('occupied hold: nextQueue is preserved unchanged', () => {
    const frame = {
      ...frameWithPiece(5, 15, I),
      holdPiece: T as any,
      nextQueue: [0, 1, 2] as any[],
    };
    const result = holdOp(frame, makeRotSys());
    expect(result!.nextQueue).toEqual([0, 1, 2]);
  });

  it('does not mutate the source frame', () => {
    const frame = {
      ...frameWithPiece(5, 15, I),
      nextQueue: [T as any],
    };
    holdOp(frame, makeRotSys());
    expect(frame.holdPiece).toBeUndefined();
    expect(frame.nextQueue).toEqual([T]);
  });
});
