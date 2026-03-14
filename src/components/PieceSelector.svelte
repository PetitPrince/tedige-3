<script lang="ts">
  import { get } from 'svelte/store';
  import {
    drawCellType, diagram, currentFrame, renderConfig,
    selectedPieceType, selectedRotation, pieceCollision,
    activeTool, overlayColor, overlayEmoji, overlayBlockType, lastPaletteSection,
    getFrameState,
  } from '../editor/store';
  import { checkpoint } from '../editor/history';
  import { updateFrame } from '../engine/frame-ops';
  import { getRotationSystem } from '../rotation/index';
  import { spawnActivePiece } from '../editor/actions';
  import { CellType } from '../types/board';
  import { PieceType, PIECE_NAMES } from '../types/piece';
  import type { PieceType as PT } from '../types/piece';
  import { pieceTypeToCellType } from '../renderer/colors';
  import PieceRotationsPopover from './PieceRotationsPopover.svelte';

  const CELL_LABELS: { type: CellType; label: string }[] = [
    { type: CellType.I, label: 'I' },
    { type: CellType.O, label: 'O' },
    { type: CellType.T, label: 'T' },
    { type: CellType.S, label: 'S' },
    { type: CellType.Z, label: 'Z' },
    { type: CellType.J, label: 'J' },
    { type: CellType.L, label: 'L' },
    { type: CellType.Garbage, label: 'G' },
  ];

  $: cellOptions = CELL_LABELS.map(({ type, label }) => ({
    type, label, color: $renderConfig.skin.cellFill[type],
  }));

  $: pieceOptions = Array.from({ length: 7 }, (_, idx) => {
    const type = idx as PT;
    const rotSys = getRotationSystem($diagram.rotationSystem);
    const shape = rotSys.getShape(type, 0);
    const color = $renderConfig.skin.cellFill[pieceTypeToCellType(type)];
    const minDeltaCol = Math.min(...shape.map(m => m.deltaCol));
    const maxDeltaCol = Math.max(...shape.map(m => m.deltaCol));
    const minDeltaRow = Math.min(...shape.map(m => m.deltaRow));
    const maxDeltaRow = Math.max(...shape.map(m => m.deltaRow));
    const cols = maxDeltaCol - minDeltaCol + 1;
    const rows = maxDeltaRow - minDeltaRow + 1;
    const cells = new Set(shape.map(({ deltaCol, deltaRow }) => `${deltaCol - minDeltaCol},${deltaRow - minDeltaRow}`));
    return { type, color, cols, rows, cells, name: PIECE_NAMES[idx] };
  });

  function selectCell(type: import('../types/board').CellType) {
    drawCellType.set(type);
    selectedPieceType.set(null);
    lastPaletteSection.set('cell');
  }

  function changeActivePieceType(type: PT) {
    lastPaletteSection.set('piece');
    const { d, idx, frame } = getFrameState();
    if (!frame.activePiece) return;
    checkpoint();
    diagram.set(updateFrame(d, idx, { ...frame, activePiece: { ...frame.activePiece, type } }));
  }

  function togglePieceType(idx: number) {
    lastPaletteSection.set('piece');
    selectedPieceType.update(v => {
      if (v === (idx as PT)) return null;
      selectedRotation.set(0);
      activeTool.set('draw');
      return idx as PT;
    });
  }

  function removeActivePiece() {
    selectedPieceType.set(null);
    clearActivePiece();
  }

  function clearActivePiece() {
    const { d, idx, frame } = getFrameState();
    checkpoint();
    diagram.set(updateFrame(d, idx, { ...frame, activePiece: undefined }));
  }

  const OVERLAY_COLORS = [
    '#ff4444', '#ff8844', '#ffdd44', '#44dd44',
    '#44ddff', '#4488ff', '#aa44ff', '#dddddd',
  ];

  const OVERLAY_EMOJIS = ['⭕', '❌', '✅', '❗', '❓'];
  const OVERLAY_KEYCAPS = ['0️⃣','1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣'];

  function clearOverlays() {
    const { d, idx } = getFrameState();
    checkpoint();
    diagram.set(updateFrame(d, idx, { ...d.frames[idx], overlays: undefined }));
  }

  $: blockOptions = CELL_LABELS.map(({ type, label }) => ({ type, label }));

  $: hasActivePiece = !!$currentFrame?.activePiece;
  $: showPieceOptions = $selectedPieceType !== null || hasActivePiece;
