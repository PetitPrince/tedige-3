import type { Frame, Callout } from '../types/frame';
import type { RotationSystem } from '../types/rotation-system';
import type { SkinConfig } from '../renderer/colors';
import { DEFAULT_SKIN, pieceTypeToCellType } from '../renderer/colors';
import { computeCalloutLayout } from '../renderer/board-renderer';
import { BOARD_COLS, BOARD_ROWS, CellType, getCell } from '../types/board';
import { computeGhost } from '../engine/ghost';

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Emit <defs> with one <linearGradient> per non-empty cell type, if the skin has gradients.
 * Uses objectBoundingBox so the gradient scales to each rect's own height.
 */
function buildGradientDefs(skin: SkinConfig): string {
  if (!skin.cellGradientBottom) return '';
  const lines: string[] = ['<defs>'];
  for (const key of Object.keys(skin.cellFill)) {
    const k = Number(key) as CellType;
    if (k === CellType.Empty) continue;
    const top = skin.cellFill[k];
    const bot = skin.cellGradientBottom[k];
    lines.push(
      `<linearGradient id="cg${k}" x1="0" y1="0" x2="0" y2="1" gradientUnits="objectBoundingBox">`,
      `<stop offset="0" stop-color="${top}"/>`,
      `<stop offset="1" stop-color="${bot}"/>`,
      `</linearGradient>`,
    );
  }
  lines.push('</defs>');
  return lines.join('\n');
}

/**
 * Emit SVG rects for one board cell, matching the bevel shading of drawCell() in board-renderer.ts.
 * Draws: base fill → top/left highlight → bottom/right shadow → inner fill.
 */
function svgCell(
  x: number,
  y: number,
  size: number,
  type: CellType,
  skin: SkinConfig,
): string[] {
  const pad = Math.max(1, Math.floor(size / 12));
  const hasGrad = !!skin.cellGradientBottom;
  const fill  = hasGrad ? `url(#cg${type})` : skin.cellFill[type];
  const hi    = skin.cellHighlight[type];
  const sh    = skin.cellShadow[type];

  return [
    // Base fill
    `<rect x="${x}" y="${y}" width="${size}" height="${size}" fill="${fill}"/>`,
    // Top highlight strip
    `<rect x="${x}" y="${y}" width="${size}" height="${pad}" fill="${hi}"/>`,
    // Left highlight strip
    `<rect x="${x}" y="${y}" width="${pad}" height="${size}" fill="${hi}"/>`,
    // Bottom shadow strip
    `<rect x="${x}" y="${y + size - pad}" width="${size}" height="${pad}" fill="${sh}"/>`,
    // Right shadow strip
    `<rect x="${x + size - pad}" y="${y}" width="${pad}" height="${size}" fill="${sh}"/>`,
    // Inner fill (inset, gives bevel depth)
    `<rect x="${x + pad}" y="${y + pad}" width="${size - pad * 2}" height="${size - pad * 2}" fill="${fill}"/>`,
  ];
}

