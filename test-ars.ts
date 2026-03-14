/**
 * test-ars.ts — Verify our ARS rotation system against the reference test suite.
 * Run with: npx tsx test-ars.ts
 */

import { ARSRotationSystem, TGM3RotationSystem } from './src/rotation/ars';
import { ARS_SHAPES, ARS_BBOX_OFFSET } from './src/rotation/shapes';
import { createBoard, setCell, CellType, BOARD_COLS, BOARD_TOTAL_ROWS } from './src/types/board';
import type { Board } from './src/types/board';
import { PieceType } from './src/types/piece';
import type { ActivePiece, Rotation } from './src/types/piece';
import testData from './ars_reference/files/ars_tests.json';

// Reference piece shapes (bounding-box [row, col] offsets) from ars.ts reference
const REF_PIECES: Record<string, Record<string, [number, number][]>> = {
  I: {
    spawn: [[1,0],[1,1],[1,2],[1,3]],
    CW:    [[0,2],[1,2],[2,2],[3,2]],
    "180": [[1,0],[1,1],[1,2],[1,3]],
    CCW:   [[0,2],[1,2],[2,2],[3,2]],
  },
  T: {
    spawn: [[1,0],[1,1],[1,2],[2,1]],
    CW:    [[0,1],[1,0],[1,1],[2,1]],
    "180": [[1,1],[2,0],[2,1],[2,2]],
    CCW:   [[0,1],[1,1],[1,2],[2,1]],
  },
  L: {
    spawn: [[1,0],[1,1],[1,2],[2,0]],
    CW:    [[0,0],[0,1],[1,1],[2,1]],
    "180": [[1,2],[2,0],[2,1],[2,2]],
    CCW:   [[0,1],[1,1],[2,1],[2,2]],
  },
  J: {
    spawn: [[1,0],[1,1],[1,2],[2,2]],
    CW:    [[0,1],[1,1],[2,0],[2,1]],
    "180": [[1,0],[2,0],[2,1],[2,2]],
    CCW:   [[0,1],[0,2],[1,1],[2,1]],
  },
  S: {
    spawn: [[1,1],[1,2],[2,0],[2,1]],
    CW:    [[0,0],[1,0],[1,1],[2,1]],
    "180": [[1,1],[1,2],[2,0],[2,1]],
    CCW:   [[0,0],[1,0],[1,1],[2,1]],
  },
  Z: {
    spawn: [[1,0],[1,1],[2,1],[2,2]],
    CW:    [[0,2],[1,1],[1,2],[2,1]],
    "180": [[1,0],[1,1],[2,1],[2,2]],
    CCW:   [[0,2],[1,1],[1,2],[2,1]],
  },
  O: {
    spawn: [[1,1],[1,2],[2,1],[2,2]],
    CW:    [[1,1],[1,2],[2,1],[2,2]],
    "180": [[1,1],[1,2],[2,1],[2,2]],
    CCW:   [[1,1],[1,2],[2,1],[2,2]],
  },
};

const PIECE_MAP: Record<string, PieceType> = {
  'I': PieceType.I, 'O': PieceType.O, 'T': PieceType.T,
  'S': PieceType.S, 'Z': PieceType.Z, 'J': PieceType.J, 'L': PieceType.L,
};

const ORIENT_MAP: Record<string, Rotation> = {
  'spawn': 0, 'CW': 1, '180': 2, 'CCW': 3,
};

const ACTION_MAP: Record<string, 'cw' | 'ccw'> = {
  'CW': 'cw', 'CCW': 'ccw',
};

/**
 * Compute physical cell positions in game coords from reference data.
 * Reference row r → game row (H - 1 - r).
 */
function refCellsToGameCoords(
  pieceName: string,
  orientation: string,
  bbRow: number,
  bbCol: number,
  boardHeight: number,
): { col: number; row: number }[] {
  const shape = REF_PIECES[pieceName][orientation];
  return shape.map(([dr, dc]) => ({
    col: bbCol + dc,
    row: (boardHeight - 1) - (bbRow + dr),
  }));
}

/**
 * Given physical cell positions and our ARS shape for a given piece/rotation,
 * find the anchor (col, row) in our coordinate system.
 */