</script>

<div class="piece-selector">
  {#if $activeTool === 'draw'}
    <div class="section-label">CELL</div>
    <div class="cell-grid">
      {#each cellOptions as opt}
        <button
          class="cell-btn"
          class:active={$drawCellType === opt.type && $selectedPieceType === null}
          style="--c: {opt.color}"
          on:click={() => selectCell(opt.type)}
          title={opt.label}
        >
          {opt.label}
        </button>
      {/each}
    </div>
  {/if}

  {#if $activeTool !== 'draw'}
    <div class="section-label">OVERLAY</div>
    <div class="overlay-colors">
      {#each OVERLAY_COLORS as c}
        <button
          class="overlay-swatch"
          class:active={$overlayColor === c && $activeTool === 'overlay' && $overlayEmoji === null && $overlayBlockType === null}
          style="--c: {c}"
          on:click={() => { overlayColor.set(c); overlayEmoji.set(null); overlayBlockType.set(null); activeTool.set('overlay'); }}
          title={c}
        ></button>
      {/each}
    </div>
    <div class="cell-grid overlay-blocks">
      {#each blockOptions as b}
        <button
          class="cell-btn"
          class:active={$overlayBlockType === b.type && $activeTool === 'overlay'}
          style="--c: {$renderConfig.skin.cellFill[b.type]}"
          on:click={() => { overlayBlockType.set(b.type); overlayEmoji.set(null); activeTool.set('overlay'); }}
          title={b.label}
        >{b.label}</button>
      {/each}
    </div>
    <div class="overlay-emojis">
      {#each OVERLAY_EMOJIS as e}
        <button class="overlay-emoji-btn"
          class:active={$overlayEmoji === e && $activeTool === 'overlay'}
          on:click={() => { overlayEmoji.set(e); overlayBlockType.set(null); activeTool.set('overlay'); }}
          title={e}>{e}</button>
      {/each}
    </div>
    <div class="overlay-emojis overlay-keycaps">
      {#each OVERLAY_KEYCAPS as e}
        <button class="overlay-emoji-btn"
          class:active={$overlayEmoji === e && $activeTool === 'overlay'}
          on:click={() => { overlayEmoji.set(e); overlayBlockType.set(null); activeTool.set('overlay'); }}
          title={e}>{e}</button>
      {/each}
    </div>
    <div class="overlay-row">
      <button class="overlay-clear-btn" on:click={clearOverlays} title="Clear all overlays on this frame">Clear overlays</button>
    </div>
  {/if}

  <hr class="piece-divider" />
  <div class="section-label">ACTIVE PIECE</div>
  <div class="piece-grid">
    {#each pieceOptions as opt, idx}
      <button
        class="piece-btn"
        class:active={$selectedPieceType === idx}
        style="--c: {opt.color}"
        on:click={() => togglePieceType(idx)}
        on:dblclick={() => spawnActivePiece(idx as PT)}
        title="{opt.name} — double-click to spawn"
      >
        <div class="piece-preview">
          {#each Array(opt.rows) as _, r}
            <div class="piece-row">
              {#each Array(opt.cols) as _, c}
                <div class="piece-mini-cell" style={opt.cells.has(`${c},${r}`) ? 'background:var(--c)' : ''}></div>
              {/each}
            </div>
          {/each}
        </div>
      </button>
    {/each}
    <button
      class="piece-btn piece-btn-none"
      class:active={$selectedPieceType === null && !hasActivePiece}
      on:click={removeActivePiece}
      title="No active piece"
    >
      <span class="piece-none-label">None</span>
    </button>
  </div>

  {#if $selectedPieceType !== null}
    <PieceRotationsPopover
      pieceType={$selectedPieceType}
      onclose={() => selectedPieceType.set(null)}
    />
  {/if}
</div>

<style>
  .piece-selector { display: flex; flex-direction: column; gap: 4px; }

  .overlay-colors {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 2px;
  }

  .overlay-swatch {
    height: 16px;
    background: color-mix(in srgb, var(--c) 40%, var(--bg-base));
    border: 1px solid color-mix(in srgb, var(--c) 50%, var(--bg-base));
    border-radius: 2px;
    cursor: pointer;
    opacity: 0.5;
    transition: opacity 0.1s, border-color 0.1s;
  }
  .overlay-swatch:hover { opacity: 0.85; border-color: var(--c); }
  .overlay-swatch.active { opacity: 1; border-color: var(--c); outline: 1px solid var(--c); outline-offset: 1px; }

  .overlay-blocks { margin-top: 1px; }

  .overlay-emojis {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 2px;
  }
  .overlay-keycaps {
    grid-template-columns: repeat(5, 1fr);
  }
  .overlay-emoji-btn {
    font-size: 13px; line-height: 1; padding: 2px 0;
    background: var(--bg-1); border: 1px solid var(--brd-1);
    border-radius: 2px; cursor: pointer;
    opacity: 0.55; transition: opacity 0.1s, border-color 0.1s;
  }
  .overlay-emoji-btn:hover { opacity: 1; border-color: var(--brd-3); }
  .overlay-emoji-btn.active { opacity: 1; border-color: var(--accent); outline: 1px solid var(--accent); outline-offset: 1px; }

  .overlay-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .overlay-clear-btn {
    background: var(--bg-1);
    border: 1px solid var(--purple-brd);
    border-radius: var(--r-sm);
    color: var(--purple-mid);
    font-size: 10px;
    padding: 2px 6px;
    cursor: pointer;
    line-height: 1;
  }
  .overlay-clear-btn:hover { background: var(--danger-bg); border-color: var(--danger-brd-mid); color: var(--danger-dim); }

  .piece-divider {
    border: none;
    border-top: 1px solid var(--brd-1);
    margin: 6px 0 2px;
  }

  .section-label {
    font-size: 10px; font-weight: 700; letter-spacing: 0.1em; color: var(--txt-dim);
  }

  .cell-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 2px;
  }

  .cell-btn {
    background: color-mix(in srgb, var(--c) 25%, var(--bg-base));
    border: 1px solid color-mix(in srgb, var(--c) 50%, var(--bg-base));
    border-radius: var(--r-sm);
    color: var(--c);
    font-size: 11px;
    font-weight: 700;
    cursor: pointer;
    padding: 4px 2px;
    transition: all 0.1s;
    opacity: 0.45;
  }
  .cell-btn:hover { background: color-mix(in srgb, var(--c) 40%, var(--bg-base)); opacity: 1; }
  .cell-btn.active {
    background: color-mix(in srgb, var(--c) 60%, var(--bg-base));
    border-color: var(--c);
    color: #ffffff;
    opacity: 1;
  }

  .piece-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 2px;
  }

  .piece-btn {
    background: color-mix(in srgb, var(--c) 15%, var(--bg-base));
    border: 1px solid color-mix(in srgb, var(--c) 35%, var(--bg-base));
    border-radius: var(--r-sm);
    cursor: pointer;
    padding: 5px 3px;
    display: flex; align-items: center; justify-content: center;
    transition: background 0.1s, border-color 0.1s, opacity 0.1s;
    opacity: 0.45;
  }
  .piece-btn:hover { background: color-mix(in srgb, var(--c) 28%, var(--bg-base)); border-color: color-mix(in srgb, var(--c) 60%, var(--bg-base)); opacity: 1; }
  .piece-btn.active { background: color-mix(in srgb, var(--c) 45%, var(--bg-base)); border-color: var(--c); opacity: 1; }

  .piece-btn-none {
    --c: var(--brd-2);
    min-height: 28px;
  }
  .piece-btn-none .piece-none-label {
    font-size: 10px;
    color: var(--txt-dim);
    letter-spacing: 0.05em;
  }
  .piece-btn-none.active {
    background: var(--bg-2);
    border-color: var(--brd-3);
    opacity: 1;
  }
  .piece-btn-none.active .piece-none-label { color: var(--txt-1); }

  .piece-preview {
    display: flex;
    flex-direction: column;
    gap: 1px;
    align-items: center;
  }

  .piece-row {
    display: flex;
    gap: 1px;
  }

  .piece-mini-cell {
    width: 4px;
    height: 4px;
  }

</style>
