import { BOARD_COLS, BOARD_TOTAL_ROWS, cloneBoard, getCell, setCell } from '../types/board';
import type { Board } from '../types/board';
import { PieceType } from '../types/piece';
import type { ActivePiece, Rotation } from '../types/piece';
import type { RotationSystem } from '../types/rotation-system';
import type { Frame, Diagram, RotationSystemId } from '../types/frame';
import { getRotationSystem } from '../rotation/index';

export function mirrorBoard(board: Board): Board {
  const mirrored = cloneBoard(board);
  for (let r = 0; r < BOARD_TOTAL_ROWS; r++) {
    for (let c = 0; c < Math.floor(BOARD_COLS / 2); c++) {
      const a = r * BOARD_COLS + c;
      const b = r * BOARD_COLS + (BOARD_COLS - 1 - c);
      const tmp = mirrored[a];
      mirrored[a] = mirrored[b];
      mirrored[b] = tmp;
    }
  }
  return mirrored;
}

export function mirrorPieceType(type: PieceType): PieceType {
  switch (type) {
    case PieceType.S: return PieceType.Z;
    case PieceType.Z: return PieceType.S;
    case PieceType.J: return PieceType.L;
    case PieceType.L: return PieceType.J;
    default: return type;
  }
}

/**
 * Mirror an active piece horizontally.
 * Strategy: compute the absolute mino positions, flip them, then find the
 * (type, rotation, col, row) in the rotation system that matches.
 */
export function mirrorActivePiece(piece: ActivePiece, rotSys: RotationSystem): ActivePiece | null {
  const mirType = mirrorPieceType(piece.type);
  const shape = rotSys.getShape(piece.type, piece.rotation);

  // Compute absolute positions and mirror them
  const mirrored: { x: number; y: number }[] = [];
  for (const { deltaCol, deltaRow } of shape) {
    const col = piece.col + deltaCol;
    const row = piece.row - deltaRow;
    mirrored.push({ x: BOARD_COLS - 1 - col, y: row });
  }

  // Find matching rotation state in the mirrored piece type
  for (let r = 0; r < 4; r++) {
    const testShape = rotSys.getShape(mirType, r as Rotation);
    // Try each mino as the anchor reference
    for (const ref of mirrored) {
      // If ref corresponds to testShape offset [0], then anchor col = ref.x - deltaCol0, row = ref.y + deltaRow0
      const deltaCol0 = testShape[0].deltaCol;
      const deltaRow0 = testShape[0].deltaRow;
      const testCol = ref.x - deltaCol0;
      const testRow = ref.y + deltaRow0;
      let ok = true;
      for (const { deltaCol, deltaRow } of testShape) {
        const minoCol = testCol + deltaCol;
        const minoRow = testRow - deltaRow;
        if (!mirrored.some(p => p.x === minoCol && p.y === minoRow)) {
          ok = false;
          break;
        }
      }
      if (ok) {
        return { type: mirType, rotation: r as Rotation, col: testCol, row: testRow, big: piece.big };
      }
    }
  }
  return null;
}

export function mirrorFrame(frame: Frame, rotSys: RotationSystem): Frame {
  const mirrored: Frame = {
    ...frame,
    board: mirrorBoard(frame.board),
    activePiece: frame.activePiece
      ? mirrorActivePiece(frame.activePiece, rotSys) ?? undefined
      : undefined,
    holdPiece: frame.holdPiece !== undefined ? mirrorPieceType(frame.holdPiece) : undefined,
    nextQueue: frame.nextQueue.map(p => p === null ? null : mirrorPieceType(p)),
    callouts: (frame.callouts ?? []).map(c => ({
      ...c,
      col: BOARD_COLS - 1 - c.col,
      dir: c.dir === 'left' ? 'right' as const
        : c.dir === 'right' ? 'left' as const
        : c.dir,
    })),
    overlays: frame.overlays?.map(o => ({
      ...o,
      col: BOARD_COLS - 1 - o.col,
    })),
  };
  return mirrored;
}

export function mirrorDiagram(diagram: Diagram): Diagram {
  const rotSys = getRotationSystem(diagram.rotationSystem);
  return {
    ...diagram,
    frames: diagram.frames.map(f => mirrorFrame(f, rotSys)),
  };
}
