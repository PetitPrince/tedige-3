import type { Frame } from '../types/frame';
import type { RotationSystem } from '../types/rotation-system';
import type { RenderConfig } from '../renderer/board-renderer';
import type { SkinConfig } from '../renderer/colors';
import {
  renderBoard, DEFAULT_RENDER_CONFIG,
  drawCommentOverlay, drawCallouts, drawClearingRows,
  drawCell, renderPiecePreview,
} from '../renderer/board-renderer';
import { pieceTypeToCellType } from '../renderer/colors';
import { BOARD_COLS, BOARD_ROWS } from '../types/board';
import type { PieceType } from '../types/piece';

// Must match NextQueue.svelte constants
const STRIP_ROWS       = 3;
const SECOND_START_COLS = 7;
const PANEL_GAP        = 6;

type Ctx = CanvasRenderingContext2D;

const ZONE_STROKE = 'rgba(120,120,140,0.25)';
const ZONE_LABEL  = 'rgba(160,160,180,0.55)';

/**
 * Draw the hold panel: "HOLD" legend above a piece preview.
 * (x, y) is the top-left of the whole block (label + piece).
 */
function drawHoldPanel(
  ctx: Ctx,
  piece: PieceType | null | undefined,
  rotSys: RotationSystem,
  skin: SkinConfig,
  x: number, y: number,
  pcs: number,
  labelFontSize: number,
): void {
  const GAP     = 3;
  const pieceY  = y + labelFontSize + GAP;
  const holdW   = 4 * pcs;
  const holdH   = 2 * pcs;

  // Legend
  ctx.fillStyle    = ZONE_LABEL;
  ctx.font         = `700 ${labelFontSize}px system-ui, sans-serif`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('HOLD', x + holdW / 2, y);

  // Background
  ctx.fillStyle = skin.previewBackgroundColor;
  ctx.fillRect(x, pieceY, holdW, holdH);

  // Piece
  if (piece != null) {
    ctx.save();
    ctx.translate(x, pieceY);
    renderPiecePreview(ctx, 0, 0, piece, rotSys, pcs, 4, 2, false, skin);
    ctx.restore();
  }
}

