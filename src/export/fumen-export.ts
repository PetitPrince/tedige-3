import { encoder, Field } from 'tetris-fumen';
import type { EncodePage } from 'tetris-fumen';
import type { Frame, RotationSystemId } from '../types/frame';
import { CellType, BOARD_COLS, getCell } from '../types/board';
import { PieceType } from '../types/piece';
import type { ActivePiece, Rotation } from '../types/piece';
import { SRS_SHAPES } from '../rotation/shapes';
import { getRotationSystem } from '../rotation/index';

const FUMEN_FIELD_HEIGHT = 23;

function cellToFumen(c: CellType): string {
  switch (c) {
    case CellType.I: return 'I';
    case CellType.O: return 'O';
    case CellType.T: return 'T';
    case CellType.S: return 'S';
    case CellType.Z: return 'Z';
    case CellType.J: return 'J';
    case CellType.L: return 'L';
    case CellType.Garbage: return 'X';
    default: return '_';
  }
}

function pieceTypeToFumen(t: PieceType): string {
  switch (t) {
    case PieceType.I: return 'I';
    case PieceType.O: return 'O';
    case PieceType.T: return 'T';
    case PieceType.S: return 'S';
    case PieceType.Z: return 'Z';
    case PieceType.J: return 'J';
    case PieceType.L: return 'L';
  }
}

const ROTATION_MAP: Record<number, string> = {
  0: 'spawn',
  1: 'right',
  2: 'reverse',
  3: 'left',
};

type SRSShapeEntry = readonly (readonly [number, number])[];

/**
 * Given the absolute mino positions, find the SRS (rotation, x, y) that matches.
 * Fumen uses SRS conventions internally, so we reverse-lookup in the SRS shape table.
 */
function findSRSOperation(
  type: PieceType,
  positions: { x: number; y: number }[],
): { rotation: string; x: number; y: number } | null {
  const posSet = new Set(positions.map(p => `${p.x},${p.y}`));
  const p0 = positions[0];

  for (let r = 0; r < 4; r++) {
    const shape = SRS_SHAPES[type][r];
    for (const [deltaCol0, deltaRow0] of shape) {
      const col = p0.x - deltaCol0;
      const row = p0.y + deltaRow0;
      let ok = true;
      for (const [deltaCol, deltaRow] of shape) {
        if (!posSet.has(`${col + deltaCol},${row - deltaRow}`)) { ok = false; break; }
      }
      if (ok) return { rotation: ROTATION_MAP[r], x: col, y: row };
    }
  }
  return null;
}

export function exportFumen(frames: Frame[], rotationSystem: RotationSystemId): string {
  const rotSys = getRotationSystem(rotationSystem);
  const pages: EncodePage[] = [];

  for (const frame of frames) {
    const field = Field.create();

    // Set board cells
    for (let y = 0; y < FUMEN_FIELD_HEIGHT; y++) {
      for (let x = 0; x < BOARD_COLS; x++) {
        const cell = getCell(frame.board, x, y);
        if (cell !== CellType.Empty) {
          field.set(x, y, cellToFumen(cell));
        }
      }
    }

    // Convert active piece
    let operation: EncodePage['operation'];
    if (frame.activePiece) {
      const piece = frame.activePiece;
      const shape = rotSys.getShape(piece.type, piece.rotation);
      const positions = shape.map(({ deltaCol, deltaRow }) => ({
        x: piece.col + deltaCol,
        y: piece.row - deltaRow,
      }));

      const srsOp = findSRSOperation(piece.type, positions);
      if (srsOp) {
        operation = {
          type: pieceTypeToFumen(piece.type) as any,
          rotation: srsOp.rotation as any,
          x: srsOp.x,
          y: srsOp.y,
        };
      }
    }

    pages.push({
      field,
      operation,
      comment: frame.comment || undefined,
    });
  }

  return encoder.encode(pages);
}
