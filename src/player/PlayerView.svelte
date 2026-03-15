<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { Diagram } from '../types/frame';
  import { LC_DEFAULT_PRE_MS, LC_DEFAULT_SWIPE_MS, LC_DEFAULT_POST_MS, LF_DEFAULT_MS } from '../types/frame';
  import InputDisplay from '../components/InputDisplay.svelte';
  import type { RenderConfig } from '../renderer/board-renderer';
  import {
    DEFAULT_RENDER_CONFIG,
    renderBoard,
    drawCallouts,
    drawCommentOverlay,
    renderPiecePreview,
    drawCell,
  } from '../renderer/board-renderer';
  import { pieceTypeToCellType } from '../renderer/colors';
  import { getRotationSystem } from '../rotation/index';
  import { BOARD_COLS, BOARD_ROWS, cloneBoard, setCell, CellType } from '../types/board';
  import type { Board } from '../types/board';

  export let diagram: Diagram;
  export let config: RenderConfig = { ...DEFAULT_RENDER_CONFIG };
  export let autoplay = false;
  export let nextQueueLayout: 'horizontal' | 'vertical' = 'horizontal';

  // ── State ──────────────────────────────────────────────────────────────────
  let currentIndex = 0;
  let isPlaying = autoplay;
  let speedMultiplier = 1;

  let boardCanvas: HTMLCanvasElement;
  let holdCanvas: HTMLCanvasElement;
  let nextCanvas: HTMLCanvasElement;
  let timer: ReturnType<typeof setTimeout> | null = null;

  // ── Line-clear transition state ────────────────────────────────────────────
  // Phase 1 (pre): show filled board briefly, no overlay
  // Phase 2 (swipe): white bar sweeps left→right across clearing rows
  // Phase 3 (post): show cleared board briefly before advancing frame
  type TPhase = 'none' | 'pre' | 'swipe' | 'post';
  let tPhase: TPhase = 'none';
  let tRows: number[] = [];
  let tClearedBoard: Board | null = null;
  let tSwipeProgress = 0;
  let tRaf: number | null = null;
  let tPreTimer: ReturnType<typeof setTimeout> | null = null;
  let tPostTimer: ReturnType<typeof setTimeout> | null = null;


  const SPEEDS = [
    { label: '½×', value: 0.5 },
    { label: '1×',  value: 1   },
    { label: '2×',  value: 2   },
    { label: '3×',  value: 3   },
  ];

  // ── Derived ────────────────────────────────────────────────────────────────
  $: frames = diagram.frames;
  $: rotSys  = getRotationSystem(diagram.rotationSystem);
  $: total   = frames.length;
  $: frame   = frames[Math.min(currentIndex, total - 1)];
  $: cellSize      = config.cellSize;
  $: pcs     = Math.max(6, Math.floor(cellSize * 0.65));
  $: sm_v    = Math.max(6, Math.floor(cellSize / 2));
  $: slotH_v = 3 * sm_v;
  $: delay   = Math.max(50, diagram.animationDelayMs / speedMultiplier);

  // Compact mode: hide side panels, frame dots, and non-essential controls.
  // Auto-triggers when cell size is too small; can be overridden by the user.
  let manualCompact: boolean | null = null;
  $: autoCompact = cellSize < 24;
  $: compact = manualCompact !== null ? manualCompact : autoCompact;

  function toggleCompact() {
    // On first toggle, flip the current effective value; subsequent toggles flip manualCompact.
    manualCompact = !compact;
  }

  // ── Timer + transition helpers ─────────────────────────────────────────────
  function clearTimer() {
    if (timer !== null) { clearTimeout(timer); timer = null; }
  }

  function cancelTransition() {
    if (tRaf !== null) { cancelAnimationFrame(tRaf); tRaf = null; }
    if (tPreTimer !== null) { clearTimeout(tPreTimer); tPreTimer = null; }
    if (tPostTimer !== null) { clearTimeout(tPostTimer); tPostTimer = null; }
    tPhase = 'none';
    tRows = [];
    tClearedBoard = null;
    tSwipeProgress = 0;
  }

  /**
   * 3-phase line-clear transition:
   *   1. pre  – show filled board (no overlay) for T_PRE_MS
   *   2. swipe – white bar sweeps left→right for T_SWIPE_MS
   *   3. post – show cleared board (stack floating) for T_POST_MS
   * then calls onComplete.
   */
  function playLineClearTransition(
    rows: number[], board: Board,
    preMs: number, swipeMs: number, postMs: number,
    onComplete: () => void,
  ) {
    console.log('[LC] playLineClearTransition called — pre=%d swipe=%d post=%d rows=%o', preMs, swipeMs, postMs, rows);
    cancelTransition();
    tRows = [...rows];
    // Post phase shows the clearing rows erased in-place (no gravity), so the
    // stack above appears to float — distinct from the next frame where gravity
    // has been applied.
    const erased = cloneBoard(board);
    for (const r of rows) {
      for (let c = 0; c < BOARD_COLS; c++) {
        setCell(erased, c, r, CellType.Empty);
      }
    }
    tClearedBoard = erased;

    // Phase 1
    tPhase = 'pre';
    drawBoard();
    console.log('[LC] pre phase started — will hold for %dms', preMs);
    tPreTimer = setTimeout(() => {
      tPreTimer = null;
      // Phase 2
      tPhase = 'swipe';
      console.log('[LC] swipe phase started — will run for %dms', swipeMs);

      tSwipeProgress = 0;
      const t0 = performance.now();
      function step(now: number) {
        tSwipeProgress = Math.min(1, (now - t0) / swipeMs);
        drawBoard();
        if (tSwipeProgress < 1) {
          tRaf = requestAnimationFrame(step);
        } else {
          tRaf = null;

          // Phase 3
          tPhase = 'post';
          drawBoard();
          console.log('[LC] post phase started — will hold for %dms (postMs captured in closure = %d)', postMs, postMs);
          tPostTimer = setTimeout(() => {
            console.log('[LC] post phase ended — calling onComplete');
            tPostTimer = null;
            tPhase = 'none';
            tRows = [];
            tClearedBoard = null;
            tSwipeProgress = 0;
            onComplete();
          }, postMs);
        }
      }
      tRaf = requestAnimationFrame(step);
    }, preMs);
  }

  // ── Drawing ────────────────────────────────────────────────────────────────
  function drawBoard() {
    if (!boardCanvas || !frame) return;
    const ctx = boardCanvas.getContext('2d');
    if (!ctx) return;
    boardCanvas.width  = BOARD_COLS * cellSize;
    boardCanvas.height = BOARD_ROWS * cellSize;
    const W = boardCanvas.width;
    const H = boardCanvas.height;

    if (tPhase === 'post' && tClearedBoard) {
      // Phase 3: show the cleared board (no active piece — stack is floating)
      renderBoard(ctx, tClearedBoard, undefined, rotSys, config, false, 0);
    } else {
      // Phase 1/2 or normal: show current board without clearing overlay
      renderBoard(ctx, frame.board, frame.activePiece, rotSys, config, frame.showGhost, frame.lockDelayProgress ?? 0, frame.overlays, frame.lockFlash ? 1 : 0);

      // Phase 2: white swipe bar grows left→right across clearing rows
      if (tPhase === 'swipe' && tSwipeProgress > 0 && tRows.length) {
        ctx.fillStyle = 'white';
        for (const r of tRows) {
          if (r < 0 || r >= BOARD_ROWS) continue;
          ctx.fillRect(0, (BOARD_ROWS - 1 - r) * cellSize, Math.round(W * tSwipeProgress), cellSize);
        }
      }
    }

    if (frame.callouts?.length) drawCallouts(ctx, frame.callouts, cellSize, W, H);
    if (frame.comment) drawCommentOverlay(ctx, frame.comment, W, H, cellSize);
  }

  function drawHold() {
    if (!holdCanvas || !frame) return;
    const ctx = holdCanvas.getContext('2d');
    if (!ctx) return;
    holdCanvas.width  = 4 * pcs;
    holdCanvas.height = 2 * pcs;
    ctx.fillStyle = config.skin.backgroundColor;
    ctx.fillRect(0, 0, holdCanvas.width, holdCanvas.height);
    if (frame.holdPiece !== undefined) {
      renderPiecePreview(ctx, 0, 0, frame.holdPiece, rotSys, pcs, 4, 2, false, config.skin);
    }
  }

  // Mirrors NextQueue.svelte constants
  const STRIP_ROWS = 3;
  const SECOND_START_COLS = 7;

  function drawNext() {
    if (!nextCanvas || !frame) return;
    const ctx = nextCanvas.getContext('2d');
    if (!ctx) return;
    const queue = frame.nextQueue.slice(0, 6);
    const skin  = config.skin;

    if (nextQueueLayout === 'vertical') {
      // Vertical: narrow column to the right of the board, pieces top→bottom
      const count = queue.length;
      nextCanvas.width  = 5 * sm_v;
      nextCanvas.height = Math.max(1, count * slotH_v);
      ctx.fillStyle = skin.previewBackgroundColor;
      ctx.fillRect(0, 0, nextCanvas.width, nextCanvas.height);

      const zoneLabelSize = Math.max(7, Math.round(sm_v * 0.5));
      ctx.font = `700 ${zoneLabelSize}px system-ui, sans-serif`;
      ctx.textBaseline = 'top';
      const zoneStroke = 'rgba(120,120,140,0.25)';
      const zoneLabelColor = 'rgba(160,160,180,0.55)';

      for (let i = 0; i < count; i++) {
        const zy = i * slotH_v;
        ctx.strokeStyle = zoneStroke;
        ctx.lineWidth = 1;
        ctx.strokeRect(0.5, zy + 0.5, nextCanvas.width - 1, slotH_v - 1);
        ctx.fillStyle = zoneLabelColor;
        ctx.textAlign = 'left';
        ctx.fillText(i === 0 ? 'NEXT' : String(i + 1), 3, zy + 2);

        if (queue[i] === null) continue;
        const type  = queue[i];
        const shape = rotSys.getShape(type, 0);
        const cellType = pieceTypeToCellType(type);
        const minDC = Math.min(...shape.map(m => m.deltaCol));
        const maxDC = Math.max(...shape.map(m => m.deltaCol));
        const minDR = Math.min(...shape.map(m => m.deltaRow));
        const maxDR = Math.max(...shape.map(m => m.deltaRow));
        const bboxW = maxDC - minDC + 1;
        const bboxH = maxDR - minDR + 1;
        const xOff  = Math.floor((5 - bboxW) / 2) * sm_v;
        const yOff  = Math.floor((3 - bboxH) / 2) * sm_v;
        for (const { deltaCol, deltaRow } of shape) {
          drawCell(ctx, xOff + (deltaCol - minDC) * sm_v, zy + yOff + (deltaRow - minDR) * sm_v, cellType, sm_v, skin);
        }
      }
    } else {
      // Horizontal: matches editor NextQueue.svelte layout exactly.
      // First piece at full cellSize on the left; pieces 2–6 at sm size in a 2×3 grid on the right.
      const sm = Math.max(5, Math.floor(cellSize / 4));
      const W  = BOARD_COLS * cellSize;
      const H  = STRIP_ROWS * cellSize;
      nextCanvas.width  = W;
      nextCanvas.height = H;
      ctx.fillStyle = skin.previewBackgroundColor;
      ctx.fillRect(0, 0, W, H);

      const secondX     = SECOND_START_COLS * cellSize;
      const slotW       = 4 * sm;
      const halfH       = H / 2;
      const firstZoneLeft = Math.floor((BOARD_COLS - 4) / 2) * cellSize;

      // Zone outlines + labels
      const zoneLabelSize  = Math.max(8, Math.round(sm * 0.85));
      const zoneStroke     = 'rgba(120,120,140,0.25)';
      const zoneLabelColor = 'rgba(160,160,180,0.55)';
      ctx.font = `700 ${zoneLabelSize}px system-ui, sans-serif`;
      ctx.textBaseline = 'top';

      // First slot zone
      ctx.strokeStyle = zoneStroke;
      ctx.lineWidth = 1;
      ctx.strokeRect(firstZoneLeft + 0.5, 0.5, secondX - firstZoneLeft - 1, H - 1);
      ctx.fillStyle = zoneLabelColor;
      ctx.textAlign = 'left';
      ctx.fillText('NEXT', firstZoneLeft + 3, 2);

      // Secondary zones: bottom row (slots 1,2), top row (slots 3,4,5)
      for (let col = 0; col < 2; col++) {
        const slot = 1 + col;
        if (slot >= queue.length) break;
        const zx = secondX + col * slotW;
        ctx.strokeStyle = zoneStroke;
        ctx.lineWidth = 1;
        ctx.strokeRect(zx + 0.5, halfH + 0.5, slotW - 1, halfH - 1);
        ctx.fillStyle = zoneLabelColor;
        ctx.textAlign = 'left';
        ctx.fillText(String(slot + 1), zx + 3, halfH + 2);
      }
      for (let col = 0; col < 3; col++) {
        const slot = 3 + col;
        if (slot >= queue.length) break;
        const zx = secondX + col * slotW;
        ctx.strokeStyle = zoneStroke;
        ctx.lineWidth = 1;
        ctx.strokeRect(zx + 0.5, 0.5, slotW - 1, halfH - 1);
        ctx.fillStyle = zoneLabelColor;
        ctx.textAlign = 'left';
        ctx.fillText(String(slot + 1), zx + 3, 2);
      }

      if (queue.length === 0) return;

      // First piece at full cellSize, centered horizontally, bottom-aligned
      if (queue[0] !== null) {
        const firstShape = rotSys.getShape(queue[0], 0);
        const firstMinDC = Math.min(...firstShape.map(m => m.deltaCol));
        const firstMinDR = Math.min(...firstShape.map(m => m.deltaRow));
        const firstMaxDC = Math.max(...firstShape.map(m => m.deltaCol));
        const firstMaxDR = Math.max(...firstShape.map(m => m.deltaRow));
        const firstBboxW = firstMaxDC - firstMinDC + 1;
        const firstBboxH = firstMaxDR - firstMinDR + 1;
        const firstXOff  = Math.floor((BOARD_COLS - firstBboxW) / 2) * cellSize;
        const firstYOff  = (STRIP_ROWS - firstBboxH) * cellSize;
        const firstCellType = pieceTypeToCellType(queue[0]);
        for (const { deltaCol, deltaRow } of firstShape) {
          drawCell(ctx, firstXOff + (deltaCol - firstMinDC) * cellSize, firstYOff + (deltaRow - firstMinDR) * cellSize, firstCellType, cellSize, skin);
        }
      }

      // Pieces 2–6: smaller size, 2-row grid
      for (let i = 1; i < queue.length; i++) {
        if (queue[i] === null) continue;
        const slotIsBottom = i <= 2;
        const slotCol = slotIsBottom ? i - 1 : i - 3;
        const x = secondX + slotCol * slotW;
        const y = slotIsBottom ? halfH : 0;

        const type  = queue[i];
        const shape = rotSys.getShape(type, 0);
        const cellType = pieceTypeToCellType(type);
        const minDC = Math.min(...shape.map(m => m.deltaCol));
        const maxDC = Math.max(...shape.map(m => m.deltaCol));
        const minDR = Math.min(...shape.map(m => m.deltaRow));
        const maxDR = Math.max(...shape.map(m => m.deltaRow));
        const bboxW = maxDC - minDC + 1;
        const bboxH = maxDR - minDR + 1;
        const xOff  = Math.floor((4 - bboxW) / 2) * sm;
        const yOff  = Math.floor((halfH / sm - bboxH) / 2) * sm;
        for (const { deltaCol, deltaRow } of shape) {
          drawCell(ctx, x + xOff + (deltaCol - minDC) * sm, y + yOff + (deltaRow - minDR) * sm, cellType, sm, skin);
        }
      }
    }
  }

  // Redraw when frame or size-related config changes
  $: { void cellSize;  void frame; if (boardCanvas) drawBoard(); }
  $: { void pcs; void frame; if (holdCanvas)  drawHold();  }
  $: { void cellSize; void frame; void nextQueueLayout; void sm_v; if (nextCanvas) drawNext(); }

  // ── Playback timer ─────────────────────────────────────────────────────────
  /**
   * Schedule the next tick using the current frame's appropriate delay.
   * Lock-flash frames use a short fixed delay; all others use the diagram delay.
   */
  function scheduleNextTick() {
    const f = frames[Math.min(currentIndex, total - 1)];
    let ms: number;
    if (f?.lockFlash) ms = LF_DEFAULT_MS;
    else if (f?.durationMs != null) ms = Math.max(50, f.durationMs / speedMultiplier);
    else ms = delay;
    timer = setTimeout(tick, ms);
  }

  function tick() {
    const f = frames[Math.min(currentIndex, total - 1)];
    const next = currentIndex < total - 1 ? currentIndex + 1 : 0;
    if (f?.clearingRows?.length && currentIndex < total - 1) {
      const preMs   = f.lineClearPreMs   ?? LC_DEFAULT_PRE_MS;
      const swipeMs = f.lineClearSwipeMs ?? LC_DEFAULT_SWIPE_MS;
      const postMs  = f.lineClearPostMs  ?? LC_DEFAULT_POST_MS;
      console.log('[LC] tick: frame[%d] has clearingRows — f.lineClearPreMs=%o f.lineClearSwipeMs=%o f.lineClearPostMs=%o → preMs=%d swipeMs=%d postMs=%d',
        currentIndex, f.lineClearPreMs, f.lineClearSwipeMs, f.lineClearPostMs, preMs, swipeMs, postMs);
      playLineClearTransition(f.clearingRows, f.board, preMs, swipeMs, postMs, () => {
        currentIndex = next;
        if (isPlaying) scheduleNextTick();
      });
    } else {
      currentIndex = next;
      if (isPlaying) scheduleNextTick();
    }
  }

  // (Re)start timer whenever play state or delay changes
  $: { clearTimer(); if (isPlaying) scheduleNextTick(); }

  // ── Controls ───────────────────────────────────────────────────────────────
  function togglePlay() { if (isPlaying) cancelTransition(); isPlaying = !isPlaying; }
  function goFirst()    { isPlaying = false; cancelTransition(); currentIndex = 0; }
  function goLast()     { isPlaying = false; cancelTransition(); currentIndex = total - 1; }
  function goPrev()     { isPlaying = false; cancelTransition(); if (currentIndex > 0) currentIndex--; }

  function goNext() {
    isPlaying = false;
    cancelTransition();
    const f = frames[Math.min(currentIndex, total - 1)];
    if (f?.clearingRows?.length && currentIndex < total - 1) {
      const preMs   = f.lineClearPreMs   ?? LC_DEFAULT_PRE_MS;
      const swipeMs = f.lineClearSwipeMs ?? LC_DEFAULT_SWIPE_MS;
      const postMs  = f.lineClearPostMs  ?? LC_DEFAULT_POST_MS;
      console.log('[LC] goNext: frame[%d] has clearingRows — f.lineClearPreMs=%o f.lineClearSwipeMs=%o f.lineClearPostMs=%o → preMs=%d swipeMs=%d postMs=%d',
        currentIndex, f.lineClearPreMs, f.lineClearSwipeMs, f.lineClearPostMs, preMs, swipeMs, postMs);
      playLineClearTransition(f.clearingRows, f.board, preMs, swipeMs, postMs, () => { currentIndex++; });
    } else {
      if (currentIndex < total - 1) currentIndex++;
    }
  }

  function onSeek(e: Event) {
    isPlaying = false;
    cancelTransition();
    currentIndex = parseInt((e.target as HTMLInputElement).value);
  }

  function onKeydown(e: KeyboardEvent) {
    if      (e.key === 'ArrowLeft'  || e.key === 'ArrowDown')  { goPrev();     e.preventDefault(); }
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp')    { goNext();     e.preventDefault(); }
    else if (e.key === ' ')                                     { togglePlay(); e.preventDefault(); }
    else if (e.key === 'Home')                                  { goFirst();    e.preventDefault(); }
    else if (e.key === 'End')                                   { goLast();     e.preventDefault(); }
  }

  onDestroy(() => { clearTimer(); cancelTransition(); });
