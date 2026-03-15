<script lang="ts">
  import { onMount } from 'svelte';
  import PlayerView from './PlayerView.svelte';
  import { decodeDiagram } from '../export/url-codec';
  import type { Diagram } from '../types/frame';
  import { DEFAULT_RENDER_CONFIG } from '../renderer/board-renderer';
  import type { RenderConfig } from '../renderer/board-renderer';
  import { CLASSIC_SKIN, GUIDELINE_SKIN } from '../renderer/colors';
  import { BOARD_COLS, BOARD_ROWS } from '../types/board';

  let diagram: Diagram | null = null;
  let error: string | null = null;
  let config: RenderConfig = { ...DEFAULT_RENDER_CONFIG };
  let autoplay = false;
  let editorUrl = '/';
  let nextQueueLayout: 'horizontal' | 'vertical' = 'horizontal';

  onMount(() => {
    const hash   = window.location.hash.slice(1); // strip leading '#'
    const params = new URLSearchParams(window.location.search);

    // diagram data: hash takes priority, then ?d= query param
    const encoded = hash.startsWith('v') ? hash : (params.get('d') ?? hash);
    const skinParam = params.get('skin');
    autoplay = params.has('autoplay');
    nextQueueLayout = (localStorage.getItem('tedige-nq-layout') ?? 'horizontal') as 'horizontal' | 'vertical';

    // Build "edit" link back to the editor.
    // Use the current path's directory so this works under any base path
    // (e.g. https://host/tedige-3/player → https://host/tedige-3/).
    const basePath = window.location.pathname.replace(/\/[^/]*$/, '/');
    editorUrl = basePath + (hash ? '#' + hash : '');

    if (!encoded) {
      error = 'No diagram data in URL. Use the editor\'s Export → Player to share a diagram.';
      return;
    }

    try {
      diagram = decodeDiagram(encoded);
    } catch (e) {
      error = `Could not decode diagram: ${String(e)}`;
      return;
    }

    // Skin: explicit param → default by rotation system
    const skinId = skinParam ?? (diagram.rotationSystem === 'ars' ? 'classic' : 'guideline');
    const skin   = skinId === 'classic' ? CLASSIC_SKIN : GUIDELINE_SKIN;

    // Pick the largest cell size that fits inside the viewport.
    // Controls bar + seekbar + edit link: ~90px vertical; page padding: 32px
    const CTRL_H = 90;
    const csH = Math.floor((window.innerHeight - CTRL_H - 32) / BOARD_ROWS);

    // Try "full" mode (with hold/next side panels: adds ~5.2 board-col-equivalents + 24px gaps)
    const csW_full    = Math.floor((window.innerWidth - 24) / (BOARD_COLS + 5.2));
    // Fallback "compact" mode (board only, no side panels)
    const csW_compact = Math.floor(window.innerWidth / BOARD_COLS);

    // Use full mode if it yields cellSize ≥ 24 (side panels are useful at that size);
    // otherwise fall back to compact mode so the board fills the available width.
    let cellSize: number;
    if (Math.min(csH, csW_full) >= 24) {
      cellSize = Math.min(csH, csW_full);
    } else {
      cellSize = Math.min(csH, csW_compact);
    }
    cellSize = Math.max(10, Math.min(48, cellSize));

    config = { ...DEFAULT_RENDER_CONFIG, cellSize: cellSize, skin };
  });
</script>

<div class="page">
  {#if diagram}
    <PlayerView {diagram} {config} {autoplay} {nextQueueLayout} />
    <a class="edit-link" href={editorUrl}>✏ Edit in Tedige</a>
  {:else if error}
    <div class="error-box">
      <div class="error-title">Cannot load diagram</div>
      <div class="error-msg">{error}</div>
    </div>
  {:else}
    <div class="loading">Loading…</div>
  {/if}
</div>

<style>
  .page {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    min-height: 100dvh;
    padding: 16px;
    box-sizing: border-box;
  }

  .edit-link {
    font-size: 12px;
    color: var(--txt-dim);
    text-decoration: none;
    letter-spacing: 0.04em;
  }
  .edit-link:hover { color: var(--txt-mid); }

  .error-box {
    background: var(--bg-1);
    border: 1px solid var(--err-brd);
    border-radius: var(--r-lg);
    padding: 24px 32px;
    max-width: 420px;
    text-align: center;
  }
  .error-title { color: var(--err-txt); font-weight: 700; margin-bottom: 8px; font-size: 15px; }
  .error-msg   { color: var(--txt-2); font-size: 13px; line-height: 1.5; }

  .loading { color: var(--txt-dim); font-size: 14px; }
</style>
