import { describe, it, expect } from 'vitest';
import { encodeDiagram, decodeDiagram } from './url-codec';
import { emptyDiagram, emptyFrame } from '../types/frame';
import { setCell, getCell } from '../types/board';
import type { Diagram, Frame } from '../types/frame';

function diagWith(frames: Frame[]): Diagram {
  return { ...emptyDiagram(), frames };
}

function rt(d: Diagram): Diagram {
  return decodeDiagram(encodeDiagram(d));
}

function boardsEqual(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

// ── Prefix / version guards ────────────────────────────────────────────────────

describe('decodeDiagram error handling', () => {
  it('throws on unknown prefix', () => {
    expect(() => decodeDiagram('v2@abc')).toThrow();
  });

  it('throws when prefix is missing entirely', () => {
    expect(() => decodeDiagram('ABCDabcd')).toThrow();
  });

  it('encodeDiagram produces a v1@ prefixed string', () => {
    expect(encodeDiagram(emptyDiagram())).toMatch(/^v1@/);
  });
});

// ── Diagram-level fields ───────────────────────────────────────────────────────

describe('diagram-level round-trip', () => {
  it('0 frames round-trips', () => {
    const d: Diagram = {
      frames: [],
      rotationSystem: 'srs',
      animationDelayMs: 500,
      metadata: { title: '', author: '', createdAt: '' },
    };
    const decoded = rt(d);
    expect(decoded.frames).toHaveLength(0);
  });

  it('rotationSystem "srs" round-trips', () => {
    const d = { ...emptyDiagram(), rotationSystem: 'srs' as const };
    expect(rt(d).rotationSystem).toBe('srs');
  });

  it('rotationSystem "ars" round-trips', () => {
    const d = { ...emptyDiagram(), rotationSystem: 'ars' as const };
    expect(rt(d).rotationSystem).toBe('ars');
  });

  it('animationDelayMs round-trips (rounded to nearest 100 ms)', () => {
    const d = { ...emptyDiagram(), animationDelayMs: 800 };
    expect(rt(d).animationDelayMs).toBe(800);
  });

  it('multi-frame diagram preserves frame count', () => {
    const d = diagWith([emptyFrame(), emptyFrame(), emptyFrame()]);
    expect(rt(d).frames).toHaveLength(3);
  });
});

// ── Board encoding ─────────────────────────────────────────────────────────────

describe('board round-trip', () => {
  it('empty board round-trips', () => {
    const frame = emptyFrame();
    const decoded = rt(diagWith([frame]));
    expect(boardsEqual(decoded.frames[0].board, frame.board)).toBe(true);
  });

  it('single cell set on the board round-trips', () => {
    const frame = emptyFrame();
    setCell(frame.board, 5, 3, 1 as any); // I cell
    const decoded = rt(diagWith([frame]));
    expect(getCell(decoded.frames[0].board, 5, 3)).toBe(1);
  });

  it('garbage cell round-trips', () => {
    const frame = emptyFrame();
    setCell(frame.board, 2, 0, 8 as any); // Garbage
    const decoded = rt(diagWith([frame]));
    expect(getCell(decoded.frames[0].board, 2, 0)).toBe(8);
  });

  it('multi-frame board diffs preserve each frame independently', () => {
    const f0 = emptyFrame(); setCell(f0.board, 0, 0, 1 as any);
    const f1 = emptyFrame(); setCell(f1.board, 1, 1, 2 as any);
    const f2 = emptyFrame(); setCell(f2.board, 2, 2, 3 as any);
    const decoded = rt(diagWith([f0, f1, f2]));
    expect(getCell(decoded.frames[0].board, 0, 0)).toBe(1);
    expect(getCell(decoded.frames[0].board, 1, 1)).toBe(0); // not in frame 0
    expect(getCell(decoded.frames[1].board, 1, 1)).toBe(2);
    expect(getCell(decoded.frames[1].board, 0, 0)).toBe(0); // not in frame 1
    expect(getCell(decoded.frames[2].board, 2, 2)).toBe(3);
  });

  it('full board round-trips correctly', () => {
    const frame = emptyFrame();
    // Fill all 10 cells of row 0
    for (let c = 0; c < 10; c++) setCell(frame.board, c, 0, 1 as any);
    const decoded = rt(diagWith([frame]));
    expect(boardsEqual(decoded.frames[0].board, frame.board)).toBe(true);
  });
});

// ── Active piece ───────────────────────────────────────────────────────────────

describe('activePiece round-trip', () => {
  it('no active piece stays absent', () => {
    const decoded = rt(diagWith([emptyFrame()]));
    expect(decoded.frames[0].activePiece).toBeUndefined();
  });

  it('active piece type, rotation, col, row round-trip', () => {
    const frame = emptyFrame();
    frame.activePiece = { type: 0 as any, rotation: 1, col: 3, row: 18 };
    const decoded = rt(diagWith([frame]));
    expect(decoded.frames[0].activePiece).toEqual(frame.activePiece);
  });

  it('active piece at col 0 and row 0 round-trips', () => {
    const frame = emptyFrame();
    frame.activePiece = { type: 2 as any, rotation: 2, col: 0, row: 0 };
    const decoded = rt(diagWith([frame]));
    expect(decoded.frames[0].activePiece).toEqual(frame.activePiece);
  });

  it('active piece at negative col round-trips', () => {
    const frame = emptyFrame();
    frame.activePiece = { type: 0 as any, rotation: 0, col: -2, row: 5 };
    const decoded = rt(diagWith([frame]));
    expect(decoded.frames[0].activePiece?.col).toBe(-2);
  });
});

// ── Hold piece ─────────────────────────────────────────────────────────────────

describe('holdPiece round-trip', () => {
  it('absent holdPiece stays absent', () => {
    const decoded = rt(diagWith([emptyFrame()]));
    expect(decoded.frames[0].holdPiece).toBeUndefined();
  });

  it('holdPiece type round-trips', () => {
    const frame = { ...emptyFrame(), holdPiece: 2 as any }; // T
    expect(rt(diagWith([frame])).frames[0].holdPiece).toBe(2);
  });
});

// ── Next queue ─────────────────────────────────────────────────────────────────

describe('nextQueue round-trip', () => {
  it('empty queue stays empty', () => {
    const decoded = rt(diagWith([emptyFrame()]));
    expect(decoded.frames[0].nextQueue).toEqual([]);
  });

  it('4-piece queue round-trips', () => {
    const frame = { ...emptyFrame(), nextQueue: [0, 1, 2, 3] as any[] };
    expect(rt(diagWith([frame])).frames[0].nextQueue).toEqual([0, 1, 2, 3]);
  });

  it('max 6-piece queue round-trips', () => {
    const frame = { ...emptyFrame(), nextQueue: [0, 1, 2, 3, 4, 5] as any[] };
    expect(rt(diagWith([frame])).frames[0].nextQueue).toEqual([0, 1, 2, 3, 4, 5]);
  });
});

// ── Comment ────────────────────────────────────────────────────────────────────

describe('comment round-trip', () => {
  it('empty comment stays empty', () => {
    expect(rt(diagWith([emptyFrame()])).frames[0].comment).toBe('');
  });

  it('ASCII comment round-trips', () => {
    const frame = { ...emptyFrame(), comment: 'hello world' };
    expect(rt(diagWith([frame])).frames[0].comment).toBe('hello world');
  });

  it('Unicode comment round-trips', () => {
    const frame = { ...emptyFrame(), comment: '日本語テスト' };
    expect(rt(diagWith([frame])).frames[0].comment).toBe('日本語テスト');
  });
});

// ── showGhost ──────────────────────────────────────────────────────────────────

describe('showGhost round-trip', () => {
  it('showGhost=false round-trips', () => {
    const frame = { ...emptyFrame(), showGhost: false };
    expect(rt(diagWith([frame])).frames[0].showGhost).toBe(false);
  });

  it('showGhost=true round-trips', () => {
    const frame = { ...emptyFrame(), showGhost: true };
    expect(rt(diagWith([frame])).frames[0].showGhost).toBe(true);
  });
});

// ── Callouts ───────────────────────────────────────────────────────────────────

describe('callouts round-trip', () => {
  it('no callouts stays empty', () => {
    expect(rt(diagWith([emptyFrame()])).frames[0].callouts).toEqual([]);
  });

  it('callout text, col, row, dir round-trip', () => {
    const frame = {
      ...emptyFrame(),
      callouts: [{ col: 3, row: 5, text: 'hello', dir: 'top' as const }],
    };
    const decoded = rt(diagWith([frame])).frames[0].callouts[0];
    expect(decoded.text).toBe('hello');
    expect(decoded.col).toBe(3);
    expect(decoded.row).toBe(5);
    expect(decoded.dir).toBe('top');
  });

  it('callout with dir="bottom" round-trips', () => {
    const frame = {
      ...emptyFrame(),
      callouts: [{ col: 1, row: 2, text: 'X', dir: 'bottom' as const }],
    };
    expect(rt(diagWith([frame])).frames[0].callouts[0].dir).toBe('bottom');
  });

  it('callout with dir="free" and freeX/freeY round-trips approximately', () => {
    const frame = {
      ...emptyFrame(),
      callouts: [{
        col: 0, row: 0, text: 'free',
        dir: 'free' as const,
        freeX: 0.5,
        freeY: 0.25,
      }],
    };
    const decoded = rt(diagWith([frame])).frames[0].callouts[0];
    expect(decoded.dir).toBe('free');
    expect(decoded.freeX).toBeCloseTo(0.5, 1);
    expect(decoded.freeY).toBeCloseTo(0.25, 1);
  });

  it('callouts with empty text are filtered out', () => {
    const frame = {
      ...emptyFrame(),
      callouts: [
        { col: 0, row: 0, text: '', dir: 'top' as const },
        { col: 1, row: 1, text: 'keep', dir: 'top' as const },
      ],
    };
    const decoded = rt(diagWith([frame])).frames[0].callouts;
    expect(decoded).toHaveLength(1);
    expect(decoded[0].text).toBe('keep');
  });
});

// ── Inputs ─────────────────────────────────────────────────────────────────────

describe('inputs round-trip', () => {
  it('no inputs stays absent', () => {
    expect(rt(diagWith([emptyFrame()])).frames[0].inputs).toBeUndefined();
  });

  it('"pressed" and "hold" states round-trip', () => {
    const frame = {
      ...emptyFrame(),
      inputs: { left: 'pressed' as const, cw: 'hold' as const },
    };
    const decoded = rt(diagWith([frame])).frames[0].inputs;
    expect(decoded?.left).toBe('pressed');
    expect(decoded?.cw).toBe('hold');
  });

  it('neutral inputs are not present in decoded result', () => {
    const frame = {
      ...emptyFrame(),
      inputs: { left: 'pressed' as const },
    };
    const decoded = rt(diagWith([frame])).frames[0].inputs;
    expect(decoded?.right).toBeUndefined();
  });
});

// ── lockFlash ──────────────────────────────────────────────────────────────────

describe('lockFlash round-trip', () => {
  it('lockFlash=true round-trips', () => {
    const frame = { ...emptyFrame(), lockFlash: true as const };
    expect(rt(diagWith([frame])).frames[0].lockFlash).toBe(true);
  });

  it('absent lockFlash stays absent', () => {
    expect(rt(diagWith([emptyFrame()])).frames[0].lockFlash).toBeUndefined();
  });
});

// ── lockDelayProgress ──────────────────────────────────────────────────────────

describe('lockDelayProgress round-trip', () => {
  it('absent stays absent', () => {
    expect(rt(diagWith([emptyFrame()])).frames[0].lockDelayProgress).toBeUndefined();
  });

  it('value 1.0 round-trips', () => {
    const frame = { ...emptyFrame(), lockDelayProgress: 1.0 };
    expect(rt(diagWith([frame])).frames[0].lockDelayProgress).toBeCloseTo(1.0, 1);
  });
});

// ── Per-frame line-clear timing ────────────────────────────────────────────────

describe('line-clear timing round-trip', () => {
  it('undefined timing stays undefined', () => {
    const decoded = rt(diagWith([emptyFrame()])).frames[0];
    expect(decoded.lineClearPreMs).toBeUndefined();
    expect(decoded.lineClearSwipeMs).toBeUndefined();
    expect(decoded.lineClearPostMs).toBeUndefined();
  });

  it('explicit timing values round-trip', () => {
    const frame = { ...emptyFrame(), lineClearPreMs: 100, lineClearSwipeMs: 200, lineClearPostMs: 300 };
    const decoded = rt(diagWith([frame])).frames[0];
    expect(decoded.lineClearPreMs).toBe(100);
    expect(decoded.lineClearSwipeMs).toBe(200);
    expect(decoded.lineClearPostMs).toBe(300);
  });
});
