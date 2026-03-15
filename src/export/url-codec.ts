import { BitWriter, BitReader } from '../utils/bits';
import type { Diagram, Frame, RotationSystemId, Callout, CalloutDir, InputId, InputCategory, InputState } from '../types/frame';
import { ALL_INPUT_IDS, ALL_INPUT_CATEGORIES } from '../types/frame';
import { createBoard, cloneBoard, getCell, setCell, BOARD_COLS, BOARD_TOTAL_ROWS, CellType } from '../types/board';
import type { Board } from '../types/board';
import type { PieceType } from '../types/piece';

const RS_IDS: RotationSystemId[] = ['srs', 'ars', 'nes'];
const DIR_IDS: CalloutDir[] = ['top', 'bottom', 'left', 'right', 'free'];
const VERSION = 1;

// ── Board encoding ────────────────────────────────────────────────────────────
// Differential RLE against previous board. Each run: [length:8][value:4].
// A run of length 0 is the sentinel.

function encodeBoard(board: Board, prev: Board, w: BitWriter): void {
  let runLen = 0;
  let runVal = 0;

  for (let r = 0; r < BOARD_TOTAL_ROWS; r++) {
    for (let c = 0; c < BOARD_COLS; c++) {
      const diff = getCell(board, c, r) ^ getCell(prev, c, r);
      if (diff === runVal && runLen < 255) {
        runLen++;
      } else {
        if (runLen > 0) { w.write(runLen, 8); w.write(runVal, 4); }
        runVal = diff;
        runLen = 1;
      }
    }
  }
  if (runLen > 0) { w.write(runLen, 8); w.write(runVal, 4); }
  w.write(0, 8); w.write(0, 4); // sentinel
}

function decodeBoard(prev: Board, r: BitReader): Board {
  const board = cloneBoard(prev);
  let pos = 0;
  while (true) {
    const len = r.read(8);
    const val = r.read(4);
    if (len === 0) break;
    for (let i = 0; i < len; i++) {
      const c2 = (pos % BOARD_COLS) as number;
      const r2 = Math.floor(pos / BOARD_COLS);
      const old = getCell(board, c2, r2);
      setCell(board, c2, r2, (old ^ val) as CellType);
      pos++;
    }
  }
  return board;
}

// ── Line-clear timing helpers ─────────────────────────────────────────────────
// 13-bit field: 0 = undefined (use default), N = (N-1)*10 ms (max 81900 ms)

function encodeLcMs(ms: number | undefined): number {
  if (ms === undefined) return 0;
  return Math.min(8191, Math.round(ms / 10) + 1);
}

function decodeLcMs(v: number): number | undefined {
  return v === 0 ? undefined : (v - 1) * 10;
}

// ── Frame encoding ────────────────────────────────────────────────────────────

