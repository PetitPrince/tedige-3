<script lang="ts">
  import { onMount } from 'svelte';
  import EditorLayout from './EditorLayout.svelte';
  import KeyboardShortcuts from './KeyboardShortcuts.svelte';
  import {
    diagram, currentFrameIndex, drawCellType,
    isPlaying, showShortcuts, showExport, showSettings,
    canUndo, canRedo, isRecordMode, lastPaletteSection,
    themeMode, getFrameState,
  } from '../editor/store';
  import type { ThemeMode } from '../editor/store';
  import { handleRecordInput } from '../editor/record-mode';
  import { undo, redo, checkpoint } from '../editor/history';
  import { rotateActivePiece, mirrorCurrentFrame, selectTool } from '../editor/actions';
  import { keyMap, matches, isCapturingKey } from '../editor/keybindings';
  import { movePiece, hardDrop, holdPiece } from '../engine/play-ops';
  import { boardWithPiece } from '../engine/board';
  import { computeGhost } from '../engine/ghost';
  import { PieceType, ALL_PIECE_TYPES } from '../types/piece';
  import { CellType } from '../types/board';
  import { decodeDiagram } from '../export/url-codec';
  import { get } from 'svelte/store';
  import {
    insertFrameAfter, deleteFrame, duplicateFrame, advanceFrame, updateFrame,
  } from '../engine/frame-ops';
  import { getRotationSystem } from '../rotation/index';
  import { LF_DEFAULT_MS } from '../types/frame';

  /**
   * Resolves the theme mode to either 'light' or 'dark'.
   * @param {ThemeMode} mode - The theme mode ('light', 'dark', or 'os').
   * @returns {'light' | 'dark'} - The resolved theme.
   */
  function resolveTheme(mode: ThemeMode): 'light' | 'dark' {
    if (mode === 'light') return 'light';
    if (mode === 'dark') return 'dark';
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }

  $: document.documentElement.setAttribute('data-theme', resolveTheme($themeMode));

  // Load from URL hash on mount, falling back to localStorage
  onMount(() => {
    const hash = window.location.hash;
    if (hash.startsWith('#v')) {
      try {
        const decoded = decodeDiagram(hash.slice(1)); // strip '#'
        diagram.set(decoded);
        currentFrameIndex.set(0);
      } catch (e) {
        console.warn('Failed to decode diagram from URL:', e);
      }
    } else {
      try {
        const saved = localStorage.getItem('tedige-diagram');
        if (saved) {
          const decoded = decodeDiagram(saved);
          diagram.set(decoded);
          currentFrameIndex.set(0);
        }
      } catch (e) {
        console.warn('Failed to decode diagram from localStorage:', e);
      }
    }

    // Watch OS preference changes for 'os' mode
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const handler = () => {
      if (get(themeMode) === 'os') {
        document.documentElement.setAttribute('data-theme', mq.matches ? 'light' : 'dark');
      }
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  });

  let playbackTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Schedules the next playback tick based on the current frame's delay.
   */
  function scheduleTick() {
    const { d, idx, frame } = getFrameState();
    const delay = frame?.lockFlash ? LF_DEFAULT_MS : d.animationDelayMs;
    playbackTimer = setTimeout(tick, delay);
  }

  /**
   * Advances the playback to the next frame.
   */
  function tick() {
    playbackTimer = null;
    const { d, idx } = getFrameState();
    const next = (idx + 1) % d.frames.length;
    currentFrameIndex.set(next);
    if (get(isPlaying)) scheduleTick();
  }

  $: if ($isPlaying) {
    if (!playbackTimer) scheduleTick();
  } else {
    if (playbackTimer) { clearTimeout(playbackTimer); playbackTimer = null; }
  }

  // ── Piece manipulation helpers (Shift+Arrow / H) ──────────────────────────
  /**
   * Moves the active piece by a specified number of columns and rows.
   * @param {number} deltaCol - The change in columns (delta column).
   * @param {number} deltaRow - The change in rows (delta row).
   */
  function shiftMove(deltaCol: number, deltaRow: number) {
    const { d, idx } = getFrameState();
    const rotSys = getRotationSystem(d.rotationSystem);
    const result = movePiece(d.frames[idx], deltaCol, deltaRow, rotSys);
    if (!result) return;
    checkpoint();
    diagram.set(updateFrame(d, idx, result));
  }

  /**
   * Performs a hard drop or sonic drop for the active piece.
   */
  function shiftHardDrop() {
    const { d, idx, frame } = getFrameState();
    if (!frame.activePiece) return;
    const rotSys = getRotationSystem(d.rotationSystem);

    if (d.rotationSystem === 'ars') {
      // Sonic drop: move piece to ghost row, no lock
      const ghost = computeGhost(frame.activePiece, frame.board, rotSys);
      if (ghost.row === frame.activePiece.row) return;
      const result = { ...frame, activePiece: ghost, comment: '', callouts: [] };
      checkpoint();
      const frames = [...d.frames];
      frames.splice(idx + 1, 0, result);
      diagram.set({ ...d, frames });
      currentFrameIndex.set(idx + 1);
    } else {
      // Hard drop: lock, clear lines, spawn next
      const result = hardDrop(frame, rotSys);
      if (!result) return;
      checkpoint();
      const frames = [...d.frames];
      frames.splice(idx + 1, 0, result.nextFrame);
      diagram.set({ ...d, frames });
      currentFrameIndex.set(idx + 1);
    }
  }

  /**
   * Cycles the piece type or draw cell type based on the last palette section.
   * @param {1 | -1} dir - The direction of cycling (1 for forward, -1 for backward).
   */
  function cyclePieceTypeKey(dir: 1 | -1 = 1) {
    if (get(lastPaletteSection) === 'piece') {
      const { d, idx, frame } = getFrameState();
      if (frame.activePiece) {
        const newType = ((frame.activePiece.type + dir + 7) % 7) as PieceType;
        checkpoint();
        diagram.set(updateFrame(d, idx, { ...frame, activePiece: { ...frame.activePiece, type: newType } }));
      }
      // If piece section was last clicked but no active piece, nothing to cycle
    } else {
      // Cycle draw cell type: CellType values 1–8 (I through Garbage)
      const cur = get(drawCellType);
      drawCellType.set(((cur - 1 + dir + 8) % 8 + 1) as CellType);
    }
  }

  /**
   * Holds the active piece.
   */
  function holdKey() {
    const { d, idx } = getFrameState();
    const rotSys = getRotationSystem(d.rotationSystem);
    const result = holdPiece(d.frames[idx], rotSys);
    if (!result) return;
    checkpoint();
    diagram.set(updateFrame(d, idx, result));
  }

  /**
   * Locks the active piece onto the board.
   */
  function lockPieceKey() {
    const { d, idx, frame } = getFrameState();
    if (!frame.activePiece) return;
    const rotSys = getRotationSystem(d.rotationSystem);
    const shape = rotSys.getShape(frame.activePiece.type, frame.activePiece.rotation);
    checkpoint();
    const flashFrame = { ...frame, lockFlash: true as const };
    const settledFrame = {
      ...frame,
      board: boardWithPiece(frame.board, frame.activePiece, shape),
      activePiece: undefined as undefined,
      lockFlash: undefined as undefined,
    };
    const frames = [...d.frames];
    frames[idx] = flashFrame;
    frames.splice(idx + 1, 0, settledFrame);
    diagram.set({ ...d, frames });
    currentFrameIndex.set(idx + 1);
  }

  /**
   * Steps the active piece down by one row.
   */
  function stepPieceKey() {
    const { d, idx } = getFrameState();
    const rotSys = getRotationSystem(d.rotationSystem);
    const result = movePiece(d.frames[idx], 0, -1, rotSys);
    if (!result) return;
    checkpoint();
    const frames = [...d.frames];
    frames.splice(idx + 1, 0, result);
    diagram.set({ ...d, frames });
    currentFrameIndex.set(idx + 1);
  }

  /**
   * Handles keydown events for various actions and shortcuts.
   * @param {KeyboardEvent} e - The keydown event.
   */
  function handleKeydown(e: KeyboardEvent) {
    // Don't intercept while typing in an input or remapping a key
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (get(isCapturingKey)) return;

    // ── Record mode intercept ─────────────────────────────────────────────────
    if (get(isRecordMode)) {
      if (e.key === 'Escape') { e.preventDefault(); isRecordMode.set(false); return; }
      const recordKeys = ['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp', ' ', 'z', 'Z', 'x', 'X', 'c', 'C'];
      if (recordKeys.includes(e.key)) { e.preventDefault(); handleRecordInput(e.key); return; }
      // Ctrl+Z undo, frame timeline navigation, etc. fall through unchanged
    }

    // ── Shift+Arrow: move active piece; H: hold ───────────────────────────────
    if (e.shiftKey && !e.ctrlKey && !e.metaKey) {
      if (e.key === 'ArrowLeft')  { e.preventDefault(); shiftMove(-1,  0); return; }
      if (e.key === 'ArrowRight') { e.preventDefault(); shiftMove( 1,  0); return; }
      if (e.key === 'ArrowDown')  { e.preventDefault(); shiftMove( 0, -1); return; }
      if (e.key === 'ArrowUp')    { e.preventDefault(); shiftHardDrop();   return; }
    }
    const km = get(keyMap);
    const { d, idx } = getFrameState();
    const n  = d.frames.length;

    // ── Configurable bindings ─────────────────────────────────────────────────
    if (matches(e, km['rotate-cw']))       { e.preventDefault(); rotateActivePiece('cw');  return; }
    if (matches(e, km['rotate-ccw']))      { e.preventDefault(); rotateActivePiece('ccw'); return; }
    if (matches(e, km['frame-prev']))      { e.preventDefault(); currentFrameIndex.set(Math.max(0, idx - 1)); return; }
    if (matches(e, km['frame-next']))      { e.preventDefault(); currentFrameIndex.set(Math.min(n - 1, idx + 1)); return; }
    if (matches(e, km['play-pause']))      { e.preventDefault(); isPlaying.update(v => !v); return; }
    if (matches(e, km['undo']))            { e.preventDefault(); undo(); return; }
    if (matches(e, km['redo']))            { e.preventDefault(); redo(); return; }
    if (matches(e, km['piece-lock']))      { e.preventDefault(); lockPieceKey();  return; }
    if (matches(e, km['piece-step']))      { e.preventDefault(); stepPieceKey();  return; }
    if (matches(e, km['piece-hold']))      { e.preventDefault(); holdKey();           return; }
    if (matches(e, km['piece-cycle-type-prev'])) { e.preventDefault(); cyclePieceTypeKey(-1); return; }
    if (matches(e, km['piece-cycle-type']))      { e.preventDefault(); cyclePieceTypeKey();    return; }
    if (matches(e, km['tool-draw']))       { selectTool('draw');       return; }
    if (matches(e, km['tool-erase']))      { selectTool('erase');      return; }
    if (matches(e, km['tool-fill']))       { selectTool('fill');       return; }

    // ── Tool shortcuts ────────────────────────────────────────────────────────
    if (e.key === 'c' && !e.ctrlKey && !e.metaKey && !e.shiftKey) { selectTool('callout'); return; }
    if (e.key === 'o' && !e.ctrlKey && !e.metaKey) { selectTool('overlay'); return; }
    if (e.key === 'M' && e.shiftKey && !e.ctrlKey && !e.metaKey) { e.preventDefault(); mirrorCurrentFrame(); return; }
    if (matches(e, km['frame-insert'])) {
      e.preventDefault();
      diagram.set(insertFrameAfter(d, idx));
      currentFrameIndex.set(idx + 1);
      return;
    }
    if (matches(e, km['frame-delete'])) {
      e.preventDefault();
      const updated = deleteFrame(d, idx);
      diagram.set(updated);
      currentFrameIndex.set(Math.min(idx, updated.frames.length - 1));
      return;
    }
    if (matches(e, km['frame-advance'])) {
      e.preventDefault();
      const rotSys = getRotationSystem(d.rotationSystem);
      const { diagram: next, newIndex } = advanceFrame(d, idx, rotSys);
      diagram.set(next);
      currentFrameIndex.set(newIndex);
      return;
    }

    // ── Fixed bindings ────────────────────────────────────────────────────────
    // Ctrl+Shift+Z → redo (alternative)
    if (e.key === 'Z' && e.shiftKey && (e.ctrlKey || e.metaKey)) { e.preventDefault(); redo(); return; }
    // j / l as alternative frame navigation
    if (e.key === 'j' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); currentFrameIndex.set(Math.max(0, idx - 1)); return; }
    if (e.key === 'l' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); currentFrameIndex.set(Math.min(n - 1, idx + 1)); return; }
    // Piece colour shortcuts (1–8)
    if (e.key === '1') { drawCellType.set(CellType.I); return; }
    if (e.key === '2') { drawCellType.set(CellType.O); return; }
    if (e.key === '3') { drawCellType.set(CellType.T); return; }
    if (e.key === '4') { drawCellType.set(CellType.S); return; }
    if (e.key === '5') { drawCellType.set(CellType.Z); return; }
    if (e.key === '6') { drawCellType.set(CellType.J); return; }
    if (e.key === '7') { drawCellType.set(CellType.L); return; }
    if (e.key === '8') { drawCellType.set(CellType.Garbage); return; }
    // UI toggles
    if (e.key === '?') { showShortcuts.update(v => !v); return; }
    if (e.key === 'Escape') {
      showShortcuts.set(false);
      showExport.set(false);
      showSettings.set(false);
    }
  }
</script>

<svelte:window on:keydown={handleKeydown} />

<div class="app">
  <EditorLayout />
  {#if $showShortcuts}
    <KeyboardShortcuts />
  {/if}
</div>

<style>
  .app {
    display: flex;
    flex-direction: column;
    height: 100%;
    width: 100%;
    position: relative;
  }
</style>