function drawNextHorizontal(
  ctx: Ctx,
  queue: (PieceType | null)[],
  rotSys: RotationSystem,
  skin: SkinConfig,
  x: number, y: number,
  cellSize: number,
): void {
  const sm = Math.max(5, Math.floor(cellSize / 4));
  const W  = BOARD_COLS * cellSize;
  const H  = STRIP_ROWS * cellSize;

  ctx.fillStyle = skin.previewBackgroundColor;
  ctx.fillRect(x, y, W, H);

  const secondX       = x + SECOND_START_COLS * cellSize;
  const firstZoneLeft = x + Math.floor((BOARD_COLS - 4) / 2) * cellSize;
  const slotW         = 4 * sm;
  const halfH         = H / 2;

  const labelFontSize  = Math.max(8, Math.round(sm * 0.85));
  ctx.font = `700 ${labelFontSize}px system-ui, sans-serif`;
  ctx.textBaseline = 'top';

  // First slot zone
  ctx.strokeStyle = ZONE_STROKE; ctx.lineWidth = 1;
  ctx.strokeRect(firstZoneLeft + 0.5, y + 0.5, secondX - firstZoneLeft - 1, H - 1);
  ctx.fillStyle = ZONE_LABEL; ctx.textAlign = 'left';
  ctx.fillText('NEXT', firstZoneLeft + 3, y + 2);

  // Secondary zones: bottom row (slots 1–2), top row (slots 3–5)
  for (let col = 0; col < 2; col++) {
    const slot = 1 + col;
    if (slot >= queue.length) break;
    const zx = secondX + col * slotW;
    ctx.strokeStyle = ZONE_STROKE; ctx.lineWidth = 1;
    ctx.strokeRect(zx + 0.5, y + halfH + 0.5, slotW - 1, halfH - 1);
    ctx.fillStyle = ZONE_LABEL; ctx.textAlign = 'left';
    ctx.fillText(String(slot + 1), zx + 3, y + halfH + 2);
  }
  for (let col = 0; col < 3; col++) {
    const slot = 3 + col;
    if (slot >= queue.length) break;
    const zx = secondX + col * slotW;
    ctx.strokeStyle = ZONE_STROKE; ctx.lineWidth = 1;
    ctx.strokeRect(zx + 0.5, y + 0.5, slotW - 1, halfH - 1);
    ctx.fillStyle = ZONE_LABEL; ctx.textAlign = 'left';
    ctx.fillText(String(slot + 1), zx + 3, y + 2);
  }

  if (queue.length === 0) return;

  // First piece at full cellSize, centered, bottom-aligned in strip
  if (queue[0] !== null) {
    const shape  = rotSys.getShape(queue[0], 0);
    const minDC  = Math.min(...shape.map(m => m.deltaCol));
    const maxDC  = Math.max(...shape.map(m => m.deltaCol));
    const minDR  = Math.min(...shape.map(m => m.deltaRow));
    const maxDR  = Math.max(...shape.map(m => m.deltaRow));
    const bboxW  = maxDC - minDC + 1;
    const bboxH  = maxDR - minDR + 1;
    const xOff   = x + Math.floor((BOARD_COLS - bboxW) / 2) * cellSize;
    const yOff   = y + (STRIP_ROWS - bboxH) * cellSize;
    const ctype  = pieceTypeToCellType(queue[0]);
    for (const { deltaCol, deltaRow } of shape) {
      drawCell(ctx, xOff + (deltaCol - minDC) * cellSize, yOff + (deltaRow - minDR) * cellSize, ctype, cellSize, skin);
    }
  }

  // Pieces 2–6 at smaller size, 2-row grid
  for (let i = 1; i < queue.length; i++) {
    if (queue[i] === null) continue;
    const slotIsBottom = i <= 2;
    const slotCol = slotIsBottom ? i - 1 : i - 3;
    const sx = secondX + slotCol * slotW;
    const sy = y + (slotIsBottom ? halfH : 0);

    const shape  = rotSys.getShape(queue[i]!, 0);
    const ctype  = pieceTypeToCellType(queue[i]!);
    const minDC  = Math.min(...shape.map(m => m.deltaCol));
    const maxDC  = Math.max(...shape.map(m => m.deltaCol));
    const minDR  = Math.min(...shape.map(m => m.deltaRow));
    const maxDR  = Math.max(...shape.map(m => m.deltaRow));
    const bboxW  = maxDC - minDC + 1;
    const bboxH  = maxDR - minDR + 1;
    const xOff   = Math.floor((4 - bboxW) / 2) * sm;
    const yOff   = Math.floor((halfH / sm - bboxH) / 2) * sm;
    for (const { deltaCol, deltaRow } of shape) {
      drawCell(ctx, sx + xOff + (deltaCol - minDC) * sm, sy + yOff + (deltaRow - minDR) * sm, ctype, sm, skin);
    }
  }
}

function drawNextVertical(
  ctx: Ctx,
  queue: (PieceType | null)[],
  rotSys: RotationSystem,
  skin: SkinConfig,
  x: number, y: number,
  sm_v: number, slotH_v: number,
): void {
  const panelW = 5 * sm_v;
  const panelH = queue.length * slotH_v;

  ctx.fillStyle = skin.previewBackgroundColor;
  ctx.fillRect(x, y, panelW, panelH);

  const labelFontSize  = Math.max(7, Math.round(sm_v * 0.5));
  ctx.font = `700 ${labelFontSize}px system-ui, sans-serif`;
  ctx.textBaseline = 'top';

  for (let i = 0; i < queue.length; i++) {
    const zy = y + i * slotH_v;
    ctx.strokeStyle = ZONE_STROKE; ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, zy + 0.5, panelW - 1, slotH_v - 1);
    ctx.fillStyle = ZONE_LABEL; ctx.textAlign = 'left';
    ctx.fillText(i === 0 ? 'NEXT' : String(i + 1), x + 3, zy + 2);

    if (queue[i] === null) continue;
    const type   = queue[i]!;
    const shape  = rotSys.getShape(type, 0);
    const ctype  = pieceTypeToCellType(type);
    const minDC  = Math.min(...shape.map(m => m.deltaCol));
    const maxDC  = Math.max(...shape.map(m => m.deltaCol));
    const minDR  = Math.min(...shape.map(m => m.deltaRow));
    const maxDR  = Math.max(...shape.map(m => m.deltaRow));
    const bboxW  = maxDC - minDC + 1;
    const bboxH  = maxDR - minDR + 1;
    const xOff   = Math.floor((5 - bboxW) / 2) * sm_v;
    const yOff   = Math.floor((3 - bboxH) / 2) * sm_v;
    for (const { deltaCol, deltaRow } of shape) {
      drawCell(ctx, x + xOff + (deltaCol - minDC) * sm_v, zy + yOff + (deltaRow - minDR) * sm_v, ctype, sm_v, skin);
    }
  }
}

