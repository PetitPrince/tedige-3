<script lang="ts">
  import BoardCanvas from './BoardCanvas.svelte';
  import NextQueue from './NextQueue.svelte';
  import HoldDisplay from './HoldDisplay.svelte';
  import FrameTimeline from './FrameTimeline.svelte';
  import Toolbar from './Toolbar.svelte';
  import PieceSelector from './PieceSelector.svelte';
  import DiagramSettings from './DiagramSettings.svelte';
  import ExportPanel from './ExportPanel.svelte';
  import SettingsPanel from './SettingsPanel.svelte';
  import CapturePanel from './CapturePanel.svelte';
  import ActivePieceControls from './ActivePieceControls.svelte';
  import { showExport, showSettings, showCapture, showShortcuts, isPlaying, diagram, currentFrame, currentFrameIndex, activeTool, editingCallout, renderConfig, themeMode, nextQueueLayout, clearSavedDiagram } from '../editor/store';
  import type { ThemeMode } from '../editor/store';
  import InputDisplay from './InputDisplay.svelte';
  import { get } from 'svelte/store';
  import { updateFrame } from '../engine/frame-ops';
  import type { CalloutDir } from '../types/frame';
  import { BOARD_COLS, BOARD_ROWS } from '../types/board';
  import { keyMap, formatBinding } from '../editor/keybindings';
  import { mirrorCurrentFrame, mirrorAllFrames } from '../editor/actions';
  import { checkpoint } from '../editor/history';
  import { emptyDiagram } from '../types/frame';
  import { tick } from 'svelte';

  function newDiagram() {
    checkpoint();
    diagram.set(emptyDiagram());
    currentFrameIndex.set(0);
    window.location.hash = '';
    clearSavedDiagram();
  }

  function focusEl(el: HTMLElement) {
    tick().then(() => el.focus());
  }

  let innerWidth = 0;
  $: isMobile = innerWidth > 0 && innerWidth < 700;

  const THEME_ICONS: Record<ThemeMode, string> = { dark: '☾', light: '☀', os: '⊙' };
  const THEME_CYCLE: Record<ThemeMode, ThemeMode> = { dark: 'light', light: 'os', os: 'dark' };
  const THEME_TITLES: Record<ThemeMode, string> = { dark: 'Dark theme (click for light)', light: 'Light theme (click for OS)', os: 'OS theme (click for dark)' };
  function cycleTheme() { themeMode.update(m => THEME_CYCLE[m]); }
  let mobileTab: 'diagram' | 'tools' | 'frame' = 'diagram';

  const DIR_ICONS: Record<CalloutDir, string> = {
    top: '▲', bottom: '▼', left: '◀', right: '▶', free: 'Float',
  };
  const DIR_LABELS: Record<CalloutDir, string> = {
    top: 'Above cell', bottom: 'Below cell', left: 'Left of cell', right: 'Right of cell', free: 'Float freely (drag)',
  };
  const ALL_DIRS: CalloutDir[] = ['top', 'left', 'right', 'bottom', 'free'];

  $: currentCallout = $editingCallout
    ? ($currentFrame.callouts ?? []).find(c => c.col === $editingCallout!.col && c.row === $editingCallout!.row) ?? null
    : null;

  function upsertCallout(col: number, row: number, text: string) {
    const idx = get(currentFrameIndex);
    const d = get(diagram);
    const frame = d.frames[idx];
    const existing = (frame.callouts ?? []).find(c => c.col === col && c.row === row);
    const callouts = (frame.callouts ?? []).filter(c => !(c.col === col && c.row === row));
    if (text) callouts.push({
      col, row, text,
      dir: existing?.dir ?? 'top',
      freeX: existing?.freeX,
      freeY: existing?.freeY,
    });
    diagram.set(updateFrame(d, idx, { ...frame, callouts }));
  }

  function removeCallout(col: number, row: number) {
    upsertCallout(col, row, '');
    editingCallout.set(null);
  }

  function toggleFrameInput(id: import('../types/frame').InputId) {
    const idx = get(currentFrameIndex);
    const d = get(diagram);
    const frame = d.frames[idx];
    const inputs = { ...(frame.inputs ?? {}) };
    const cur = inputs[id];
    if (!cur) inputs[id] = 'pressed';
    else if (cur === 'pressed') inputs[id] = 'hold';
    else delete inputs[id];
    diagram.set(updateFrame(d, idx, { ...frame, inputs: Object.keys(inputs).length ? inputs : undefined }));
  }

  function setCalloutDir(col: number, row: number, dir: CalloutDir) {
    const idx = get(currentFrameIndex);
    const d = get(diagram);
    const frame = d.frames[idx];
    const callouts = (frame.callouts ?? []).map(c => {
      if (c.col !== col || c.row !== row) return c;
      if (dir !== 'free') return { ...c, dir, freeX: undefined, freeY: undefined };
      // Switching to free: initialize position above the cell (like 'top')
      if (c.freeX !== undefined) return { ...c, dir };
      const cellSize = get(renderConfig).cellSize;
      const W = BOARD_COLS * cellSize;
      const H = BOARD_ROWS * cellSize;
      const tailH = Math.max(6, cellSize * 0.22);
      const initBX = Math.max(2, c.col * cellSize + cellSize / 2 - 40);
      const initBY = Math.max(2, (BOARD_ROWS - 1 - c.row) * cellSize - tailH - 30);
      return { ...c, dir, freeX: initBX / W, freeY: initBY / H };
    });
    diagram.set(updateFrame(d, idx, { ...frame, callouts }));
  }
