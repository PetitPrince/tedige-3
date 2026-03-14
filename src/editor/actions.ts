/**
 * Editor actions — shared imperative operations that update diagram state.
 * Lives here (not in store.ts) so we can import both store and history
 * without creating a circular dependency (history.ts imports store.ts).
 */
import { get } from 'svelte/store';
import {
  diagram, activeTool, selectedPieceType, pieceCollision, selectedRotation,
  getFrameState,
} from './store';
import type { ToolMode } from './store';
import { checkpoint } from './history';
import { updateFrame, shiftFrame } from '../engine/frame-ops';
import type { ShiftDir } from '../engine/frame-ops';
import { getRotationSystem } from '../rotation/index';
import { nextRotation } from '../types/piece';
import type { PieceType, Rotation } from '../types/piece';
import type { RotationSystem } from '../types/rotation-system';
import type { Frame } from '../types/frame';
import { createBoard, BOARD_ROWS, BOARD_BUFFER } from '../types/board';
import { mirrorFrame, mirrorDiagram } from '../engine/mirror';

/**
 * Pure: spawn pieceType onto frame at the given rotation.
 * Places the topmost mino at the top visible row (BOARD_ROWS-1),
 * pushing upward only if blocked by the stack.
 * Returns null if all candidate positions are blocked.
 */
export function spawnPieceOnFrame(
  frame: Frame,
  pieceType: PieceType,
  rotation: Rotation,
  rotSys: RotationSystem,
): Frame | null {
  const refPiece = rotSys.spawn(pieceType, createBoard());
  const col = refPiece ? refPiece.col : 3;
  const shape = rotSys.getShape(pieceType, rotation);
  const minDeltaRow = shape.length > 0 ? Math.min(...shape.map(m => m.deltaRow)) : 0;
  // startRow places the topmost mino exactly at BOARD_ROWS-1 (top visible row)
  const startRow = (BOARD_ROWS - 1) + minDeltaRow;
  const maxRow = BOARD_ROWS + BOARD_BUFFER - 1;
  for (let row = startRow; row <= maxRow; row++) {
    const candidate = { type: pieceType, rotation, col, row };
    if (!rotSys.collides(candidate, frame.board)) {
      return { ...frame, activePiece: candidate };
    }
  }
  return null;
}

/** Store-connected: spawn pieceType on the current frame at the current selected rotation. */
export function spawnActivePiece(type: PieceType, rotation?: Rotation): void {
  const { d, idx } = getFrameState();
  const rotSys = getRotationSystem(d.rotationSystem);
  const rot: Rotation = rotation ?? (get(selectedRotation) as Rotation);
  const newFrame = spawnPieceOnFrame(d.frames[idx], type, rot, rotSys);
  if (!newFrame) return;
  checkpoint();
  diagram.set(updateFrame(d, idx, newFrame));
}

/** Mirror the current frame (board + piece + queue + annotations). */
export function mirrorCurrentFrame(): void {
  const { d, idx } = getFrameState();
  const rotSys = getRotationSystem(d.rotationSystem);
  checkpoint();
  const mirrored = mirrorFrame(d.frames[idx], rotSys);
  diagram.set(updateFrame(d, idx, mirrored));
}

/** Mirror all frames in the diagram. */
export function mirrorAllFrames(): void {
  checkpoint();
  diagram.update(d => mirrorDiagram(d));
}

export function selectTool(id: ToolMode): void {
  activeTool.set(id);
  if (id === 'erase' || id === 'callout' || id === 'overlay') {
    selectedPieceType.set(null);
  }
  if (id === 'erase') {
    const { d, idx } = getFrameState();
    if (d.frames[idx]?.activePiece) {
      checkpoint();
      diagram.set(updateFrame(d, idx, { ...d.frames[idx], activePiece: undefined }));
    }
  }
}

/** Shift the board cells (and overlays) of the current frame one step in the given direction. */
export function shiftStack(dir: ShiftDir): void {
  const { d, idx, frame } = getFrameState();
  checkpoint();
  diagram.set(updateFrame(d, idx, shiftFrame(frame, dir)));
}

export function rotateActivePiece(dir: 'cw' | 'ccw'): void {
  const { d, idx, frame } = getFrameState();
  if (!frame.activePiece) return;

  const rotSys = getRotationSystem(d.rotationSystem);

  const rotated = get(pieceCollision)
    ? rotSys.rotate(frame.activePiece, dir, frame.board)
    : { ...frame.activePiece, rotation: nextRotation(frame.activePiece.rotation, dir) };

  if (rotated) {
    checkpoint();
    diagram.set(updateFrame(d, idx, { ...frame, activePiece: rotated }));
  }
}