function findAnchor(
  cells: { col: number; row: number }[],
  type: PieceType,
  rotation: Rotation,
): { col: number; row: number } | null {
  const shape = ARS_SHAPES[type][rotation];
  const cellSet = new Set(cells.map(c => `${c.col},${c.row}`));

  // Try each cell as a potential match for shape[0]
  for (const cell of cells) {
    const anchorCol = cell.col - shape[0][0]; // dc
    const anchorRow = cell.row + shape[0][1]; // dr (array-down, so game_row = anchor - dr)

    // Check if all shape cells match
    let allMatch = true;
    for (const [dc, dr] of shape) {
      const c = anchorCol + dc;
      const r = anchorRow - dr;
      if (!cellSet.has(`${c},${r}`)) {
        allMatch = false;
        break;
      }
    }
    if (allMatch) return { col: anchorCol, row: anchorRow };
  }
  return null;
}

/**
 * Build our Board from reference board strings.
 * Piece letter cells are treated as empty (they belong to the active piece).
 */
function buildBoard(lines: string[], pieceLetter: string): Board {
  const board = createBoard();
  const H = lines.length;
  for (let r = 0; r < H; r++) {
    const gameRow = H - 1 - r;
    for (let c = 0; c < lines[r].length; c++) {
      const ch = lines[r][c];
      if (ch !== '.' && ch !== pieceLetter) {
        setCell(board, c, gameRow, CellType.Garbage);
      }
    }
  }
  return board;
}

// ── Run tests ──────────────────────────────────────────────────────────────────

const ars = new ARSRotationSystem();
const tgm3 = new TGM3RotationSystem();

let passed = 0;
let failed = 0;
const failures: string[] = [];

for (const test of (testData as any).tests) {
  const {
    id, description, ruleset, piece: pieceName,
    initial_orientation, bb, action, board: boardLines,
    expected_outcome, expected_orientation, expected_bb,
  } = test;

  const pieceType = PIECE_MAP[pieceName];
  const rotation = ORIENT_MAP[initial_orientation] as Rotation;
  const dir = ACTION_MAP[action];
  const H = boardLines.length;

  // Build board (strip piece letter)
  const board = buildBoard(boardLines, pieceName);

  // Find physical cell positions of the piece
  const physCells = refCellsToGameCoords(pieceName, initial_orientation, bb[0], bb[1], H);

  // Find our anchor
  const anchor = findAnchor(physCells, pieceType, rotation);
  if (!anchor) {
    failures.push(`${id}: Could not find anchor for piece ${pieceName} ${initial_orientation} at bb [${bb}]`);
    failed++;
    continue;
  }

  const activePiece: ActivePiece = {
    type: pieceType,
    rotation,
    col: anchor.col,
    row: anchor.row,
  };

  // Choose rotation system
  const rotSys = (ruleset === 'tgm3') ? tgm3 : ars;

  // Verify piece doesn't collide at initial position
  if (rotSys.collides(activePiece, board)) {
    failures.push(`${id}: Piece collides at initial position! anchor=(${anchor.col},${anchor.row}), cells=${JSON.stringify(physCells)}`);
    failed++;
    continue;
  }

  // Run rotation
  const result = rotSys.rotate(activePiece, dir, board);

  if (expected_outcome === 'fail') {
    if (result === null) {
      passed++;
    } else {
      // Get result cells
      const resultShape = ARS_SHAPES[pieceType][result.rotation];
      const resultCells = resultShape.map(([dc, dr]: readonly [number, number]) => ({
        col: result.col + dc,
        row: result.row - dr,
      }));
      failures.push(
        `${id} FAIL: Expected fail but got rotation=${result.rotation} at (${result.col},${result.row})\n` +
        `  ${description}\n` +
        `  Result cells: ${JSON.stringify(resultCells)}`
      );
      failed++;
    }
  } else {
    if (result === null) {
      failures.push(
        `${id} FAIL: Expected ${expected_outcome} but got null (rotation failed)\n` +
        `  ${description}`
      );
      failed++;
    } else {
      // Compute expected physical cells from reference expected position
      const expectedCells = refCellsToGameCoords(
        pieceName, expected_orientation, expected_bb[0], expected_bb[1], H,
      );
      const expectedSet = new Set(expectedCells.map(c => `${c.col},${c.row}`));

      // Compute actual physical cells
      const resultShape = ARS_SHAPES[pieceType][result.rotation];
      const resultCells = resultShape.map(([dc, dr]: readonly [number, number]) => ({
        col: result.col + dc,
        row: result.row - dr,
      }));
      const resultSet = new Set(resultCells.map(c => `${c.col},${c.row}`));

      // Compare
      const setsMatch = expectedSet.size === resultSet.size &&
        [...expectedSet].every(v => resultSet.has(v));

      if (setsMatch) {
        passed++;
      } else {
        failures.push(
          `${id} FAIL: Cell positions don't match\n` +
          `  ${description}\n` +
          `  Expected (${expected_outcome}): ${JSON.stringify(expectedCells)}\n` +
          `  Got: ${JSON.stringify(resultCells)}\n` +
          `  Our rotation=${result.rotation} anchor=(${result.col},${result.row})`
        );
        failed++;
      }
    }
  }
}