</script>

<svelte:window bind:innerWidth />
<div class="layout">
  <!-- Top bar -->
  <header class="topbar">
    <span class="title">Tedige</span>
    <div class="topbar-controls">
      <button class="btn" on:click={newDiagram} title="New empty diagram">New</button>
      <button class="btn" on:click={() => isPlaying.update(v => !v)}>
        {$isPlaying ? '⏸ Pause' : '▶ Play'}
      </button>
      <button class="btn btn-cv" on:click={() => showCapture.set(true)} title="Capture: detect board state from a live video stream">Capture (experimental)</button>
      <button class="btn" on:click={() => showSettings.update(v => !v)} title="Settings: skin, cell size, keybindings, theme">Settings</button>
      <button class="btn btn-accent" on:click={() => showExport.update(v => !v)}>Import / Export</button>
      <button class="btn" on:click={() => showShortcuts.update(v => !v)} title="Keyboard shortcuts (?)">?</button>
      <button class="btn btn-theme" on:click={cycleTheme} title={THEME_TITLES[$themeMode]}>{THEME_ICONS[$themeMode]}</button>
      <a class="btn btn-github" href="https://github.com/PetitPrince/tedige-3" target="_blank" rel="noopener noreferrer" title="View on GitHub">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
      </a>
    </div>
  </header>

  <!-- Main area -->
  <div class="main">
    <!-- Left: timeline -->
    {#if !isMobile}
    <aside class="sidebar sidebar-left">
      <DiagramSettings />
      <hr class="divider" />
      <FrameTimeline />
    </aside>
    {/if}

    <!-- Centre: board + side displays -->
    <section class="board-area">
      <div class="board-center">
      <div class="board-row">
        <div class="hold-col">
          <div class="label">HOLD</div>
          <HoldDisplay />
        </div>

        <div class="board-col">
          {#if $nextQueueLayout === 'horizontal'}
            <NextQueue />
          {/if}
          <BoardCanvas />
          <div class="input-display-strip">
            <InputDisplay inputs={$currentFrame?.inputs ?? {}} hiddenCategories={$diagram.hiddenInputs ?? []} onToggle={toggleFrameInput} />
          </div>
        </div>

        {#if $nextQueueLayout === 'vertical'}
          <div class="next-col">
            <NextQueue vertical />
          </div>
        {/if}

        {#if !isMobile}
        <div class="board-right">
          <div class="right-label">TITLE</div>
          <input
            class="comment-input"
            type="text"
            placeholder="Frame title…"
            value={$currentFrame.comment}
            on:input={(e) => {
              const idx = get(currentFrameIndex);
              const d = get(diagram);
              diagram.set(updateFrame(d, idx, { ...d.frames[idx], comment: e.currentTarget.value }));
            }}
          />

          {#if $currentFrame?.activePiece}
            <hr class="right-divider" />
            <div class="right-label-row">
              <span class="right-label">ACTIVE PIECE</span>
              <div class="piece-info-wrap">
                <button class="piece-info-btn">ⓘ</button>
                <div class="piece-info-popup">
                  <div class="piece-info-row"><kbd>Shift+←/→</kbd><span>Move left / right</span></div>
                  <div class="piece-info-row"><kbd>Shift+↓</kbd><span>Soft drop</span></div>
                  <div class="piece-info-row"><kbd>Shift+↑</kbd><span>Sonic drop (ARS) / Hard drop (SRS)</span></div>
                  <div class="piece-info-row"><kbd>{formatBinding($keyMap['piece-hold'])}</kbd><span>Hold</span></div>
                  <div class="piece-info-row"><kbd>{formatBinding($keyMap['piece-lock'])}</kbd><span>Lock</span></div>
                  <div class="piece-info-row"><kbd>{formatBinding($keyMap['piece-step'])}</kbd><span>Step</span></div>
                  <div class="piece-info-row"><kbd>{formatBinding($keyMap['rotate-ccw'])}</kbd><kbd>{formatBinding($keyMap['rotate-cw'])}</kbd><span>Rotate</span></div>
                </div>
              </div>
            </div>
          {/if}
          <hr class="right-divider" />
          <ActivePieceControls />

          {#if $activeTool === 'callout'}
            <hr class="right-divider" />
            <div class="right-label">CALLOUT</div>
            <div class="callout-editor">
              {#if $editingCallout}
                <span class="callout-cell">col {$editingCallout.col + 1}, row {$editingCallout.row + 1}</span>
                <div class="callout-dir-group">
                  <span class="callout-dir-label">Tail</span>
                  <div class="dir-picker">
                    {#each ALL_DIRS as dir}
                      <button
                        class="dir-btn"
                        class:dir-btn-free={dir === 'free'}
                        class:active={currentCallout?.dir === dir || (!currentCallout?.dir && dir === 'top')}
                        on:click={() => { if ($editingCallout) setCalloutDir($editingCallout.col, $editingCallout.row, dir); }}
                        title={DIR_LABELS[dir]}
                      >{DIR_ICONS[dir]}</button>
                    {/each}
                  </div>
                </div>
                {#if currentCallout?.dir === 'free'}
                  <span class="callout-hint">Drag the bubble to reposition it</span>
                {/if}
                <span class="callout-dir-label">Text</span>
                {#key $editingCallout}
                  <div class="callout-row">
                    <textarea
                      class="callout-input"
                      placeholder="Callout text…"
                      rows="2"
                      value={$currentFrame.callouts?.find(c => c.col === $editingCallout.col && c.row === $editingCallout.row)?.text ?? ''}
                      on:input={(e) => {
                        if ($editingCallout) upsertCallout($editingCallout.col, $editingCallout.row, e.currentTarget.value);
                      }}
                      use:focusEl
                    ></textarea>
                    <button class="callout-remove" on:click={() => { if ($editingCallout) removeCallout($editingCallout.col, $editingCallout.row); }}>✕</button>
                  </div>
                {/key}
              {:else}
                <span class="callout-hint">Click a cell to add a callout</span>
              {/if}
            </div>
          {/if}

          <hr class="right-divider" />
          <div class="right-label">MIRROR</div>
          <div class="btn-group" style="display:flex;gap:4px;">
            <button class="dir-btn" style="width:auto;padding:0 6px;font-size:10px;" on:click={mirrorCurrentFrame} title="Mirror current frame (Shift+M)">Frame</button>
            <button class="dir-btn" style="width:auto;padding:0 6px;font-size:10px;" on:click={mirrorAllFrames} title="Mirror all frames">All</button>
          </div>
        </div>
        {/if}

      </div>
      </div>
    </section>

    <!-- Right: tools -->
    {#if !isMobile}
    <aside class="sidebar sidebar-right">
      <Toolbar />
      <hr class="divider" />
      <PieceSelector />
    </aside>
    {/if}
  </div>

  <!-- Overlays -->
  {#if $showExport}
    <div class="overlay-backdrop" on:click={() => showExport.set(false)} role="presentation">
      <div class="overlay-panel" on:click|stopPropagation role="presentation">
        <ExportPanel />
      </div>
    </div>
  {/if}

  {#if $showSettings}
    <div class="overlay-backdrop" on:click={() => showSettings.set(false)} role="presentation">
      <div class="overlay-panel" on:click|stopPropagation role="presentation">
        <SettingsPanel />
      </div>
    </div>
  {/if}

  {#if $showCapture}
    <div class="overlay-backdrop" on:click={() => showCapture.set(false)} role="presentation">
      <div class="overlay-panel overlay-panel-wide" on:click|stopPropagation role="presentation">
        <CapturePanel />
      </div>
    </div>
  {/if}

  <!-- Mobile bottom bar -->
  {#if isMobile}
  <div class="mobile-bar">
    <div class="mobile-tabs">
      <button class="mobile-tab" class:active={mobileTab === 'diagram'} on:click={() => mobileTab = 'diagram'}>Diagram</button>
      <button class="mobile-tab" class:active={mobileTab === 'tools'}   on:click={() => mobileTab = 'tools'}>Tools</button>
      <button class="mobile-tab" class:active={mobileTab === 'frame'}   on:click={() => mobileTab = 'frame'}>Frame</button>
    </div>
    <div class="mobile-panel">
      {#if mobileTab === 'diagram'}
        <DiagramSettings />
        <hr class="divider" />
        <FrameTimeline horizontal />
      {:else if mobileTab === 'tools'}
        <Toolbar />
        <hr class="divider" />
        <PieceSelector />
      {:else}
        <div class="right-label">TITLE</div>
        <input
          class="comment-input"
          type="text"
          placeholder="Frame title…"
          value={$currentFrame.comment}
          on:input={(e) => {
            const idx = get(currentFrameIndex);
            const d = get(diagram);
            diagram.set(updateFrame(d, idx, { ...d.frames[idx], comment: e.currentTarget.value }));
          }}
        />
        {#if $currentFrame?.activePiece}
          <div class="right-label-row" style="margin-top: 6px;">
            <span class="right-label">ACTIVE PIECE</span>
            <div class="piece-info-wrap">
              <button class="piece-info-btn">ⓘ</button>
              <div class="piece-info-popup">
                <div class="piece-info-row"><kbd>Shift+←/→</kbd><span>Move left / right</span></div>
                <div class="piece-info-row"><kbd>Shift+↓</kbd><span>Soft drop</span></div>
                <div class="piece-info-row"><kbd>Shift+↑</kbd><span>Hard drop</span></div>
                <div class="piece-info-row"><kbd>{formatBinding($keyMap['piece-hold'])}</kbd><span>Hold</span></div>
                <div class="piece-info-row"><kbd>{formatBinding($keyMap['piece-lock'])}</kbd><span>Lock</span></div>
                <div class="piece-info-row"><kbd>{formatBinding($keyMap['piece-step'])}</kbd><span>Step</span></div>
                <div class="piece-info-row"><kbd>{formatBinding($keyMap['rotate-ccw'])}</kbd><kbd>{formatBinding($keyMap['rotate-cw'])}</kbd><span>Rotate</span></div>
              </div>
            </div>
          </div>
        {/if}
        <ActivePieceControls />
        {#if $activeTool === 'callout'}
          <div class="right-label" style="margin-top: 6px;">CALLOUT</div>
          <div class="callout-editor">
            {#if $editingCallout}
              <span class="callout-cell">col {$editingCallout.col + 1}, row {$editingCallout.row + 1}</span>
              <div class="callout-dir-group">
                <span class="callout-dir-label">Tail</span>
                <div class="dir-picker">
                  {#each ALL_DIRS as dir}
                    <button
                      class="dir-btn"
                      class:dir-btn-free={dir === 'free'}
                      class:active={currentCallout?.dir === dir || (!currentCallout?.dir && dir === 'top')}
                      on:click={() => { if ($editingCallout) setCalloutDir($editingCallout.col, $editingCallout.row, dir); }}
                      title={DIR_LABELS[dir]}
                    >{DIR_ICONS[dir]}</button>
                  {/each}
                </div>
              </div>
              {#if currentCallout?.dir === 'free'}
                <span class="callout-hint">Drag the bubble to reposition it</span>
              {/if}
              <span class="callout-dir-label">Text</span>
              {#key $editingCallout}
                <div class="callout-row">
                  <textarea
                    class="callout-input"
                    placeholder="Callout text…"
                    rows="2"
                    value={$currentFrame.callouts?.find(c => c.col === $editingCallout.col && c.row === $editingCallout.row)?.text ?? ''}
                    on:input={(e) => {
                      if ($editingCallout) upsertCallout($editingCallout.col, $editingCallout.row, e.currentTarget.value);
                    }}
                  ></textarea>
                  <button class="callout-remove" on:click={() => { if ($editingCallout) removeCallout($editingCallout.col, $editingCallout.row); }}>✕</button>
                </div>
              {/key}
            {:else}
              <span class="callout-hint">Click a cell to add a callout</span>
            {/if}
          </div>
        {/if}
      {/if}
    </div>
  </div>
  {/if}

</div>

<style>
  .layout {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  .topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 16px;
    height: 44px;
    background: var(--bg-input);
    border-bottom: 1px solid var(--brd-1);
    flex-shrink: 0;
  }

  .title {
    font-size: 18px;
    font-weight: 700;
    letter-spacing: 0.08em;
    color: var(--txt-head);
  }

  .topbar-controls {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  .main {
    display: flex;
    flex: 1;
    overflow: hidden;
  }

  .sidebar {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 8px;
    background: var(--bg-input);
    border-color: var(--brd-1);
    overflow-y: auto;
  }

  .sidebar-left {
    width: 160px;
    border-right: 1px solid var(--brd-1);
    min-width: 120px;
  }

  .sidebar-right {
    width: 140px;
    border-left: 1px solid var(--brd-1);
  }

  .board-area {
    flex: 1;
    overflow: auto;
    background: var(--bg-base);
  }

  .board-center {
    min-height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 12px;
    box-sizing: border-box;
  }

  .board-row {
    display: flex;
    align-items: flex-start;
    gap: 12px;
  }

  .hold-col {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 72px;
  }

  .board-col {
    display: flex;
    flex-direction: column;
    gap: 0;
    align-items: flex-start;
  }

  .next-col {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    align-self: flex-start;
  }

  .board-right {
    display: flex;
    flex-direction: column;
    gap: 6px;
    width: 150px;
    padding-top: 4px;
  }

  .right-label {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.1em;
    color: var(--txt-dim);
  }

  .right-label-row {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .piece-info-wrap {
    position: relative;
    display: flex;
    align-items: center;
  }

  .piece-info-btn {
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    font-size: 11px;
    color: var(--txt-dim);
    line-height: 1;
    opacity: 0.6;
  }
  .piece-info-btn:hover { opacity: 1; color: var(--txt-1); }

  .piece-info-popup {
    display: none;
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    z-index: 50;
    background: var(--bg-2);
    border: 1px solid var(--brd-2);
    border-radius: var(--r);
    padding: 6px 8px;
    white-space: nowrap;
    box-shadow: 0 4px 12px rgba(0,0,0,0.4);
    flex-direction: column;
    gap: 3px;
  }
  .piece-info-wrap:hover .piece-info-popup,
  .piece-info-wrap:focus-within .piece-info-popup {
    display: flex;
  }

  .piece-info-row {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    color: var(--txt-2);
  }
  .piece-info-row kbd {
    background: var(--bg-3);
    border: 1px solid var(--brd-3);
    border-radius: 3px;
    padding: 1px 4px;
    font-size: 10px;
    font-family: monospace;
    color: var(--txt-0);
  }
  .piece-info-row span { color: var(--txt-2); }

  .right-divider {
    border: none;
    border-top: 1px solid var(--brd-1);
    margin: 2px 0;
  }

  .input-display-strip {
    width: 100%;
    box-sizing: border-box;
    background: var(--bg-base);
    border: 1px solid var(--bg-1);
    border-top: none;
    padding: 2px 6px;
    display: flex;
    justify-content: center;
  }

  .comment-input {
    width: 100%;
    box-sizing: border-box;
    background: var(--bg-input);
    border: 1px solid var(--brd-1);
    border-radius: var(--r-sm);
    color: var(--txt-0);
    font-size: 12px;
    padding: 4px 6px;
    outline: none;
  }
  .comment-input::placeholder { color: var(--brd-2); }
  .comment-input:focus { border-color: var(--txt-dim); }

  .callout-editor {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .callout-cell {
    font-size: 10px;
    color: var(--txt-dim);
    font-weight: 600;
    letter-spacing: 0.04em;
  }

  .callout-dir-group {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .callout-dir-label {
    font-size: 10px;
    color: var(--txt-dim);
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .callout-hint {
    font-size: 11px;
    color: var(--brd-2);
    font-style: italic;
  }

  .callout-row {
    display: flex;
    gap: 4px;
    align-items: flex-start;
  }

  .callout-input {
    flex: 1;
    box-sizing: border-box;
    background: var(--bg-input);
    border: 1px solid var(--brd-1);
    border-radius: var(--r-sm);
    color: var(--txt-0);
    font-size: 12px;
    font-family: inherit;
    padding: 4px 6px;
    outline: none;
    resize: vertical;
    min-height: 36px;
  }
  .callout-input::placeholder { color: var(--brd-2); }
  .callout-input:focus { border-color: var(--txt-dim); }

  .dir-picker {
    display: flex;
    gap: 3px;
  }

  .dir-btn {
    width: 24px;
    height: 24px;
    background: var(--bg-1);
    border: 1px solid var(--brd-1);
    border-radius: var(--r-sm);
    color: var(--accent);
    cursor: pointer;
    font-size: 11px;
    padding: 0;
    line-height: 1;
    text-align: center;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .dir-btn-free {
    width: auto;
    padding: 0 6px;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.04em;
  }
  .dir-btn:hover { background: var(--bg-2); border-color: var(--brd-3); color: var(--purple-hover); }
  .dir-btn.active { background: var(--bg-3); border-color: var(--accent); color: var(--txt-0); }

  .callout-remove {
    background: var(--bg-1);
    border: 1px solid var(--brd-1);
    border-radius: var(--r-sm);
    color: var(--accent);
    cursor: pointer;
    font-size: 12px;
    padding: 3px 6px;
    line-height: 1;
    flex-shrink: 0;
  }
  .callout-remove:hover { background: var(--danger-bg); border-color: var(--danger-brd); color: var(--danger); }

  .label {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.1em;
    color: var(--txt-dim);
    text-align: center;
  }

  .divider {
    border: none;
    border-top: 1px solid var(--brd-1);
    margin: 4px 0;
  }

  .btn {
    padding: 4px 10px;
    background: var(--bg-2);
    border: 1px solid var(--brd-2);
    border-radius: var(--r);
    color: var(--txt-0);
    cursor: pointer;
    font-size: 13px;
    transition: background 0.15s;
  }
  .btn:hover { background: var(--bg-3); }
  .btn-accent { background: var(--accent-bg); border-color: var(--accent-brd); color: var(--accent-text); }
  .btn-accent:hover { background: var(--accent-bg-hi); }
  .btn-cv { background: var(--blue-bg); border-color: var(--blue-brd); color: var(--blue-text); }
  .btn-cv:hover { background: var(--blue-bg-hi); }
  .btn-theme { font-size: 15px; padding: 2px 8px; min-width: 32px; }
  .btn-github { display: inline-flex; align-items: center; padding: 4px 8px; text-decoration: none; }
  .overlay-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
  }

  .overlay-panel {
    background: var(--bg-1);
    border: 1px solid var(--brd-2);
    border-radius: var(--r-lg);
    padding: 24px;
    min-width: 320px;
    max-width: 520px;
    max-height: 80vh;
    overflow-y: auto;
  }

  .overlay-panel-wide {
    max-width: 900px;
    width: 92vw;
  }

  /* ── Mobile bottom bar ─────────────────────────────────────────── */
  .mobile-bar {
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    background: var(--bg-input);
    border-top: 1px solid var(--brd-1);
    height: 200px;
  }

  .mobile-tabs {
    display: flex;
    flex-shrink: 0;
    border-bottom: 1px solid var(--brd-1);
  }

  .mobile-tab {
    flex: 1;
    padding: 8px 0;
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--txt-2);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    letter-spacing: 0.04em;
    transition: color 0.1s, border-color 0.1s;
  }
  .mobile-tab:hover { color: var(--txt-1); }
  .mobile-tab.active { color: var(--txt-0); border-bottom-color: var(--accent); }

  .mobile-panel {
    flex: 1;
    overflow-y: auto;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-height: 0;
  }
</style>
