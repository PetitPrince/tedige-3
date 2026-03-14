import { CellType, BOARD_COLS, BOARD_ROWS } from '../types/board';
import { rgbToHsv, sampleRegionAvg } from './color-utils';

export type ColorPalette = 'srs' | 'ars';

/** CellTypes that correspond to Tetris pieces (I/O/T/S/Z/J/L). */
export const PIECE_CELL_TYPES: CellType[] = [
  CellType.I, CellType.O, CellType.T, CellType.S, CellType.Z, CellType.J, CellType.L,
];

/** Labels and fixed display colours for each piece CellType. */
export const PIECE_META: { cellType: CellType; name: string; color: string }[] = [
  { cellType: CellType.I, name: 'I', color: '#00dddd' },
  { cellType: CellType.O, name: 'O', color: '#e8d200' },
  { cellType: CellType.T, name: 'T', color: '#bb00ee' },
  { cellType: CellType.S, name: 'S', color: '#00cc00' },
  { cellType: CellType.Z, name: 'Z', color: '#ee0000' },
  { cellType: CellType.J, name: 'J', color: '#003cee' },
  { cellType: CellType.L, name: 'L', color: '#ee8200' },
];

/**
 * Default hue centres (0–360°) for each piece type.
 *
 * SRS / Guideline: I cyan, T purple, S green, Z red
 * ARS / Classic  : I red,  T cyan,  S purple, Z green
 */
export const SRS_DEFAULT_HUES: Record<number, number> = {
  [CellType.I]: 188, [CellType.O]: 52,  [CellType.T]: 293,
  [CellType.S]: 122, [CellType.Z]: 3,   [CellType.J]: 214, [CellType.L]: 26,
};

export const ARS_DEFAULT_HUES: Record<number, number> = {
  [CellType.I]: 0,   [CellType.O]: 52,  [CellType.T]: 180,
  [CellType.S]: 290, [CellType.Z]: 120, [CellType.J]: 216, [CellType.L]: 32,
};

export function getDefaultHues(palette: ColorPalette): Record<number, number> {
  return palette === 'srs' ? SRS_DEFAULT_HUES : ARS_DEFAULT_HUES;
}

export interface ClassifyThresholds {
  /**
   * Cells with HSV value (brightness) below this are Empty. Default 0.25.
   */
  emptyBrightness: number;
  /**
   * Cells with HSV saturation below this are Garbage (gray). Default 0.20.
   */
  garbageSaturation: number;
  /** Colour palette — determines the default hue centres. */
  palette: ColorPalette;
  /**
   * Maximum hue distance (degrees) to the nearest piece centre for the pixel
   * to be classified as that piece. Pixels beyond this distance from ALL piece
   * centres are classified as Garbage. Default 90° (≈ always matches closest).
   */
  hueTolerance: number;
  /**
   * Per-piece hue centre overrides (degrees, 0–360).
   * Keys are CellType numeric values. Missing keys use the palette default.
   */
  pieceHues: Partial<Record<number, number>>;
}

export const DEFAULT_THRESHOLDS: ClassifyThresholds = {
  emptyBrightness: 0.25,
  garbageSaturation: 0.20,
  palette: 'srs',
  hueTolerance: 90,
  pieceHues: {},
};

// ── Hue helper ────────────────────────────────────────────────────────────────

/** Circular distance between two hue values (0–360°). Result is 0–180. */
function hueDist(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

// ── Classification ────────────────────────────────────────────────────────────

/**
 * Classify a hue value using the closest piece-centre algorithm.
 * If the best match exceeds `hueTolerance`, returns Garbage.
 */
function hueToCell(h: number, t: ClassifyThresholds): CellType {
  const defaults = getDefaultHues(t.palette);
  let bestCell: CellType = CellType.Garbage;
  let bestDist = Infinity;
  for (const cellType of PIECE_CELL_TYPES) {
    const center = t.pieceHues[cellType] ?? defaults[cellType] ?? 0;
    const dist = hueDist(h, center);
    if (dist < bestDist) { bestDist = dist; bestCell = cellType; }
  }
  return bestDist <= t.hueTolerance ? bestCell : CellType.Garbage;
}

export function cellTypeFromRgb(
  r: number, g: number, b: number,
  t: ClassifyThresholds = DEFAULT_THRESHOLDS,
): CellType {
  const [h, s, v] = rgbToHsv(r, g, b);
  if (v < t.emptyBrightness)   return CellType.Empty;
  if (s < t.garbageSaturation) return CellType.Garbage;
  return hueToCell(h, t);
}

/**
 * Classify a board-region ImageData into a 2-D cell grid.
 * Returns `cells[displayRow][col]` where displayRow 0 is the top of the board.
 */
export function classifyBoard(
  imageData: ImageData,
  cols = BOARD_COLS,
  rows = BOARD_ROWS,
  thresholds: ClassifyThresholds = DEFAULT_THRESHOLDS,
): CellType[][] {
  const { data, width, height } = imageData;
  const cw = width  / cols;
  const ch = height / rows;
  return Array.from({ length: rows }, (_, row) =>
    Array.from({ length: cols }, (_, col) => {
      const [r, g, b] = sampleRegionAvg(data, width, col * cw, row * ch, cw, ch);
      return cellTypeFromRgb(r, g, b, thresholds);
    }),
  );
}
