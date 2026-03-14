import { BOARD_COLS, BOARD_ROWS, CellType, getCell } from '../types/board';
import type { Callout, InputId, InputCategory, InputState, OverlayCell } from '../types/frame';
import type { Board } from '../types/board';
import { PieceType } from '../types/piece';
import type { ActivePiece, Rotation } from '../types/piece';
import type { RotationSystem } from '../types/rotation-system';
import type { SkinConfig } from './colors';
import { DEFAULT_SKIN, pieceTypeToCellType } from './colors';
import { computeGhost } from '../engine/ghost';

export interface RenderConfig {
  cellSize: number;
  gridLineWidth: number;
  ghostAlpha: number;
  showGrid: boolean;
  skin: SkinConfig;
}

export const DEFAULT_RENDER_CONFIG: RenderConfig = {
  cellSize: 32,
  gridLineWidth: 1,
  ghostAlpha: 0.3,
  showGrid: true,
  skin: DEFAULT_SKIN,
};

/**
 * Draw a single cell at display coordinates (left-top pixel offset x, y).
 * Renders with a simple bevel shading: top+left edges lighter, bottom+right darker.
 */
export function drawCell(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  type: CellType,
  size: number,
  skin: SkinConfig,
): void {
  // NES block style: flat fill + chevron highlight matching actual NES tile pattern:
  //   W C C C C C C     (0,0) single corner pixel
  //   C W W C C C C     (1,1)..(1,2) two pixels
  //   C W C C C C C     (2,1) one pixel
  if (skin.blockStyle === 'nes') {
    ctx.fillStyle = skin.cellFill[type];
    ctx.fillRect(x, y, size, size);
    const pixelUnit = Math.max(1, Math.round(size / 8));
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x,         y,         pixelUnit,     pixelUnit); // (0,0) corner
    ctx.fillRect(x + pixelUnit,     y + pixelUnit,     pixelUnit * 2, pixelUnit); // (1,1)..(1,2)
    ctx.fillRect(x + pixelUnit,     y + pixelUnit * 2, pixelUnit,     pixelUnit); // (2,1)
    return;
  }

  const pad = Math.max(1, Math.floor(size / 12));
  const gradBottom = skin.cellGradientBottom?.[type];

  function makeFill(top: number, height: number): string | CanvasGradient {
    if (!gradBottom) return skin.cellFill[type];
    const g = ctx.createLinearGradient(0, top, 0, top + height);
    g.addColorStop(0, skin.cellFill[type]);
    g.addColorStop(1, gradBottom);
    return g;
  }

  // Base fill
  ctx.fillStyle = makeFill(y, size);
  ctx.fillRect(x, y, size, size);

  // Top highlight
  ctx.fillStyle = skin.cellHighlight[type];
  ctx.fillRect(x, y, size, pad);
  ctx.fillRect(x, y, pad, size);

  // Bottom-right shadow
  ctx.fillStyle = skin.cellShadow[type];
  ctx.fillRect(x, y + size - pad, size, pad);
  ctx.fillRect(x + size - pad, y, pad, size);

  // Inner fill (slightly inset to show bevel)
  ctx.fillStyle = makeFill(y + pad, size - pad * 2);
  ctx.fillRect(x + pad, y + pad, size - pad * 2, size - pad * 2);
}

function drawGhostCell(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  type: CellType,
  size: number,
  skin: SkinConfig,
  alpha: number,
): void {
  const pad = Math.max(1, Math.floor(size / 12));
  ctx.globalAlpha = alpha;
  // Ghost: just a thin outline in the piece colour
  ctx.strokeStyle = skin.cellFill[type];
  ctx.lineWidth = pad;
  ctx.strokeRect(x + pad, y + pad, size - pad * 2, size - pad * 2);
  ctx.globalAlpha = 1;
}

/**
 * Convert game row (0=floor, positive=up) to display Y.
 * Display Y=0 is top-left. Row BOARD_ROWS-1 = top visible row.
 */
export function gameRowToDisplayY(gameRow: number, cellSize: number): number {
  return (BOARD_ROWS - 1 - gameRow) * cellSize;
}

