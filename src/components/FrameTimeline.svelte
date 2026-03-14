<script lang="ts">
  import { get } from 'svelte/store';
  import { diagram, currentFrameIndex, frameOrderDesc } from '../editor/store';
  import { checkpoint } from '../editor/history';
  import {
    insertFrameAfter, deleteFrame, duplicateFrame,
    advanceFrame, moveFrame,
  } from '../engine/frame-ops';
  import { getRotationSystem } from '../rotation/index';
  import FrameThumb from './FrameThumb.svelte';

  $: frames = $diagram.frames;
  $: rotSys = getRotationSystem($diagram.rotationSystem);
  $: displayFrames = $frameOrderDesc
    ? frames.map((f, i) => ({ frame: f, realIndex: i })).reverse()
    : frames.map((f, i) => ({ frame: f, realIndex: i }));

  /**
   * Selects a frame by its index.
   * @param {number} i - The index of the frame to select.
   */
  function selectFrame(idx: number) {
    currentFrameIndex.set(idx);
  }

  /**
   * Adds a new frame to the timeline.
   */
  function addFrame() {
    checkpoint();
    diagram.set(insertFrameAfter(get(diagram), get(currentFrameIndex)));
    currentFrameIndex.update(i => i + 1);
  }

  /**
   * Duplicates the currently selected frame.
   */
  function dupFrame() {
    checkpoint();
    diagram.set(duplicateFrame(get(diagram), get(currentFrameIndex)));
    currentFrameIndex.update(i => i + 1);
  }

  /**
   * Deletes the currently selected frame.
   */
  function delFrame() {
    const d = get(diagram);
    if (d.frames.length <= 1) return;
    checkpoint();
    const idx = get(currentFrameIndex);
    diagram.set(deleteFrame(d, idx));
    currentFrameIndex.set(Math.min(idx, get(diagram).frames.length - 1));
  }

  /**
   * Advances the timeline to the next frame.
   */
  function advance() {
    checkpoint();
    const d = get(diagram);
    const idx = get(currentFrameIndex);
    const rotSys = getRotationSystem(d.rotationSystem);
    const { diagram: next, newIndex } = advanceFrame(d, idx, rotSys);
    diagram.set(next);
    currentFrameIndex.set(newIndex);
  }

  export let horizontal = false;

  // Drag-to-reorder
  let dragFrom: number | null = null;

  /**
   * Handles the drag start event for a frame.
   * @param {number} i - The index of the frame being dragged.
   */
  function onDragstart(i: number) { dragFrom = i; }
  /**
   * Handles the drag over event for a frame.
   * @param {DragEvent} e - The drag event.
   * @param {number} i - The index of the frame being dragged over.
   */
  function onDragover(e: DragEvent, realIdx: number) {
    e.preventDefault();
    if (dragFrom === null || dragFrom === realIdx) return;
    checkpoint();
    diagram.set(moveFrame(get(diagram), dragFrom, realIdx));
    currentFrameIndex.set(realIdx);
    dragFrom = realIdx;
  }
  /**
   * Handles the drag end event for a frame.
   */
  function onDragend() { dragFrom = null; }
</script>

<div class="timeline" class:horizontal>
  <div class="timeline-actions">
    <button class="action-btn" title="Add frame (N)" on:click={addFrame}>+</button>
    <button class="action-btn" title="Duplicate frame" on:click={dupFrame}>⊕</button>
    <button class="action-btn" title="Delete frame (Shift+Del)" on:click={delFrame}>−</button>
    <button class="action-btn advance" title="Simulate lock (Enter)" on:click={advance}>▶|</button>
    <button class="action-btn" title="Toggle frame order" on:click={() => frameOrderDesc.update(v => !v)}>{$frameOrderDesc ? '▲' : '▼'}</button>
  </div>

  <div class="frames">
    {#each displayFrames as { frame, realIndex } (realIndex)}
      <div
        draggable="true"
        role="option"
        tabindex={realIndex}
        aria-selected={$currentFrameIndex === realIndex}
        on:click={() => selectFrame(realIndex)}
        on:keydown={(e) => e.key === 'Enter' && selectFrame(realIndex)}
        on:dragstart={() => onDragstart(realIndex)}
        on:dragover={(e) => onDragover(e, realIndex)}
        on:dragend={onDragend}
      >
        <FrameThumb {frame} {rotSys} selected={$currentFrameIndex === realIndex} index={realIndex} />
      </div>
    {/each}
  </div>
</div>

<style>
  .timeline {
    display: flex;
    flex-direction: column;
    height: 100%;
    gap: 4px;
  }

  .timeline-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 3px;
  }

  .action-btn {
    flex: 1;
    background: var(--bg-2);
    border: 1px solid var(--brd-2);
    border-radius: var(--r-sm);
    color: var(--txt-1);
    cursor: pointer;
    font-size: 14px;
    padding: 2px;
    min-width: 24px;
    transition: background 0.1s;
  }
  .action-btn:hover { background: var(--bg-3); }
  .action-btn.advance { color: var(--advance-clr); }

  .frames {
    display: flex;
    flex-direction: column;
    gap: 4px;
    overflow-y: auto;
    flex: 1;
  }

  /* ── Horizontal mode (mobile bottom bar) ── */
  .timeline.horizontal {
    flex-direction: row;
    align-items: stretch;
    height: 100%;
    gap: 6px;
  }
  .timeline.horizontal .timeline-actions {
    flex-direction: column;
    flex-wrap: nowrap;
    flex-shrink: 0;
    width: 28px;
    gap: 3px;
  }
  .timeline.horizontal .timeline-actions .action-btn {
    flex: 1;
    min-width: 0;
    font-size: 13px;
  }
  .timeline.horizontal .frames {
    flex-direction: row;
    overflow-x: auto;
    overflow-y: hidden;
    flex: 1;
    align-items: flex-start;
  }
</style>
