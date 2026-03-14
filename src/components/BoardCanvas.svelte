<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import {
    diagram, currentFrame,
    activeTool, drawCellType, renderConfig,
    selectedPieceType, selectedRotation, pieceCollision,
    editingCallout, overlayColor, overlayEmoji, overlayBlockType, showBoundingBox,
    getFrameState,
  } from '../editor/store';
  import { checkpoint } from '../editor/history';
  import { rotateActivePiece } from '../editor/actions';
  import { renderBoard, drawCell, drawCommentOverlay, drawCallouts, drawClearingRows, drawBoundingBox, getCalloutBubbleBounds } from '../renderer/board-renderer';
  import type { RenderConfig } from '../renderer/board-renderer';
  import { getRotationSystem } from '../rotation/index';
  import { BOARD_COLS, BOARD_ROWS, CellType, getCell } from '../types/board';
  import { boardWithCell, boardWithFill } from '../engine/board';
  import { updateFrame } from '../engine/frame-ops';
  import type { ActivePiece } from '../types/piece';
  import { PieceType } from '../types/piece';
  import type { Rotation } from '../types/piece';
  import type { Frame } from '../types/frame';
  import { pieceTypeToCellType } from '../renderer/colors';
  import { clientToCell, primaryTouchCoords } from '../utils/canvas-coords';

  let canvas: HTMLCanvasElement;
  let ctx: CanvasRenderingContext2D;

  $: W = BOARD_COLS * $renderConfig.cellSize;
  $: H = BOARD_ROWS * $renderConfig.cellSize;

  // ── Rendering ──────────────────────────────────────────────────────────────

  /**
   * Computes the offset to visually center a piece shape on the cursor cell.
   * @param {import('../types/piece').PieceShape} shape - The shape of the piece, represented as an array of offsets.
   * @returns {[number, number]} - The computed column and row offsets to center the shape.
   */
  function shapeCenterOffset(shape: import('../types/piece').PieceShape): [number, number] {
    let sumDeltaCol = 0, sumDeltaRow = 0;
    for (const { deltaCol, deltaRow } of shape) { sumDeltaCol += deltaCol; sumDeltaRow += deltaRow; }
    return [Math.round(sumDeltaCol / shape.length), Math.round(sumDeltaRow / shape.length)];
  }

  /**
   * Checks if the given column and row are within the board boundaries.
   * @param {number} col - The column to check.
   * @param {number} row - The row to check.
   * @returns {boolean} - True if the position is within bounds, false otherwise.
   */
  function isWithinBoardBounds(col: number, row: number): boolean {
    return col >= 0 && col < BOARD_COLS && row >= 0 && row < BOARD_ROWS;
  }

  /**
   * Draws a hover preview of the selected piece on the board.
   * @param {Frame} frame - The current frame of the board.
   * @param {RenderConfig} config - The rendering configuration, including cell size and skin.
   */
  function drawHoverPreview(frame: Frame, config: RenderConfig) {
    if (hoverCol === null || hoverRow === null) return;
    const col = hoverCol;
    const row = hoverRow;
    const cellSize = config.cellSize;
    const skin = config.skin;
    const selPiece = get(selectedPieceType);

    if (selPiece !== null) {
      // ── Piece placement preview ──────────────────────────────────────────
      const d = get(diagram);
      const rotSys = getRotationSystem(d.rotationSystem);
      const rotation: Rotation = get(selectedRotation);
      const shape = rotSys.getShape(selPiece, rotation);
      const [cdc, cdr] = shapeCenterOffset(shape);
      const adjCol = col - cdc;
      const adjRow = row + cdr;
      const hoverPiece: ActivePiece = { type: selPiece, rotation, col: adjCol, row: adjRow };
      const blocked = get(pieceCollision) && rotSys.collides(hoverPiece, frame.board);
      const cellType = pieceTypeToCellType(selPiece);

      ctx.globalAlpha = blocked ? 0.2 : 0.5;
      for (const { deltaCol, deltaRow } of shape) {
        const minoCol = adjCol + deltaCol;
        const minoRow = adjRow - deltaRow;
        if (!isWithinBoardBounds(minoCol, minoRow)) continue;
        drawCell(ctx, minoCol * cellSize, (BOARD_ROWS - 1 - minoRow) * cellSize, cellType, cellSize, skin);
      }
      ctx.globalAlpha = 1;
      return;
    }

    const tool = get(activeTool);
    if (!isWithinBoardBounds(col, row)) return;
    const x = col * cellSize;
    const y = (BOARD_ROWS - 1 - row) * cellSize;

    if (tool === 'callout') {
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = '#ffdd00';
      ctx.fillRect(x, y, cellSize, cellSize);
      ctx.globalAlpha = 1;
      return;
    }

    if (tool === 'overlay') {
      const color = get(overlayColor);
      const emoji = get(overlayEmoji);
      const blockType = get(overlayBlockType);
      const existing = (frame.overlays ?? []).find(o => o.col === col && o.row === row);
      const willErase = blockType != null ? existing?.blockType === blockType
        : emoji ? existing?.emoji === emoji
        : existing?.color === color;
      if (willErase) {
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = skin.backgroundColor;
        ctx.fillRect(x, y, cellSize, cellSize);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = 'rgba(255,255,255,0.25)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, cellSize - 1, cellSize - 1);
      } else if (blockType != null) {
        ctx.globalAlpha = 0.6;
        drawCell(ctx, x, y, blockType as CellType, cellSize, skin);
        ctx.globalAlpha = 1;
      } else if (emoji) {
        ctx.globalAlpha = 0.7;
        const fontSize = Math.round(cellSize * 0.72);
        ctx.font = `${fontSize}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(emoji, x + cellSize / 2, y + cellSize / 2);
        ctx.globalAlpha = 1;
      } else {
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = color;
        ctx.fillRect(x, y, cellSize, cellSize);
        ctx.globalAlpha = 1;
      }
      return;
    }

    if (tool === 'draw') {
      const paintType = get(drawCellType);
      const existing = getCell(frame.board, col, row);
      if (existing === paintType) {
        // Will erase — show empty overlay with a faint border
        ctx.globalAlpha = 0.65;
        ctx.fillStyle = skin.backgroundColor;
        ctx.fillRect(x, y, cellSize, cellSize);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = 'rgba(255,255,255,0.25)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, cellSize - 1, cellSize - 1);
      } else {
        // Will paint — show at half opacity
        ctx.globalAlpha = 0.5;
        drawCell(ctx, x, y, paintType, cellSize, skin);
        ctx.globalAlpha = 1;
      }
    } else if (tool === 'erase') {
      // Show the cell as it will look after erasing
      ctx.globalAlpha = 0.65;
      ctx.fillStyle = skin.backgroundColor;
      ctx.fillRect(x, y, cellSize, cellSize);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, cellSize - 1, cellSize - 1);
    } else if (tool === 'fill') {
      const paintType = get(drawCellType);
      if (getCell(frame.board, col, row) === paintType) return; // nothing would change
      const filledBoard = boardWithFill(frame.board, col, row, paintType);
      for (let r = 0; r < BOARD_ROWS; r++) {
        for (let c = 0; c < BOARD_COLS; c++) {
          const orig = getCell(frame.board, c, r);
          const next = getCell(filledBoard, c, r);
          if (orig === next) continue;
          const cx = c * cellSize;
          const cy = (BOARD_ROWS - 1 - r) * cellSize;
          if (next === CellType.Empty) {
            ctx.globalAlpha = 0.65;
            ctx.fillStyle = skin.backgroundColor;
            ctx.fillRect(cx, cy, cellSize, cellSize);
            ctx.globalAlpha = 1;
            ctx.strokeStyle = 'rgba(255,255,255,0.25)';
            ctx.lineWidth = 1;
            ctx.strokeRect(cx + 0.5, cy + 0.5, cellSize - 1, cellSize - 1);
          } else {
            ctx.globalAlpha = 0.5;
            drawCell(ctx, cx, cy, next, cellSize, skin);
            ctx.globalAlpha = 1;
          }
        }
      }
    }
  }

  function draw() {
    if (!ctx) return;
    const frame = get(currentFrame);
    const d = get(diagram);
    const config = get(renderConfig);
    const rotSys = getRotationSystem(d.rotationSystem);
    const cellSize = config.cellSize;
    const W = BOARD_COLS * cellSize;
    const H = BOARD_ROWS * cellSize;
    renderBoard(ctx, frame.board, frame.activePiece, rotSys, config, frame.showGhost, frame.lockDelayProgress ?? 0, frame.overlays, frame.lockFlash ? 1 : 0);
    if (frame.clearingRows?.length) drawClearingRows(ctx, frame.clearingRows, cellSize, W);
    if (get(showBoundingBox) && frame.activePiece) drawBoundingBox(ctx, frame.activePiece, rotSys, cellSize);
    if (frame.comment) {
      drawCommentOverlay(ctx, frame.comment, W, H, cellSize);
    }
    drawCallouts(ctx, frame.callouts ?? [], cellSize, W, H);

    // Highlight the cell currently being edited in callout mode
    const editing = get(editingCallout);
    if (get(activeTool) === 'callout' && editing !== null) {
      const ex = editing.col * cellSize;
      const ey = (BOARD_ROWS - 1 - editing.row) * cellSize;
      ctx.save();
      ctx.strokeStyle = '#ffdd00';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(ex + 1, ey + 1, cellSize - 2, cellSize - 2);
      ctx.restore();
    }

    drawHoverPreview(frame, config);
  }

  // Re-render whenever relevant stores change
  $: { $currentFrame; $renderConfig; $diagram; $selectedPieceType; $selectedRotation; $drawCellType; $activeTool; $editingCallout; $showBoundingBox; $overlayColor; $overlayEmoji; $overlayBlockType; draw(); }

  onMount(() => {
    ctx = canvas.getContext('2d')!;
    draw();
  });

  // ── Hover tracking ─────────────────────────────────────────────────────────
  let hoverCol: number | null = null;
  let hoverRow: number | null = null;

  // ── Mouse editing ──────────────────────────────────────────────────────────
  let isMouseDown = false;
  let lastCell: [number, number] | null = null;
  // Target cell type locked for the current draw stroke (Empty = erase stroke)
  let strokeTarget: CellType = CellType.Empty;
  // Whether the current overlay stroke is painting or erasing
  let overlayStrokeMode: 'paint' | 'erase' = 'paint';
  // Dragging while in piece placement mode
  let placingPiece = false;
  // Dragging a free-positioned callout bubble
  let draggingFreeCallout = false;
  let freeDragStartMouse: [number, number] | null = null;
  let freeDragStartFreeXY: [number, number] = [0, 0];

  function canvasToCell(e: { clientX: number; clientY: number }): [number, number] {
    return clientToCell(e.clientX, e.clientY, canvas.getBoundingClientRect(), get(renderConfig).cellSize);
  }

  /** Place (or move) the selected piece type at the given board cell, respecting collision settings. */
  function applyPiecePlacement(col: number, row: number) {
    const selPiece = get(selectedPieceType);
    if (selPiece === null) return;
    const { d, idx, frame } = getFrameState();
    const rotSys = getRotationSystem(d.rotationSystem);
    const rotation: Rotation = get(selectedRotation);
    const shape = rotSys.getShape(selPiece, rotation);
    const [cdc, cdr] = shapeCenterOffset(shape);
    const piece: ActivePiece = { type: selPiece, rotation, col: col - cdc, row: row + cdr };
    if (get(pieceCollision) && rotSys.collides(piece, frame.board)) return;
    diagram.set(updateFrame(d, idx, { ...frame, activePiece: piece }));
  }

  function applyTool(col: number, row: number) {
    const tool = get(activeTool);
    const { d, idx, frame } = getFrameState();

    if (tool === 'draw') {
      const newBoard = boardWithCell(frame.board, col, row, strokeTarget);
      diagram.set(updateFrame(d, idx, { ...frame, board: newBoard }));
    } else if (tool === 'erase') {
      const newBoard = boardWithCell(frame.board, col, row, CellType.Empty);
      diagram.set(updateFrame(d, idx, { ...frame, board: newBoard }));
    } else if (tool === 'fill') {
      const newBoard = boardWithFill(frame.board, col, row, get(drawCellType));
      diagram.set(updateFrame(d, idx, { ...frame, board: newBoard }));
      isMouseDown = false;
    } else if (tool === 'overlay') {
      const color = get(overlayColor);
      const emoji = get(overlayEmoji) ?? undefined;
      const blockType = get(overlayBlockType) ?? undefined;
      const overlays = [...(frame.overlays ?? [])];
      const oi = overlays.findIndex(o => o.col === col && o.row === row);
      if (overlayStrokeMode === 'paint') {
        const cell = { col, row, color, emoji, blockType };
        if (oi >= 0) overlays[oi] = cell; else overlays.push(cell);
      } else {
        if (oi >= 0) overlays.splice(oi, 1);
      }
      diagram.set(updateFrame(d, idx, { ...frame, overlays: overlays.length ? overlays : undefined }));
    }
  }

  function onMousedown(e: MouseEvent) {
    e.preventDefault();
    const [col, row] = canvasToCell(e);

    // Piece placement mode takes priority over draw tools
    if (get(selectedPieceType) !== null) {
      checkpoint();
      applyPiecePlacement(col, row);
      placingPiece = true;
      return;
    }

    const tool = get(activeTool);
    const frame = get(currentFrame);

    if (tool === 'callout') {
      // If editing a free-positioned callout, check if the click is on the bubble
      const editing = get(editingCallout);
      if (editing) {
        const frame = get(currentFrame);
        const callout = (frame.callouts ?? []).find(c => c.col === editing.col && c.row === editing.row);
        if (callout?.dir === 'free') {
          const cellSize = get(renderConfig).cellSize;
          const canvasW = BOARD_COLS * cellSize;
          const canvasH = BOARD_ROWS * cellSize;
          const bounds = getCalloutBubbleBounds(callout, ctx, cellSize, canvasW, canvasH);
          if (bounds) {
            const rect = canvas.getBoundingClientRect();
            const mx = e.clientX - rect.left;
            const my = e.clientY - rect.top;
            if (mx >= bounds.x && mx <= bounds.x + bounds.w && my >= bounds.y && my <= bounds.y + bounds.h) {
              draggingFreeCallout = true;
              freeDragStartMouse = [e.clientX, e.clientY];
              freeDragStartFreeXY = [callout.freeX ?? 0, callout.freeY ?? 0];
              return;
            }
          }
        }
      }
      if (col >= 0 && col < BOARD_COLS && row >= 0 && row < BOARD_ROWS) {
        editingCallout.set({ col, row });
      }
      return;
    }

    if (tool === 'draw') {
      const paintType = get(drawCellType);
      const existing = getCell(frame.board, col, row);
      strokeTarget = existing === paintType ? CellType.Empty : paintType;
    } else if (tool === 'overlay') {
      const color = get(overlayColor);
      const emoji = get(overlayEmoji);
      const blockType = get(overlayBlockType);
      const existing = (frame.overlays ?? []).find(o => o.col === col && o.row === row);
      if (blockType != null) {
        overlayStrokeMode = existing?.blockType === blockType ? 'erase' : 'paint';
      } else if (emoji) {
        overlayStrokeMode = existing?.emoji === emoji ? 'erase' : 'paint';
      } else {
        overlayStrokeMode = existing?.color === color ? 'erase' : 'paint';
      }
    }

    isMouseDown = true;
    checkpoint();
    lastCell = [col, row];
    applyTool(col, row);
  }

  function onMousemove(e: MouseEvent) {
    const [col, row] = canvasToCell(e);

    // Piece placement drag: move piece anchor to cursor cell
    if (placingPiece) {
      hoverCol = col; hoverRow = row;
      applyPiecePlacement(col, row);
      draw();
      return;
    }

    if (draggingFreeCallout && freeDragStartMouse) {
      const editing = get(editingCallout);
      if (!editing) { draggingFreeCallout = false; return; }
      const config = get(renderConfig);
      const cellSize = config.cellSize;
      const canvasW = BOARD_COLS * cellSize;
      const canvasH = BOARD_ROWS * cellSize;
      const { d, idx, frame } = getFrameState();
      const callout = (frame.callouts ?? []).find(c => c.col === editing.col && c.row === editing.row);
      if (!callout) { draggingFreeCallout = false; return; }
      const bounds = getCalloutBubbleBounds(callout, ctx, cellSize, canvasW, canvasH);
      const bw = bounds?.w ?? 60;
      const bh = bounds?.h ?? 24;
      const delta_mousex = e.clientX - freeDragStartMouse[0];
      const delta_mousey = e.clientY - freeDragStartMouse[1];
      const newBX = freeDragStartFreeXY[0] * canvasW + delta_mousex;
      const newBY = freeDragStartFreeXY[1] * canvasH + delta_mousey;
      const newFreeX = Math.max(0, Math.min(newBX / canvasW, (canvasW - bw) / canvasW));
      const newFreeY = Math.max(0, Math.min(newBY / canvasH, (canvasH - bh) / canvasH));
      const callouts = (frame.callouts ?? []).map(c =>
        c.col === editing.col && c.row === editing.row ? { ...c, freeX: newFreeX, freeY: newFreeY } : c,
      );
      diagram.set(updateFrame(d, idx, { ...frame, callouts }));
      return;
    }

    // Update hover and redraw preview
    if (hoverCol !== col || hoverRow !== row) {
      hoverCol = col;
      hoverRow = row;
      draw();
    }

    if (!isMouseDown) return;
    if (lastCell && lastCell[0] === col && lastCell[1] === row) return;
    lastCell = [col, row];
    applyTool(col, row);
  }

  function onMouseleave() {
    hoverCol = null;
    hoverRow = null;
    draw();
    isMouseDown = false;
    placingPiece = false;
    draggingFreeCallout = false;
    freeDragStartMouse = null;
  }

  function onMouseup(e?: MouseEvent) {
    isMouseDown = false;
    placingPiece = false;
    draggingFreeCallout = false;
    freeDragStartMouse = null;
  }

  function onTouchstart(e: TouchEvent) {
    e.preventDefault();
    const coords = primaryTouchCoords(e);
    if (!coords) return;
    onMousedown(coords as MouseEvent);
  }

  function onTouchmove(e: TouchEvent) {
    e.preventDefault();
    const coords = primaryTouchCoords(e);
    if (!coords) return;
    onMousemove(coords as MouseEvent);
  }

  function onTouchend(e: TouchEvent) {
    const coords = primaryTouchCoords(e);
    if (coords) onMousemove(coords as MouseEvent);
    onMouseup();
  }

  function onContextmenu(e: MouseEvent) {
    e.preventDefault();
    const [col, row] = canvasToCell(e);
    const tool = get(activeTool);
    const { d, idx, frame } = getFrameState();

    if (tool === 'callout') {
      const callouts = (frame.callouts ?? []).filter(c => !(c.col === col && c.row === row));
      diagram.set(updateFrame(d, idx, { ...frame, callouts }));
      const editing = get(editingCallout);
      if (editing && editing.col === col && editing.row === row) {
        editingCallout.set(null);
      }
      return;
    }

    checkpoint();
    const newBoard = boardWithCell(frame.board, col, row, CellType.Empty);
    diagram.set(updateFrame(d, idx, { ...frame, board: newBoard }));
  }

  $: cursor = $selectedPieceType !== null ? 'cell'
    : draggingFreeCallout ? 'grabbing'
    : $activeTool === 'callout' ? 'pointer'
    : 'crosshair';
</script>

<canvas
  bind:this={canvas}
  width={W}
  height={H}
  style="display:block; cursor:{cursor}; touch-action:none;"
  on:mousedown={onMousedown}
  on:mousemove={onMousemove}
  on:mouseup={onMouseup}
  on:mouseleave={onMouseleave}
  on:contextmenu={onContextmenu}
  on:touchstart={onTouchstart}
  on:touchmove={onTouchmove}
  on:touchend={onTouchend}
></canvas>
