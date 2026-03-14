import { PieceType, nextRotation } from '../types/piece';
import type { ActivePiece, Rotation } from '../types/piece';
import type { Board } from '../types/board';
import { BOARD_COLS, BOARD_TOTAL_ROWS, CellType, getCell } from '../types/board';
import { ARS_SHAPES, getShape } from './shapes';
import { collidesAt } from '../engine/collision';

// ── Trace types ────────────────────────────────────────────────────────────────

export interface MinoPos {
  col: number;
  row: number; // game row (0 = floor)
}

export interface CentreColMinoInfo {
  deltaCol: number;
  deltaRow: number;
  col: number; // absolute board column
  row: number; // absolute game row
  blocked: boolean;
  isCentreCol: boolean; // deltaCol === 1
  deciding: boolean;    // first blocked mino → drives accept/reject
  checked: boolean;     // false when algorithm stopped before reaching this mino
}

/**
 * Fine-grained micro-steps emitted by traceARSRotate().
 *
 *  init            — the piece before rotation
 *  basic-test      — testing the target rotation at the original position
 *  basic-pass      — target rotation fits; no kick needed
 *  basic-fail      — target rotation blocked; kick logic will run
 *  no-kick-io      — I / O pieces never kick; rotation cancelled
 *  centre-col-skip — centre-column rule skipped (wrong piece or wrong state)
 *  centre-col-mino — one mino examined by the centre-column scan (one step per mino)
 *  centre-col-reject — centre column blocked → rotation cancelled
 *  centre-col-allow  — first blocked mino is not centre-col → kicks allowed
 *  kick-test       — attempting a kick offset (testing, not yet resolved)
 *  kick-pass       — kick fits; rotation succeeds
 *  kick-fail       — kick blocked; trying next offset
 *  result          — final outcome (success or failure)
 */
export type WallkickStep =
  | { kind: 'init';            piece: ActivePiece }
  | { kind: 'basic-test';      piece: ActivePiece }
  | { kind: 'basic-pass';      piece: ActivePiece }
  | { kind: 'basic-fail';      piece: ActivePiece; blockedMinos: MinoPos[] }
  | { kind: 'no-kick-io' }
  | { kind: 'centre-col-skip'; reason: 'not-vertical' | 'not-jlt' }
  | { kind: 'centre-col-mino'; minoIndex: number; allMinos: CentreColMinoInfo[] }
  | { kind: 'centre-col-reject'; minos: CentreColMinoInfo[] }
  | { kind: 'centre-col-allow';  minos: CentreColMinoInfo[] }
  | { kind: 'kick-test'; deltaCol: number; piece: ActivePiece }
  | { kind: 'kick-pass'; deltaCol: number; piece: ActivePiece }
  | { kind: 'kick-fail'; deltaCol: number; piece: ActivePiece }
  | { kind: 'result'; piece: ActivePiece | null };

export interface WallkickTrace {
  fromPiece: ActivePiece;
  basePiece: ActivePiece; // target rotation, no kick applied
  direction: 'cw' | 'ccw' | '180';
  steps: WallkickStep[];
  result: ActivePiece | null;
}

// ── Internal helpers ───────────────────────────────────────────────────────────

function normaliseRotation(type: PieceType, r: Rotation): Rotation {
  if (type === PieceType.I || type === PieceType.S || type === PieceType.Z) {
    return (r % 2) as Rotation;
  }
  return r;
}

/** Collect every mino position that is blocked at the given piece state. */
function getBlockedMinos(
  board: Board,
  type: PieceType,
  rotation: Rotation,
  col: number,
  row: number,
): MinoPos[] {
  const shape = getShape(ARS_SHAPES, type, normaliseRotation(type, rotation));
  const blocked: MinoPos[] = [];
  for (const { deltaCol, deltaRow } of shape) {
    const minoCol = col + deltaCol;
    const minoRow = row - deltaRow;
    if (minoRow >= BOARD_TOTAL_ROWS) continue; // above buffer — no collision
    const isBlocked =
      minoCol < 0 || minoCol >= BOARD_COLS ||
      minoRow < 0 ||
      getCell(board, minoCol, minoRow) !== CellType.Empty;
    if (isBlocked) blocked.push({ col: minoCol, row: minoRow });
  }
  return blocked;
}

