import { decoder } from 'tetris-fumen';
import type { Frame, RotationSystemId } from '../types/frame';
import { emptyFrame } from '../types/frame';
import { CellType, BOARD_COLS, createBoard, setCell } from '../types/board';
import { PieceType } from '../types/piece';
import type { ActivePiece } from '../types/piece';
import { findActivePiece, getShapeTable } from '../engine/piece-detect';

const FUMEN_FIELD_HEIGHT = 23; // v115 field rows: y=0 (floor) .. y=22 (top)

function cellFromFumen(ch: string): CellType {
  switch (ch) {
    case 'I': return CellType.I;
    case 'O': return CellType.O;
    case 'T': return CellType.T;
    case 'S': return CellType.S;
    case 'Z': return CellType.Z;
    case 'J': return CellType.J;
    case 'L': return CellType.L;
    case 'X': return CellType.Garbage;
    default:  return CellType.Empty;
  }
}

function pieceTypeFromFumen(ch: string): PieceType | null {
  switch (ch) {
    case 'I': return PieceType.I;
    case 'O': return PieceType.O;
    case 'T': return PieceType.T;
    case 'S': return PieceType.S;
    case 'Z': return PieceType.Z;
    case 'J': return PieceType.J;
    case 'L': return PieceType.L;
    default:  return null;
  }
}


export type ImportResult =
  | { frames: Frame[]; error: null }
  | { frames: null; error: string };

export function importFumen(str: string, rotationSystem: RotationSystemId): ImportResult {
  let pages;
  try {
    pages = decoder.decode(str.trim());
  } catch (e) {
    return { frames: null, error: `Failed to parse fumen: ${e}` };
  }

  if (!pages.length) {
    return { frames: null, error: 'No pages found in fumen string.' };
  }

  const shapes = getShapeTable(rotationSystem);
  const frames: Frame[] = [];

  for (const page of pages) {
    const board = createBoard();

    // Copy the field into our board. y=0=floor in both fumen and our system,
    // so the mapping is direct (no coordinate transformation needed).
    for (let y = 0; y < FUMEN_FIELD_HEIGHT; y++) {
      for (let x = 0; x < BOARD_COLS; x++) {
        const cell = cellFromFumen(page.field.at(x, y) as string);
        if (cell !== CellType.Empty) {
          setCell(board, x, y, cell);
        }
      }
    }

    // Map the active piece via reverse-lookup in the target rotation system's
    // shape table. This works for both SRS and ARS: the fumen mino positions
    // are the true cell coordinates, and we find whichever (rotation, anchor)
    // in the target table reproduces those exact cells.
    let activePiece: ActivePiece | undefined;
    if (page.operation) {
      const ourType = pieceTypeFromFumen(page.operation.type);
      if (ourType !== null) {
        const positions = page.mino().positions();
        activePiece = findActivePiece(ourType, positions, shapes) ?? undefined;
      }
    }

    const frame = emptyFrame();
    frame.board = board;
    frame.activePiece = activePiece;
    frame.comment = page.comment ?? '';
    frames.push(frame);
  }

  return { frames, error: null };
}
