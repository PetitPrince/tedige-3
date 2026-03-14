import type { Board } from './board';
import type { ActivePiece, PieceType } from './piece';
import { createBoard } from './board';

export type CalloutDir = 'top' | 'bottom' | 'left' | 'right' | 'free';

// ── Input overlay ─────────────────────────────────────────────────────────────
export type InputId = 'left' | 'right' | 'up' | 'down' | 'ccw' | 'cw' | 'ccw2' | 'rewind' | 'cw2' | 'hold' | 'extra';
export const ALL_INPUT_IDS: InputId[] = ['left', 'right', 'up', 'down', 'ccw', 'cw', 'ccw2', 'rewind', 'cw2', 'hold', 'extra'];

/** Visual state of a single input button. */
export type InputState = 'pressed' | 'hold';

/** Visibility categories for the diagram-wide input overlay toggle. */
export type InputCategory = 'dir' | 'ccw' | 'cw' | 'ccw2' | 'rewind' | 'cw2' | 'hold' | 'extra';
export const ALL_INPUT_CATEGORIES: InputCategory[] = ['dir', 'ccw', 'cw', 'ccw2', 'rewind', 'cw2', 'hold', 'extra'];

/** Maps each InputCategory to the InputIds it covers. */
export const INPUT_CATEGORY_IDS: Record<InputCategory, InputId[]> = {
  dir:    ['left', 'right', 'up', 'down'],
  ccw:    ['ccw'],
  cw:     ['cw'],
  ccw2:   ['ccw2'],
  rewind: ['rewind'],
  cw2:    ['cw2'],
  hold:   ['hold'],
  extra:  ['extra'],
};


export interface Callout {
  col: number;
  row: number;
  text: string;
  dir: CalloutDir;
  /** Bubble top-left X as fraction [0..1] of canvas W. Only used when dir='free'. */
  freeX?: number;
  /** Bubble top-left Y as fraction [0..1] of canvas H. Only used when dir='free'. */
  freeY?: number;
}

/** A single colored overlay cell — drawn above the stack but below the active piece. */
export interface OverlayCell {
  col: number;
  row: number;
  color: string; // CSS hex color, e.g. "#ffdd44"
  emoji?: string;    // Optional emoji to render centered in the cell (no color fill when set)
  blockType?: number; // Optional CellType — renders a full skinned block instead of a flat fill
}

export interface Frame {
  board: Board;
  activePiece?: ActivePiece;
  nextQueue: PieceType[];    // 0–6 upcoming pieces; index 0 = next to spawn
  holdPiece?: PieceType;
  comment: string;
  showGhost: boolean;
  callouts: Callout[];
  /** 0 = no fade (full time remaining), 1 = fully faded (lock imminent). */
  lockDelayProgress?: number;
  /** Row indices (game coords, 0=floor) currently in the line-clear flash state. */
  clearingRows?: number[];
  /** Line-clear animation timing overrides for this frame (ms). Undefined = use player default. */
  lineClearPreMs?: number;
  lineClearSwipeMs?: number;
  lineClearPostMs?: number;
  /** Active inputs to display on this frame. Absent/empty = no overlay shown. */
  inputs?: Partial<Record<InputId, InputState>>;
  /** Colored cell overlays — drawn above the stack, independent of board data. */
  overlays?: OverlayCell[];
  /** When true, the active piece on this frame represents the moment of lock — rendered with a white flash. */
  lockFlash?: boolean;
}

export const LC_DEFAULT_PRE_MS   = 150;
export const LC_DEFAULT_SWIPE_MS = 200;
export const LC_DEFAULT_POST_MS  = 350;
export const LF_DEFAULT_MS       = 80;

export type RotationSystemId = 'srs' | 'ars' | 'nes';

export interface Diagram {
  frames: Frame[];
  rotationSystem: RotationSystemId;
  animationDelayMs: number;
  metadata: {
    title: string;
    author: string;
    createdAt: string;
  };
  /** Input categories hidden from the overlay. Absent/empty = all visible. */
  hiddenInputs?: InputCategory[];
  /** How many next-queue slots to display (0–6). Absent = 6. */
  nextQueueLength?: number;
}

export function emptyFrame(): Frame {
  return {
    board: createBoard(),
    activePiece: undefined,
    nextQueue: [],
    holdPiece: undefined,
    comment: '',
    showGhost: false,
    callouts: [],
  };
}

export function emptyDiagram(): Diagram {
  return {
    frames: [emptyFrame()],
    rotationSystem: 'ars',
    animationDelayMs: 500,
    metadata: {
      title: '',
      author: '',
      createdAt: new Date().toISOString(),
    },
  };
}