function encodeFrame(frame: Frame, prev: Board, w: BitWriter): void {
  encodeBoard(frame.board, prev, w);

  // Active piece (1 flag bit + 17 data bits if present)
  if (frame.activePiece) {
    w.write(1, 1);
    w.write(frame.activePiece.type, 3);
    w.write(frame.activePiece.rotation, 2);
    // col: 0–9 fits in 4 bits; support -8..+15 with bias +8, 5 bits
    w.write(frame.activePiece.col + 8, 5);
    // row: support -4..+27 with bias +4, 5 bits
    w.write(frame.activePiece.row + 4, 5);
  } else {
    w.write(0, 1);
  }

  // Hold piece
  if (frame.holdPiece !== undefined) {
    w.write(1, 1);
    w.write(frame.holdPiece, 3);
  } else {
    w.write(0, 1);
  }

  // Next queue (max 6, 3 bits per piece type)
  const qLen = Math.min(frame.nextQueue.length, 6);
  w.write(qLen, 3);
  for (let i = 0; i < qLen; i++) {
    w.write(frame.nextQueue[i] ?? 7, 3);  // null encoded as 7 (unused piece-type value)
  }

  // Show ghost flag
  w.write(frame.showGhost ? 1 : 0, 1);

  // Comment (max 255 UTF-8 bytes)
  const enc = new TextEncoder().encode((frame.comment ?? '').slice(0, 255));
  w.write(Math.min(enc.length, 255), 8);
  for (const byte of enc) w.write(byte, 8);

  // Callouts (max 15, 4-bit count)
  const callouts = (frame.callouts ?? []).filter(c => c.text.length > 0).slice(0, 15);
  w.write(callouts.length, 4);
  for (const c of callouts) {
    w.write(c.col, 4);
    w.write(c.row, 5);
    w.write(DIR_IDS.indexOf(c.dir ?? 'top'), 3);
    if ((c.dir ?? 'top') === 'free') {
      w.write(Math.round((c.freeX ?? 0) * 255), 8);
      w.write(Math.round((c.freeY ?? 0) * 255), 8);
    }
    const textEnc = new TextEncoder().encode(c.text.slice(0, 255));
    const textLen = Math.min(textEnc.length, 255);
    w.write(textLen, 8);
    for (const byte of textEnc.slice(0, textLen)) w.write(byte, 8);
  }

  // Lock delay progress (4 bits, 0–15 → 0–1)
  w.write(Math.round((frame.lockDelayProgress ?? 0) * 15), 4);

  // Clearing rows bitmask (20 bits, one per visible row 0–19)
  let crBitmask = 0;
  for (const r of (frame.clearingRows ?? [])) {
    if (r >= 0 && r < 20) crBitmask |= (1 << r);
  }
  w.write(crBitmask, 20);

  // Per-frame line-clear timing (13 bits each; 0=use default, N=(N-1)*10 ms)
  w.write(encodeLcMs(frame.lineClearPreMs),   13);
  w.write(encodeLcMs(frame.lineClearSwipeMs), 13);
  w.write(encodeLcMs(frame.lineClearPostMs),  13);

  // Input states (2 bits per InputId in ALL_INPUT_IDS order)
  // 0=neutral, 1=pressed, 2=hold
  const inputsMap = frame.inputs ?? {};
  for (const id of ALL_INPUT_IDS) {
    const state = inputsMap[id];
    w.write(state === 'pressed' ? 1 : state === 'hold' ? 2 : 0, 2);
  }

  // Lock-flash flag (1 bit)
  w.write(frame.lockFlash ? 1 : 0, 1);
}