function svgCallout(callout: Callout, cellSize: number, W: number, H: number): string[] {
  const fontSize = Math.max(11, Math.floor(cellSize * 0.38));
  const lineH = Math.ceil(fontSize * 1.3);
  const lines = callout.text.split('\n');
  // Approximate text width (SVG has no measureText): ~0.6 * fontSize per char
  const textW = Math.max(...lines.map(l => l.length)) * (fontSize * 0.6);
  const padX = Math.max(6, cellSize * 0.2);
  const padY = Math.max(4, cellSize * 0.14);
  const bubbleW = textW + padX * 2;
  const bubbleH = lines.length * lineH + padY * 2;

  const layout = computeCalloutLayout(callout, bubbleW, bubbleH, cellSize, W, H);
  const { bubbleX, bubbleY, tailTipX, tailTipY, tailBaseX, tailBaseY, radius } = layout;

  // Generic perpendicular tail
  const tdx = tailBaseX - tailTipX;
  const tdy = tailBaseY - tailTipY;
  const tlen = Math.sqrt(tdx * tdx + tdy * tdy) || 1;
  const px = (-tdy / tlen) * 5;
  const py = (tdx / tlen) * 5;

  const elements: string[] = [];

  // Tail
  elements.push(`<polygon points="${tailBaseX + px},${tailBaseY + py} ${tailBaseX - px},${tailBaseY - py} ${tailTipX},${tailTipY}" fill="white" fill-opacity="0.97"/>`);

  // Bubble
  elements.push(`<rect x="${bubbleX}" y="${bubbleY}" width="${bubbleW}" height="${bubbleH}" rx="${radius}" fill="white" fill-opacity="0.97" stroke="black" stroke-opacity="0.15" stroke-width="1"/>`);

  // Text — one <tspan> per line
  const cx = bubbleX + bubbleW / 2;
  const textStartY = bubbleY + padY + lineH / 2;
  const tspans = lines.map((line, i) =>
    `<tspan x="${cx}" y="${textStartY + i * lineH}">${escapeXml(line)}</tspan>`,
  ).join('');
  elements.push(`<text text-anchor="middle" dominant-baseline="central" font-size="${fontSize}" font-weight="bold" font-family="sans-serif" fill="#1a1a2e">${tspans}</text>`);

  return elements;
}

