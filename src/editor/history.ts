import { get } from 'svelte/store';
import { diagram, canUndo, canRedo } from './store';
import type { Diagram } from '../types/frame';
import { cloneBoard } from '../types/board';

const MAX_HISTORY = 100;

// We need deep-clone of Diagram (Uint8Array boards aren't JSON-serializable normally)
function cloneDiagram(d: Diagram): Diagram {
  return {
    ...d,
    frames: d.frames.map(f => ({
      ...f,
      board: cloneBoard(f.board),
      nextQueue: [...f.nextQueue],
      activePiece: f.activePiece ? { ...f.activePiece } : undefined,
    })),
    metadata: { ...d.metadata },
  };
}

const undoStack: Diagram[] = [];
const redoStack: Diagram[] = [];

/** Save a checkpoint before making a change. */
export function checkpoint(): void {
  undoStack.push(cloneDiagram(get(diagram)));
  if (undoStack.length > MAX_HISTORY) undoStack.shift();
  redoStack.length = 0;
  canUndo.set(true);
  canRedo.set(false);
}

export function undo(): void {
  const prev = undoStack.pop();
  if (!prev) return;
  redoStack.push(cloneDiagram(get(diagram)));
  diagram.set(prev);
  canUndo.set(undoStack.length > 0);
  canRedo.set(true);
}

export function redo(): void {
  const next = redoStack.pop();
  if (!next) return;
  undoStack.push(cloneDiagram(get(diagram)));
  diagram.set(next);
  canUndo.set(undoStack.length > 0);
  canRedo.set(redoStack.length > 0);
}

export function clearHistory(): void {
  undoStack.length = 0;
  redoStack.length = 0;
  canUndo.set(false);
  canRedo.set(false);
}