export async function downloadPNG(
  frame: Frame,
  rotSys: RotationSystem,
  config: RenderConfig = DEFAULT_RENDER_CONFIG,
  nextQueueLayout: 'horizontal' | 'vertical' = 'horizontal',
  nextQueueLength = 6,
  filename = 'tedige.png',
): Promise<void> {
  const { cellSize, skin } = config;
  const pcs     = Math.max(6, Math.floor(cellSize * 0.65));
  const sm      = Math.max(5, Math.floor(cellSize / 4));  // for horizontal next labels
  const sm_v    = Math.max(6, Math.floor(cellSize / 2));  // for vertical next labels
  const slotH_v = 3 * sm_v;
  const boardW  = BOARD_COLS * cellSize;
  const boardH  = BOARD_ROWS * cellSize;
  const holdW   = 4 * pcs;
  const holdH   = 2 * pcs;
  const queue   = frame.nextQueue.slice(0, nextQueueLength);

  let totalW: number, totalH: number;
  let boardX: number, boardY: number;
  let holdX: number, holdY: number;
  let holdLabelFontSize: number;
  let nextX: number, nextY: number;

  if (nextQueueLayout === 'vertical') {
    // Hold: top-left, top aligned with board top (y = 0)
    // Board: to the right of hold
    // Next: to the right of board (if any pieces)
    const labelGap       = 3;
    holdLabelFontSize    = Math.max(7, Math.round(sm_v * 0.5));
    const holdBlockH     = holdLabelFontSize + labelGap + holdH;
    const hasNext        = queue.length > 0;
    const nextW          = hasNext ? 5 * sm_v + PANEL_GAP : 0;
    totalW  = holdW + PANEL_GAP + boardW + nextW;
    totalH  = boardH;
    holdX   = 0;
    holdY   = 0;   // top of hold block aligned with board top
    boardX  = holdW + PANEL_GAP;
    boardY  = 0;
    nextX   = boardX + boardW + PANEL_GAP;
    nextY   = 0;
    void holdBlockH; // used implicitly via holdY=0 + drawHoldPanel
  } else {
    // Horizontal: canvas is exactly boardW wide.
    // Hold lives in the left margin of the next strip (firstZoneLeft = 3*cellSize of space).
    const firstZoneLeft  = Math.floor((BOARD_COLS - 4) / 2) * cellSize;  // = 3*cellSize
    const labelGap       = 3;
    holdLabelFontSize    = Math.max(8, Math.round(sm * 0.85));
    const holdBlockH     = holdLabelFontSize + labelGap + holdH;
    const nextH          = STRIP_ROWS * cellSize;
    totalW  = boardW;
    totalH  = nextH + boardH;
    // Center hold block horizontally in [0, firstZoneLeft] and vertically in [0, nextH]
    holdX   = Math.round((firstZoneLeft - holdW) / 2);
    holdY   = Math.round((nextH - holdBlockH) / 2);
    boardX  = 0;
    boardY  = nextH;
    nextX   = 0;
    nextY   = 0;
  }

  const offscreen = new OffscreenCanvas(totalW, totalH);
  const ctx = offscreen.getContext('2d')! as unknown as Ctx;

  // Board
  ctx.save();
  ctx.translate(boardX, boardY);
  renderBoard(ctx, frame.board, frame.activePiece, rotSys, config,
    frame.showGhost, frame.lockDelayProgress ?? 0, frame.overlays, frame.lockFlash ? 1 : 0);
  if (frame.clearingRows?.length) drawClearingRows(ctx, frame.clearingRows, cellSize, boardW);
  if (frame.comment) drawCommentOverlay(ctx, frame.comment, boardW, boardH, cellSize);
  if (frame.callouts?.length) drawCallouts(ctx, frame.callouts, cellSize, boardW, boardH);
  ctx.restore();

  // Next queue (drawn before hold so hold appears on top in horizontal layout)
  if (nextQueueLayout === 'vertical') {
    if (queue.length > 0) drawNextVertical(ctx, queue, rotSys, skin, nextX, nextY, sm_v, slotH_v);
  } else {
    drawNextHorizontal(ctx, queue, rotSys, skin, nextX, nextY, cellSize);
  }

  // Hold panel
  drawHoldPanel(ctx, frame.holdPiece, rotSys, skin, holdX, holdY, pcs, holdLabelFontSize);

  const blob = await offscreen.convertToBlob({ type: 'image/png' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