/** Iterate over piece minos, computing display coordinates, handling big-mode expansion. */
function forEachMino(
  piece: ActivePiece,
  shape: import('../types/piece').PieceShape,
  big: boolean,
  cellSize: number,
  cb: (x: number, y: number, size: number) => void,
): void {
  if (big) {
    for (const { deltaCol, deltaRow } of shape) {
      const col = piece.col + deltaCol * 2;
      const row = piece.row - deltaRow * 2;
      if (row - 1 < 0) continue;
      cb(col * cellSize, gameRowToDisplayY(row, cellSize), cellSize * 2);
    }
  } else {
    for (const { deltaCol, deltaRow } of shape) {
      const col = piece.col + deltaCol;
      const row = piece.row - deltaRow;
      if (row < 0 || row >= BOARD_ROWS) continue;
      cb(col * cellSize, gameRowToDisplayY(row, cellSize), cellSize);
    }
  }
}

/**
 * Render the full board to the canvas context.
 * The canvas is expected to have dimensions: BOARD_COLS*cellSize × BOARD_ROWS*cellSize.
 */
export function renderBoard(
  ctx: CanvasRenderingContext2D,
  board: Board,
  activePiece: ActivePiece | undefined,
  rotSys: RotationSystem,
  config: RenderConfig,
  showGhost = true,
  lockDelayProgress = 0,
  overlays?: OverlayCell[],
  lockFlashAlpha = 0,
): void {
  const { cellSize, showGrid, skin } = config;
  const W = BOARD_COLS * cellSize;
  const H = BOARD_ROWS * cellSize;

  // 1. Background
  ctx.fillStyle = skin.backgroundColor;
  ctx.fillRect(0, 0, W, H);

  // 2. Empty cell fills (subtle grid fill)
  ctx.fillStyle = skin.emptyFill;
  for (let r = 0; r < BOARD_ROWS; r++) {
    for (let c = 0; c < BOARD_COLS; c++) {
      if (getCell(board, c, r) === CellType.Empty) {
        ctx.fillRect(c * cellSize + 1, gameRowToDisplayY(r, cellSize) + 1, cellSize - 2, cellSize - 2);
      }
    }
  }

  // 3. Locked cells (dimmed relative to the active piece)
  ctx.globalAlpha = 0.33;
  for (let r = 0; r < BOARD_ROWS; r++) {
    const cell = (() => {
      for (let c = 0; c < BOARD_COLS; c++) {
        const v = getCell(board, c, r);
        if (v !== CellType.Empty) return { c, v };
      }
      return null;
    });
    for (let c = 0; c < BOARD_COLS; c++) {
      const v = getCell(board, c, r);
      if (v !== CellType.Empty) {
        drawCell(ctx, c * cellSize, gameRowToDisplayY(r, cellSize), v, cellSize, skin);
      }
    }
  }
  ctx.globalAlpha = 1;

  // 4. Ghost piece
  if (activePiece && showGhost && config.ghostAlpha > 0) {
    const ghost = computeGhost(activePiece, board, rotSys);
    const shape = rotSys.getShape(ghost.type, ghost.rotation);
    const cellType = pieceTypeToCellType(ghost.type);
    forEachMino(ghost, shape, !!activePiece.big, cellSize, (x, y, sz) => {
      drawGhostCell(ctx, x, y, cellType, sz, skin, config.ghostAlpha);
    });
  }

  // 5. Active piece (faded when lockDelayProgress > 0)
  if (activePiece) {
    const shape = rotSys.getShape(activePiece.type, activePiece.rotation);
    const cellType = pieceTypeToCellType(activePiece.type);
    if (lockDelayProgress > 0) ctx.globalAlpha = 1 - lockDelayProgress * 0.75;
    forEachMino(activePiece, shape, !!activePiece.big, cellSize, (x, y, sz) => {
      drawCell(ctx, x, y, cellType, sz, skin);
    });
    ctx.globalAlpha = 1;
  }

  // 6. Overlay cells (above active piece)
  if (overlays?.length) {
    const overlaySet = new Set(overlays.filter(o => o.row >= 0 && o.row < BOARD_ROWS && o.col >= 0 && o.col < BOARD_COLS).map(o => `${o.col},${o.row}`));
    for (const { col, row, color, emoji, blockType } of overlays) {
      if (row < 0 || row >= BOARD_ROWS || col < 0 || col >= BOARD_COLS) continue;
      const x = col * cellSize;
      const y = gameRowToDisplayY(row, cellSize);
      if (blockType != null) {
        drawCell(ctx, x, y, blockType as CellType, cellSize, skin);
      } else if (emoji) {
        ctx.globalAlpha = 1;
        const fontSize = Math.round(cellSize * 0.72);
        ctx.font = `${fontSize}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(emoji, x + cellSize / 2, y + cellSize / 2);
      } else {
        ctx.globalAlpha = 0.45;
        ctx.fillStyle = color;
        ctx.fillRect(x, y, cellSize, cellSize);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        // External edges at full stroke alpha; internal (shared) edges at fill alpha so they blend in
        const edges = [
          { key: `${col},${row + 1}`, x1: x + 0.75,          y1: y + 0.75,          x2: x + cellSize - 0.75, y2: y + 0.75          }, // top
          { key: `${col},${row - 1}`, x1: x + 0.75,          y1: y + cellSize - 0.75, x2: x + cellSize - 0.75, y2: y + cellSize - 0.75 }, // bottom
          { key: `${col - 1},${row}`, x1: x + 0.75,          y1: y + 0.75,          x2: x + 0.75,            y2: y + cellSize - 0.75 }, // left
          { key: `${col + 1},${row}`, x1: x + cellSize - 0.75, y1: y + 0.75,        x2: x + cellSize - 0.75, y2: y + cellSize - 0.75 }, // right
        ];
        for (const { key, x1, y1, x2, y2 } of edges) {
          ctx.globalAlpha = overlaySet.has(key) ? 0.45 : 0.75;
          ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
    }
  }

  // 6b. Lock-flash overlay: white tint on active piece cells
  if (lockFlashAlpha > 0 && activePiece) {
    const shape = rotSys.getShape(activePiece.type, activePiece.rotation);
    ctx.fillStyle = 'white';
    ctx.globalAlpha = lockFlashAlpha;
    forEachMino(activePiece, shape, !!activePiece.big, cellSize, (x, y, sz) => {
      ctx.fillRect(x, y, sz, sz);
    });
    ctx.globalAlpha = 1;
  }

  // 7. Grid lines
  if (showGrid) {
    ctx.strokeStyle = skin.gridColor;
    ctx.lineWidth = config.gridLineWidth;
    ctx.beginPath();
    for (let c = 0; c <= BOARD_COLS; c++) {
      ctx.moveTo(c * cellSize, 0);
      ctx.lineTo(c * cellSize, H);
    }
    for (let r = 0; r <= BOARD_ROWS; r++) {
      ctx.moveTo(0, r * cellSize);
      ctx.lineTo(W, r * cellSize);
    }
    ctx.stroke();
  }

  // 8. Stack border (ARS/TGM style — white perimeter outline around locked cells)
  if (skin.stackBorderColor) {
    const hasBlock = (c: number, r: number): boolean => {
      if (c < 0 || c >= BOARD_COLS || r < 0 || r >= BOARD_ROWS) return false;
      return getCell(board, c, r) !== CellType.Empty;
    };
    ctx.strokeStyle = skin.stackBorderColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let r = 0; r < BOARD_ROWS; r++) {
      for (let c = 0; c < BOARD_COLS; c++) {
        if (!hasBlock(c, r)) continue;
        const x = c * cellSize;
        const y = gameRowToDisplayY(r, cellSize);
        // Top edge (neighbour above in game coords = r+1 = smaller display Y)
        if (!hasBlock(c, r + 1)) { ctx.moveTo(x, y);              ctx.lineTo(x + cellSize, y); }
        // Bottom edge (neighbour below = r-1 = larger display Y)
        if (!hasBlock(c, r - 1)) { ctx.moveTo(x, y + cellSize);   ctx.lineTo(x + cellSize, y + cellSize); }
        // Left edge
        if (!hasBlock(c - 1, r)) { ctx.moveTo(x, y);              ctx.lineTo(x, y + cellSize); }
        // Right edge
        if (!hasBlock(c + 1, r)) { ctx.moveTo(x + cellSize, y);   ctx.lineTo(x + cellSize, y + cellSize); }
      }
    }
    ctx.stroke();
  }
}

/**
 * Draw a dashed bounding-box rectangle representing the rotation matrix of the
 * active piece. The box size is derived by taking the union of all 4 rotation
 * states and making it square, giving the standard 4×4 (I) or 3×3 / 2×2 box.
 * The position mirrors PieceRotationsPopover's getColOffset/offR logic so the
 * piece sits at the same relative position within the box as in the popover.
 * Call this after renderBoard so it appears on top of everything.
 */
export function drawBoundingBox(
  ctx: CanvasRenderingContext2D,
  piece: ActivePiece,
  rotSys: RotationSystem,
  cellSize: number,
): void {
  const { type, rotation } = piece;
  const GRID = 4;

  // Current rotation state's mino bounds
  const curShape = rotSys.getShape(type, rotation);
  let minDeltaCol = Infinity, maxDeltaCol = -Infinity, minDeltaRow = Infinity, maxDeltaRow = -Infinity;
  for (const { deltaCol, deltaRow } of curShape) {
    if (deltaCol < minDeltaCol) minDeltaCol = deltaCol; if (deltaCol > maxDeltaCol) maxDeltaCol = deltaCol;
    if (deltaRow < minDeltaRow) minDeltaRow = deltaRow; if (deltaRow > maxDeltaRow) maxDeltaRow = deltaRow;
  }
  const bboxW = maxDeltaCol - minDeltaCol + 1;
  const bboxH = maxDeltaRow - minDeltaRow + 1;

  // Column offset of minos within the rotation grid — mirrors getColOffset() in PieceRotationsPopover
  let offC: number;
  if (type === PieceType.I && (rotation === 1 || rotation === 3)) {
    offC = 2;
  } else if (rotation === 1 && type !== PieceType.I && type !== PieceType.O) {
    offC = 0;
  } else if (rotation === 3 && (type === PieceType.S || type === PieceType.Z)) {
    offC = 0;
  } else {
    offC = Math.floor((GRID - bboxW) / 2);
  }
  // Row offset: always centred in the 4-row grid
  const offR = Math.floor((GRID - bboxH) / 2);

  // Box top-left in game coordinates.
  // Derivation: in the popover, mino (deltaCol, deltaRow) sits at grid cell
  //   (offC + deltaCol − minDeltaCol,  offR + deltaRow − minDeltaRow).
  // Inverting for grid cell (0, 0):
  //   deltaCol = minDeltaCol − offC   →  board col      = piece.col + minDeltaCol − offC
  //   deltaRow = minDeltaRow − offR   →  board game row = piece.row − (minDeltaRow − offR)
  const boxCol     = piece.col + minDeltaCol - offC;
  const boxGameRow = piece.row - minDeltaRow + offR;

  // Box size: union of all 4 rotation states, kept square → 4×4 (I) or 3×3
  // O piece is a special case: its union gives 2×2 but we want a 4×4 box centred on it
  let maxOff = 0;
  for (let r = 0; r < 4; r++) {
    const shape = rotSys.getShape(type, r as Rotation);
    for (const { deltaCol, deltaRow } of shape) {
      if (deltaCol > maxOff) maxOff = deltaCol;
      if (deltaRow > maxOff) maxOff = deltaRow;
    }
  }
  const size = (type === PieceType.O ? GRID : maxOff + 1) * cellSize;

  const left = boxCol * cellSize;
  const top  = gameRowToDisplayY(boxGameRow, cellSize);

  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  ctx.strokeRect(left + 0.5, top + 0.5, size - 1, size - 1);
  ctx.restore();
}

/**
 * Draw white flash overlays over rows that are in the line-clear animation state.
 */
export function drawClearingRows(
  ctx: CanvasRenderingContext2D,
  clearingRows: number[],
  cellSize: number,
  W: number,
): void {
  if (!clearingRows.length) return;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
  for (const r of clearingRows) {
    if (r < 0 || r >= BOARD_ROWS) continue;
    ctx.fillRect(0, gameRowToDisplayY(r, cellSize), W, cellSize);
  }
}

/**
 * Draw a comment/caption overlay at the bottom of the canvas.
 * Renders a semi-transparent bar with white centred text.
 */
export function drawCommentOverlay(
  ctx: CanvasRenderingContext2D,
  comment: string,
  W: number,
  H: number,
  cellSize: number,
): void {
  if (!comment) return;
  const fontSize = Math.max(12, Math.floor(cellSize * 0.45));
  const pad = Math.max(4, Math.floor(cellSize * 0.15));
  const boxH = fontSize + pad * 2;
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(0, H - boxH, W, boxH);
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold ${fontSize}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText(comment, W / 2, H - pad, W - pad * 2);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

// ── Callout (speech bubble) rendering ─────────────────────────────────────────

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

export interface CalloutLayout {
  bubbleX: number;
  bubbleY: number;
  tailTipX: number;
  tailTipY: number;
  tailBaseX: number;
  tailBaseY: number;
  radius: number;
}

/**
 * Pure positioning function — no canvas context required.
 * Computes bubble top-left and tail geometry for any direction.
 */
export function computeCalloutLayout(
  callout: Callout,
  bubbleW: number,
  bubbleH: number,
  cellSize: number,
  W: number,
  H: number,
): CalloutLayout {
  const tailH = Math.max(6, cellSize * 0.22);
  const radius = Math.min(6, bubbleH / 3);
  const dir = callout.dir ?? 'top';

  const cellCX   = callout.col * cellSize + cellSize / 2;
  const cellCY   = (BOARD_ROWS - 1 - callout.row) * cellSize + cellSize / 2;
  const cellTopY = (BOARD_ROWS - 1 - callout.row) * cellSize;
  const cellBotY = cellTopY + cellSize;
  const cellLeftX  = callout.col * cellSize;
  const cellRightX = (callout.col + 1) * cellSize;

  let bubbleX: number, bubbleY: number;
  let tailTipX: number, tailTipY: number;
  let tailBaseX: number, tailBaseY: number;

  if (dir === 'top') {
    bubbleX  = Math.max(2, Math.min(cellCX - bubbleW / 2, W - bubbleW - 2));
    bubbleY  = Math.max(2, Math.min(cellTopY - tailH - bubbleH, H - bubbleH - 2));
    tailTipX = cellCX;
    tailTipY = cellTopY;
    tailBaseX = Math.max(bubbleX + radius + 5, Math.min(cellCX, bubbleX + bubbleW - radius - 5));
    tailBaseY = bubbleY + bubbleH;

  } else if (dir === 'bottom') {
    bubbleX  = Math.max(2, Math.min(cellCX - bubbleW / 2, W - bubbleW - 2));
    bubbleY  = Math.max(2, Math.min(cellBotY + tailH, H - bubbleH - 2));
    tailTipX = cellCX;
    tailTipY = cellBotY;
    tailBaseX = Math.max(bubbleX + radius + 5, Math.min(cellCX, bubbleX + bubbleW - radius - 5));
    tailBaseY = bubbleY;

  } else if (dir === 'left') {
    bubbleX  = Math.max(2, Math.min(cellLeftX - tailH - bubbleW, W - bubbleW - 2));
    bubbleY  = Math.max(2, Math.min(cellCY - bubbleH / 2, H - bubbleH - 2));
    tailTipX = cellLeftX;
    tailTipY = cellCY;
    tailBaseX = bubbleX + bubbleW;
    tailBaseY = Math.max(bubbleY + radius + 5, Math.min(cellCY, bubbleY + bubbleH - radius - 5));

  } else if (dir === 'right') {
    bubbleX  = Math.max(2, Math.min(cellRightX + tailH, W - bubbleW - 2));
    bubbleY  = Math.max(2, Math.min(cellCY - bubbleH / 2, H - bubbleH - 2));
    tailTipX = cellRightX;
    tailTipY = cellCY;
    tailBaseX = bubbleX;
    tailBaseY = Math.max(bubbleY + radius + 5, Math.min(cellCY, bubbleY + bubbleH - radius - 5));

  } else { // 'free'
    bubbleX  = Math.max(2, Math.min((callout.freeX ?? 0) * W, W - bubbleW - 2));
    bubbleY  = Math.max(2, Math.min((callout.freeY ?? 0) * H, H - bubbleH - 2));
    tailTipX = cellCX;
    tailTipY = cellCY;
    // Find exit point on bubble edge along the bubble-center → cell-center line
    const bCX = bubbleX + bubbleW / 2;
    const bCY = bubbleY + bubbleH / 2;
    const dx = tailTipX - bCX;
    const dy = tailTipY - bCY;
    if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) {
      tailBaseX = bCX; tailBaseY = bubbleY + bubbleH;
    } else if (Math.abs(dx) * bubbleH > Math.abs(dy) * bubbleW) {
      // Exits left or right edge
      tailBaseX = bCX + Math.sign(dx) * bubbleW / 2;
      tailBaseY = Math.max(bubbleY, Math.min(bCY + dy * (bubbleW / 2) / Math.abs(dx), bubbleY + bubbleH));
    } else {
      // Exits top or bottom edge
      tailBaseY = bCY + Math.sign(dy) * bubbleH / 2;
      tailBaseX = Math.max(bubbleX, Math.min(bCX + dx * (bubbleH / 2) / Math.abs(dy), bubbleX + bubbleW));
    }
  }

  return { bubbleX, bubbleY, tailTipX, tailTipY, tailBaseX, tailBaseY, radius };
}

/**
 * Returns the bounding box of the rendered bubble (for hit testing).
 * Returns null if the callout has no text.
 */
export function getCalloutBubbleBounds(
  callout: Callout,
  ctx: CanvasRenderingContext2D,
  cellSize: number,
  W: number,
  H: number,
): { x: number; y: number; w: number; h: number } | null {
  if (!callout.text) return null;
  const fontSize = Math.max(11, Math.floor(cellSize * 0.38));
  const lineH = Math.ceil(fontSize * 1.3);
  ctx.font = `bold ${fontSize}px sans-serif`;
  const lines = callout.text.split('\n');
  const textW = Math.max(...lines.map(l => ctx.measureText(l).width));
  const padX = Math.max(6, cellSize * 0.2);
  const padY = Math.max(4, cellSize * 0.14);
  const bubbleW = textW + padX * 2;
  const bubbleH = lines.length * lineH + padY * 2;
  const { bubbleX, bubbleY } = computeCalloutLayout(callout, bubbleW, bubbleH, cellSize, W, H);
  return { x: bubbleX, y: bubbleY, w: bubbleW, h: bubbleH };
}

/**
 * Draw speech bubble callout overlays on the board canvas.
 */
export function drawCallouts(
  ctx: CanvasRenderingContext2D,
  callouts: Callout[],
  cellSize: number,
  W: number,
  H: number,
): void {
  const fontSize = Math.max(11, Math.floor(cellSize * 0.38));
  const lineH = Math.ceil(fontSize * 1.3);
  ctx.font = `bold ${fontSize}px sans-serif`;

  for (const callout of callouts) {
    if (!callout.text) continue;

    const lines = callout.text.split('\n');
    const textW = Math.max(...lines.map(l => ctx.measureText(l).width));
    const padX = Math.max(6, cellSize * 0.2);
    const padY = Math.max(4, cellSize * 0.14);
    const bubbleW = textW + padX * 2;
    const bubbleH = lines.length * lineH + padY * 2;

    const layout = computeCalloutLayout(callout, bubbleW, bubbleH, cellSize, W, H);
    const { bubbleX, bubbleY, tailTipX, tailTipY, tailBaseX, tailBaseY, radius } = layout;

    // Generic perpendicular tail triangle
    const tdx = tailBaseX - tailTipX;
    const tdy = tailBaseY - tailTipY;
    const tlen = Math.sqrt(tdx * tdx + tdy * tdy) || 1;
    const px = (-tdy / tlen) * 5;
    const py = (tdx / tlen) * 5;

    // Shadow + bubble fill
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 4;
    ctx.shadowOffsetX = 1;
    ctx.shadowOffsetY = 2;
    ctx.fillStyle = 'rgba(255,255,255,0.97)';
    roundedRect(ctx, bubbleX, bubbleY, bubbleW, bubbleH, radius);
    ctx.fill();
    ctx.restore();

    // Tail (drawn after shadow so it doesn't cast its own shadow edge)
    ctx.fillStyle = 'rgba(255,255,255,0.97)';
    ctx.beginPath();
    ctx.moveTo(tailBaseX + px, tailBaseY + py);
    ctx.lineTo(tailBaseX - px, tailBaseY - py);
    ctx.lineTo(tailTipX, tailTipY);
    ctx.closePath();
    ctx.fill();

    // Border
    ctx.strokeStyle = 'rgba(0,0,0,0.15)';
    ctx.lineWidth = 1;
    roundedRect(ctx, bubbleX, bubbleY, bubbleW, bubbleH, radius);
    ctx.stroke();

    // Text lines
    ctx.fillStyle = '#1a1a1c';
    ctx.font = `bold ${fontSize}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const cx = bubbleX + bubbleW / 2;
    const textStartY = bubbleY + padY + lineH / 2;
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], cx, textStartY + i * lineH, bubbleW - padX * 2);
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }
}