function decodeFrameCore(prev: Board, r: BitReader): Frame {
  const board = decodeBoard(prev, r);

  let activePiece = undefined;
  if (r.read(1) === 1) {
    activePiece = {
      type: r.read(3) as PieceType,
      rotation: r.read(2) as 0|1|2|3,
      col: r.read(5) - 8,
      row: r.read(5) - 4,
    };
  }

  let holdPiece: PieceType | undefined = undefined;
  if (r.read(1) === 1) {
    holdPiece = r.read(3) as PieceType;
  }

  const qLen = r.read(3);
  const nextQueue: (PieceType | null)[] = [];
  for (let i = 0; i < qLen; i++) {
    const v = r.read(3);
    nextQueue.push(v === 7 ? null : v as PieceType);  // 7 = empty slot sentinel
  }

  const showGhost = r.read(1) === 1;

  const commentLen = r.read(8);
  const commentBytes = new Uint8Array(commentLen);
  for (let i = 0; i < commentLen; i++) commentBytes[i] = r.read(8);
  const comment = new TextDecoder().decode(commentBytes);

  const calloutCount = r.read(4);
  const callouts: Callout[] = [];
  for (let i = 0; i < calloutCount; i++) {
    const col = r.read(4);
    const row = r.read(5);
    const dir: CalloutDir = DIR_IDS[r.read(3)] ?? 'top';
    let freeX: number | undefined;
    let freeY: number | undefined;
    if (dir === 'free') {
      freeX = r.read(8) / 255;
      freeY = r.read(8) / 255;
    }
    const textLen = r.read(8);
    const textBytes = new Uint8Array(textLen);
    for (let j = 0; j < textLen; j++) textBytes[j] = r.read(8);
    const text = new TextDecoder().decode(textBytes);
    callouts.push({ col, row, text, dir, freeX, freeY });
  }

  const ldpRaw = r.read(4);
  const lockDelayProgress = ldpRaw > 0 ? ldpRaw / 15 : undefined;

  const crBitmask = r.read(20);
  const clearingRows: number[] = [];
  for (let bit = 0; bit < 20; bit++) {
    if (crBitmask & (1 << bit)) clearingRows.push(bit);
  }

  const lineClearPreMs   = decodeLcMs(r.read(13));
  const lineClearSwipeMs = decodeLcMs(r.read(13));
  const lineClearPostMs  = decodeLcMs(r.read(13));

  const inputs: Partial<Record<InputId, InputState>> = {};
  for (const id of ALL_INPUT_IDS) {
    const bits = r.read(2);
    if (bits === 1) inputs[id] = 'pressed';
    else if (bits === 2) inputs[id] = 'hold';
  }

  const lockFlash = r.read(1) === 1 ? true : undefined;

  return {
    board,
    activePiece,
    holdPiece,
    nextQueue,
    showGhost,
    comment,
    callouts,
    lockDelayProgress,
    clearingRows: clearingRows.length ? clearingRows : undefined,
    lineClearPreMs,
    lineClearSwipeMs,
    lineClearPostMs,
    inputs: Object.keys(inputs).length ? inputs : undefined,
    lockFlash,
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

export function encodeDiagram(diagram: Diagram): string {
  const w = new BitWriter();

  // Header: version (4 bits), rotation system (2 bits), animDelay/100 (12 bits),
  // frame count (12 bits), hiddenInputs bitmask (8 bits)
  w.write(VERSION, 4);
  w.write(RS_IDS.indexOf(diagram.rotationSystem), 2);
  w.write(Math.round(diagram.animationDelayMs / 100) & 0xfff, 12);
  w.write(Math.min(diagram.frames.length, 4095), 12);
  let hiddenMask = 0;
  for (let i = 0; i < ALL_INPUT_CATEGORIES.length; i++) {
    if ((diagram.hiddenInputs ?? []).includes(ALL_INPUT_CATEGORIES[i])) hiddenMask |= (1 << i);
  }
  w.write(hiddenMask, 8);

  let prev = createBoard();
  for (const frame of diagram.frames) {
    encodeFrame(frame, prev, w);
    prev = frame.board;
  }

  return 'v1@' + w.flush();
}

export function decodeDiagram(encoded: string): Diagram {
  if (!encoded.startsWith('v1@')) throw new Error('Unknown or unsupported format');
  const r = new BitReader(encoded.slice(3));
  const version = r.read(4);
  if (version !== VERSION) throw new Error(`Unsupported version: ${version}`);

  const rsIdx = r.read(2);
  const rotationSystem: RotationSystemId = RS_IDS[rsIdx] ?? 'ars';
  const animationDelayMs = r.read(12) * 100;
  const frameCount = r.read(12);
  const hiddenMask = r.read(8);
  const hiddenInputs: InputCategory[] = [];
  for (let i = 0; i < ALL_INPUT_CATEGORIES.length; i++) {
    if (hiddenMask & (1 << i)) hiddenInputs.push(ALL_INPUT_CATEGORIES[i]);
  }

  const frames: Frame[] = [];
  let prev = createBoard();
  for (let i = 0; i < frameCount; i++) {
    const frame = decodeFrameCore(prev, r);
    frames.push(frame);
    prev = frame.board;
  }

  return {
    frames,
    rotationSystem,
    animationDelayMs,
    hiddenInputs: hiddenInputs.length ? hiddenInputs : undefined,
    metadata: { title: '', author: '', createdAt: new Date().toISOString() },
  };
}

export function diagramToUrlHash(diagram: Diagram): string {
  return '#' + encodeDiagram(diagram);
}
