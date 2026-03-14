<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { currentFrame, diagram, renderConfig, getFrameState } from '../editor/store';
  import { checkpoint } from '../editor/history';
  import { renderPiecePreview } from '../renderer/board-renderer';
  import { getRotationSystem } from '../rotation/index';
  import { updateFrame } from '../engine/frame-ops';
  import type { PieceType } from '../types/piece';

  const CELL = 18;
  const PREVIEW_PX = 4 * CELL; // 4×4 preview area

  let canvas: HTMLCanvasElement;
  let ctx: CanvasRenderingContext2D;

  /**
   * Draws the hold piece preview on the canvas.
   */
  function draw() {
    if (!ctx) return;
    const frame = get(currentFrame);
    const rotSys = getRotationSystem(get(diagram).rotationSystem);
    const skin = get(renderConfig).skin;
    ctx.clearRect(0, 0, PREVIEW_PX, PREVIEW_PX);
    ctx.fillStyle = skin.previewBackgroundColor;
    ctx.fillRect(0, 0, PREVIEW_PX, PREVIEW_PX);
    if (frame.holdPiece !== undefined) {
      renderPiecePreview(ctx, 0, 0, frame.holdPiece, rotSys, CELL, 4, 2, false, skin);
    } else {
      ctx.fillStyle = '#505058';
      ctx.font = '8px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Click', PREVIEW_PX / 2, PREVIEW_PX / 2 - 6);
      ctx.fillText('to cycle', PREVIEW_PX / 2, PREVIEW_PX / 2 + 6);
    }
  }

  $: { $currentFrame; $renderConfig; draw(); }

  onMount(() => {
    ctx = canvas.getContext('2d')!;
    draw();
  });
  /**
   * Handles the click event to cycle the hold piece.
   */
  function handleClick() {
    const frame = get(currentFrame);
    const current = frame.holdPiece;
    // Cycle: empty → I → O → T → S → Z → J → L → empty
    const next: PieceType | undefined =
      current === undefined ? 0 :
      current >= 6          ? undefined :
      (current + 1) as PieceType;
    checkpoint();
    const { d, idx } = getFrameState();
    diagram.set(updateFrame(d, idx, { ...frame, holdPiece: next }));
  }

  /**
   * Handles the context menu event to prevent default behavior.
   * @param {MouseEvent} e - The context menu event.
   */
  function handleContextmenu(e: MouseEvent) {
    e.preventDefault();
    const frame = get(currentFrame);
    if (frame.holdPiece === undefined) return;
    checkpoint();
    const { d, idx } = getFrameState();
    diagram.set(updateFrame(d, idx, { ...frame, holdPiece: undefined }));
  }
</script>

<canvas
  bind:this={canvas}
  width={PREVIEW_PX}
  height={PREVIEW_PX}
  on:click={handleClick}
  on:contextmenu={handleContextmenu}
  style="cursor:pointer; display:block; outline: 1px dashed var(--bg-2);"
></canvas>
