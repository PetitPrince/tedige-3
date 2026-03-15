import type { Diagram, InputId, InputCategory, InputState } from '../types/frame';
import { LF_DEFAULT_MS, ALL_INPUT_CATEGORIES } from '../types/frame';
import type { RenderConfig } from '../renderer/board-renderer';
import {
  renderBoard, DEFAULT_RENDER_CONFIG, drawCommentOverlay, drawCallouts, drawClearingRows,
  renderPiecePreview, drawCell,
} from '../renderer/board-renderer';
import type { SkinConfig } from '../renderer/colors';
import { pieceTypeToCellType } from '../renderer/colors';
import type { RotationSystem } from '../types/rotation-system';
import { getRotationSystem } from '../rotation/index';
import { BOARD_COLS, BOARD_ROWS } from '../types/board';
import type { PieceType } from '../types/piece';

const STRIP_ROWS = 3;        // next-queue strip height in cells, matches PlayerView
const SECOND_START_COLS = 7; // secondary pieces start col, matches PlayerView

export interface GIFExportOptions {
  cellSize?: number;
  delay?: number;             // ms per frame (overrides diagram setting)
  loops?: number;             // 0 = infinite
  showGhost?: boolean;
  finalFrameHoldMs?: number;  // extra hold on last frame
  skin?: SkinConfig;
  onProgress?: (ratio: number) => void;
}

// ── Panel drawing helpers ─────────────────────────────────────────────────────

function drawNextHorizontal(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, W: number, H: number,
  queue: (PieceType | null)[],
  cellSize: number,
  rotSys: RotationSystem,
  skin: SkinConfig,
): void {
  ctx.fillStyle = skin.previewBackgroundColor;
  ctx.fillRect(x, y, W, H);

  const sm = Math.max(5, Math.floor(cellSize / 4));
  const secondX = x + SECOND_START_COLS * cellSize;
  const slotW   = 4 * sm;
  const halfH   = H / 2;
  const firstZoneLeft = x + Math.floor((BOARD_COLS - 4) / 2) * cellSize;

  const zoneLabelSize  = Math.max(8, Math.round(sm * 0.85));
  const zoneStroke     = 'rgba(120,120,140,0.25)';
  const zoneLabelColor = 'rgba(160,160,180,0.55)';
  ctx.font = `700 ${zoneLabelSize}px system-ui, sans-serif`;
  ctx.textBaseline = 'top';

  // First slot outline
  ctx.strokeStyle = zoneStroke;
  ctx.lineWidth = 1;
  ctx.strokeRect(firstZoneLeft + 0.5, y + 0.5, secondX - firstZoneLeft - 1, H - 1);
  ctx.fillStyle = zoneLabelColor;
  ctx.textAlign = 'left';
  ctx.fillText('NEXT', firstZoneLeft + 3, y + 2);

  // Secondary slots: bottom row (1,2), top row (3,4,5)
  for (let col = 0; col < 2; col++) {
    const slot = 1 + col;
    if (slot >= queue.length) break;
    const zx = secondX + col * slotW;
    ctx.strokeStyle = zoneStroke; ctx.lineWidth = 1;
    ctx.strokeRect(zx + 0.5, y + halfH + 0.5, slotW - 1, halfH - 1);
    ctx.fillStyle = zoneLabelColor; ctx.textAlign = 'left';
    ctx.fillText(String(slot + 1), zx + 3, y + halfH + 2);
  }
  for (let col = 0; col < 3; col++) {
    const slot = 3 + col;
    if (slot >= queue.length) break;
    const zx = secondX + col * slotW;
    ctx.strokeStyle = zoneStroke; ctx.lineWidth = 1;
    ctx.strokeRect(zx + 0.5, y + 0.5, slotW - 1, halfH - 1);
    ctx.fillStyle = zoneLabelColor; ctx.textAlign = 'left';
    ctx.fillText(String(slot + 1), zx + 3, y + 2);
  }

  if (queue.length === 0) return;

  // First piece: full cellSize, centered, bottom-aligned in strip
  if (queue[0] !== null) {
    const shape    = rotSys.getShape(queue[0], 0);
    const minDC    = Math.min(...shape.map(m => m.deltaCol));
    const minDR    = Math.min(...shape.map(m => m.deltaRow));
    const maxDC    = Math.max(...shape.map(m => m.deltaCol));
    const maxDR    = Math.max(...shape.map(m => m.deltaRow));
    const bboxW    = maxDC - minDC + 1;
    const bboxH    = maxDR - minDR + 1;
    const xOff     = x + Math.floor((BOARD_COLS - bboxW) / 2) * cellSize;
    const yOff     = y + (STRIP_ROWS - bboxH) * cellSize;
    const cellType = pieceTypeToCellType(queue[0]);
    for (const { deltaCol, deltaRow } of shape) {
      drawCell(ctx, xOff + (deltaCol - minDC) * cellSize, yOff + (deltaRow - minDR) * cellSize, cellType, cellSize, skin);
    }
  }

  // Pieces 2–6: small size, 2-row grid
  for (let i = 1; i < queue.length; i++) {
    if (queue[i] === null) continue;
    const slotIsBottom = i <= 2;
    const slotCol = slotIsBottom ? i - 1 : i - 3;
    const px = secondX + slotCol * slotW;
    const py = y + (slotIsBottom ? halfH : 0);
    const type     = queue[i];
    const shape    = rotSys.getShape(type, 0);
    const cellType = pieceTypeToCellType(type);
    const minDC    = Math.min(...shape.map(m => m.deltaCol));
    const maxDC    = Math.max(...shape.map(m => m.deltaCol));
    const minDR    = Math.min(...shape.map(m => m.deltaRow));
    const maxDR    = Math.max(...shape.map(m => m.deltaRow));
    const bboxW    = maxDC - minDC + 1;
    const bboxH    = maxDR - minDR + 1;
    const xOff     = Math.floor((4 - bboxW) / 2) * sm;
    const yOff     = Math.floor((halfH / sm - bboxH) / 2) * sm;
    for (const { deltaCol, deltaRow } of shape) {
      drawCell(ctx, px + xOff + (deltaCol - minDC) * sm, py + yOff + (deltaRow - minDR) * sm, cellType, sm, skin);
    }
  }
}

