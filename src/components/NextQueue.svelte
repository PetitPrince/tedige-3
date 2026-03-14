<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { currentFrame, diagram, currentFrameIndex, renderConfig } from '../editor/store';
  import { checkpoint } from '../editor/history';
  import { getRotationSystem } from '../rotation/index';
  import { updateFrame } from '../engine/frame-ops';
  import { PieceType } from '../types/piece';
  import { BOARD_COLS } from '../types/board';
  import { pieceTypeToCellType } from '../renderer/colors';
  import { drawCell } from '../renderer/board-renderer';

  export let vertical = false;

  // Number of rows to show in the strip (bounding box of any spawn piece fits in 3 rows).
  const STRIP_ROWS = 3;
  // Column where secondary (small) pieces begin — right edge of widest possible first piece.
  const SECOND_START_COLS = 7; // = center_offset(3) + max_piece_width(4)

  $: maxQueue = $diagram.nextQueueLength ?? 6;

  let canvas: HTMLCanvasElement;
  let ctx: CanvasRenderingContext2D;

  $: cellSize = $renderConfig.cellSize;
  $: smallSize = Math.max(5, Math.floor(cellSize / 4));
  $: sm_v    = Math.max(6, Math.floor(cellSize / 2));
  $: slotH_v = 3 * sm_v;
  $: canvasWidth  = vertical ? 5 * sm_v         : BOARD_COLS * cellSize;
  $: canvasHeight = vertical ? maxQueue * slotH_v : STRIP_ROWS * cellSize;

  function draw() {
    if (!ctx) return;
    const frame  = get(currentFrame);
    const rotSys = getRotationSystem(get(diagram).rotationSystem);
    const maxQ   = get(diagram).nextQueueLength ?? 6;
    const queue  = frame.nextQueue.slice(0, maxQ);
    const cellSize     = get(renderConfig).cellSize;
    const sm     = Math.max(5, Math.floor(cellSize / 4));
    const skin   = get(renderConfig).skin;
    const W      = BOARD_COLS * cellSize;
    const H      = STRIP_ROWS * cellSize;

    if (vertical) {
      const sm = Math.max(6, Math.floor(cellSize / 2));
      const slotH = 3 * sm;
      const panelW = 5 * sm;
      const VH = maxQ * slotH;

      ctx.fillStyle = skin.previewBackgroundColor;
      ctx.fillRect(0, 0, panelW, VH);

      const zoneLabelSize = Math.max(7, Math.round(sm * 0.5));
      ctx.font = `700 ${zoneLabelSize}px system-ui, sans-serif`;
      ctx.textBaseline = 'top';
      const zoneStroke = 'rgba(120,120,140,0.25)';
      const zoneLabelColor = 'rgba(160,160,180,0.55)';

      for (let i = 0; i < maxQ; i++) {
        const zy = i * slotH;
        ctx.strokeStyle = zoneStroke;
        ctx.lineWidth = 1;
        ctx.strokeRect(0.5, zy + 0.5, panelW - 1, slotH - 1);
        ctx.fillStyle = zoneLabelColor;
        ctx.textAlign = 'left';
        ctx.fillText(i === 0 ? 'NEXT' : String(i + 1), 3, zy + 2);
      }

      if (queue.length === 0) {
        ctx.fillStyle = '#505058';
        ctx.font = `${Math.round(sm * 0.55)}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('Click', panelW / 2, slotH / 2);
        return;
      }

      for (let i = 0; i < queue.length; i++) {
        const zy = i * slotH;
        const type  = queue[i];
        const shape = rotSys.getShape(type, 0);
        const cellType    = pieceTypeToCellType(type);
        const minDeltaCol = Math.min(...shape.map(m => m.deltaCol));
        const maxDeltaCol = Math.max(...shape.map(m => m.deltaCol));
        const minDeltaRow = Math.min(...shape.map(m => m.deltaRow));
        const maxDeltaRow = Math.max(...shape.map(m => m.deltaRow));
        const bboxW = maxDeltaCol - minDeltaCol + 1;
        const bboxH = maxDeltaRow - minDeltaRow + 1;
        const xOff  = Math.floor((5 - bboxW) / 2) * sm;
        const yOff  = Math.floor((3 - bboxH) / 2) * sm;
        for (const { deltaCol, deltaRow } of shape) {
          drawCell(ctx, xOff + (deltaCol - minDeltaCol) * sm, zy + yOff + (deltaRow - minDeltaRow) * sm, cellType, sm, skin);
        }
      }
      return;
    }

    ctx.fillStyle = skin.previewBackgroundColor;
    ctx.fillRect(0, 0, W, H);

    // ── Compute first piece layout (needed for zone left edge) ────────────────
    let firstShape, firstMinDeltaCol, firstMinDeltaRow, firstBboxW, firstBboxH, firstXOff, firstYOff;
    if (queue.length > 0) {
      firstShape  = rotSys.getShape(queue[0], 0);
      firstMinDeltaCol  = Math.min(...firstShape.map(m => m.deltaCol));
      const firstMaxDeltaCol = Math.max(...firstShape.map(m => m.deltaCol));
      firstMinDeltaRow  = Math.min(...firstShape.map(m => m.deltaRow));
      const firstMaxDeltaRow = Math.max(...firstShape.map(m => m.deltaRow));
      firstBboxW  = firstMaxDeltaCol - firstMinDeltaCol + 1;
      firstBboxH  = firstMaxDeltaRow - firstMinDeltaRow + 1;
      firstXOff   = Math.floor((BOARD_COLS - firstBboxW) / 2) * cellSize;
      firstYOff   = (STRIP_ROWS - firstBboxH) * cellSize;
    }

    // Left edge of zone 1 is fixed to the I-piece position (widest piece, 4 cols)
    const firstZoneLeft = Math.floor((BOARD_COLS - 4) / 2) * cellSize;
    const secondX = SECOND_START_COLS * cellSize;

    // ── Zone outlines + labels ────────────────────────────────────────────────
    const zoneLabelSize = Math.max(8, Math.round(sm * 0.85));
    ctx.font = `700 ${zoneLabelSize}px system-ui, sans-serif`;
    ctx.textBaseline = 'top';

    const zoneStroke = 'rgba(120,120,140,0.25)';
    const zoneLabelColor = 'rgba(160,160,180,0.55)';

    // First slot zone: left edge = piece's left side, right edge = secondX
    ctx.strokeStyle = zoneStroke;
    ctx.lineWidth = 1;
    ctx.strokeRect(firstZoneLeft + 0.5, 0.5, secondX - firstZoneLeft - 1, H - 1);
    ctx.fillStyle = zoneLabelColor;
    ctx.textAlign = 'left';
    ctx.fillText('NEXT', firstZoneLeft + 3, 2);

    // Secondary slot zones — 2-row grid
    const slotW = 4 * sm;
    const halfH = H / 2;
    // Bottom row: slots 1, 2
    for (let col = 0; col < 2; col++) {
      const slot = 1 + col;
      if (slot >= maxQ) break;
      const zx = secondX + col * slotW;
      ctx.strokeStyle = zoneStroke;
      ctx.lineWidth = 1;
      ctx.strokeRect(zx + 0.5, halfH + 0.5, slotW - 1, halfH - 1);
      ctx.fillStyle = zoneLabelColor;
      ctx.textAlign = 'left';
      ctx.fillText(String(slot + 1), zx + 3, halfH + 2);
    }
    // Top row: slots 3, 4, 5
    for (let col = 0; col < 3; col++) {
      const slot = 3 + col;
      if (slot >= maxQ) break;
      const zx = secondX + col * slotW;
      ctx.strokeStyle = zoneStroke;
      ctx.lineWidth = 1;
      ctx.strokeRect(zx + 0.5, 0.5, slotW - 1, halfH - 1);
      ctx.fillStyle = zoneLabelColor;
      ctx.textAlign = 'left';
      ctx.fillText(String(slot + 1), zx + 3, 2);
    }

    // ── Placeholder when queue is empty ──────────────────────────────────────
    if (queue.length === 0) {
      ctx.fillStyle = '#505058';
      ctx.font = `${Math.round(cellSize * 0.38)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Click to add', (firstZoneLeft + secondX) / 2, H / 2);
      return;
    }

    // ── First next piece: full cell size ─────────────────────────────────────
    if (firstShape && firstXOff !== undefined) {
      const cellType = pieceTypeToCellType(queue[0]);
      for (const { deltaCol, deltaRow } of firstShape) {
        const px = firstXOff + (deltaCol - firstMinDeltaCol!) * cellSize;
        const py = firstYOff! + (deltaRow - firstMinDeltaRow!) * cellSize;
        drawCell(ctx, px, py, cellType, cellSize, skin);
      }
    }

    // ── Pieces 2+: smaller cell size, 2-row grid ─────────────────────────────
    const slotW2 = 4 * sm;
    const halfH2 = H / 2;
    for (let i = 1; i < queue.length; i++) {
      const slot = i; // slot index 1-based within secondary pieces
      const slotIsBottom = slot <= 2;
      const slotCol = slotIsBottom ? slot - 1 : slot - 3;
      const x = secondX + slotCol * slotW2;
      const y = slotIsBottom ? halfH2 : 0;

      const type  = queue[i];
      const shape = rotSys.getShape(type, 0);
      const cellType    = pieceTypeToCellType(type);

      const minDeltaCol = Math.min(...shape.map(m => m.deltaCol));
      const maxDeltaCol = Math.max(...shape.map(m => m.deltaCol));
      const minDeltaRow = Math.min(...shape.map(m => m.deltaRow));
      const maxDeltaRow = Math.max(...shape.map(m => m.deltaRow));
      const bboxW = maxDeltaCol - minDeltaCol + 1;
      const bboxH = maxDeltaRow - minDeltaRow + 1;

      // Center within slotW2 × halfH2 area
      const xOff = Math.floor((4 - bboxW) / 2) * sm;
      const yOff = Math.floor((halfH2 / sm - bboxH) / 2) * sm;

      for (const { deltaCol, deltaRow } of shape) {
        const px = x + xOff + (deltaCol - minDeltaCol) * sm;
        const py = y + yOff + (deltaRow - minDeltaRow) * sm;
        drawCell(ctx, px, py, cellType, sm, skin);
      }
    }
  }

  $: { $currentFrame; $renderConfig; $diagram; draw(); }

  onMount(() => {
    ctx = canvas.getContext('2d')!;
    draw();
  });

  function slotAt(e: MouseEvent): number {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const cellSize = get(renderConfig).cellSize;

    if (vertical) {
      const sm = Math.max(6, Math.floor(cellSize / 2));
      const slotH = 3 * sm;
      const slot = Math.floor(y / slotH);
      return Math.min(slot, (get(diagram).nextQueueLength ?? 6) - 1);
    }

    const sm = Math.max(5, Math.floor(cellSize / 4));
    const secondX = SECOND_START_COLS * cellSize;
    const H = STRIP_ROWS * cellSize;
    if (x < secondX) return 0;
    const col = Math.floor((x - secondX) / (4 * sm));
    if (y >= H / 2) {
      // bottom row → slots 1, 2
      return 1 + Math.min(col, 1);
    } else {
      // top row → slots 3, 4, 5
      return 3 + Math.min(col, 2);
    }
  }

  function handleClick(e: MouseEvent) {
    const slot  = slotAt(e);
    const frame = get(currentFrame);
    const queue = [...frame.nextQueue];
    if (slot === queue.length && slot < (get(diagram).nextQueueLength ?? 6)) {
      // First empty slot: add a new piece starting at I
      queue.push(PieceType.I);
    } else if (slot < queue.length) {
      // Existing piece: cycle I→O→T→S→Z→J→L→(remove)
      const next = queue[slot] + 1;
      if (next > 6) {
        queue.splice(slot, 1);
      } else {
        queue[slot] = next as PieceType;
      }
    } else {
      return;
    }
    checkpoint();
    diagram.set(updateFrame(get(diagram), get(currentFrameIndex), { ...frame, nextQueue: queue }));
  }

  function handleContextmenu(e: MouseEvent) {
    e.preventDefault();
    const slot  = slotAt(e);
    const frame = get(currentFrame);
    const queue = [...frame.nextQueue];
    if (slot >= queue.length) return;
    queue.splice(slot, 1);
    checkpoint();
    diagram.set(updateFrame(get(diagram), get(currentFrameIndex), { ...frame, nextQueue: queue }));
  }


</script>

<canvas
  bind:this={canvas}
  width={canvasWidth}
  height={canvasHeight}
  on:click={handleClick}
  on:contextmenu={handleContextmenu}
  style="cursor:pointer; display:block; outline: 1px dashed var(--bg-2);"
></canvas>