console.log(`\n${'='.repeat(60)}`);
console.log(`ARS Rotation Test Results: ${passed} passed, ${failed} failed`);
console.log(`${'='.repeat(60)}`);

if (failures.length > 0) {
  console.log('\nFailures:');
  for (const f of failures) {
    console.log(`\n  ${f}`);
  }
}

// ── Shape verification ─────────────────────────────────────────────────────────
// Verify that our ARS shapes produce the same physical appearance as the reference.
console.log(`\n${'='.repeat(60)}`);
console.log('Shape Verification');
console.log(`${'='.repeat(60)}`);

const ORIENT_NAMES: string[] = ['spawn', 'CW', '180', 'CCW'];

let shapeErrors = 0;
for (const [name, pieceType] of Object.entries(PIECE_MAP)) {
  for (let rotIdx = 0; rotIdx < 4; rotIdx++) {
    const orientName = ORIENT_NAMES[rotIdx];
    const refShape = REF_PIECES[name][orientName];
    const ourShape = ARS_SHAPES[pieceType][rotIdx as Rotation];

    // Normalise both to relative offsets from top-left
    const refCols = refShape.map(([r, c]) => c);
    const refRows = refShape.map(([r, c]) => r);
    const refMinC = Math.min(...refCols);
    const refMinR = Math.min(...refRows);
    const refNorm = new Set(refShape.map(([r, c]) => `${c - refMinC},${r - refMinR}`));

    // Our shape: [dc, dr] where dc=col, dr=row-down
    const ourCols = ourShape.map(([dc, dr]: readonly [number, number]) => dc);
    const ourRows = ourShape.map(([dc, dr]: readonly [number, number]) => dr);
    const ourMinC = Math.min(...ourCols);
    const ourMinR = Math.min(...ourRows);
    const ourNorm = new Set(ourShape.map(([dc, dr]: readonly [number, number]) => `${dc - ourMinC},${dr - ourMinR}`));

    const match = refNorm.size === ourNorm.size && [...refNorm].every(v => ourNorm.has(v));
    if (!match) {
      console.log(`  MISMATCH: ${name} ${orientName}`);
      console.log(`    Reference: ${JSON.stringify([...refNorm])}`);
      console.log(`    Ours:      ${JSON.stringify([...ourNorm])}`);
      shapeErrors++;
    }
  }
}

if (shapeErrors === 0) {
  console.log('  All shapes match the reference.');
} else {
  console.log(`\n  ${shapeErrors} shape mismatches found.`);
}

// ── Bbox offset verification ───────────────────────────────────────────────────
// Verify that ARS_BBOX_OFFSET places each shape at the correct absolute position
// within the reference bounding box (not just the same relative shape).
console.log(`\n${'='.repeat(60)}`);
console.log('Bbox Offset Verification (absolute position in reference bbox)');
console.log(`${'='.repeat(60)}`);

let bboxErrors = 0;
for (const [name, pieceType] of Object.entries(PIECE_MAP)) {
  for (let rotIdx = 0; rotIdx < 4; rotIdx++) {
    const orientName = ORIENT_NAMES[rotIdx];
    const refShape = REF_PIECES[name][orientName];
    const ourShape = ARS_SHAPES[pieceType][rotIdx as Rotation];
    const [offC, offR] = ARS_BBOX_OFFSET[pieceType][rotIdx];

    // Reference cells as (col, row) within bbox
    const refSet = new Set(refShape.map(([r, c]) => `${c},${r}`));

    // Our cells shifted by bbox offset: (offC + dc, offR + dr)
    const ourSet = new Set(
      ourShape.map(([dc, dr]: readonly [number, number]) => `${offC + dc},${offR + dr}`)
    );

    const match = refSet.size === ourSet.size && [...refSet].every(v => ourSet.has(v));
    if (!match) {
      console.log(`  MISMATCH: ${name} ${orientName}`);
      console.log(`    Reference: ${JSON.stringify([...refSet])}`);
      console.log(`    Ours+off:  ${JSON.stringify([...ourSet])}`);
      console.log(`    Offset:    [${offC}, ${offR}]`);
      bboxErrors++;
    }
  }
}

if (bboxErrors === 0) {
  console.log('  All bbox offsets match the reference positions.');
} else {
  console.log(`\n  ${bboxErrors} bbox offset mismatches found.`);
}