type BtnInfo = { id: InputId; label: string; col: number; row: number };

function getInputDisplayWidth(hiddenCategories: InputCategory[], btnSize: number): number {
  const gap = Math.max(1, Math.round(btnSize * 0.09));
  const groupGap = gap * 4;
  const { dpad, actions } = getVisibleBtns(hiddenCategories);
  const dpadW   = dpad.length   > 0 ? 3 * btnSize + 2 * gap : 0;
  const actCols = Math.min(4, actions.length);
  const actW    = actCols > 0 ? actCols * btnSize + (actCols - 1) * gap : 0;
  const sep     = dpad.length > 0 && actions.length > 0 ? groupGap : 0;
  return dpadW + sep + actW;
}

function getVisibleBtns(hiddenCategories: InputCategory[]): { dpad: BtnInfo[]; actions: BtnInfo[] } {
  const hidden = new Set(hiddenCategories);
  const dpad: BtnInfo[] = [];
  if (!hidden.has('dir')) {
    dpad.push(
      { id: 'up',    label: '↑', col: 1, row: 0 },
      { id: 'left',  label: '←', col: 0, row: 1 },
      { id: 'right', label: '→', col: 2, row: 1 },
      { id: 'down',  label: '↓', col: 1, row: 2 },
    );
  }

  const ALL_ACTIONS: { id: InputId; label: string; cat: InputCategory }[] = [
    { id: 'ccw',    label: '↺',  cat: 'ccw' },
    { id: 'cw',     label: '↻',  cat: 'cw' },
    { id: 'ccw2',   label: '↺2', cat: 'ccw2' },
    { id: 'rewind', label: '⏮',  cat: 'rewind' },
    { id: 'hold',   label: 'H',  cat: 'hold' },
    { id: 'cw2',    label: '↻2', cat: 'cw2' },
    { id: 'extra',  label: 'E',  cat: 'extra' },
  ];

  const actions: BtnInfo[] = [];
  let col = 0, row = 0;
  for (const { id, label, cat } of ALL_ACTIONS) {
    if (hidden.has(cat)) continue;
    actions.push({ id, label, col, row });
    col++;
    if (col >= 4) { col = 0; row++; }
  }
  return { dpad, actions };
}

