import { CellType } from '../types/board';
import { PieceType } from '../types/piece';
import type { ActivePiece } from '../types/piece';
import { findActivePiece, getShapeTable } from '../engine/piece-detect';
import { BOARD_ROWS } from '../types/board';

export interface DiffResult {
  activePiece: ActivePiece | null;
  boardCells: CellType[][];   // cells with active piece removed
  candidateCount: number;      // how many "new" cells found
}

/**
 * Compare current classified grid against a locked baseline.
 * Cells present in `current` but Empty in `baseline` are candidates.
 * If candidateCount is within [minCells, maxCells] and all same CellType,
 * attempt shape matching via findActivePiece().
 */
export function diffDetectActivePiece(
  current: CellType[][],
  baseline: CellType[][],
  rotationSystem: string,
  minCells = 4,
  maxCells = 4,
): DiffResult {
  const rows = current.length;
  const cols = current[0]?.length ?? 0;

  const candidates: { dRow: number; col: number; cellType: CellType }[] = [];
  for (let dRow = 0; dRow < rows; dRow++) {
    for (let col = 0; col < cols; col++) {
      const cur = current[dRow][col];
      const base = baseline[dRow]?.[col] ?? CellType.Empty;
      if (cur !== CellType.Empty && base === CellType.Empty) {
        candidates.push({ dRow, col, cellType: cur });
      }
    }
  }

  if (candidates.length < minCells || candidates.length > maxCells) {
    return { activePiece: null, boardCells: current, candidateCount: candidates.length };
  }

  const cellType = candidates[0].cellType;
  if (!candidates.every(c => c.cellType === cellType)) {
    return { activePiece: null, boardCells: current, candidateCount: candidates.length };
  }

  // CellType.I=1 … CellType.L=7 map to PieceType 0–6; Garbage/Empty are not pieces
  if (cellType < 1 || cellType > 7) {
    return { activePiece: null, boardCells: current, candidateCount: candidates.length };
  }

  const pieceType = (cellType - 1) as PieceType;
  const shapes = getShapeTable(rotationSystem);
  const positions = candidates.map(c => ({
    x: c.col,
    y: BOARD_ROWS - 1 - c.dRow,
  }));

  const activePiece = findActivePiece(pieceType, positions, shapes);
  if (!activePiece) {
    return { activePiece: null, boardCells: current, candidateCount: candidates.length };
  }

  const boardCells = current.map(row => [...row]);
  for (const c of candidates) {
    boardCells[c.dRow][c.col] = CellType.Empty;
  }

  return { activePiece, boardCells, candidateCount: candidates.length };
}

/**
 * Find a group of exactly 4 connected same-colored cells that is floating
 * (not supported by the floor or other filled cells below).
 * Returns the cells and matched ActivePiece if found, or null.
 */
export function findFloatingPiece(
  grid: CellType[][],
  rotationSystem: string,
): { cells: { dRow: number; col: number; cellType: CellType }[]; activePiece: ActivePiece } | null {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  const visited = Array.from({ length: rows }, () => new Array<boolean>(cols).fill(false));

  for (let dRow = 0; dRow < rows; dRow++) {
    for (let col = 0; col < cols; col++) {
      if (visited[dRow][col] || grid[dRow][col] === CellType.Empty) continue;
      const cellType = grid[dRow][col];
      const component: { dRow: number; col: number }[] = [];
      const queue: [number, number][] = [[dRow, col]];
      visited[dRow][col] = true;
      while (queue.length > 0) {
        const [r, c] = queue.shift()!;
        component.push({ dRow: r, col: c });
        for (const [dr, dc] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
          const nr = r + dr, nc = c + dc;
          if (nr >= 0 && nr < rows && nc >= 0 && nc < cols
              && !visited[nr][nc] && grid[nr][nc] === cellType) {
            visited[nr][nc] = true;
            queue.push([nr, nc]);
          }
        }
      }
      if (component.length !== 4) continue;

      // Check if floating: at least one cell has empty below it (or isn't on the floor)
      const isFloating = component.some(({ dRow: r, col: c }) => {
        const below = r + 1; // dRow increases downward
        if (below >= rows) return false; // on the floor → not floating
        return grid[below][c] === CellType.Empty;
      });
      if (!isFloating) continue;
      if (cellType < 1 || cellType > 7) continue;

      const shapes = getShapeTable(rotationSystem);
      const pieceType = (cellType - 1) as PieceType;
      const positions = component.map(c => ({ x: c.col, y: BOARD_ROWS - 1 - c.dRow }));
      const activePiece = findActivePiece(pieceType, positions, shapes);
      if (activePiece) {
        return {
          cells: component.map(c => ({ ...c, cellType })),
          activePiece,
        };
      }
    }
  }
  return null;
}
