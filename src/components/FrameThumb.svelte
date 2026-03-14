<script lang="ts">
  import { onMount } from 'svelte';
  import type { Frame } from '../types/frame';
  import type { RotationSystem } from '../types/rotation-system';
  import { BOARD_COLS, BOARD_ROWS, CellType, getCell } from '../types/board';
  import { pieceTypeToCellType } from '../renderer/colors';
  import { renderConfig } from '../editor/store';

  export let frame: Frame;
  export let rotSys: RotationSystem;
  export let selected = false;
  export let index: number;

  const THUMB_COLS = BOARD_COLS;
  const THUMB_ROWS = BOARD_ROWS;
  const CELL = 3; // 3px per cell = 30×60 thumb
  const W = THUMB_COLS * CELL;
  const H = THUMB_ROWS * CELL;

  let canvas: HTMLCanvasElement;
  let ctx: CanvasRenderingContext2D;

  function drawThumb() {
    if (!ctx) return;
    const skin = $renderConfig.skin;
    ctx.fillStyle = skin.backgroundColor;
    ctx.fillRect(0, 0, W, H);

    for (let r = 0; r < THUMB_ROWS; r++) {
      for (let c = 0; c < THUMB_COLS; c++) {
        const v = getCell(frame.board, c, r);
        if (v !== CellType.Empty) {
          ctx.fillStyle = skin.cellFill[v] ?? '#888';
          ctx.fillRect(c * CELL, (THUMB_ROWS - 1 - r) * CELL, CELL, CELL);
        }
      }
    }

    // Draw active piece
    if (frame.activePiece) {
      const shape = rotSys.getShape(frame.activePiece.type, frame.activePiece.rotation);
      const cellType = pieceTypeToCellType(frame.activePiece.type);
      ctx.fillStyle = skin.cellFill[cellType] ?? '#aaa';
      for (const { deltaCol, deltaRow } of shape) {
        const minoCol = frame.activePiece.col + deltaCol;
        const minoRow = frame.activePiece.row - deltaRow;
        if (minoRow < 0 || minoRow >= THUMB_ROWS) continue;
        ctx.fillRect(minoCol * CELL, (THUMB_ROWS - 1 - minoRow) * CELL, CELL, CELL);
      }
    }
  }

  $: { frame; rotSys; $renderConfig; drawThumb(); }

  onMount(() => {
    ctx = canvas.getContext('2d')!;
    drawThumb();
  });
</script>

<div class="thumb-wrapper" class:selected>
  <div class="index">{index + 1}</div>
  <canvas bind:this={canvas} width={W} height={H}></canvas>
</div>

<style>
  .thumb-wrapper {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: 4px;
    border-radius: var(--r);
    border: 2px solid transparent;
    cursor: pointer;
    transition: border-color 0.1s;
  }
  .thumb-wrapper:hover { border-color: var(--brd-3); }
  .thumb-wrapper.selected { border-color: var(--accent); }

  .index {
    font-size: 10px;
    color: var(--txt-dim);
    line-height: 1;
  }

  canvas { display: block; image-rendering: pixelated; }
</style>
