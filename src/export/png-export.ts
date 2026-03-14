import type { Frame } from '../types/frame';
import type { RotationSystem } from '../types/rotation-system';
import type { RenderConfig } from '../renderer/board-renderer';
import { renderBoard, DEFAULT_RENDER_CONFIG, drawCommentOverlay, drawCallouts, drawClearingRows } from '../renderer/board-renderer';
import { BOARD_COLS, BOARD_ROWS } from '../types/board';

export async function downloadPNG(
  frame: Frame,
  rotSys: RotationSystem,
  config: RenderConfig = DEFAULT_RENDER_CONFIG,
  filename = 'tedige.png',
): Promise<void> {
  const { cellSize } = config;
  const W = BOARD_COLS * cellSize;
  const H = BOARD_ROWS * cellSize;

  const offscreen = new OffscreenCanvas(W, H);
  const ctx = offscreen.getContext('2d')!;
  renderBoard(ctx as unknown as CanvasRenderingContext2D, frame.board, frame.activePiece, rotSys, config, frame.showGhost, frame.lockDelayProgress ?? 0);
  if (frame.clearingRows?.length) {
    drawClearingRows(ctx as unknown as CanvasRenderingContext2D, frame.clearingRows, cellSize, W);
  }
  if (frame.comment) {
    drawCommentOverlay(ctx as unknown as CanvasRenderingContext2D, frame.comment, W, H, cellSize);
  }
  if (frame.callouts?.length) {
    drawCallouts(ctx as unknown as CanvasRenderingContext2D, frame.callouts, cellSize, W, H);
  }

  const blob = await offscreen.convertToBlob({ type: 'image/png' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
