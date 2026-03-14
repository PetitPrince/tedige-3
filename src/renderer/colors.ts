import { CellType } from '../types/board';
import { PieceType } from '../types/piece';

export interface SkinConfig {
  cellFill: Record<CellType, string>;
  cellHighlight: Record<CellType, string>;
  cellShadow: Record<CellType, string>;
  /** If present, cells are drawn with a top-to-bottom gradient (fill → gradientBottom). */
  cellGradientBottom?: Record<CellType, string>;
  emptyFill: string;
  backgroundColor: string;
  /** Slightly darker background used for hold / next-queue preview areas. */
  previewBackgroundColor: string;
  gridColor: string;
  ghostFill: string;
  /** If present, draws a border around the perimeter of the locked cell stack (ARS/TGM style). */
  stackBorderColor?: string;
  /** When 'nes', drawCell renders a flat fill + white inner border instead of the bevel. */
  blockStyle?: 'nes';
}

// Guideline colours
const GUIDELINE_FILL: Record<CellType, string> = {
  [CellType.Empty]:   '#000000',
  [CellType.I]:       '#00bcd4',
  [CellType.O]:       '#f9a825',
  [CellType.T]:       '#9c27b0',
  [CellType.S]:       '#4caf50',
  [CellType.Z]:       '#f44336',
  [CellType.J]:       '#1565c0',
  [CellType.L]:       '#ff6d00',
  [CellType.Garbage]: '#607d8b',
};

function highlight(hex: string): string {
  // mix with white at 35%
  const r = parseInt(hex.slice(1,3), 16);
  const g = parseInt(hex.slice(3,5), 16);
  const b = parseInt(hex.slice(5,7), 16);
  const mix = (v: number) => Math.round(v + (255 - v) * 0.35).toString(16).padStart(2, '0');
  return `#${mix(r)}${mix(g)}${mix(b)}`;
}

function shadow(hex: string): string {
  // darken by 40%
  const r = parseInt(hex.slice(1,3), 16);
  const g = parseInt(hex.slice(3,5), 16);
  const b = parseInt(hex.slice(5,7), 16);
  const dark = (v: number) => Math.round(v * 0.6).toString(16).padStart(2, '0');
  return `#${dark(r)}${dark(g)}${dark(b)}`;
}

function darkenBy(hex: string, factor: number): string {
  const r = parseInt(hex.slice(1,3), 16);
  const g = parseInt(hex.slice(3,5), 16);
  const b = parseInt(hex.slice(5,7), 16);
  const d = (v: number) => Math.round(v * (1 - factor)).toString(16).padStart(2, '0');
  return `#${d(r)}${d(g)}${d(b)}`;
}

function buildSkin(fills: Record<CellType, string>, gradientFactor = 0): SkinConfig {
  const cellHighlight = {} as Record<CellType, string>;
  const cellShadow    = {} as Record<CellType, string>;
  for (const key of Object.keys(fills)) {
    const k = Number(key) as CellType;
    cellHighlight[k] = highlight(fills[k]);
    cellShadow[k]    = shadow(fills[k]);
  }
  const skin: SkinConfig = {
    cellFill: fills,
    cellHighlight,
    cellShadow,
    emptyFill: '#121214',
    backgroundColor: '#0e0e10',
    previewBackgroundColor: '#080809',
    gridColor: '#1e1e20',
    ghostFill: '#ffffff',
  };
  if (gradientFactor > 0) {
    const cellGradientBottom = {} as Record<CellType, string>;
    for (const key of Object.keys(fills)) {
      const k = Number(key) as CellType;
      cellGradientBottom[k] = darkenBy(fills[k], gradientFactor);
    }
    skin.cellGradientBottom = cellGradientBottom;
  }
  return skin;
}

export const GUIDELINE_SKIN: SkinConfig = buildSkin(GUIDELINE_FILL);

// Classic (TGM-ish) colours
const CLASSIC_FILL: Record<CellType, string> = {
  [CellType.Empty]:   '#000000',
  [CellType.I]:       '#ff0000',
  [CellType.O]:       '#f0d000',
  [CellType.T]:       '#00c0c0',
  [CellType.S]:       '#a000c0',
  [CellType.Z]:       '#00a000',
  [CellType.J]:       '#0060f0',
  [CellType.L]:       '#f08000',
  [CellType.Garbage]: '#808080',
};

// gradientFactor 0.72 → bottom is ~28% of original brightness, matching TGM's dark gradient
export const CLASSIC_SKIN: SkinConfig = {
  ...buildSkin(CLASSIC_FILL, 0.72),
  stackBorderColor: '#ffffff',
};

// NES Tetris Level 0 colors — flat fill with white inner border
const NES_FILL: Record<CellType, string> = {
  [CellType.Empty]:   '#000000',
  [CellType.I]:       '#6060ff',
  [CellType.O]:       '#60d0ff',
  [CellType.T]:       '#b000b0',
  [CellType.S]:       '#ff6000',
  [CellType.Z]:       '#0000b0',
  [CellType.J]:       '#f0f000',
  [CellType.L]:       '#c00000',
  [CellType.Garbage]: '#808080',
};

export const NES_SKIN: SkinConfig = {
  ...buildSkin(NES_FILL, 0),
  blockStyle: 'nes',
  emptyFill: '#000000',
  backgroundColor: '#000000',
  previewBackgroundColor: '#000000',
  gridColor: '#222222',
  ghostFill: '#ffffff',
};

export const SKINS: Record<string, SkinConfig> = {
  guideline: GUIDELINE_SKIN,
  classic:   CLASSIC_SKIN,
  nes:       NES_SKIN,
};

export const DEFAULT_SKIN = GUIDELINE_SKIN;

// Map PieceType to CellType (they're offset by 1)
export function pieceTypeToCellType(t: PieceType): CellType {
  return (t + 1) as CellType;
}
