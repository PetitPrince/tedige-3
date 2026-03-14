import { get } from 'svelte/store';
import { diagram, currentFrameIndex, getFrameState } from './store';
import type { Frame } from '../types/frame';
import { getRotationSystem } from '../rotation/index';
import type { RotationSystem } from '../types/rotation-system';
import { movePiece, rotatePiece, hardDrop, holdPiece } from '../engine/play-ops';

/** Append a new frame after the current index, trimming any frames ahead. */
export function appendRecordFrame(newFrame: Frame): void {
  const d = get(diagram);
  const idx = get(currentFrameIndex);
  const frames = d.frames.slice(0, idx + 1);
  frames.push(newFrame);
  diagram.set({ ...d, frames });
  currentFrameIndex.set(idx + 1);
}

function recordAction(fn: (frame: Frame, rotSys: RotationSystem) => Frame | null): boolean {
  const { d, idx, frame } = getFrameState();
  if (!frame) return false;
  const rotSys = getRotationSystem(d.rotationSystem);
  const next = fn(frame, rotSys);
  if (next) { appendRecordFrame(next); return true; }
  return false;
}

export const recordMove = (dcol: number, drow: number) =>
  recordAction((f, rs) => movePiece(f, dcol, drow, rs));

export const recordRotate = (dir: 'cw' | 'ccw') =>
  recordAction((f, rs) => rotatePiece(f, dir, rs));

export const recordHardDrop = () =>
  recordAction((f, rs) => { const r = hardDrop(f, rs); return r?.nextFrame ?? null; });

export const recordHold = () =>
  recordAction((f, rs) => holdPiece(f, rs));

/**
 * Handle a record-mode keypress. Returns true if a move was made.
 * ArrowLeft/Right/Down = move, ArrowUp/Space = hard drop, Z/z = CCW, X/x = CW, C/c = hold.
 */
export function handleRecordInput(key: string): boolean {
  if (key === 'ArrowLeft')              return recordMove(-1, 0);
  if (key === 'ArrowRight')             return recordMove(+1, 0);
  if (key === 'ArrowDown')              return recordMove(0, -1);
  if (key === 'ArrowUp' || key === ' ') return recordHardDrop();
  if (key === 'z' || key === 'Z')       return recordRotate('ccw');
  if (key === 'x' || key === 'X')       return recordRotate('cw');
  if (key === 'c' || key === 'C')       return recordHold();
  return false;
}