/**
 * Render a piece preview (for next queue or hold display).
 * Renders the piece centred in a bounding box of `previewCells` × `previewCells` cells.
 */
export function renderPiecePreview(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  type: import('../types/piece').PieceType | undefined,
  rotSys: RotationSystem,
  previewCellSize: number,
  previewCols = 4,
  previewRows = 2,
  faded = false,
  skin: SkinConfig = DEFAULT_SKIN,
): void {
  if (type === undefined) return;

  const shape = rotSys.getShape(type, 0);
  const cellType = pieceTypeToCellType(type);

  // Compute bounding box of the shape
  let minDeltaCol = Infinity, maxDeltaCol = -Infinity, minDeltaRow = Infinity, maxDeltaRow = -Infinity;
  for (const { deltaCol, deltaRow } of shape) {
    minDeltaCol = Math.min(minDeltaCol, deltaCol); maxDeltaCol = Math.max(maxDeltaCol, deltaCol);
    minDeltaRow = Math.min(minDeltaRow, deltaRow); maxDeltaRow = Math.max(maxDeltaRow, deltaRow);
  }
  const bboxW = maxDeltaCol - minDeltaCol + 1;
  const bboxH = maxDeltaRow - minDeltaRow + 1;

  // Centre in preview area
  const offsetX = Math.floor((previewCols - bboxW) / 2) * previewCellSize;
  const offsetY = Math.floor((previewRows - bboxH) / 2) * previewCellSize;

  if (faded) ctx.globalAlpha = 0.4;

  for (const { deltaCol, deltaRow } of shape) {
    const px = x + offsetX + (deltaCol - minDeltaCol) * previewCellSize;
    const py = y + offsetY + (deltaRow - minDeltaRow) * previewCellSize;
    drawCell(ctx, px, py, cellType, previewCellSize, skin);
  }

  ctx.globalAlpha = 1;
}

