import type { Frame } from '../types/frame';
import type { RotationSystem } from '../types/rotation-system';
import { cloneBoard } from '../types/board';
import { placePiece } from './board';
import { clearLines } from './line-clear';
import { computeGhost } from './ghost';
import { cloneFrame } from './frame-ops';

/** Move the active piece by (dcol, drow). Returns null if blocked. */
export function movePiece(
  frame: Frame,
  dcol: number,
  drow: number,
  rotSys: RotationSystem,
): Frame | null {
  if (!frame.activePiece) return null;
  const newPiece = {
    ...frame.activePiece,
    col: frame.activePiece.col + dcol,
    row: frame.activePiece.row + drow,
  };
  if (rotSys.collides(newPiece, frame.board)) return null;
  const next = cloneFrame(frame, true);
  next.activePiece = newPiece;
  return next;
}

/** Rotate the active piece CW or CCW. Returns null if all kicks fail. */
export function rotatePiece(
  frame: Frame,
  dir: 'cw' | 'ccw',
  rotSys: RotationSystem,
): Frame | null {
  if (!frame.activePiece) return null;
  const rotated = rotSys.rotate(frame.activePiece, dir, frame.board);
  if (!rotated) return null;
  const next = cloneFrame(frame, true);
  next.activePiece = rotated;
  return next;
}

/**
 * Hard-drop: ghost to floor, lock, clear lines, spawn next piece.
 * Returns null if no active piece.
 */
export function hardDrop(
  frame: Frame,
  rotSys: RotationSystem,
): { nextFrame: Frame } | null {
  if (!frame.activePiece) return null;

  // 1. Drop to ghost position
  const ghostPiece = computeGhost(frame.activePiece, frame.board, rotSys);

  // 2. Lock onto board
  const lockedBoard = cloneBoard(frame.board);
  const shape = rotSys.getShape(ghostPiece.type, ghostPiece.rotation);
  placePiece(lockedBoard, ghostPiece, shape);

  // 3. Clear lines
  const { board: clearedBoard } = clearLines(lockedBoard);

  // 4. Shift queue and spawn next piece
  const [nextType, ...remainingQueue] = frame.nextQueue;
  const newActivePiece = nextType != null
    ? rotSys.spawn(nextType, clearedBoard) ?? undefined
    : undefined;

  const nextFrame = cloneFrame(frame, true);
  nextFrame.board = clearedBoard;
  nextFrame.activePiece = newActivePiece;
  nextFrame.nextQueue = remainingQueue;

  return { nextFrame };
}

/**
 * Hold: swap active piece with hold slot (or take from queue if hold is empty).
 * Returns null if no active piece or queue empty when hold is unoccupied.
 */
export function holdPiece(
  frame: Frame,
  rotSys: RotationSystem,
): Frame | null {
  if (!frame.activePiece) return null;

  const activeType = frame.activePiece.type;

  if (frame.holdPiece === undefined) {
    // Hold is empty: move active into hold, spawn from queue
    const [nextType, ...remainingQueue] = frame.nextQueue;
    if (nextType == null) return null;
    const next = cloneFrame(frame, true);
    next.activePiece = rotSys.spawn(nextType, frame.board) ?? undefined;
    next.nextQueue = remainingQueue;
    next.holdPiece = activeType;
    return next;
  } else {
    // Swap active <-> hold
    const next = cloneFrame(frame, true);
    next.activePiece = rotSys.spawn(frame.holdPiece, frame.board) ?? undefined;
    next.holdPiece = activeType;
    return next;
  }
}