</script>

<!-- svelte-ignore a11y-no-noninteractive-tabindex a11y-no-static-element-interactions a11y-no-noninteractive-element-interactions -->
<div
  class="player"
  class:compact
  tabindex="0"
  role="application"
  aria-label="Diagram player"
  on:keydown={onKeydown}
>
  <!-- Board section: [hold |] [next-above / board] stacked vertically.
       The next canvas is the same width as the board (10 cols × cellSize) and sits
       flush above it, so piece 0 appears centered over the playfield. -->
  <div class="board-section">
    {#if !compact}
      <div class="hold-col">
        <span class="side-label">HOLD</span>
        <canvas bind:this={holdCanvas} class="side-canvas"></canvas>
      </div>
    {/if}

    <div class="main-col">
      {#if !compact && nextQueueLayout === 'horizontal'}
        <canvas bind:this={nextCanvas} class="next-canvas"></canvas>
      {/if}
      <canvas bind:this={boardCanvas} class="board-canvas"></canvas>
    </div>

    {#if !compact && nextQueueLayout === 'vertical'}
      <div class="next-col-v">
        <canvas bind:this={nextCanvas} class="next-canvas-v"></canvas>
      </div>
    {/if}
  </div>

  <div class="input-display-wrap" style="width: {BOARD_COLS * cellSize}px">
    <InputDisplay inputs={frame?.inputs ?? {}} hiddenCategories={diagram.hiddenInputs ?? []} />
  </div>

  <!-- Seekbar -->
  <div class="seekbar-wrap" style="width: {BOARD_COLS * cellSize}px">
    <input
      class="seekbar"
      type="range"
      min="0"
      max={total - 1}
      step="1"
      value={currentIndex}
      on:input={onSeek}
    />
  </div>

  <!-- Frame dots: only in full mode, only when ≤ 40 frames -->
  {#if !compact && total <= 40}
    <div class="dots-row" style="width: {BOARD_COLS * cellSize}px">
      {#each frames as _, i}
        <button
          class="dot"
          class:dot-active={i === currentIndex}
          class:dot-played={i < currentIndex}
          on:click={() => { isPlaying = false; currentIndex = i; }}
          title="Frame {i + 1}"
          aria-label="Frame {i + 1}"
        ></button>
      {/each}
    </div>
  {/if}

  <!-- Controls bar -->
  <div class="controls" style="width: {BOARD_COLS * cellSize}px">
    {#if !compact}
      <button class="btn" on:click={goFirst} title="First frame (Home)">⏮</button>
    {/if}
    <button class="btn" on:click={goPrev}  title="Previous (←)">◀</button>
    <button class="btn btn-play" on:click={togglePlay} title="Play / Pause (Space)">
      {isPlaying ? '⏸' : '▶'}
    </button>
    <button class="btn" on:click={goNext}  title="Next (→)">▶</button>
    {#if !compact}
      <button class="btn" on:click={goLast} title="Last frame (End)">⏭</button>
    {/if}

    <span class="frame-count">{currentIndex + 1}&thinsp;/&thinsp;{total}</span>

    {#if !compact}
      <select class="speed-sel" bind:value={speedMultiplier} title="Playback speed">
        {#each SPEEDS as s}
          <option value={s.value}>{s.label}</option>
        {/each}
      </select>
    {/if}

    <button
      class="btn btn-layout"
      class:btn-layout-active={manualCompact !== null}
      on:click={toggleCompact}
      title={compact ? 'Show hold / next panels' : 'Hide hold / next panels'}
    >{compact ? '⊞' : '⊟'}</button>
  </div>
</div>

<style>
  .player {
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    outline: none;
    user-select: none;
    -webkit-user-select: none;
  }
  /* Tighter vertical rhythm in compact mode */
  .player.compact { gap: 4px; }

  /* ── Board section ──────────────────────────────────────────────────────── */
  /* hold-col on the left, main-col (next stacked above board) on the right */
  .board-section {
    display: flex;
    flex-direction: row;
    align-items: flex-start;
    gap: 8px;
  }

  .hold-col {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
  }

  /* next canvas sits flush above the board — no gap between them */
  .main-col {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0;
  }

  .side-canvas    { display: block; background: var(--bg-base); }
  .next-canvas    { display: block; }
  .board-canvas   { display: block; }

  .next-col-v {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    align-self: flex-start;
  }
  .next-canvas-v  { display: block; }

  .side-label {
    font-size: 9px;
    color: var(--txt-dim);
    letter-spacing: 0.1em;
    font-family: 'Segoe UI', system-ui, sans-serif;
  }

  /* ── Input display ─────────────────────────────────────────────────────── */
  .input-display-wrap {
    display: flex;
    justify-content: center;
    background: var(--bg-base);
    border-top: 1px solid var(--bg-1);
    padding: 2px 4px;
  }

  /* ── Seekbar ───────────────────────────────────────────────────────────── */
  .seekbar-wrap { padding: 2px 0; }

  .seekbar {
    -webkit-appearance: none;
    appearance: none;
    width: 100%;
    height: 6px;
    border-radius: var(--r-sm);
    background: var(--brd-1);
    outline: none;
    cursor: pointer;
  }
  .seekbar::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--accent);
    cursor: pointer;
    border: 2px solid var(--bg-base);
    box-shadow: 0 0 4px rgba(0,0,0,0.6);
    transition: background 0.1s;
  }
  .seekbar::-webkit-slider-thumb:hover { background: var(--accent-hi); }
  .seekbar::-moz-range-thumb {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--accent);
    cursor: pointer;
    border: 2px solid var(--bg-base);
  }

  /* ── Frame dots ────────────────────────────────────────────────────────── */
  .dots-row {
    display: flex;
    flex-wrap: wrap;
    gap: 3px;
    justify-content: flex-start;
    min-height: 10px;
  }

  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    border: 1px solid var(--brd-2);
    background: var(--bg-1);
    cursor: pointer;
    padding: 0;
    transition: background 0.1s, border-color 0.1s;
  }
  .dot:hover      { background: var(--brd-2); border-color: var(--accent); }
  .dot-played     { background: var(--bg-3); border-color: var(--brd-3); }
  .dot-active     { background: var(--accent); border-color: var(--txt-head); }

  /* ── Controls bar ──────────────────────────────────────────────────────── */
  .controls {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  /* Tighter gap in compact mode so three buttons + counter fit in small width */
  .player.compact .controls { gap: 2px; }

  .btn {
    background: var(--bg-1);
    border: 1px solid var(--brd-1);
    border-radius: var(--r);
    color: var(--txt-mid);
    cursor: pointer;
    font-size: 13px;
    padding: 4px 8px;
    line-height: 1;
    font-family: inherit;
    flex-shrink: 0;
    transition: background 0.1s, color 0.1s;
  }
  .btn:hover { background: var(--bg-2); color: var(--txt-0); border-color: var(--brd-3); }

  /* Smaller buttons in compact mode */
  .player.compact .btn {
    font-size: 11px;
    padding: 3px 5px;
  }

  .btn-play {
    background: var(--bg-2);
    border-color: var(--brd-2);
    color: var(--txt-0);
    padding: 4px 14px;
    font-size: 14px;
  }
  .btn-play:hover { background: var(--bg-3); }
  .player.compact .btn-play {
    font-size: 12px;
    padding: 3px 10px;
  }

  .frame-count {
    flex: 1;
    text-align: center;
    font-size: 12px;
    color: var(--txt-dim);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    font-family: 'Segoe UI', system-ui, sans-serif;
    min-width: 0;
  }
  .player.compact .frame-count { font-size: 11px; }

  .speed-sel {
    background: var(--bg-1);
    border: 1px solid var(--brd-1);
    border-radius: var(--r);
    color: var(--accent);
    font-size: 12px;
    padding: 3px 4px;
    cursor: pointer;
    outline: none;
    font-family: inherit;
    flex-shrink: 0;
  }
  .speed-sel:hover { border-color: var(--brd-3); }

  /* ── Layout toggle ─────────────────────────────────────────────────────── */
  .btn-layout {
    flex-shrink: 0;
    color: var(--txt-dim);
    border-color: var(--bg-2);
  }
  .btn-layout:hover { color: var(--txt-1); border-color: var(--brd-3); }
  /* Lit up when the user has manually overridden the auto value */
  .btn-layout-active { color: var(--txt-mid); border-color: var(--accent); }
</style>
