<script lang="ts">
  import { afterUpdate } from 'svelte';
  import { diagram, renderConfig, selectedRotation } from '../editor/store';
  import { spawnActivePiece } from '../editor/actions';
  import { getRotationSystem } from '../rotation/index';
  import { PIECE_NAMES, PieceType } from '../types/piece';
  import type { PieceType as PT, Rotation } from '../types/piece';
  import { drawCell } from '../renderer/board-renderer';
  import { pieceTypeToCellType } from '../renderer/colors';
  import { ARS_BBOX_OFFSET, SRS_BBOX_OFFSET, NES_BBOX_OFFSET } from '../rotation/shapes';

  export let pieceType: PT;
  export let onclose: () => void;


  const MINI_CELL = 10;
  const GRID_COLS = 4;
  const GRID_ROWS = 4;
  const W = GRID_COLS * MINI_CELL;
  const H = GRID_ROWS * MINI_CELL;
  const ROT_LABELS = ['Spawn', 'CW', '180°', 'CCW'];

  let canvasEls: HTMLCanvasElement[] = [];

  function draw() {
    const rotSys = getRotationSystem($diagram.rotationSystem);
    const skin = $renderConfig.skin;
    const cellType = pieceTypeToCellType(pieceType);

    for (let rot = 0; rot < 4; rot++) {
      const canvas = canvasEls[rot];
      if (!canvas) continue;
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;

      // Background
      ctx.fillStyle = skin.backgroundColor;
      ctx.fillRect(0, 0, W, H);

      // Empty cell fills
      ctx.fillStyle = skin.emptyFill;
      for (let r = 0; r < GRID_ROWS; r++) {
        for (let c = 0; c < GRID_COLS; c++) {
          ctx.fillRect(c * MINI_CELL + 1, r * MINI_CELL + 1, MINI_CELL - 2, MINI_CELL - 2);
        }
      }

      // Grid lines
      ctx.strokeStyle = skin.gridColor;
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      for (let c = 0; c <= GRID_COLS; c++) {
        ctx.moveTo(c * MINI_CELL, 0);
        ctx.lineTo(c * MINI_CELL, H);
      }
      for (let r = 0; r <= GRID_ROWS; r++) {
        ctx.moveTo(0, r * MINI_CELL);
        ctx.lineTo(W, r * MINI_CELL);
      }
      ctx.stroke();

      // Piece minos — position within the 4×4 grid
      const shape = rotSys.getShape(pieceType, rot as 0 | 1 | 2 | 3);
      const rotSysName = $diagram.rotationSystem;

      let offC: number, offR: number;
      if (rotSysName === 'srs') {
        const [bc, br] = SRS_BBOX_OFFSET[pieceType][rot];
        offC = bc;
        offR = br;
      } else if (rotSysName === 'nes') {
        const [bc, br] = NES_BBOX_OFFSET[pieceType][rot];
        offC = bc;
        offR = br;
      } else {
        // ARS and other systems
        const [bc, br] = ARS_BBOX_OFFSET[pieceType][rot];
        offC = bc;
        offR = br;
      }

      for (const { deltaCol, deltaRow } of shape) {
        const px = (offC + deltaCol) * MINI_CELL;
        const py = (offR + deltaRow) * MINI_CELL;
        drawCell(ctx, px, py, cellType, MINI_CELL, skin);
      }
    }
  }

  afterUpdate(draw);
</script>

<div class="popover">
  <div class="header">
    <span class="title">{PIECE_NAMES[pieceType]} rotations</span>
    <button class="close" on:click={onclose}>✕</button>
  </div>
  <div class="grid">
    {#each ROT_LABELS as label, rot}
      <button
        class="rot-cell"
        class:selected={$selectedRotation === rot}
        on:click={() => selectedRotation.set(rot as Rotation)}
        on:dblclick={() => spawnActivePiece(pieceType, rot as Rotation)}
        title="Select {label} rotation — double-click to spawn"
      >
        <canvas width={W} height={H} bind:this={canvasEls[rot]}></canvas>
        <span class="label">{label}</span>
      </button>
    {/each}
  </div>
</div>

<style>
  .popover {
    background: var(--bg-input);
    border: 1px solid var(--brd-3);
    border-radius: var(--r);
    padding: 6px;
    margin-top: 6px;
  }
  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 5px;
  }
  .title {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.08em;
    color: var(--txt-dim);
    text-transform: uppercase;
  }
  .close {
    background: none;
    border: none;
    color: var(--txt-dim);
    font-size: 10px;
    cursor: pointer;
    padding: 0;
    line-height: 1;
  }
  .close:hover { color: var(--danger); }
  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 5px;
  }
  .rot-cell {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    background: none;
    border: 2px solid transparent;
    border-radius: var(--r-sm);
    padding: 2px;
    cursor: pointer;
  }
  .rot-cell:hover { border-color: var(--brd-3); }
  .rot-cell.selected { border-color: var(--accent); background: var(--bg-1); }
  .rot-cell canvas {
    border: 1px solid var(--bg-3);
    border-radius: 2px;
    display: block;
  }
  .label {
    font-size: 8px;
    color: var(--txt-dim);
    text-align: center;
  }
  .rot-cell.selected .label { color: var(--txt-mid); }
</style>