/**
 * Instrumented version of centreColumnBlocked().
 * Scans minos in raster order, records which were checked and which was deciding.
 */
function traceCentreCol(
  type: PieceType,
  normToRotation: Rotation,
  col: number,
  gameRow: number,
  board: Board,
): { minos: CentreColMinoInfo[]; rejected: boolean } {
  const raw = ARS_SHAPES[type][normToRotation];
  const minos: CentreColMinoInfo[] = [];
  let stopped = false;
  let rejected = false;

  for (const [deltaCol, deltaRow] of raw) {
    const c = col + deltaCol;
    const r = gameRow - deltaRow;

    if (stopped) {
      minos.push({ deltaCol, deltaRow, col: c, row: r, blocked: false, isCentreCol: deltaCol === 1, deciding: false, checked: false });
      continue;
    }

    const blocked =
      c < 0 || c >= BOARD_COLS ||
      r < 0 ||
      getCell(board, c, r) !== CellType.Empty;

    const isCentreCol = deltaCol === 1;
    minos.push({ deltaCol, deltaRow, col: c, row: r, blocked, isCentreCol, deciding: blocked, checked: true });

    if (blocked) {
      stopped = true;
      rejected = isCentreCol;
    }
  }

  return { minos, rejected };
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Mirrors ARSRotationSystem.rotate() exactly, collecting a fine-grained trace.
 * Only valid when the diagram uses the 'ars' rotation system.
 */
export function traceARSRotate(
  piece: ActivePiece,
  direction: 'cw' | 'ccw' | '180',
  board: Board,
): WallkickTrace {
  const steps: WallkickStep[] = [];
  const toRot    = nextRotation(piece.rotation, direction);
  const normTo   = normaliseRotation(piece.type, toRot);
  const normFrom = normaliseRotation(piece.type, piece.rotation);
  const basePiece: ActivePiece = { ...piece, rotation: toRot };

  // 2-state pieces: 180 is a visual no-op — nothing interesting to trace.
  if (normTo === normFrom) {
    return { fromPiece: piece, basePiece, direction, steps, result: basePiece };
  }

  // ── Step 0: show the piece before rotation ──────────────────────────────────
  steps.push({ kind: 'init', piece });

  // ── Step 1: basic rotation (no offset) ─────────────────────────────────────
  const baseShape = getShape(ARS_SHAPES, piece.type, normTo);
  const basicCollides = collidesAt(board, baseShape, piece.col, piece.row);

  steps.push({ kind: 'basic-test', piece: basePiece });

  if (!basicCollides) {
    steps.push({ kind: 'basic-pass', piece: basePiece });
    steps.push({ kind: 'result', piece: basePiece });
    return { fromPiece: piece, basePiece, direction, steps, result: basePiece };
  }

  const blockedMinos = getBlockedMinos(board, piece.type, toRot, piece.col, piece.row);
  steps.push({ kind: 'basic-fail', piece: basePiece, blockedMinos });

  // ── Step 2: I and O never kick ─────────────────────────────────────────────
  if (piece.type === PieceType.I || piece.type === PieceType.O) {
    steps.push({ kind: 'no-kick-io' });
    steps.push({ kind: 'result', piece: null });
    return { fromPiece: piece, basePiece, direction, steps, result: null };
  }

  // ── Step 3: Centre-column rule ─────────────────────────────────────────────
  const fromIsVertical = piece.rotation === 1 || piece.rotation === 3;
  const isJLT = piece.type === PieceType.J || piece.type === PieceType.L || piece.type === PieceType.T;

  if (!fromIsVertical) {
    steps.push({ kind: 'centre-col-skip', reason: 'not-vertical' });
  } else if (!isJLT) {
    steps.push({ kind: 'centre-col-skip', reason: 'not-jlt' });
  } else {
    const { minos, rejected } = traceCentreCol(piece.type, normTo, piece.col, piece.row, board);

    // One step per mino, revealing scan results progressively.
    // Stop after the deciding (first blocked) mino.
    for (let i = 0; i < minos.length; i++) {
      const progressiveMinos = minos.map((m, j) =>
        j <= i ? m : { ...m, checked: false, deciding: false },
      );
      steps.push({ kind: 'centre-col-mino', minoIndex: i, allMinos: progressiveMinos });
      if (minos[i].deciding) break;
    }

    if (rejected) {
      steps.push({ kind: 'centre-col-reject', minos });
      steps.push({ kind: 'result', piece: null });
      return { fromPiece: piece, basePiece, direction, steps, result: null };
    }
    steps.push({ kind: 'centre-col-allow', minos });
  }

  // ── Step 4: Kick attempts (+1 col, then −1 col) ────────────────────────────
  for (const deltaCol of [1, -1] as const) {
    const kickedPiece: ActivePiece = { ...basePiece, col: piece.col + deltaCol };
    const kickShape = getShape(ARS_SHAPES, piece.type, normTo);
    const kickCollides = collidesAt(board, kickShape, piece.col + deltaCol, piece.row);

    steps.push({ kind: 'kick-test', deltaCol, piece: kickedPiece });

    if (!kickCollides) {
      steps.push({ kind: 'kick-pass', deltaCol, piece: kickedPiece });
      steps.push({ kind: 'result', piece: kickedPiece });
      return { fromPiece: piece, basePiece, direction, steps, result: kickedPiece };
    }
    steps.push({ kind: 'kick-fail', deltaCol, piece: kickedPiece });
  }

  steps.push({ kind: 'result', piece: null });
  return { fromPiece: piece, basePiece, direction, steps, result: null };
}

// ── Step description helpers (used by the UI panel) ───────────────────────────

const PIECE_NAMES = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'] as const;

export function stepTitle(step: WallkickStep): string {
  switch (step.kind) {
    case 'init':             return 'Initial position';
    case 'basic-test':       return 'Test basic rotation';
    case 'basic-pass':       return 'Basic rotation: fits';
    case 'basic-fail':       return 'Basic rotation: blocked';
    case 'no-kick-io':       return 'I / O: no kick rule';
    case 'centre-col-skip':
      return step.reason === 'not-vertical'
        ? 'Centre-col: skip (not from vertical)'
        : 'Centre-col: skip (not J / L / T)';
    case 'centre-col-mino':  return `Centre-col scan: mino ${step.minoIndex + 1}`;
    case 'centre-col-reject': return 'Centre-col: reject rotation';
    case 'centre-col-allow':  return 'Centre-col: kicks allowed';
    case 'kick-test': return `Kick ${step.deltaCol > 0 ? '+1 →' : '−1 ←'}: testing`;
    case 'kick-pass': return `Kick ${step.deltaCol > 0 ? '+1 →' : '−1 ←'}: success`;
    case 'kick-fail': return `Kick ${step.deltaCol > 0 ? '+1 →' : '−1 ←'}: blocked`;
    case 'result':    return step.piece ? 'Result: rotated' : 'Result: failed';
  }
}

export function stepIcon(step: WallkickStep): string {
  switch (step.kind) {
    case 'init':             return '○';
    case 'basic-test':       return '?';
    case 'basic-pass':       return '✓';
    case 'basic-fail':       return '✗';
    case 'no-kick-io':       return '⊘';
    case 'centre-col-skip':  return '→';
    case 'centre-col-mino': {
      const m = step.allMinos[step.minoIndex];
      if (!m.checked) return '?';
      if (!m.blocked) return '·';
      return m.isCentreCol ? '✗' : '!';
    }
    case 'centre-col-reject': return '✗';
    case 'centre-col-allow':  return '✓';
    case 'kick-test': return '?';
    case 'kick-pass': return '✓';
    case 'kick-fail': return '✗';
    case 'result':    return step.piece ? '✓' : '✗';
  }
}

export function stepColor(step: WallkickStep): string {
  switch (step.kind) {
    case 'init':             return '#4488ff';
    case 'basic-test':       return '#ffe060';
    case 'basic-pass':       return '#00cc55';
    case 'basic-fail':       return '#ff4444';
    case 'no-kick-io':       return '#888888';
    case 'centre-col-skip':  return '#ffcc00';
    case 'centre-col-mino': {
      const m = step.allMinos[step.minoIndex];
      if (!m.checked || !m.blocked) return '#00cc55';
      return m.isCentreCol ? '#ff4444' : '#ff8800';
    }
    case 'centre-col-reject': return '#ff4444';
    case 'centre-col-allow':  return '#00cc55';
    case 'kick-test': return '#00ccff';
    case 'kick-pass': return '#00cc55';
    case 'kick-fail': return '#ff4444';
    case 'result':    return step.piece ? '#00cc55' : '#ff4444';
  }
}

export function stepDescription(step: WallkickStep, trace: WallkickTrace): string {
  switch (step.kind) {
    case 'init': {
      const name = PIECE_NAMES[trace.fromPiece.type];
      const dir  = trace.direction === 'cw' ? 'clockwise' : trace.direction === 'ccw' ? 'counter-clockwise' : '180°';
      return `${name} piece at col ${trace.fromPiece.col}, row ${trace.fromPiece.row}, state ${trace.fromPiece.rotation}. Requesting ${dir} rotation.`;
    }

    case 'basic-test':
      return `Testing target state ${trace.basePiece.rotation} at col ${trace.basePiece.col}, row ${trace.basePiece.row} with no positional offset.`;

    case 'basic-pass':
      return 'The piece fits at the target rotation with no kick. Rotation succeeds immediately.';

    case 'basic-fail':
      return `The target rotation overlaps ${step.blockedMinos.length} cell${step.blockedMinos.length !== 1 ? 's' : ''}. Kick logic will run.`;

    case 'no-kick-io':
      return 'ARS rule: I and O pieces never wall-kick. Rotation is cancelled.';

    case 'centre-col-skip':
      if (step.reason === 'not-vertical') {
        return `Rotating from state ${trace.fromPiece.rotation} (horizontal). The centre-column rule only fires when rotating FROM a vertical state (state 1 or 3). Skipping to kick attempts.`;
      }
      return `${PIECE_NAMES[trace.fromPiece.type]} is not J, L, or T. Centre-column rule only applies to J, L, T pieces. Skipping to kick attempts.`;

    case 'centre-col-mino': {
      const total = step.allMinos.length;
      const m     = step.allMinos[step.minoIndex];
      const pos   = `deltaCol=${m.deltaCol}, deltaRow=${m.deltaRow} → board (col ${m.col}, row ${m.row})`;
      if (!m.blocked) {
        const more = step.minoIndex < total - 1 ? ' Continuing scan.' : ' All minos free.';
        return `Mino ${step.minoIndex + 1} of ${total}: ${pos}. Cell is free.${more}`;
      }
      if (m.isCentreCol) {
        return `Mino ${step.minoIndex + 1} of ${total}: ${pos}. BLOCKED. deltaCol=1 is the centre column → ARS rejects rotation entirely.`;
      }
      return `Mino ${step.minoIndex + 1} of ${total}: ${pos}. BLOCKED. deltaCol=${m.deltaCol} ≠ 1 (not the centre column) → kick attempts are allowed.`;
    }

    case 'centre-col-reject': {
      const deciding = step.minos.find(m => m.deciding);
      return deciding
        ? `Centre column (deltaCol=1) mino at (col ${deciding.col}, row ${deciding.row}) is blocked. ARS rule: reject rotation entirely — no kicks.`
        : 'Centre column check rejected the rotation.';
    }

    case 'centre-col-allow': {
      const deciding = step.minos.find(m => m.deciding);
      if (!deciding) return 'No mino is blocked. Centre-column check passes; kick attempts proceed.';
      return `First blocked mino at deltaCol=${deciding.deltaCol} (not the centre column). ARS rule: kick attempts are allowed.`;
    }

    case 'kick-test':
      return `Trying kick ${step.deltaCol > 0 ? '+1 col to the right' : '−1 col to the left'}. Testing piece at col ${step.piece.col}, row ${step.piece.row}…`;

    case 'kick-pass':
      return `Kick ${step.deltaCol > 0 ? '+1' : '−1'} fits at col ${step.piece.col}. Rotation succeeds.`;

    case 'kick-fail':
      return `Kick ${step.deltaCol > 0 ? '+1' : '−1'} blocked at col ${step.piece.col}.${step.deltaCol > 0 ? ' Will try −1 next.' : ' No more kicks available.'}`;

    case 'result':
      if (step.piece) {
        return `Rotation succeeded. Final position: col ${step.piece.col}, row ${step.piece.row}, state ${step.piece.rotation}.`;
      }
      return 'Rotation failed. The piece stays in its original position.';
  }
}
