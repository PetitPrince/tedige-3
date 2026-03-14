import { describe, it, expect } from 'vitest';
import { insertFrameAfter, duplicateFrame, deleteFrame, moveFrame } from './frame-ops';
import { emptyDiagram, emptyFrame } from '../types/frame';
import { setCell, getCell } from '../types/board';
import type { Diagram } from '../types/frame';

function diagWith(frames: ReturnType<typeof emptyFrame>[]): Diagram {
  return { ...emptyDiagram(), frames };
}

// ── insertFrameAfter ───────────────────────────────────────────────────────────

describe('insertFrameAfter', () => {
  it('increases frame count by 1', () => {
    const result = insertFrameAfter(emptyDiagram(), 0);
    expect(result.frames.length).toBe(2);
  });

  it('new frame is inserted at index+1', () => {
    const f0 = emptyFrame(); setCell(f0.board, 1, 1, 1 as any);
    const f1 = emptyFrame(); setCell(f1.board, 2, 2, 2 as any);
    const d = diagWith([f0, f1]);
    const result = insertFrameAfter(d, 0);
    expect(result.frames.length).toBe(3);
    // index 1 is the new copy of f0
    expect(getCell(result.frames[1].board, 1, 1)).toBe(1);
    // original f1 shifted to index 2
    expect(getCell(result.frames[2].board, 2, 2)).toBe(2);
  });

  it('copies board from source frame', () => {
    const d = emptyDiagram();
    setCell(d.frames[0].board, 5, 5, 1 as any);
    const result = insertFrameAfter(d, 0);
    expect(getCell(result.frames[1].board, 5, 5)).toBe(1);
  });

  it('copies nextQueue from source frame', () => {
    const d = emptyDiagram();
    d.frames[0].nextQueue = [0, 1, 2] as any[];
    const result = insertFrameAfter(d, 0);
    expect(result.frames[1].nextQueue).toEqual([0, 1, 2]);
  });

  it('copies holdPiece from source frame', () => {
    const d = emptyDiagram();
    d.frames[0].holdPiece = 3 as any;
    const result = insertFrameAfter(d, 0);
    expect(result.frames[1].holdPiece).toBe(3);
  });

  it('does not mutate the original diagram', () => {
    const d = emptyDiagram();
    insertFrameAfter(d, 0);
    expect(d.frames.length).toBe(1);
  });
});

// ── duplicateFrame ─────────────────────────────────────────────────────────────

describe('duplicateFrame', () => {
  it('increases frame count by 1', () => {
    expect(duplicateFrame(emptyDiagram(), 0).frames.length).toBe(2);
  });

  it('copy has the same board content as source', () => {
    const d = emptyDiagram();
    setCell(d.frames[0].board, 3, 3, 5 as any);
    const result = duplicateFrame(d, 0);
    expect(getCell(result.frames[1].board, 3, 3)).toBe(5);
  });

  it('mutating the copy does not affect the original', () => {
    const d = emptyDiagram();
    const result = duplicateFrame(d, 0);
    setCell(result.frames[1].board, 0, 0, 7 as any);
    expect(getCell(result.frames[0].board, 0, 0)).toBe(0);
  });

  it('copy is placed immediately after the source index', () => {
    const f0 = emptyFrame(); setCell(f0.board, 0, 0, 1 as any);
    const f1 = emptyFrame(); setCell(f1.board, 1, 1, 2 as any);
    const result = duplicateFrame(diagWith([f0, f1]), 0);
    // index 1 should be copy of f0
    expect(getCell(result.frames[1].board, 0, 0)).toBe(1);
    // f1 shifted to index 2
    expect(getCell(result.frames[2].board, 1, 1)).toBe(2);
  });
});

// ── deleteFrame ────────────────────────────────────────────────────────────────

describe('deleteFrame', () => {
  it('removes the correct frame and decreases count by 1', () => {
    const f0 = emptyFrame();
    const f1 = emptyFrame(); setCell(f1.board, 0, 0, 1 as any);
    const f2 = emptyFrame(); setCell(f2.board, 1, 1, 2 as any);
    const result = deleteFrame(diagWith([f0, f1, f2]), 1);
    expect(result.frames.length).toBe(2);
    expect(getCell(result.frames[0].board, 0, 0)).toBe(0); // f0
    expect(getCell(result.frames[1].board, 1, 1)).toBe(2); // f2
  });

  it('cannot delete the last remaining frame', () => {
    const d = emptyDiagram();
    const result = deleteFrame(d, 0);
    expect(result.frames.length).toBe(1);
    expect(result).toBe(d); // returned unchanged
  });

  it('deletes the first frame correctly', () => {
    const f0 = emptyFrame(); setCell(f0.board, 0, 0, 1 as any);
    const f1 = emptyFrame();
    const result = deleteFrame(diagWith([f0, f1]), 0);
    expect(result.frames.length).toBe(1);
    expect(getCell(result.frames[0].board, 0, 0)).toBe(0);
  });
});

// ── moveFrame ──────────────────────────────────────────────────────────────────

describe('moveFrame', () => {
  it('from === to returns the same diagram reference', () => {
    const d = emptyDiagram();
    expect(moveFrame(d, 0, 0)).toBe(d);
  });

  it('moves frame from index 0 to index 2', () => {
    const f0 = emptyFrame(); setCell(f0.board, 0, 0, 1 as any);
    const f1 = emptyFrame(); setCell(f1.board, 1, 1, 2 as any);
    const f2 = emptyFrame(); setCell(f2.board, 2, 2, 3 as any);
    const result = moveFrame(diagWith([f0, f1, f2]), 0, 2);
    expect(getCell(result.frames[0].board, 1, 1)).toBe(2); // f1
    expect(getCell(result.frames[1].board, 2, 2)).toBe(3); // f2
    expect(getCell(result.frames[2].board, 0, 0)).toBe(1); // f0 (moved)
  });

  it('moves frame from index 2 to index 0', () => {
    const f0 = emptyFrame(); setCell(f0.board, 0, 0, 1 as any);
    const f1 = emptyFrame(); setCell(f1.board, 1, 1, 2 as any);
    const f2 = emptyFrame(); setCell(f2.board, 2, 2, 3 as any);
    const result = moveFrame(diagWith([f0, f1, f2]), 2, 0);
    expect(getCell(result.frames[0].board, 2, 2)).toBe(3); // f2 (moved)
    expect(getCell(result.frames[1].board, 0, 0)).toBe(1); // f0
    expect(getCell(result.frames[2].board, 1, 1)).toBe(2); // f1
  });

  it('does not mutate the original diagram', () => {
    const f0 = emptyFrame();
    const f1 = emptyFrame();
    const d = diagWith([f0, f1]);
    moveFrame(d, 0, 1);
    expect(d.frames[0]).toBe(f0);
  });
});