/**
 * Draw the input overlay in the bottom-right corner of the board.
 * Only drawn when inputs is non-empty.
 * hiddenCategories controls which input groups are omitted.
 */
export function drawInputOverlay(
  ctx: CanvasRenderingContext2D,
  inputs: Partial<Record<InputId, InputState>>,
  hiddenCategories: InputCategory[],
  cellSize: number,
  W: number,
  H: number,
): void {
  if (!Object.keys(inputs).length) return;

  const hidden = new Set(hiddenCategories);

  const showDir    = !hidden.has('dir');
  const showCcw    = !hidden.has('ccw');
  const showCw     = !hidden.has('cw');
  const showCcw2   = !hidden.has('ccw2');
  const showRewind = !hidden.has('rewind');
  const showCw2    = !hidden.has('cw2');
  const showHold   = !hidden.has('hold');
  const showExtra  = !hidden.has('extra');

  const ib  = Math.min(20, Math.max(10, Math.round(cellSize * 0.5)));
  const gap = Math.max(1, Math.round(ib * 0.12));
  const pad = Math.round(ib * 0.45);

  // Row 1: CCW, CW, CCW2, Rewind  |  Row 2: Hold, CW2, Extra
  // Build in TGM4 order; layoutCols = 4 when rewind is included, else 2
  const actionBtns: { id: InputId; label: string }[] = [];
  if (showCcw)    actionBtns.push({ id: 'ccw',    label: '↺' });
  if (showCw)     actionBtns.push({ id: 'cw',     label: '↻' });
  if (showCcw2)   actionBtns.push({ id: 'ccw2',   label: '↺²' });
  if (showRewind) actionBtns.push({ id: 'rewind', label: '⏮' });
  if (showHold)   actionBtns.push({ id: 'hold',   label: 'H' });
  if (showCw2)    actionBtns.push({ id: 'cw2',    label: '↻²' });
  if (showExtra)  actionBtns.push({ id: 'extra',  label: 'E' });

  const hasRewindBtn = showRewind && actionBtns.some(b => b.id === 'rewind');
  const actionCols = actionBtns.length > 0
    ? (actionBtns.length <= 2 ? 1 : hasRewindBtn ? 4 : 2)
    : 0;
  const actionRows = actionCols > 0 ? Math.ceil(actionBtns.length / actionCols) : 0;
  const dpadW      = showDir ? 3 * ib + 2 * gap : 0;
  const actionW    = actionCols > 0 ? actionCols * ib + (actionCols - 1) * gap : 0;
  const innerSep   = (dpadW > 0 && actionW > 0) ? pad : 0;
  const totalW     = pad + dpadW + innerSep + actionW + pad;
  const rows       = Math.max(showDir ? 3 : 0, actionRows > 0 ? actionRows + 1 : 0);
  const totalH     = pad + rows * ib + Math.max(0, rows - 1) * gap + pad;

  if (totalW <= pad * 2 || rows === 0) return;

  const ox = W - totalW;
  const oy = H - totalH;

  ctx.save();
  ctx.globalAlpha = 0.82;
  ctx.fillStyle = '#080808';
  roundedRect(ctx, ox, oy, totalW, totalH, 4);
  ctx.fill();
  ctx.globalAlpha = 1;

  const fontSize = Math.max(6, Math.round(ib * 0.52));

  function drawBtn(bx: number, by: number, id: InputId, label: string) {
    const s = inputs[id];
    const bg    = s === 'hold' ? '#7a4400' : s === 'pressed' ? '#2a2a70' : '#141416';
    const bord  = s === 'hold' ? '#cc8800' : s === 'pressed' ? '#6868cc' : '#242428';
    const color = s === 'hold' ? '#ffcc44' : s === 'pressed' ? '#c0c0f0' : '#505058';
    ctx.fillStyle = bg;
    roundedRect(ctx, bx, by, ib, ib, 2);
    ctx.fill();
    ctx.strokeStyle = bord;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.font = `bold ${fontSize}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, bx + ib / 2, by + ib / 2);
  }

  const cx = ox + pad;
  const cy = oy + pad;

  if (showDir) {
    const dpadCells: [number, number, InputId, string][] = [
      [1, 0, 'up',    '↑'],
      [0, 1, 'left',  '←'],
      [2, 1, 'right', '→'],
      [1, 2, 'down',  '↓'],
    ];
    ctx.fillStyle = '#101012';
    roundedRect(ctx, cx + ib + gap, cy + ib + gap, ib, ib, 2);
    ctx.fill();
    for (const [deltaCol, deltaRow, id, label] of dpadCells) {
      drawBtn(cx + deltaCol * (ib + gap), cy + deltaRow * (ib + gap), id, label);
    }
  }

  if (actionBtns.length > 0) {
    const ax = cx + dpadW + innerSep;
    for (let i = 0; i < actionBtns.length; i++) {
      const col = i % actionCols;
      const row = Math.floor(i / actionCols);
      drawBtn(ax + col * (ib + gap), cy + (row + 1) * (ib + gap), actionBtns[i].id, actionBtns[i].label);
    }
  }

  ctx.restore();
}
