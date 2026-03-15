import { cloneBoard, BOARD_COLS, BOARD_TOTAL_ROWS } from '../types/board';
import type { Diagram, Frame, RotationSystemId } from '../types/frame';
import { emptyFrame } from '../types/frame';
import type { PieceType } from '../types/piece';
import type { RotationSystem } from '../types/rotation-system';
import { placePiece } from './board';
import { clearLines } from './line-clear';

export function cloneFrame(frame: Frame, clean = false): Frame {
  return {
    board: cloneBoard(frame.board),
    activePiece: frame.activePiece ? { ...frame.activePiece } : undefined,
    nextQueue: [...frame.nextQueue],
    holdPiece: frame.holdPiece,
    comment: clean ? '' : frame.comment,
    showGhost: frame.showGhost,
    callouts: clean ? [] : (frame.callouts ?? []).map(c => ({ ...c })),
    ...(clean ? {} : {
      lockDelayProgress: frame.lockDelayProgress,
      clearingRows: frame.clearingRows ? [...frame.clearingRows] : undefined,
      lineClearPreMs: frame.lineClearPreMs,
      lineClearSwipeMs: frame.lineClearSwipeMs,
      lineClearPostMs: frame.lineClearPostMs,
      inputs: frame.inputs ? { ...frame.inputs } : undefined,
      overlays: frame.overlays ? frame.overlays.map(o => ({ ...o })) : undefined,
      lockFlash: frame.lockFlash,
    }),
  };
}

/** Insert a blank frame (copying board + queue from current) after the given index. */
export function insertFrameAfter(diagram: Diagram, index: number): Diagram {
  const frames = [...diagram.frames];
  const newFrame = emptyFrame();
  const src = frames[index];
  if (src) {
    newFrame.board = cloneBoard(src.board);
    newFrame.nextQueue = [...src.nextQueue];
    newFrame.holdPiece = src.holdPiece;
    newFrame.showGhost = src.showGhost;
  }
  frames.splice(index + 1, 0, newFrame);
  return { ...diagram, frames };
}

/** Duplicate the frame at the given index, inserting the copy after it. */
export function duplicateFrame(diagram: Diagram, index: number): Diagram {
  const frames = [...diagram.frames];
  frames.splice(index + 1, 0, cloneFrame(frames[index]));
  return { ...diagram, frames };
}

/** Delete the frame at the given index. Always keeps at least one frame. */
export function deleteFrame(diagram: Diagram, index: number): Diagram {
  if (diagram.frames.length <= 1) return diagram;
  const frames = diagram.frames.filter((_, i) => i !== index);
  return { ...diagram, frames };
}

/** Move a frame from one index to another (for drag-to-reorder). */
export function moveFrame(diagram: Diagram, from: number, to: number): Diagram {
  if (from === to) return diagram;
  const frames = [...diagram.frames];
  const [removed] = frames.splice(from, 1);
  frames.splice(to, 0, removed);
  return { ...diagram, frames };
}

/**
 * Advance frame: lock the active piece, clear lines, produce the next frame.
 * Inserts the new frame after the given index. Returns the updated diagram
 * and the index of the newly inserted frame.
 */
export function advanceFrame(
  diagram: Diagram,
  index: number,
  rotSys: RotationSystem,
): { diagram: Diagram; newIndex: number } {
  const frame = diagram.frames[index];
  if (!frame.activePiece) {
    // No active piece: just insert blank continuation
    return { diagram: insertFrameAfter(diagram, index), newIndex: index + 1 };
  }

  // 1. Place the active piece onto the board
  const newBoard = cloneBoard(frame.board);
  const shape = rotSys.getShape(frame.activePiece.type, frame.activePiece.rotation);
  placePiece(newBoard, frame.activePiece, shape);

  // 2. Clear completed lines
  const { board: clearedBoard } = clearLines(newBoard);

  // 3. Shift the next queue: first piece becomes the new active piece
  const [nextType, ...remainingQueue] = frame.nextQueue;

  // 4. Spawn new active piece if one is queued
  const newActivePiece = nextType != null
    ? rotSys.spawn(nextType, clearedBoard) ?? undefined
    : undefined;

  // 5. Build the next frame
  const nextFrame: Frame = {
    board: clearedBoard,
    activePiece: newActivePiece,
    nextQueue: remainingQueue,
    holdPiece: frame.holdPiece,
    comment: '',
    showGhost: frame.showGhost,
    callouts: [],
  };

  // 6. Mark current frame as lock-flash, then insert settled frame after it
  const frames = [...diagram.frames];
  frames[index] = { ...frame, lockFlash: true as const };
  frames.splice(index + 1, 0, nextFrame);

  return { diagram: { ...diagram, frames }, newIndex: index + 1 };
}

export type ShiftDir = 'up' | 'down' | 'left' | 'right';

/** Shift all board cells one step in the given direction. Cells that go out of bounds are lost; vacated edge is filled with Empty. */
function shiftBoard(board: Uint8Array, dir: ShiftDir): Uint8Array {
  const result = new Uint8Array(board.length);
  switch (dir) {
    case 'up':
      // row r → row r+1; row 0 becomes empty; top row content is lost
      result.set(board.subarray(0, (BOARD_TOTAL_ROWS - 1) * BOARD_COLS), BOARD_COLS);
      break;
    case 'down':
      // row r → row r-1; top row becomes empty; floor content is lost
      result.set(board.subarray(BOARD_COLS), 0);
      break;
    case 'left':
      for (let r = 0; r < BOARD_TOTAL_ROWS; r++) {
        const base = r * BOARD_COLS;
        for (let c = 0; c < BOARD_COLS - 1; c++) result[base + c] = board[base + c + 1];
      }
      break;
    case 'right':
      for (let r = 0; r < BOARD_TOTAL_ROWS; r++) {
        const base = r * BOARD_COLS;
        for (let c = BOARD_COLS - 1; c > 0; c--) result[base + c] = board[base + c - 1];
      }
      break;
  }
  return result;
}

/** Shift the board and overlay cells of a frame one step in the given direction. */
export function shiftFrame(frame: Frame, dir: ShiftDir): Frame {
  const dc = dir === 'right' ? 1 : dir === 'left' ? -1 : 0;
  const dr = dir === 'up' ? 1 : dir === 'down' ? -1 : 0;

  const overlays = frame.overlays
    ? frame.overlays
        .map(o => ({ ...o, col: o.col + dc, row: o.row + dr }))
        .filter(o => o.col >= 0 && o.col < BOARD_COLS && o.row >= 0 && o.row < BOARD_TOTAL_ROWS)
    : undefined;

  return { ...frame, board: shiftBoard(frame.board, dir), overlays };
}

/** Update a single frame in the diagram (immutably). */
export function updateFrame(diagram: Diagram, index: number, frame: Frame): Diagram {
  const frames = [...diagram.frames];
  frames[index] = frame;
  return { ...diagram, frames };
}

/** Update just the rotation system, re-running spawns for all frames with active pieces. */
export function changeRotationSystem(
  diagram: Diagram,
  newId: RotationSystemId,
  newRotSys: RotationSystem,
): Diagram {
  const frames = diagram.frames.map(frame => {
    if (!frame.activePiece) return frame;
    // Try to re-spawn the piece under the new system
    const respawned = newRotSys.spawn(frame.activePiece.type, frame.board);
    return { ...frame, activePiece: respawned ?? undefined };
  });
  return { ...diagram, frames, rotationSystem: newId };
}