function drawInputs(
  ctx: CanvasRenderingContext2D,
  x: number, y: number,
  inputs: Partial<Record<InputId, InputState>>,
  hiddenCategories: InputCategory[],
  btnSize: number,
): void {
  const gap = Math.max(1, Math.round(btnSize * 0.09));
  const groupGap = gap * 4;
  const { dpad, actions } = getVisibleBtns(hiddenCategories);

  const normalBg     = '#232330';
  const normalBorder = '#3a3a55';
  const normalText   = '#888898';
  const pressedBg     = '#44446a';
  const pressedBorder = '#9999ee';
  const pressedText   = '#ffffff';
  const holdBg     = '#5a3a10';
  const holdBorder = '#cc8833';
  const holdText   = '#ffcc66';

  const fontSize = Math.max(8, Math.round(btnSize * 0.5));
  ctx.font = `${fontSize}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  function drawBtn(bx: number, by: number, label: string, state: InputState | undefined) {
    const bg     = state === 'pressed' ? pressedBg     : state === 'hold' ? holdBg     : normalBg;
    const border = state === 'pressed' ? pressedBorder : state === 'hold' ? holdBorder : normalBorder;
    const text   = state === 'pressed' ? pressedText   : state === 'hold' ? holdText   : normalText;
    const r = Math.max(2, Math.round(btnSize * 0.15));
    ctx.fillStyle = bg;
    ctx.beginPath();
    (ctx as unknown as { roundRect: (x: number, y: number, w: number, h: number, r: number) => void })
      .roundRect(bx, by, btnSize, btnSize, r);
    ctx.fill();
    ctx.strokeStyle = border;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = text;
    ctx.fillText(label, bx + btnSize / 2, by + btnSize / 2);
  }

  const cell = btnSize + gap;
  let cursorX = x;

  if (dpad.length > 0) {
    for (const { id, label, col, row } of dpad) {
      drawBtn(cursorX + col * cell, y + row * cell, label, inputs[id]);
    }
    cursorX += 3 * cell + groupGap;
  }

  if (actions.length > 0) {
    for (const { id, label, col, row } of actions) {
      drawBtn(cursorX + col * cell, y + row * cell, label, inputs[id]);
    }
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function exportGIF(
  diagram: Diagram,
  opts: GIFExportOptions = {},
): Promise<Blob> {
  const {
    cellSize = 24,
    delay = diagram.animationDelayMs,
    loops = 0,
    showGhost = true,
    finalFrameHoldMs = 1000,
    skin = DEFAULT_RENDER_CONFIG.skin,
    onProgress,
  } = opts;

  const { GIFEncoder, quantize, applyPalette } = await import('gifenc');

  const rotSys  = getRotationSystem(diagram.rotationSystem);
  const boardW  = BOARD_COLS * cellSize;
  const boardH  = BOARD_ROWS * cellSize;
  const pcs     = Math.max(6, Math.floor(cellSize * 0.65));    // hold preview cell size
  const holdGap = Math.round(cellSize * 0.15);                  // gap between hold and board

  const config: RenderConfig = {
    ...DEFAULT_RENDER_CONFIG,
    skin,
    cellSize,
    showGrid: false,
    ghostAlpha: showGhost ? 0.3 : 0,
  };

  // Determine which side panels to include
  const showNext  = diagram.frames.some(f => f.nextQueue.length > 0);
  const showHold  = diagram.frames.some(f => f.holdPiece !== undefined);
  const hiddenCategories = diagram.hiddenInputs ?? [];
  const hasVisibleInputCategories = ALL_INPUT_CATEGORIES.some(c => !hiddenCategories.includes(c));
  const showInputs = hasVisibleInputCategories &&
    diagram.frames.some(f => f.inputs && Object.keys(f.inputs).length > 0);

  // Sizes
  const nextH    = showNext ? STRIP_ROWS * cellSize : 0;
  const holdW    = showHold ? 4 * pcs + holdGap : 0;
  const btnSize  = Math.max(14, Math.round(cellSize * 0.65));
  const btnGap   = Math.max(1, Math.round(btnSize * 0.09));
  const inputPadY = Math.max(3, Math.round(btnSize * 0.2));
  let inputH = 0;
  if (showInputs) {
    const dpadH    = !hiddenCategories.includes('dir') ? 3 * btnSize + 2 * btnGap : 0;
    const hasOther = ALL_INPUT_CATEGORIES.some(c => c !== 'dir' && !hiddenCategories.includes(c));
    const actionsH = hasOther ? 2 * btnSize + btnGap : 0;
    inputH = Math.max(dpadH, actionsH) + inputPadY;
  }

  // Center input display horizontally within the board column
  const inputDisplayW = showInputs ? getInputDisplayWidth(hiddenCategories, btnSize) : 0;
  const inputX = holdW + Math.round((boardW - inputDisplayW) / 2);

  const W = holdW + boardW;
  const H = nextH + boardH + inputH;

  const offscreen = new OffscreenCanvas(W, H);
  const ctx = offscreen.getContext('2d')!;
  const c = ctx as unknown as CanvasRenderingContext2D;

  const gif = GIFEncoder();

  for (let idx = 0; idx < diagram.frames.length; idx++) {
    const frame = diagram.frames[idx];
    ctx.clearRect(0, 0, W, H);

    // Background
    ctx.fillStyle = skin.backgroundColor;
    ctx.fillRect(0, 0, W, H);

    // Hold panel
    if (showHold) {
      ctx.fillStyle = skin.previewBackgroundColor;
      ctx.fillRect(0, nextH, holdW - holdGap, boardH);
      if (frame.holdPiece !== undefined) {
        renderPiecePreview(c, 0, nextH, frame.holdPiece, rotSys, pcs, 4, 2, false, skin);
      }
    }

    // Next strip
    if (showNext) {
      const queue = frame.nextQueue.slice(0, diagram.nextQueueLength ?? 6);
      drawNextHorizontal(c, holdW, 0, boardW, nextH, queue, cellSize, rotSys, skin);
    }

    // Board (translated so (0,0) aligns with hold+next offset)
    ctx.save();
    ctx.translate(holdW, nextH);
    renderBoard(c, frame.board, frame.activePiece, rotSys, config,
      frame.showGhost && showGhost, frame.lockDelayProgress ?? 0, frame.overlays,
      frame.lockFlash ? 1 : 0);
    if (frame.clearingRows?.length) {
      drawClearingRows(c, frame.clearingRows, cellSize, boardW);
    }
    if (frame.callouts?.length) {
      drawCallouts(c, frame.callouts, cellSize, boardW, boardH);
    }
    if (frame.comment) {
      drawCommentOverlay(c, frame.comment, boardW, boardH, cellSize);
    }
    ctx.restore();

    // Input display — always rendered on every frame when visible, centered in the board column
    if (showInputs) {
      drawInputs(c, inputX, nextH + boardH + inputPadY, frame.inputs ?? {}, hiddenCategories, btnSize);
    }

    const imageData = ctx.getImageData(0, 0, W, H);
    const pixels    = imageData.data;
    const palette   = quantize(pixels, 256, { format: 'rgb565' });
    const indexed   = applyPalette(pixels, palette);

    const isLast = idx === diagram.frames.length - 1;
    const frameDurationMs = isLast ? finalFrameHoldMs : frame.lockFlash ? LF_DEFAULT_MS : frame.durationMs ?? delay;
    const frameDelay = Math.round(frameDurationMs / 10);

    gif.writeFrame(indexed, W, H, {
      palette,
      delay: frameDelay,
      repeat: loops,
      dispose: 2,
    });

    onProgress?.((idx + 1) / diagram.frames.length);
  }

  gif.finish();
  const bytes = gif.bytes();
  const ab = new ArrayBuffer(bytes.length);
  new Uint8Array(ab).set(bytes);
  return new Blob([ab], { type: 'image/gif' });
}

export function downloadGIF(blob: Blob, filename = 'tedige.gif'): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
