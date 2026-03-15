import type { Diagram } from '../types/frame';
import { LF_DEFAULT_MS } from '../types/frame';
import type { RenderConfig } from '../renderer/board-renderer';
import { renderBoard, DEFAULT_RENDER_CONFIG, drawCommentOverlay, drawCallouts, drawClearingRows } from '../renderer/board-renderer';
import type { SkinConfig } from '../renderer/colors';
import { getRotationSystem } from '../rotation/index';
import { BOARD_COLS, BOARD_ROWS } from '../types/board';

export interface GIFExportOptions {
  cellSize?: number;
  delay?: number;             // ms per frame (overrides diagram setting)
  loops?: number;             // 0 = infinite
  showGhost?: boolean;
  finalFrameHoldMs?: number;  // extra hold on last frame
  skin?: SkinConfig;
  onProgress?: (ratio: number) => void;
}

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

  const rotSys = getRotationSystem(diagram.rotationSystem);
  const W = BOARD_COLS * cellSize;
  const H = BOARD_ROWS * cellSize;

  const config: RenderConfig = {
    ...DEFAULT_RENDER_CONFIG,
    skin,
    cellSize,
    showGrid: false,
    ghostAlpha: showGhost ? 0.3 : 0,
  };

  const offscreen = new OffscreenCanvas(W, H);
  const ctx = offscreen.getContext('2d')!;

  const gif = GIFEncoder();

  for (let idx = 0; idx < diagram.frames.length; idx++) {
    const frame = diagram.frames[idx];
    ctx.clearRect(0, 0, W, H);
    renderBoard(
      ctx as unknown as CanvasRenderingContext2D,
      frame.board,
      frame.activePiece,
      rotSys,
      config,
      frame.showGhost && showGhost,
      frame.lockDelayProgress ?? 0,
      frame.overlays,
      frame.lockFlash ? 1 : 0,
    );
    if (frame.clearingRows?.length) {
      drawClearingRows(ctx as unknown as CanvasRenderingContext2D, frame.clearingRows, cellSize, W);
    }
    if (frame.comment) {
      drawCommentOverlay(ctx as unknown as CanvasRenderingContext2D, frame.comment, W, H, cellSize);
    }
    if (frame.callouts?.length) {
      drawCallouts(ctx as unknown as CanvasRenderingContext2D, frame.callouts, cellSize, W, H);
    }

    const imageData = ctx.getImageData(0, 0, W, H);
    const pixels = imageData.data;

    const palette = quantize(pixels, 256, { format: 'rgb565' });
    const indexed = applyPalette(pixels, palette);

    const isLast = idx === diagram.frames.length - 1;
    // gifenc takes delay in centiseconds (1/100 s).
    // Lock-flash frames use a short fixed duration regardless of the diagram delay.
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
  // Copy into a plain ArrayBuffer to satisfy Blob constructor typing
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