export function generateSVG(
  frame: Frame,
  rotSys: RotationSystem,
  cellSize = 32,
  skin: SkinConfig = DEFAULT_SKIN,
): string {
  const W = BOARD_COLS * cellSize;
  const H = BOARD_ROWS * cellSize;
  const els: string[] = [];

  // Gradient defs (for skins that use them, e.g. Classic)
  const defs = buildGradientDefs(skin);
  if (defs) els.push(defs);

  // Background
  els.push(`<rect width="${W}" height="${H}" fill="${skin.backgroundColor}"/>`);

  // Empty cell fills
  for (let r = 0; r < BOARD_ROWS; r++) {
    for (let c = 0; c < BOARD_COLS; c++) {
      if (getCell(frame.board, c, r) !== CellType.Empty) continue;
      const x = c * cellSize + 1;
      const y = (BOARD_ROWS - 1 - r) * cellSize + 1;
      els.push(`<rect x="${x}" y="${y}" width="${cellSize - 2}" height="${cellSize - 2}" fill="${skin.emptyFill}"/>`);
    }
  }

  // Locked board cells (with bevel, dimmed to match canvas renderer's globalAlpha = 0.33)
  const stackEls: string[] = [];
  for (let r = 0; r < BOARD_ROWS; r++) {
    for (let c = 0; c < BOARD_COLS; c++) {
      const v = getCell(frame.board, c, r);
      if (v === CellType.Empty) continue;
      const x = c * cellSize;
      const y = (BOARD_ROWS - 1 - r) * cellSize;
      stackEls.push(...svgCell(x, y, cellSize, v, skin));
    }
  }
  if (stackEls.length > 0) {
    els.push(`<g opacity="0.33">${stackEls.join('')}</g>`);
  }

  // Ghost piece (outline only)
  if (frame.activePiece && frame.showGhost) {
    const ghost = computeGhost(frame.activePiece, frame.board, rotSys);
    const shape = rotSys.getShape(ghost.type, ghost.rotation);
    const ghostColor = skin.cellFill[pieceTypeToCellType(ghost.type)];
    const pad = Math.max(1, Math.floor(cellSize / 12));
    for (const { deltaCol, deltaRow } of shape) {
      const ghostCol = ghost.col + deltaCol;
      const ghostRow = ghost.row - deltaRow;
      if (ghostRow < 0 || ghostRow >= BOARD_ROWS) continue;
      const x = ghostCol * cellSize;
      const y = (BOARD_ROWS - 1 - ghostRow) * cellSize;
      els.push(`<rect x="${x + pad}" y="${y + pad}" width="${cellSize - pad * 2}" height="${cellSize - pad * 2}" fill="none" stroke="${ghostColor}" stroke-width="${pad}" opacity="0.35"/>`);
    }
  }

  // Active piece (with bevel; faded when lockDelayProgress > 0)
  if (frame.activePiece) {
    const shape = rotSys.getShape(frame.activePiece.type, frame.activePiece.rotation);
    const cellType = pieceTypeToCellType(frame.activePiece.type);
    const ldp = frame.lockDelayProgress ?? 0;
    const opacity = ldp > 0 ? (1 - ldp * 0.75).toFixed(3) : '1';
    const cellEls: string[] = [];
    for (const { deltaCol, deltaRow } of shape) {
      const minoCol = frame.activePiece.col + deltaCol;
      const minoRow = frame.activePiece.row - deltaRow;
      if (minoRow < 0 || minoRow >= BOARD_ROWS) continue;
      const x = minoCol * cellSize;
      const y = (BOARD_ROWS - 1 - minoRow) * cellSize;
      cellEls.push(...svgCell(x, y, cellSize, cellType, skin));
    }
    if (cellEls.length > 0) {
      els.push(`<g opacity="${opacity}">${cellEls.join('')}</g>`);
    }
  }

  // Stack border (ARS/TGM style)
  if (skin.stackBorderColor) {
    const hasBlock = (c: number, r: number): boolean => {
      if (c < 0 || c >= BOARD_COLS || r < 0 || r >= BOARD_ROWS) return false;
      return getCell(frame.board, c, r) !== CellType.Empty;
    };
    const lines: string[] = [];
    for (let r = 0; r < BOARD_ROWS; r++) {
      for (let c = 0; c < BOARD_COLS; c++) {
        if (!hasBlock(c, r)) continue;
        const x = c * cellSize;
        const y = (BOARD_ROWS - 1 - r) * cellSize;
        if (!hasBlock(c, r + 1)) lines.push(`M${x},${y} L${x + cellSize},${y}`);
        if (!hasBlock(c, r - 1)) lines.push(`M${x},${y + cellSize} L${x + cellSize},${y + cellSize}`);
        if (!hasBlock(c - 1, r)) lines.push(`M${x},${y} L${x},${y + cellSize}`);
        if (!hasBlock(c + 1, r)) lines.push(`M${x + cellSize},${y} L${x + cellSize},${y + cellSize}`);
      }
    }
    if (lines.length > 0) {
      els.push(`<path d="${lines.join(' ')}" stroke="${skin.stackBorderColor}" stroke-width="2" fill="none"/>`);
    }
  }

  // Clearing rows flash overlay
  if (frame.clearingRows?.length) {
    for (const r of frame.clearingRows) {
      if (r < 0 || r >= BOARD_ROWS) continue;
      const y = (BOARD_ROWS - 1 - r) * cellSize;
      els.push(`<rect x="0" y="${y}" width="${W}" height="${cellSize}" fill="white" fill-opacity="0.75"/>`);
    }
  }

  // Comment overlay
  if (frame.comment) {
    const fontSize = Math.max(12, Math.floor(cellSize * 0.45));
    const pad = Math.max(4, Math.floor(cellSize * 0.15));
    const boxH = fontSize + pad * 2;
    els.push(`<rect x="0" y="${H - boxH}" width="${W}" height="${boxH}" fill="black" fill-opacity="0.6"/>`);
    els.push(`<text x="${W / 2}" y="${H - pad}" text-anchor="middle" dominant-baseline="text-after-edge" font-size="${fontSize}" font-weight="bold" font-family="sans-serif" fill="white">${escapeXml(frame.comment)}</text>`);
  }

  // Callouts
  for (const callout of frame.callouts ?? []) {
    if (!callout.text) continue;
    els.push(...svgCallout(callout, cellSize, W, H));
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">\n${els.join('\n')}\n</svg>`;
}

export function downloadSVG(
  frame: Frame,
  rotSys: RotationSystem,
  cellSize = 32,
  skin: SkinConfig = DEFAULT_SKIN,
  filename = 'tedige.svg',
): void {
  const svg = generateSVG(frame, rotSys, cellSize, skin);
  const blob = new Blob([svg], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
