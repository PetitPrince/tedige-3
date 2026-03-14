<script lang="ts">
  import { onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import { CellType, BOARD_COLS, BOARD_ROWS, setCell } from '../types/board';
  import { diagram, currentFrameIndex, showCapture, canUndo } from '../editor/store';
  import { checkpoint, undo } from '../editor/history';
  import {
    classifyBoard, cellTypeFromRgb, PIECE_META, getDefaultHues,
    DEFAULT_THRESHOLDS,
  } from '../cv/classifier';
  import type { ColorPalette } from '../cv/classifier';
  import { rgbToHsv } from '../cv/color-utils';
  import {
    detectTgm4Inputs, DEFAULT_TGM4_LAYOUT, DEFAULT_INPUT_THRESHOLDS,
  } from '../cv/input-detector';
  import type { InputDetectThresholds } from '../cv/input-detector';
  import type { InputId, InputState, RotationSystemId } from '../types/frame';
  import type { PieceType, ActivePiece } from '../types/piece';
  import { diffDetectActivePiece, findFloatingPiece } from '../cv/active-piece-diff';
  import { findActivePiece, getShapeTable } from '../engine/piece-detect';
  import InputDisplay from './InputDisplay.svelte';

  // ── Video / stream ────────────────────────────────────────────────────────────
  let videoEl: HTMLVideoElement;
  let previewCanvas: HTMLCanvasElement;
  let miniCanvas: HTMLCanvasElement;
  let stream: MediaStream | null = null;
  let streamError = '';

  // ── Calibration ───────────────────────────────────────────────────────────────
  type Rect = { x: number; y: number; w: number; h: number };
  type DragMode = 'board' | 'input' | 'hold' | 'level' | 'next0' | 'next1' | 'next2' | 'next3' | 'next4' | 'next5';
  let boardRect: Rect | null = null;
  let inputRect: Rect | null = null;
  let holdRect: Rect | null = null;
  let nextRects: (Rect | null)[] = [null, null, null, null, null, null];
  let levelRect: Rect | null = null;
  let dragMode: DragMode = 'board';
  let selectedLayout: string | 'none' = 'none';
  let isDragging = false;
  let dragStartPx = { x: 0, y: 0 };
  let dragCurPx   = { x: 0, y: 0 };

  // ── Rect edge / move drag ─────────────────────────────────────────────────────
  type RectTarget = { kind: 'board' } | { kind: 'input' } | { kind: 'hold' } | { kind: 'level' } | { kind: 'next'; i: number };
  type EdgeHit = 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se' | 'center';
  let hoveredRectTarget: RectTarget | null = null;
  let hoveredRectEdge: EdgeHit | null = null;
  let draggingRectTarget: RectTarget | null = null;
  let draggingRectEdge: EdgeHit | null = null;
  let rectDragStartPx = { x: 0, y: 0 };
  let rectDragStartVid: Rect | null = null;

  function rsToPalette(rs: RotationSystemId): ColorPalette { return rs === 'srs' ? 'srs' : 'ars'; }

  // ── Board detection config ────────────────────────────────────────────────────
  let gridCols    = BOARD_COLS;
  let gridRows    = BOARD_ROWS;
  let palette: ColorPalette = rsToPalette(get(diagram).rotationSystem);
  let emptyVPct   = Math.round(DEFAULT_THRESHOLDS.emptyBrightness   * 100);
  let garbageSPct = Math.round(DEFAULT_THRESHOLDS.garbageSaturation * 100);
  let hueTolerance = 90;

  // Per-piece hue centres (initialised from palette default, editable)
  let currentHues: Record<number, number> = { ...getDefaultHues(palette) };

  // Re-init hues when palette changes (but preserve user overrides? No — palette
  // swap means completely different hue assignments, always reset.)
  function onPaletteChange() {
    currentHues = { ...getDefaultHues(palette) };
  }

  // Sync palette with diagram rotation system.
  $: {
    const newPalette = rsToPalette($diagram.rotationSystem);
    if (newPalette !== palette) { palette = newPalette; onPaletteChange(); }
  }

  $: thresholds = {
    emptyBrightness:      emptyVPct   / 100,
    garbageSaturation:    garbageSPct / 100,
    palette,
    hueTolerance,
    pieceHues:   currentHues,
  };

  // ── Input detection config ────────────────────────────────────────────────────
  let pressedHMin = DEFAULT_INPUT_THRESHOLDS.pressedHMin;
  let pressedHMax = DEFAULT_INPUT_THRESHOLDS.pressedHMax;
  let pressedSPct = Math.round(DEFAULT_INPUT_THRESHOLDS.pressedSMin * 100);
  let pressedVPct = Math.round(DEFAULT_INPUT_THRESHOLDS.pressedVMin * 100);

  $: inputThresholds = {
    pressedHMin,
    pressedHMax,
    pressedSMin: pressedSPct / 100,
    pressedVMin: pressedVPct / 100,
  } satisfies InputDetectThresholds;

  // ── Input layout (mutable copy, user-draggable) ───────────────────────────────
  function cloneButtons(b: Record<InputId, [number, number]>): Record<InputId, [number, number]> {
    return Object.fromEntries(Object.entries(b).map(([k, [x, y]]) => [k, [x, y]])) as Record<InputId, [number, number]>;
  }

  let layoutButtons: Record<InputId, [number, number]> = cloneButtons(DEFAULT_TGM4_LAYOUT.buttons);
  let sampleRadiusPct = 8; // % of input rect dimensions

  const ACTION_IDS = new Set<InputId>(['ccw', 'cw', 'ccw2', 'rewind', 'hold', 'cw2', 'extra']);
  let actionOffsetXPct = 0; // % of input rect width  (-50..50)
  let actionOffsetYPct = 0; // % of input rect height (-50..50)

  $: customLayout = {
    buttons: Object.fromEntries(
      Object.entries(layoutButtons).map(([id, [nx, ny]]) =>
        ACTION_IDS.has(id as InputId)
          ? [id, [nx + actionOffsetXPct / 100, ny + actionOffsetYPct / 100]]
          : [id, [nx, ny]],
      ),
    ) as Record<InputId, [number, number]>,
    sampleRadius: sampleRadiusPct / 100,
  };

  let draggingDot: InputId | null = null;
  let hoveredDot:  InputId | null = null;
  let lastDragDetectMs = 0;

  function resetLayout() {
    layoutButtons = cloneButtons(DEFAULT_TGM4_LAYOUT.buttons);
    sampleRadiusPct = 8;
    actionOffsetXPct = 0;
    actionOffsetYPct = 0;
  }

  // ── Loupe (precision zoom — permanent side panel) ────────────────────────────
  let mousePx = { x: 0, y: 0 };
  let loupeCanvas: HTMLCanvasElement;
  const LOUPE_ZOOM  = 2;
  const LOUPE_SRC_W = 80;
  const LOUPE_SRC_H = 60;
  const LOUPE_DST_W = LOUPE_SRC_W * LOUPE_ZOOM; // 160
  const LOUPE_DST_H = LOUPE_SRC_H * LOUPE_ZOOM; // 120

  // ── Overlay / dim ─────────────────────────────────────────────────────────────
  let dimPct = 55;

  // ── Detection results ─────────────────────────────────────────────────────────
  let detectedCells: CellType[][] | null = null;
  let detectedInputs: Partial<Record<InputId, InputState>> = {};
  let detectedHold: PieceType | null = null;
  let detectedNext: (PieceType | null)[] = [null, null, null, null, null, null];
  let importStatus = '';

  // ── Active piece detection (TGM border) ───────────────────────────────────
  let detectActivePiece = false;
  let detectedActivePiece: ActivePiece | null = null;
  let activePieceCells: CellType[][] | null = null; // cells with active piece removed
  let lastLockedBoard: CellType[][] | null = null;
  let diffCandidateCount = 0;
  let diffMinCells = 4;
  let diffMaxCells = 4;
  let manualActiveCells: Set<string> | null = null; // "dRow,col" keys; null = auto mode
  let manualSelectMode = false; // true when user is picking cells on mini-board

  // ── Mask overlays ─────────────────────────────────────────────────────────────
  type MaskKey = CellType | 'pressed';
  let activeMasks = new Set<MaskKey>();

  // Cached raw ImageData from the last grab (used to recompute masks without re-grabbing)
  let boardImageData: ImageData | null = null;
  let inputImageData: ImageData | null = null;

  // Offscreen canvases holding the current mask pixels
  const boardMaskEl = typeof document !== 'undefined' ? document.createElement('canvas') : null!;
  const inputMaskEl = typeof document !== 'undefined' ? document.createElement('canvas') : null!;
  let boardMaskReady = false;
  let inputMaskReady = false;

  function hexToRgb(hex: string): [number, number, number] {
    return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
  }

  function computeBoardMask() {
    boardMaskReady = false;
    if (!boardImageData || !boardMaskEl) return;
    const activePieces = new Set(PIECE_META.map(m => m.cellType).filter(cellType => activeMasks.has(cellType)));
    if (activePieces.size === 0) return;

    const { width, height, data } = boardImageData;
    boardMaskEl.width  = width;
    boardMaskEl.height = height;
    const mctx = boardMaskEl.getContext('2d')!;
    const out  = mctx.createImageData(width, height);

    for (let i = 0; i < width * height; i++) {
      const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
      const cellType = cellTypeFromRgb(r, g, b, thresholds);
      if (activePieces.has(cellType)) {
        const [fr, fg, fb] = hexToRgb(CELL_FILL[cellType] ?? '#888888');
        out.data[i * 4]     = fr;
        out.data[i * 4 + 1] = fg;
        out.data[i * 4 + 2] = fb;
        out.data[i * 4 + 3] = 210;
      }
    }
    mctx.putImageData(out, 0, 0);
    boardMaskReady = true;
  }

  function computeInputMask() {
    inputMaskReady = false;
    if (!inputImageData || !inputMaskEl || !activeMasks.has('pressed')) return;

    const { width, height, data } = inputImageData;
    inputMaskEl.width  = width;
    inputMaskEl.height = height;
    const mctx = inputMaskEl.getContext('2d')!;
    const out  = mctx.createImageData(width, height);
    const t    = inputThresholds;

    for (let i = 0; i < width * height; i++) {
      const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
      const [h, s, v] = rgbToHsv(r, g, b);
      if (h >= t.pressedHMin && h <= t.pressedHMax && s >= t.pressedSMin && v >= t.pressedVMin) {
        out.data[i * 4]     = 80;
        out.data[i * 4 + 1] = 80;
        out.data[i * 4 + 2] = 255;
        out.data[i * 4 + 3] = 210;
      }
    }
    mctx.putImageData(out, 0, 0);
    inputMaskReady = true;
  }

  function toggleMask(key: MaskKey) {
    if (activeMasks.has(key)) activeMasks.delete(key);
    else activeMasks.add(key);
    activeMasks = activeMasks; // trigger Svelte reactivity
    if (key === 'pressed') computeInputMask();
    else computeBoardMask();
  }

  // ── Live detection ────────────────────────────────────────────────────────────
  let liveDetect = false;
  let lastDetectMs = 0;
  let liveDetectIntervalMs = 100;

  // ── Delta / auto-record ───────────────────────────────────────────────────────
  let stackAsGarbage = false; // import stack cells as CellType.Garbage regardless of detected color
  let autoRecord = false;
  let autoRecordThreshold = 4; // min changed cells to trigger a new frame
  let lastAutoBoard: CellType[][] | null = null;
  let autoRecordMode: 'diff' | 'level' = 'diff';

  // ── Level-change detection ─────────────────────────────────────────────────
  let lastLevelBinary: Uint8Array | null = null;
  let currentLevelBinary: Uint8Array | null = null;
  let levelBinaryW = 0;
  let levelBinaryH = 0;
  let levelChanged = false;
  let levelLookbackMs = 200;
  let detectionBuffer: Array<{ cells: CellType[][]; ts: number }> = [];
  const DETECTION_BUFFER_MAX = 30;
  let levelBrightnessThreshold = 128;
  let levelDiffPct = 5; // % of region pixels that must differ
  let levelFlashUntil = 0; // performance.now() timestamp — flash visible while now < this

  // Canvases for level binary previews
  let levelCurrentCanvas: HTMLCanvasElement;
  let levelBaselineCanvas: HTMLCanvasElement;

  function drawBinaryToCanvas(canvas: HTMLCanvasElement | undefined, binary: Uint8Array | null, w: number, h: number) {
    if (!canvas || !binary || w === 0 || h === 0) return;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    const img = ctx.createImageData(w, h);
    for (let i = 0; i < w * h; i++) {
      const v = binary[i] ? 255 : 0;
      img.data[i * 4] = v;
      img.data[i * 4 + 1] = v;
      img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }

  function binarizeRegion(imageData: ImageData, threshold: number): Uint8Array {
    const { width, height, data } = imageData;
    const out = new Uint8Array(width * height);
    for (let i = 0; i < width * height; i++) {
      const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
      out[i] = (r * 299 + g * 587 + b * 114) / 1000 >= threshold ? 1 : 0;
    }
    return out;
  }

  function binaryDiff(a: Uint8Array, b: Uint8Array): number {
    let n = 0;
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) if (a[i] !== b[i]) n++;
    return n;
  }

  function countCellDiff(a: CellType[][], b: CellType[][]): number {
    let n = 0;
    for (let r = 0; r < Math.min(a.length, b.length); r++)
      for (let c = 0; c < Math.min(a[r].length, b[r].length); c++)
        if (a[r][c] !== b[r][c]) n++;
    return n;
  }

  /** Append current detection as a new frame — no checkpoint, no flash. */
  function appendDetectedFrame() {
    if (!detectedCells) return;
    const d   = get(diagram);
    const idx = get(currentFrameIndex);
    const update = buildFrameUpdate();
    const newFrame = { ...d.frames[idx], ...update };
    const frames = [
      ...d.frames.slice(0, idx + 1),
      newFrame,
      ...d.frames.slice(idx + 1),
    ];
    diagram.set({ ...d, frames });
    currentFrameIndex.set(idx + 1);
  }

  function enableAutoRecord() {
    checkpoint(); // one checkpoint for the entire session — whole session undoable at once
    lastAutoBoard = detectedCells ? detectedCells.map(r => [...r]) : null;
    // Snapshot current level binary so we don't trigger on the first frame
    if (levelRect && videoEl) {
      const off = document.createElement('canvas');
      off.width = levelRect.w; off.height = levelRect.h;
      const ctx = off.getContext('2d')!;
      ctx.drawImage(videoEl, levelRect.x, levelRect.y, levelRect.w, levelRect.h, 0, 0, levelRect.w, levelRect.h);
      lastLevelBinary = binarizeRegion(ctx.getImageData(0, 0, levelRect.w, levelRect.h), levelBrightnessThreshold);
    }
  }

  function resetBaseline() {
    lastAutoBoard = detectedCells ? detectedCells.map(r => [...r]) : null;
  }

  $: if (!liveDetect) autoRecord = false;

  // ── Render loop ───────────────────────────────────────────────────────────────
  let animFrame: number | null = null;

  const SRS_CELL_FILL: Partial<Record<CellType, string>> = {
    [CellType.I]:       '#00dddd',
    [CellType.O]:       '#e8d200',
    [CellType.T]:       '#bb00ee',
    [CellType.S]:       '#00cc00',
    [CellType.Z]:       '#ee0000',
    [CellType.J]:       '#003cee',
    [CellType.L]:       '#ee8200',
    [CellType.Garbage]: '#888888',
  };
  const ARS_CELL_FILL: Partial<Record<CellType, string>> = {
    [CellType.I]:       '#ee0000',
    [CellType.O]:       '#e8d200',
    [CellType.T]:       '#00dddd',
    [CellType.S]:       '#bb00ee',
    [CellType.Z]:       '#00cc00',
    [CellType.J]:       '#003cee',
    [CellType.L]:       '#ee8200',
    [CellType.Garbage]: '#888888',
  };
  $: CELL_FILL = palette === 'ars' ? ARS_CELL_FILL : SRS_CELL_FILL;

  // ── Screen capture ────────────────────────────────────────────────────────────
  async function startCapture() {
    streamError = '';
    try {
      stream = await (navigator.mediaDevices as any).getDisplayMedia({
        video: { frameRate: 15 },
        audio: false,
      });
      stream.getVideoTracks()[0].addEventListener('ended', stopCapture);
    } catch (e: any) {
      if (e?.name !== 'NotAllowedError') streamError = String(e?.message ?? e);
    }
  }

  async function changeCapture() {
    if (animFrame !== null) { cancelAnimationFrame(animFrame); animFrame = null; }
    stream?.getTracks().forEach(t => t.stop());
    stream = null;
    await startCapture();
  }

  function stopCapture() {
    if (animFrame !== null) { cancelAnimationFrame(animFrame); animFrame = null; }
    stream?.getTracks().forEach(t => t.stop());
    stream = null;
    selectedLayout = 'none';
    boardRect = null;
    inputRect = null;
    holdRect = null;
    nextRects = [null, null, null, null, null, null];
    detectedCells = null;
    detectedInputs = {};
    detectedHold = null;
    detectedNext = [null, null, null, null, null, null];
    detectedActivePiece = null;
    activePieceCells = null;
    autoRecord = false;
    lastAutoBoard = null;
    levelRect = null;
    lastLevelBinary = null;
    currentLevelBinary = null;
    levelChanged = false;
    detectionBuffer = [];
  }

  function getLookbackCells(lookbackMs: number): CellType[][] | null {
    if (detectionBuffer.length === 0) return null;
    const target = performance.now() - lookbackMs;
    let best = detectionBuffer[0];
    for (const entry of detectionBuffer) {
      if (entry.ts <= target) best = entry;
      else break;
    }
    return best.cells;
  }

  $: if (stream && videoEl) {
    videoEl.srcObject = stream;
    videoEl.play().catch(() => {});
  }

  function onVideoLoaded() {
    if (!previewCanvas) return;
    const MAX_W = 720, MAX_H = 480;
    const ratio = videoEl.videoWidth / videoEl.videoHeight;
    const cw = Math.min(MAX_W, MAX_H * ratio);
    previewCanvas.width  = Math.round(cw);
    previewCanvas.height = Math.round(cw / ratio);
    startRenderLoop();
  }

  function startRenderLoop() {
    if (animFrame !== null) cancelAnimationFrame(animFrame);
    const tick = (now: number) => {
      drawPreview();
      drawLoupeCanvas();
      if (liveDetect && (boardRect || inputRect) && now - lastDetectMs >= liveDetectIntervalMs) {
        lastDetectMs = now;
        runDetection();
        if (autoRecord && boardRect && detectedCells) {
          if (autoRecordMode === 'level' && levelRect && levelChanged) {
            const lookbackCells = getLookbackCells(levelLookbackMs);
            if (lookbackCells) {
              const savedCells = detectedCells;
              detectedCells = lookbackCells;
              appendDetectedFrame();
              detectedCells = savedCells;
            } else {
              appendDetectedFrame();
            }
            levelFlashUntil = now + 5;
            // Update baseline after recording
            if (videoEl) {
              const off = document.createElement('canvas');
              off.width = levelRect.w; off.height = levelRect.h;
              const ctx = off.getContext('2d')!;
              ctx.drawImage(videoEl, levelRect.x, levelRect.y, levelRect.w, levelRect.h, 0, 0, levelRect.w, levelRect.h);
              lastLevelBinary = binarizeRegion(ctx.getImageData(0, 0, levelRect.w, levelRect.h), levelBrightnessThreshold);
            }
            levelChanged = false;
          } else if (autoRecordMode === 'diff') {
            if (lastAutoBoard === null) {
              lastAutoBoard = detectedCells.map(r => [...r]);
            } else if (countCellDiff(detectedCells, lastAutoBoard) >= autoRecordThreshold) {
              lastAutoBoard = detectedCells.map(r => [...r]);
              appendDetectedFrame();
            }
          }
        }
      }
      animFrame = requestAnimationFrame(tick);
    };
    animFrame = requestAnimationFrame(tick);
  }

  // ── Canvas drawing ────────────────────────────────────────────────────────────
  function drawPreview() {
    if (!videoEl || !previewCanvas || !stream) return;
    const ctx = previewCanvas.getContext('2d')!;
    const cw = previewCanvas.width, ch = previewCanvas.height;

    ctx.drawImage(videoEl, 0, 0, cw, ch);

    if (isDragging) {
      const r = currentDragInCanvas();
      ctx.save();
      ctx.strokeStyle = dragMode === 'input' ? 'rgba(255,80,255,0.9)'
                      : dragMode === 'hold'  ? 'rgba(255,221,68,0.9)'
                      : dragMode === 'level' ? 'rgba(255,140,40,0.9)'
                      : (dragMode as string).startsWith('next') ? 'rgba(68,255,221,0.9)'
                      : 'rgba(255,230,0,0.9)';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      ctx.strokeRect(r.x, r.y, r.w, r.h);
      ctx.restore();
      return;
    }

    ctx.save();

    if (boardRect) {
      const bc = boardRectInCanvas()!;

      if (detectedCells) {
        const overlayAlpha = dimPct / 100;

        const cCw = bc.w / gridCols;
        const cCh = bc.h / gridRows;

        for (let r = 0; r < detectedCells.length; r++) {
          for (let c = 0; c < detectedCells[r].length; c++) {
            const fill = CELL_FILL[detectedCells[r][c]];
            if (fill) {
              ctx.globalAlpha = overlayAlpha;
              ctx.fillStyle = fill;
              const isActive = activePieceCells && activePieceCells[r]?.[c] === CellType.Empty && detectedCells[r][c] !== CellType.Empty;
              if (isActive) {
                const inset = Math.max(1, Math.min(cCw, cCh) * 0.2);
                ctx.fillRect(bc.x + c * cCw + inset, bc.y + r * cCh + inset, cCw - 2 * inset, cCh - 2 * inset);
              } else {
                ctx.fillRect(bc.x + c * cCw, bc.y + r * cCh, cCw, cCh);
              }
            }
          }
        }
        ctx.globalAlpha = 1;

        ctx.strokeStyle = 'rgba(255,255,255,0.20)';
        ctx.lineWidth = 0.5;
        ctx.setLineDash([]);
        for (let c = 1; c < gridCols; c++) {
          ctx.beginPath();
          ctx.moveTo(bc.x + c * cCw, bc.y);
          ctx.lineTo(bc.x + c * cCw, bc.y + bc.h);
          ctx.stroke();
        }
        for (let r = 1; r < gridRows; r++) {
          ctx.beginPath();
          ctx.moveTo(bc.x, bc.y + r * cCh);
          ctx.lineTo(bc.x + bc.w, bc.y + r * cCh);
          ctx.stroke();
        }
      }

      // Pixel-level mask overlays (drawn at full board-region resolution)
      if (boardMaskReady) {
        ctx.globalAlpha = 0.88;
        ctx.drawImage(boardMaskEl, bc.x, bc.y, bc.w, bc.h);
        ctx.globalAlpha = 1;
      }

      ctx.strokeStyle = detectedCells ? '#00ff88' : 'rgba(255,230,0,0.7)';
      ctx.lineWidth = 2;
      ctx.setLineDash(detectedCells ? [] : [5, 4]);
      ctx.strokeRect(bc.x, bc.y, bc.w, bc.h);

      if (inputRect) {
        const ic = inputRectInCanvas()!;
        if (inputMaskReady) {
          ctx.globalAlpha = 0.88;
          ctx.drawImage(inputMaskEl, ic.x, ic.y, ic.w, ic.h);
          ctx.globalAlpha = 1;
        }
        ctx.strokeStyle = '#ff44ff';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([]);
        ctx.strokeRect(ic.x, ic.y, ic.w, ic.h);

        // Button centre markers + sampling patch
        const patchR = sampleRadiusPct / 100;
        const patchW = Math.max(3, ic.w * patchR);
        const patchH = Math.max(3, ic.h * patchR);
        ctx.setLineDash([]);
        for (const [id, [nx, ny]] of Object.entries(customLayout.buttons) as [InputId, [number, number]][]) {
          const px = ic.x + nx * ic.w;
          const py = ic.y + ny * ic.h;
          const pressed = detectedInputs[id as InputId] === 'pressed';
          const isDrag  = draggingDot === id;
          const isHover = hoveredDot  === id;

          // Sampling patch rectangle
          ctx.strokeStyle = isDrag  ? 'rgba(255,200,50,0.9)'
                          : isHover ? 'rgba(255,255,255,0.55)'
                          : pressed ? 'rgba(80,80,255,0.7)'
                          :           'rgba(255,255,255,0.20)';
          ctx.lineWidth = isDrag ? 1.5 : 1;
          ctx.strokeRect(px - patchW / 2, py - patchH / 2, patchW, patchH);

          // Outer ring
          ctx.beginPath();
          ctx.arc(px, py, 4, 0, Math.PI * 2);
          ctx.strokeStyle = isDrag  ? '#ffcc33'
                          : isHover ? '#ffffff'
                          : pressed ? '#ffffff'
                          :           'rgba(255,255,255,0.35)';
          ctx.lineWidth = isDrag ? 2 : 1;
          ctx.stroke();

          // Inner fill
          ctx.beginPath();
          ctx.arc(px, py, 2.5, 0, Math.PI * 2);
          ctx.fillStyle = isDrag  ? '#ffcc33'
                        : isHover ? '#dddddd'
                        : pressed ? '#aaaaaa'
                        :           'rgba(255,255,255,0.55)';
          ctx.fill();
        }
      }
    }

    // Hold rect outline (drawn regardless of board rect)
    if (holdRect) {
      const hc = scaledRect(holdRect);
      const isActive = dragMode === 'hold';
      ctx.strokeStyle = isActive ? '#ffdd44' : 'rgba(255,221,68,0.7)';
      ctx.lineWidth = isActive ? 2 : 1.5;
      ctx.setLineDash([]);
      ctx.strokeRect(hc.x, hc.y, hc.w, hc.h);
      ctx.font = 'bold 9px sans-serif';
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fillRect(hc.x + 1, hc.y + 1, 13, 11);
      ctx.fillStyle = '#ffdd44';
      ctx.fillText('H', hc.x + 3, hc.y + 10);
      if (detectedHold !== null) {
        ctx.fillStyle = CELL_FILL[PIECE_META[detectedHold].cellType] ?? '#888';
        ctx.fillText(PIECE_META[detectedHold].name, hc.x + hc.w - 11, hc.y + 10);
      }
    }

    // Next piece rect outlines (drawn regardless of board rect)
    ctx.font = 'bold 9px sans-serif';
    for (let i = 0; i < nextRects.length; i++) {
      const nr = nextRects[i];
      if (!nr) continue;
      const nc = scaledRect(nr);
      const isActive = (dragMode as string) === `next${i}`;
      ctx.strokeStyle = isActive ? '#44ffdd' : 'rgba(68,255,221,0.7)';
      ctx.lineWidth = isActive ? 2 : 1.5;
      ctx.setLineDash([]);
      ctx.strokeRect(nc.x, nc.y, nc.w, nc.h);
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fillRect(nc.x + 1, nc.y + 1, 13, 11);
      ctx.fillStyle = '#44ffdd';
      ctx.fillText(String(i + 1), nc.x + 3, nc.y + 10);
      if (detectedNext[i] !== null) {
        ctx.fillStyle = CELL_FILL[PIECE_META[detectedNext[i]!].cellType] ?? '#888';
        ctx.fillText(PIECE_META[detectedNext[i]!].name, nc.x + nc.w - 11, nc.y + 10);
      }
    }

    // Level rect outline
    if (levelRect) {
      const lc = scaledRect(levelRect);
      const isActive = dragMode === 'level';
      ctx.strokeStyle = isActive ? '#ff8c28' : 'rgba(255,140,40,0.7)';
      ctx.lineWidth = isActive ? 2 : 1.5;
      ctx.setLineDash([]);
      ctx.strokeRect(lc.x, lc.y, lc.w, lc.h);
      // Label above the rect (exterior)
      ctx.font = 'bold 9px sans-serif';
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fillRect(lc.x, lc.y - 12, 15, 11);
      ctx.fillStyle = '#ff8c28';
      ctx.fillText('Lv', lc.x + 1, lc.y - 3);
    }

    // ── Rect hover / drag highlight ───────────────────────────────────────────
    const hlTarget = draggingRectTarget ?? hoveredRectTarget;
    const hlEdge   = draggingRectTarget ? draggingRectEdge : hoveredRectEdge;
    if (hlTarget && hlEdge) {
      const hlRect = getTargetRect(hlTarget);
      if (hlRect) {
        const rc = scaledRect(hlRect);
        const color = hlTarget.kind === 'board'  ? '#ffdd00'
                    : hlTarget.kind === 'input'  ? '#ff88ff'
                    : hlTarget.kind === 'hold'   ? '#ffdd44'
                    : hlTarget.kind === 'level'  ? '#ff8c28'
                    : '#44ffdd';
        ctx.save();
        ctx.setLineDash([]);
        if (hlEdge === 'center') {
          ctx.strokeStyle = color;
          ctx.lineWidth = 2.5;
          ctx.globalAlpha = 0.9;
          ctx.strokeRect(rc.x, rc.y, rc.w, rc.h);
          ctx.fillStyle = color;
          ctx.globalAlpha = 0.12;
          ctx.fillRect(rc.x, rc.y, rc.w, rc.h);
        } else {
          ctx.strokeStyle = color;
          ctx.lineWidth = 4;
          ctx.globalAlpha = 0.9;
          ctx.lineCap = 'round';
          const { x, y, w, h } = rc;
          ctx.beginPath();
          if (hlEdge === 'n'  || hlEdge === 'nw' || hlEdge === 'ne') { ctx.moveTo(x,     y);     ctx.lineTo(x + w, y); }
          if (hlEdge === 's'  || hlEdge === 'sw' || hlEdge === 'se') { ctx.moveTo(x,     y + h); ctx.lineTo(x + w, y + h); }
          if (hlEdge === 'w'  || hlEdge === 'nw' || hlEdge === 'sw') { ctx.moveTo(x,     y);     ctx.lineTo(x,     y + h); }
          if (hlEdge === 'e'  || hlEdge === 'ne' || hlEdge === 'se') { ctx.moveTo(x + w, y);     ctx.lineTo(x + w, y + h); }
          ctx.stroke();
        }
        ctx.restore();
      }
    }

    // Level-change flash notification
    if (performance.now() < levelFlashUntil) {
      ctx.save();
      ctx.font = 'bold 14px sans-serif';
      const text = 'Level changed — frame added';
      const tm = ctx.measureText(text);
      const px = (cw - tm.width) / 2;
      const py = 22;
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.beginPath();
      ctx.roundRect(px - 10, py - 14, tm.width + 20, 22, 4);
      ctx.fill();
      ctx.fillStyle = '#ff8c28';
      ctx.fillText(text, px, py);
      ctx.restore();
    }

    ctx.restore();
  }

  // ── Mini-board preview ────────────────────────────────────────────────────────
  const MINI_CW = 8, MINI_CH = 8;

  function drawMiniBoard() {
    if (!miniCanvas) return;
    const rows = detectedCells ? detectedCells.length : gridRows;
    const cols = detectedCells ? detectedCells[0]?.length ?? gridCols : gridCols;
    miniCanvas.width  = cols * MINI_CW;
    miniCanvas.height = rows * MINI_CH;
    const ctx = miniCanvas.getContext('2d')!;
    ctx.fillStyle = '#080808';
    ctx.fillRect(0, 0, miniCanvas.width, miniCanvas.height);
    // Grid lines to show empty board structure
    ctx.strokeStyle = '#1a1a1c';
    ctx.lineWidth = 0.5;
    for (let r = 0; r <= rows; r++) {
      ctx.beginPath(); ctx.moveTo(0, r * MINI_CH); ctx.lineTo(cols * MINI_CW, r * MINI_CH); ctx.stroke();
    }
    for (let c = 0; c <= cols; c++) {
      ctx.beginPath(); ctx.moveTo(c * MINI_CW, 0); ctx.lineTo(c * MINI_CW, rows * MINI_CH); ctx.stroke();
    }
    if (!detectedCells) return;
    for (let r = 0; r < detectedCells.length; r++) {
      for (let c = 0; c < detectedCells[r].length; c++) {
        const isActive = activePieceCells && activePieceCells[r]?.[c] === CellType.Empty && detectedCells[r][c] !== CellType.Empty;
        const ct = detectedCells[r][c];
        const fill = CELL_FILL[stackAsGarbage && ct !== CellType.Empty && !isActive ? CellType.Garbage : ct];
        if (fill) {
          ctx.fillStyle = fill;
          if (isActive) {
            const inset = Math.max(1, Math.min(MINI_CW, MINI_CH) * 0.2);
            ctx.fillRect(c * MINI_CW + 1 + inset, r * MINI_CH + 1 + inset, MINI_CW - 1 - 2 * inset, MINI_CH - 1 - 2 * inset);
          } else {
            ctx.fillRect(c * MINI_CW + 1, r * MINI_CH + 1, MINI_CW - 1, MINI_CH - 1);
          }
        }
      }
    }
    // Highlight manually toggled cells
    if (manualActiveCells) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      for (const key of manualActiveCells) {
        const [r, c] = key.split(',').map(Number);
        ctx.strokeRect(c * MINI_CW + 1.5, r * MINI_CH + 1.5, MINI_CW - 2, MINI_CH - 2);
      }
    }
  }

  $: detectedCells, activePieceCells, manualActiveCells, boardRect, gridCols, gridRows, stackAsGarbage, drawMiniBoard();

  // ── Manual active piece override ────────────────────────────────────────────
  function onMiniBoardClick(e: MouseEvent) {
    if (!manualSelectMode || !detectedCells) return;
    const rect = miniCanvas.getBoundingClientRect();
    const col = Math.floor((e.clientX - rect.left) / (rect.width / gridCols));
    const dRow = Math.floor((e.clientY - rect.top) / (rect.height / gridRows));
    if (dRow < 0 || dRow >= gridRows || col < 0 || col >= gridCols) return;
    if (detectedCells[dRow][col] === CellType.Empty) return;

    if (!manualActiveCells) manualActiveCells = new Set();
    const key = `${dRow},${col}`;
    if (manualActiveCells.has(key)) manualActiveCells.delete(key);
    else manualActiveCells.add(key);
    manualActiveCells = manualActiveCells; // trigger reactivity
    drawMiniBoard();
  }

  function applyManualOverride() {
    if (!manualActiveCells || manualActiveCells.size === 0 || !detectedCells) {
      manualActiveCells = null;
      manualSelectMode = false;
      runDetection();
      return;
    }

    const cells = [...manualActiveCells].map(k => {
      const [r, c] = k.split(',').map(Number);
      return { dRow: r, col: c, cellType: detectedCells![r][c] };
    });

    // Try shape matching if exactly 4 cells of same type
    if (cells.length === 4 && cells.every(c => c.cellType === cells[0].cellType)) {
      const d = get(diagram);
      const pieceType = (cells[0].cellType - 1) as PieceType;
      const shapes = getShapeTable(d.rotationSystem);
      const positions = cells.map(c => ({ x: c.col, y: BOARD_ROWS - 1 - c.dRow }));
      const ap = findActivePiece(pieceType, positions, shapes);
      if (ap) {
        detectedActivePiece = ap;
        activePieceCells = detectedCells.map(r => [...r]);
        for (const c of cells) activePieceCells[c.dRow][c.col] = CellType.Empty;
        lastLockedBoard = activePieceCells.map(r => [...r]);
        manualSelectMode = false;
        drawMiniBoard();
        return;
      }
    }

    // Not a valid piece (yet) — just highlight manually toggled cells visually
    activePieceCells = detectedCells.map(r => [...r]);
    for (const c of cells) activePieceCells[c.dRow][c.col] = CellType.Empty;
    detectedActivePiece = null;
    drawMiniBoard();
  }

  function enterManualSelect() {
    manualSelectMode = true;
    manualActiveCells = new Set();
    drawMiniBoard();
  }

  function cancelManualSelect() {
    manualSelectMode = false;
    manualActiveCells = null;
    runDetection();
  }

  function setNoActivePiece() {
    manualSelectMode = false;
    manualActiveCells = null;
    detectedActivePiece = null;
    activePieceCells = null;
    // Snapshot current board as baseline (everything is stack)
    if (detectedCells) lastLockedBoard = detectedCells.map(r => [...r]);
    diffCandidateCount = 0;
    drawMiniBoard();
  }

  // ── Coordinate helpers ────────────────────────────────────────────────────────
  function canvasPosFromEvent(e: MouseEvent): { x: number; y: number } {
    const rect = previewCanvas.getBoundingClientRect();
    const sx = previewCanvas.width  / rect.width;
    const sy = previewCanvas.height / rect.height;
    return { x: (e.clientX - rect.left) * sx, y: (e.clientY - rect.top) * sy };
  }

  function currentDragInCanvas(): Rect {
    return {
      x: Math.min(dragStartPx.x, dragCurPx.x),
      y: Math.min(dragStartPx.y, dragCurPx.y),
      w: Math.abs(dragCurPx.x - dragStartPx.x),
      h: Math.abs(dragCurPx.y - dragStartPx.y),
    };
  }

  function scaledRect(r: Rect): Rect {
    if (!videoEl || !previewCanvas) return r;
    const sx = previewCanvas.width  / videoEl.videoWidth;
    const sy = previewCanvas.height / videoEl.videoHeight;
    return { x: r.x * sx, y: r.y * sy, w: r.w * sx, h: r.h * sy };
  }

  function boardRectInCanvas(): Rect | null { return boardRect ? scaledRect(boardRect) : null; }
  function inputRectInCanvas(): Rect | null { return inputRect ? scaledRect(inputRect) : null; }

  // ── Loupe drawing (permanent side-panel canvas) ───────────────────────────────
  function drawLoupeCanvas() {
    if (!loupeCanvas) return;
    const ctx = loupeCanvas.getContext('2d')!;

    if (!videoEl || !stream || !previewCanvas) {
      ctx.fillStyle = '#080808';
      ctx.fillRect(0, 0, LOUPE_DST_W, LOUPE_DST_H);
      return;
    }

    const cw = previewCanvas.width, ch = previewCanvas.height;
    const vx = mousePx.x * (videoEl.videoWidth  / cw);
    const vy = mousePx.y * (videoEl.videoHeight / ch);
    const sx = Math.max(0, Math.min(videoEl.videoWidth  - LOUPE_SRC_W, vx - LOUPE_SRC_W / 2));
    const sy = Math.max(0, Math.min(videoEl.videoHeight - LOUPE_SRC_H, vy - LOUPE_SRC_H / 2));

    ctx.drawImage(videoEl, sx, sy, LOUPE_SRC_W, LOUPE_SRC_H, 0, 0, LOUPE_DST_W, LOUPE_DST_H);

    // Crosshair
    const hx = (vx - sx) / LOUPE_SRC_W * LOUPE_DST_W;
    const hy = (vy - sy) / LOUPE_SRC_H * LOUPE_DST_H;
    ctx.strokeStyle = 'rgba(255,80,255,0.85)';
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(hx, 0);           ctx.lineTo(hx, LOUPE_DST_H); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0,  hy);           ctx.lineTo(LOUPE_DST_W, hy); ctx.stroke();

    // Input button circles
    if (inputRect) {
      const scaleX = LOUPE_DST_W / LOUPE_SRC_W;
      const scaleY = LOUPE_DST_H / LOUPE_SRC_H;
      const patchR  = sampleRadiusPct / 100;
      const patchVW = inputRect.w * patchR;
      const patchVH = inputRect.h * patchR;

      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, LOUPE_DST_W, LOUPE_DST_H);
      ctx.clip();
      ctx.setLineDash([]);

      for (const [id, [nx, ny]] of Object.entries(customLayout.buttons) as [InputId, [number, number]][]) {
        const bvx = inputRect.x + nx * inputRect.w;
        const bvy = inputRect.y + ny * inputRect.h;
        const bpx = (bvx - sx) * scaleX;
        const bpy = (bvy - sy) * scaleY;

        const pressed = detectedInputs[id as InputId] === 'pressed';
        const isDrag  = draggingDot === id;
        const isHover = hoveredDot  === id;

        const lpw = patchVW * scaleX;
        const lph = patchVH * scaleY;
        ctx.strokeStyle = isDrag  ? 'rgba(255,200,50,0.9)'
                        : isHover ? 'rgba(255,255,255,0.55)'
                        : pressed ? 'rgba(80,80,255,0.7)'
                        :           'rgba(255,255,255,0.20)';
        ctx.lineWidth = isDrag ? 1.5 : 1;
        ctx.strokeRect(bpx - lpw / 2, bpy - lph / 2, lpw, lph);

        ctx.beginPath();
        ctx.arc(bpx, bpy, 4, 0, Math.PI * 2);
        ctx.strokeStyle = isDrag  ? '#ffcc33' : isHover ? '#ffffff' : pressed ? '#ffffff' : 'rgba(255,255,255,0.35)';
        ctx.lineWidth = isDrag ? 2 : 1;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(bpx, bpy, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = isDrag  ? '#ffcc33' : isHover ? '#dddddd' : pressed ? '#aaaaaa' : 'rgba(255,255,255,0.55)';
        ctx.fill();
      }
      ctx.restore();
    }

    // Label
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(2, 2, 22, 13);
    ctx.fillStyle = 'rgba(255,80,255,0.9)';
    ctx.font = 'bold 10px sans-serif';
    ctx.fillText(`${LOUPE_ZOOM}×`, 5, 12);
  }

  // ── Rect edge / move helpers ──────────────────────────────────────────────────
  const EDGE_THRESH = 8; // canvas-pixel hit distance for edge handles

  function getTargetRect(t: RectTarget): Rect | null {
    if (t.kind === 'board') return boardRect;
    if (t.kind === 'input') return inputRect;
    if (t.kind === 'hold')  return holdRect;
    if (t.kind === 'level') return levelRect;
    if (t.kind === 'next')  return nextRects[t.i];
    return null;
  }

  function setTargetRect(t: RectTarget, r: Rect) {
    if (t.kind === 'board')      boardRect = r;
    else if (t.kind === 'input') inputRect = r;
    else if (t.kind === 'hold')  holdRect  = r;
    else if (t.kind === 'level') levelRect = r;
    else if (t.kind === 'next')  nextRects = nextRects.map((nr, i) => i === (t as { kind: 'next'; i: number }).i ? r : nr);
  }

  function hitTestRect(p: { x: number; y: number }, r: Rect): EdgeHit | null {
    const rc = scaledRect(r);
    const T = EDGE_THRESH;
    if (p.x < rc.x - T || p.x > rc.x + rc.w + T || p.y < rc.y - T || p.y > rc.y + rc.h + T) return null;
    const onN = Math.abs(p.y - rc.y) <= T && p.x >= rc.x - T && p.x <= rc.x + rc.w + T;
    const onS = Math.abs(p.y - (rc.y + rc.h)) <= T && p.x >= rc.x - T && p.x <= rc.x + rc.w + T;
    const onW = Math.abs(p.x - rc.x) <= T && p.y >= rc.y - T && p.y <= rc.y + rc.h + T;
    const onE = Math.abs(p.x - (rc.x + rc.w)) <= T && p.y >= rc.y - T && p.y <= rc.y + rc.h + T;
    if (onN && onW) return 'nw';
    if (onN && onE) return 'ne';
    if (onS && onW) return 'sw';
    if (onS && onE) return 'se';
    if (onN) return 'n';
    if (onS) return 's';
    if (onW) return 'w';
    if (onE) return 'e';
    if (p.x >= rc.x && p.x <= rc.x + rc.w && p.y >= rc.y && p.y <= rc.y + rc.h) return 'center';
    return null;
  }

  function findHoveredRect(p: { x: number; y: number }): { target: RectTarget; edge: EdgeHit } | null {
    // Test small/specific rects first so they win over board when overlapping
    const candidates: { target: RectTarget; rect: Rect }[] = [];
    if (levelRect) candidates.push({ target: { kind: 'level' }, rect: levelRect });
    if (holdRect)  candidates.push({ target: { kind: 'hold' },  rect: holdRect });
    for (let i = 0; i < nextRects.length; i++) {
      const nr = nextRects[i];
      if (nr) candidates.push({ target: { kind: 'next', i }, rect: nr });
    }
    if (inputRect) candidates.push({ target: { kind: 'input' }, rect: inputRect });
    if (boardRect) candidates.push({ target: { kind: 'board' }, rect: boardRect });
    for (const { target, rect } of candidates) {
      const edge = hitTestRect(p, rect);
      if (edge !== null) return { target, edge };
    }
    return null;
  }

  function edgeCursor(edge: EdgeHit): string {
    if (edge === 'center') return 'move';
    if (edge === 'n' || edge === 's') return 'ns-resize';
    if (edge === 'e' || edge === 'w') return 'ew-resize';
    if (edge === 'nw' || edge === 'se') return 'nwse-resize';
    return 'nesw-resize';
  }

  function applyRectDrag(p: { x: number; y: number }) {
    if (!draggingRectTarget || !rectDragStartVid || !videoEl || !previewCanvas) return;
    const sx = videoEl.videoWidth  / previewCanvas.width;
    const sy = videoEl.videoHeight / previewCanvas.height;
    const dx = (p.x - rectDragStartPx.x) * sx;
    const dy = (p.y - rectDragStartPx.y) * sy;
    const s = rectDragStartVid;
    const MIN = 8;
    let { x, y, w, h } = s;
    const edge = draggingRectEdge!;
    if (edge === 'center') {
      x = s.x + dx;
      y = s.y + dy;
    } else {
      if (edge === 'n' || edge === 'nw' || edge === 'ne') {
        const ny = s.y + dy, nh = s.h - dy;
        if (nh >= MIN) { y = ny; h = nh; }
      }
      if (edge === 's' || edge === 'sw' || edge === 'se') {
        h = Math.max(MIN, s.h + dy);
      }
      if (edge === 'w' || edge === 'nw' || edge === 'sw') {
        const nx = s.x + dx, nw = s.w - dx;
        if (nw >= MIN) { x = nx; w = nw; }
      }
      if (edge === 'e' || edge === 'ne' || edge === 'se') {
        w = Math.max(MIN, s.w + dx);
      }
    }
    setTargetRect(draggingRectTarget, { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) });
  }

  // ── Mouse events ──────────────────────────────────────────────────────────────
  function dotAtPoint(p: { x: number; y: number }): InputId | null {
    if (!inputRect || !previewCanvas) return null;
    const ic = inputRectInCanvas()!;
    for (const [id, [nx, ny]] of Object.entries(customLayout.buttons) as [InputId, [number, number]][]) {
      if (Math.hypot(p.x - (ic.x + nx * ic.w), p.y - (ic.y + ny * ic.h)) <= 8)
        return id as InputId;
    }
    return null;
  }

  function onCanvasMousedown(e: MouseEvent) {
    if (!stream) return;
    const p = canvasPosFromEvent(e);

    // Priority 1: dot drag
    const dot = dotAtPoint(p);
    if (dot) { draggingDot = dot; return; }

    // Priority 2: rect edge / move drag
    const hover = findHoveredRect(p);
    if (hover) {
      draggingRectTarget = hover.target;
      draggingRectEdge   = hover.edge;
      rectDragStartPx    = p;
      rectDragStartVid   = getTargetRect(hover.target);
      return;
    }

    // Priority 3: draw new rect
    isDragging  = true;
    dragStartPx = p;
    dragCurPx   = p;
  }

  function onWindowMousemove(e: MouseEvent) {
    if (!previewCanvas) return;
    const p = canvasPosFromEvent(e);
    mousePx = p;

    // Dot drag
    if (draggingDot && inputRect) {
      const ic = inputRectInCanvas()!;
      const nx = Math.max(0, Math.min(1, (p.x - ic.x) / ic.w));
      const ny = Math.max(0, Math.min(1, (p.y - ic.y) / ic.h));
      const ox = ACTION_IDS.has(draggingDot) ? actionOffsetXPct / 100 : 0;
      const oy = ACTION_IDS.has(draggingDot) ? actionOffsetYPct / 100 : 0;
      layoutButtons = { ...layoutButtons, [draggingDot]: [nx - ox, ny - oy] };
      const now = performance.now();
      if (now - lastDragDetectMs > 60) { lastDragDetectMs = now; runDetection(); }
      return;
    }

    // Rect edge / move drag
    if (draggingRectTarget) {
      applyRectDrag(p);
      const now = performance.now();
      if (now - lastDragDetectMs > 60) { lastDragDetectMs = now; runDetection(); }
      return;
    }

    // Hover — update cursor and highlight state
    if (!isDragging) {
      const dot = dotAtPoint(p);
      if (dot) {
        hoveredDot = dot;
        hoveredRectTarget = null;
        hoveredRectEdge = null;
        previewCanvas.style.cursor = 'grab';
      } else {
        hoveredDot = null;
        const hover = findHoveredRect(p);
        hoveredRectTarget = hover?.target ?? null;
        hoveredRectEdge   = hover?.edge   ?? null;
        previewCanvas.style.cursor = hover ? edgeCursor(hover.edge) : 'crosshair';
      }
    }

    if (!isDragging) return;
    dragCurPx = p;
  }

  function onWindowMouseup(e: MouseEvent) {
    if (draggingDot) {
      draggingDot = null;
      runDetection();
      return;
    }
    if (draggingRectTarget) {
      draggingRectTarget = null;
      draggingRectEdge   = null;
      rectDragStartVid   = null;
      runDetection();
      return;
    }
    if (!isDragging || !previewCanvas) return;
    isDragging = false;
    const p  = canvasPosFromEvent(e);
    const rx = Math.min(dragStartPx.x, p.x);
    const ry = Math.min(dragStartPx.y, p.y);
    const rw = Math.abs(p.x - dragStartPx.x);
    const rh = Math.abs(p.y - dragStartPx.y);
    if (rw < 10 || rh < 10) return;
    const vidRect = {
      x: Math.round(rx * (videoEl.videoWidth  / previewCanvas.width)),
      y: Math.round(ry * (videoEl.videoHeight / previewCanvas.height)),
      w: Math.round(rw * (videoEl.videoWidth  / previewCanvas.width)),
      h: Math.round(rh * (videoEl.videoHeight / previewCanvas.height)),
    };
    if (dragMode === 'board') {
      if (rw < 20 || rh < 20) return;
      boardRect = vidRect;
      // Auto-fill other rects from preset when in preset layout mode
      if (selectedLayout !== 'none') {
        const preset = allPresets.find(p => p.name === selectedLayout);
        if (preset?.board) { applyPreset(preset); return; }
      }
    } else if (dragMode === 'input') {
      inputRect = vidRect;
    } else if (dragMode === 'hold') {
      holdRect = vidRect;
      detectedHold = null;
    } else if (dragMode === 'level') {
      levelRect = vidRect;
      lastLevelBinary = null;
    } else {
      const i = parseInt(dragMode.slice(4));
      nextRects = nextRects.map((r, j) => j === i ? vidRect : r);
      detectedNext = detectedNext.map((d, j) => j === i ? null : d);
    }
    runDetection();
  }

  // ── Detection ─────────────────────────────────────────────────────────────────
  function runDetection() {
    if (!videoEl) return;

    if (boardRect) {
      const off = document.createElement('canvas');
      off.width  = boardRect.w;
      off.height = boardRect.h;
      const ctx = off.getContext('2d')!;
      ctx.drawImage(videoEl, boardRect.x, boardRect.y, boardRect.w, boardRect.h,
                             0, 0, boardRect.w, boardRect.h);
      boardImageData = ctx.getImageData(0, 0, boardRect.w, boardRect.h);
      detectedCells  = classifyBoard(boardImageData, gridCols, gridRows, thresholds);
      if (detectedCells) {
        const now = performance.now();
        detectionBuffer.push({ cells: detectedCells.map(r => [...r]), ts: now });
        if (detectionBuffer.length > DETECTION_BUFFER_MAX) detectionBuffer.shift();
      }
      if (detectActivePiece && detectedCells && !manualActiveCells) {
        if (!lastLockedBoard) {
          // First detection — check for floating piece before snapshotting baseline
          const d = get(diagram);
          const floating = findFloatingPiece(detectedCells, d.rotationSystem);
          if (floating) {
            lastLockedBoard = detectedCells.map(r => [...r]);
            for (const c of floating.cells)
              lastLockedBoard[c.dRow][c.col] = CellType.Empty;
            detectedActivePiece = floating.activePiece;
            activePieceCells = lastLockedBoard;
            diffCandidateCount = 4;
          } else {
            lastLockedBoard = detectedCells.map(r => [...r]);
            detectedActivePiece = null;
            activePieceCells = null;
            diffCandidateCount = 0;
          }
        } else {
          const d = get(diagram);
          const result = diffDetectActivePiece(
            detectedCells, lastLockedBoard, d.rotationSystem, diffMinCells, diffMaxCells
          );
          detectedActivePiece = result.activePiece;
          activePieceCells = result.activePiece ? result.boardCells : null;
          diffCandidateCount = result.candidateCount;

          // Update baseline when piece locks (0 new cells = board settled)
          if (result.candidateCount === 0) {
            lastLockedBoard = detectedCells.map(r => [...r]);
          }

          // Auto-reset baseline on large board changes (line clears, board resets)
          if (countCellDiff(detectedCells, lastLockedBoard) > gridCols * 2) {
            lastLockedBoard = detectedCells.map(r => [...r]);
            detectedActivePiece = null;
            activePieceCells = null;
            diffCandidateCount = 0;
          }
        }
      } else if (!manualActiveCells) {
        detectedActivePiece = null;
        activePieceCells = null;
      }
      computeBoardMask();
    }

    if (inputRect) {
      const off = document.createElement('canvas');
      off.width  = inputRect.w;
      off.height = inputRect.h;
      const ctx = off.getContext('2d')!;
      ctx.drawImage(videoEl, inputRect.x, inputRect.y, inputRect.w, inputRect.h,
                             0, 0, inputRect.w, inputRect.h);
      inputImageData = ctx.getImageData(0, 0, inputRect.w, inputRect.h);
      detectedInputs = detectTgm4Inputs(inputImageData, customLayout, inputThresholds);
      computeInputMask();
    }

    if (holdRect) {
      const off = document.createElement('canvas');
      off.width = holdRect.w; off.height = holdRect.h;
      const ctx = off.getContext('2d')!;
      ctx.drawImage(videoEl, holdRect.x, holdRect.y, holdRect.w, holdRect.h,
                             0, 0, holdRect.w, holdRect.h);
      detectedHold = detectPieceFromRegion(ctx.getImageData(0, 0, holdRect.w, holdRect.h));
    }

    // Level region — binarize and diff
    if (levelRect && videoEl) {
      const off = document.createElement('canvas');
      off.width = levelRect.w; off.height = levelRect.h;
      const ctx = off.getContext('2d')!;
      ctx.drawImage(videoEl, levelRect.x, levelRect.y, levelRect.w, levelRect.h, 0, 0, levelRect.w, levelRect.h);
      const bin = binarizeRegion(ctx.getImageData(0, 0, levelRect.w, levelRect.h), levelBrightnessThreshold);
      currentLevelBinary = bin;
      levelBinaryW = levelRect.w;
      levelBinaryH = levelRect.h;
      if (lastLevelBinary && lastLevelBinary.length === bin.length) {
        const diffCount = binaryDiff(bin, lastLevelBinary);
        const diffPercent = (diffCount / bin.length) * 100;
        levelChanged = diffPercent > levelDiffPct;
      } else {
        levelChanged = false;
        if (!lastLevelBinary) lastLevelBinary = bin;
      }
      drawBinaryToCanvas(levelCurrentCanvas, currentLevelBinary, levelBinaryW, levelBinaryH);
      drawBinaryToCanvas(levelBaselineCanvas, lastLevelBinary, levelBinaryW, levelBinaryH);
    } else {
      levelChanged = false;
      currentLevelBinary = null;
    }

    const newNext = [...detectedNext];
    for (let i = 0; i < nextRects.length; i++) {
      const nr = nextRects[i];
      if (!nr) { newNext[i] = null; continue; }
      const off = document.createElement('canvas');
      off.width = nr.w; off.height = nr.h;
      const ctx = off.getContext('2d')!;
      ctx.drawImage(videoEl, nr.x, nr.y, nr.w, nr.h, 0, 0, nr.w, nr.h);
      newNext[i] = detectPieceFromRegion(ctx.getImageData(0, 0, nr.w, nr.h));
    }
    detectedNext = newNext;
  }

  // Live re-detection on threshold changes (only when a rect is already defined)
  $: { thresholds; if (boardRect)  runDetection(); }
  $: { inputThresholds; if (inputRect) runDetection(); }

  // ── Import helpers ────────────────────────────────────────────────────────────
  function buildDetectedBoard(): Uint8Array {
    const d   = get(diagram);
    const idx = get(currentFrameIndex);
    const board = d.frames[idx].board.slice();
    const source = activePieceCells ?? detectedCells!;
    for (let gameRow = 0; gameRow < BOARD_ROWS; gameRow++)
      for (let col = 0; col < BOARD_COLS; col++)
        setCell(board, col, gameRow, CellType.Empty);
    for (let dRow = 0; dRow < Math.min(source.length, BOARD_ROWS); dRow++) {
      const gameRow = BOARD_ROWS - 1 - dRow;
      const row = source[dRow];
      for (let col = 0; col < Math.min(row.length, BOARD_COLS); col++) {
        const ct = row[col];
        setCell(board, col, gameRow, stackAsGarbage && ct !== CellType.Empty ? CellType.Garbage : ct);
      }
    }
    return board;
  }

  function capturedInputs(): Partial<Record<InputId, InputState>> | undefined {
    return inputRect && Object.keys(detectedInputs).length ? detectedInputs : undefined;
  }

  function detectPieceFromRegion(imageData: ImageData): PieceType | null {
    const grid = classifyBoard(imageData, 4, 4, thresholds);
    const counts = new Map<CellType, number>();
    for (const row of grid)
      for (const cellType of row)
        if (cellType >= CellType.I && cellType <= CellType.L)
          counts.set(cellType, (counts.get(cellType) ?? 0) + 1);
    if (counts.size === 0) return null;
    let best: CellType = CellType.Empty, bestN = 0;
    for (const [cellType, n] of counts)
      if (n > bestN) { bestN = n; best = cellType; }
    return bestN > 0 ? (best - 1) as PieceType : null;
  }

  function capturedPieceUpdates(): { holdPiece?: PieceType; nextQueue?: PieceType[] } {
    const pixelUnit: { holdPiece?: PieceType; nextQueue?: PieceType[] } = {};
    if (holdRect !== null) pixelUnit.holdPiece = detectedHold ?? undefined;
    if (nextRects.some(r => r !== null)) {
      const q: PieceType[] = [];
      for (let i = 0; i < nextRects.length; i++) {
        if (nextRects[i] === null) break;
        if (detectedNext[i] !== null) q.push(detectedNext[i]!);
      }
      pixelUnit.nextQueue = q;
    }
    return pixelUnit;
  }

  function flash(msg: string) {
    importStatus = msg;
    setTimeout(() => (importStatus = ''), 2000);
  }

  function buildFrameUpdate(): Partial<import('../types/frame').Frame> {
    const update: Partial<import('../types/frame').Frame> = {
      board: buildDetectedBoard(),
      inputs: capturedInputs(),
      ...capturedPieceUpdates(),
    };
    if (detectedActivePiece) {
      update.activePiece = detectedActivePiece;
    }
    return update;
  }

  function doImport() {
    if (!detectedCells) return;
    checkpoint();
    const d   = get(diagram);
    const idx = get(currentFrameIndex);
    const update = buildFrameUpdate();
    const frames = d.frames.map((f, i) =>
      i === idx ? { ...f, ...update } : f,
    );
    diagram.set({ ...d, frames });
    flash('Overwritten!');
  }

  function doImportAsNewFrame() {
    if (!detectedCells) return;
    checkpoint();
    const d   = get(diagram);
    const idx = get(currentFrameIndex);
    const update = buildFrameUpdate();
    const newFrame = { ...d.frames[idx], ...update };
    const frames = [
      ...d.frames.slice(0, idx + 1),
      newFrame,
      ...d.frames.slice(idx + 1),
    ];
    diagram.set({ ...d, frames });
    currentFrameIndex.set(idx + 1);
    flash('Frame added!');
  }

  // ── Hue reset ─────────────────────────────────────────────────────────────────
  function resetHues() {
    currentHues = { ...getDefaultHues(palette) };
  }

  function setHue(cellType: CellType, val: number) {
    currentHues = { ...currentHues, [cellType]: val };
  }

  // ── Config snapshot / presets ─────────────────────────────────────────────────
  type ConfigSnapshot = {
    board:  Rect | null;
    input:  Rect | null;
    hold:   Rect | null;
    level:  Rect | null;
    next:   (Rect | null)[];
    palette: ColorPalette;
    emptyBrightness:       number;   // 0–100 %
    garbageSaturation:     number;   // 0–100 %
    hueTolerance: number;
    pieceHues:    Record<string, number>; // piece name → hue°
    pressedHMin:  number;
    pressedHMax:  number;
    pressedSMin:  number;   // 0–100 %
    pressedVMin:  number;   // 0–100 %
    sampleRadiusPct:    number;
    actionOffsetXPct:   number;
    actionOffsetYPct:   number;
    buttons?: Record<string, [number, number]>;
    detectActivePiece?: boolean;
    diffMinCells?: number;
    diffMaxCells?: number;
  };

  // ── Built-in presets ──────────────────────────────────────────────────────────
  const BUILTIN_PRESETS: (Partial<ConfigSnapshot> & { name: string })[] = [
    {
      name: 'TGM1',
      board: { x: 226, y: 197, w: 168, h: 334 },
      input: null, hold: null, level: { x: 265, y: 488, w: 46, h: 17},
      next: [{ x: 277, y: 142, w: 69, h: 40 }, null, null, null, null, null],
      palette: 'ars', emptyBrightness: 25, garbageSaturation: 20, hueTolerance: 90,
      pieceHues: { I: 0, O: 52, T: 180, S: 290, Z: 120, J: 216, L: 32 },
    },
    {
      name: 'TGM2',
      board: { x: 673, y: 183, w: 176, h: 352 },
      input: null, hold: null,
      next: [{ x: 712, y: 120, w: 91, h: 49 }, null, null, null, null, null],
      level: { x: 358, y: 619, w: 68, h: 26 },
      palette: 'ars', emptyBrightness: 25, garbageSaturation: 20, hueTolerance: 90,
      pieceHues: { I: 0, O: 52, T: 180, S: 290, Z: 120, J: 216, L: 32 },
    },
    {
      name: 'TGM3',
      board: { x: 113, y: 215, w: 168, h: 338 },
      input: null, hold: { x: 105, y: 152, w: 38, h: 30 }, level: { x: 384, y: 581, w: 45, h: 21},
      next: [
        { x: 159, y: 148, w: 73, h: 44 },
        { x: 234, y: 164, w: 38, h: 30 },
        { x: 273, y: 170, w: 34, h: 22 },
        null, null, null,
      ],
      palette: 'ars', emptyBrightness: 25, garbageSaturation: 20, hueTolerance: 90,
      pieceHues: { I: 0, O: 52, T: 180, S: 290, Z: 120, J: 216, L: 32 },
    },
    {
      name: 'TGM4 with input display',
      board: { x: 433, y: 209, w: 180, h: 354 },
      input: { x: 738, y: 546, w: 61, h: 22 },
      hold:  { x: 433, y: 178, w: 47, h: 26 },
      level: { x: 392, y: 477, w: 37, h: 19 },
      next: [
        { x: 566, y: 156, w: 97, h: 46 },
        { x: 623, y: 209, w: 42, h: 28 },
        { x: 621, y: 239, w: 42, h: 24 },
        { x: 621, y: 267, w: 42, h: 24 },
        { x: 621, y: 296, w: 45, h: 26 },
        { x: 621, y: 324, w: 42, h: 26 },
      ],
      palette: 'ars', emptyBrightness: 25, garbageSaturation: 20, hueTolerance: 90,
      pieceHues: { I: 0, O: 52, T: 180, S: 290, Z: 120, J: 216, L: 32 },
      pressedHMin: 195, pressedHMax: 245, pressedSMin: 45, pressedVMin: 35,
      sampleRadiusPct: 8, actionOffsetXPct: 0, actionOffsetYPct: 0,
      buttons: {
        up: [0.1985, 0.2], left: [0.0995, 0.5], right: [0.2975, 0.5], down: [0.1985, 0.8],
        ccw: [0.569625, 0.5], cw: [0.706875, 0.5], ccw2: [0.844125, 0.5], rewind: [0.981375, 0.5],
        hold: [0.569625, 0.8], cw2: [0.706875, 0.8], extra: [0.844125, 0.8],
      },
    },
    {
      name: 'TGM4 with with input display and TGM-style next box',
      board: { x: 112, y: 167, w: 231, h: 460 },
      input: { x: 503, y: 600, w: 79, h: 32 },
      hold:  { x: 112, y: 125, w: 60, h: 37 },
      level: { x: 392, y: 477, w: 37, h: 19 },
      next: [
        { x: 175, y: 91,  w: 102, h: 74 },
        { x: 280, y: 100, w: 56,  h: 49 },
        { x: 336, y: 98,  w: 51,  h: 53 },
        { x: 387, y: 98,  w: 53,  h: 53 },
        { x: 440, y: 98,  w: 51,  h: 51 },
        { x: 492, y: 98,  w: 51,  h: 53 },
      ],
      palette: 'ars', emptyBrightness: 25, garbageSaturation: 20, hueTolerance: 90,
      pieceHues: { I: 0, O: 52, T: 180, S: 290, Z: 120, J: 216, L: 32 },
      pressedHMin: 195, pressedHMax: 245, pressedSMin: 45, pressedVMin: 35,
      sampleRadiusPct: 8, actionOffsetXPct: 0, actionOffsetYPct: 0,
      buttons: {
        up: [0.1985, 0.2], left: [0.0995, 0.5], right: [0.2975, 0.5], down: [0.1985, 0.8],
        ccw: [0.569625, 0.5], cw: [0.706875, 0.5], ccw2: [0.844125, 0.5], rewind: [0.981375, 0.5],
        hold: [0.569625, 0.8], cw2: [0.706875, 0.8], extra: [0.844125, 0.8],
      },
    },
  ];

  const PRESET_KEY = 'tedige-capture-presets';
  function loadStoredPresets(): (ConfigSnapshot & { name: string })[] {
    try { return JSON.parse(localStorage.getItem(PRESET_KEY) ?? '[]'); } catch { return []; }
  }
  let presets: (ConfigSnapshot & { name: string })[] = loadStoredPresets();
  $: allPresets = [...BUILTIN_PRESETS, ...presets];
  let newPresetName = '';
  let pasteConfigText = '';
  let pasteConfigError = '';
  let copyConfigStatus = '';

  function getConfigSnapshot(): ConfigSnapshot {
    const namedHues: Record<string, number> = {};
    for (const { cellType, name } of PIECE_META)
      namedHues[name] = currentHues[cellType] ?? getDefaultHues(palette)[cellType] ?? 0;
    return {
      board: boardRect, input: inputRect, hold: holdRect, level: levelRect, next: [...nextRects],
      palette,
      emptyBrightness: emptyVPct, garbageSaturation: garbageSPct, hueTolerance,
      pieceHues: namedHues,
      pressedHMin, pressedHMax, pressedSMin: pressedSPct, pressedVMin: pressedVPct,
      sampleRadiusPct, actionOffsetXPct, actionOffsetYPct,
      buttons: Object.fromEntries(
        Object.entries(layoutButtons).map(([k, [x, y]]) => [k, [x, y] as [number, number]])
      ),
      detectActivePiece,
      diffMinCells, diffMaxCells,
    };
  }

  // Reactive full config JSON — explicit deps so Svelte re-runs on rect/config changes
  $: configJson = (boardRect, inputRect, holdRect, levelRect, nextRects,
     palette, emptyVPct, garbageSPct, hueTolerance, currentHues,
     pressedHMin, pressedHMax, pressedSPct, pressedVPct,
     sampleRadiusPct, actionOffsetXPct, actionOffsetYPct, layoutButtons,
     detectActivePiece, diffMinCells, diffMaxCells,
     JSON.stringify(getConfigSnapshot(), null, 2));

  function applySnapshot(snap: Partial<ConfigSnapshot>, dx = 0, dy = 0) {
    const shift = (r: Rect | null | undefined): Rect | null =>
      r ? { x: r.x + dx, y: r.y + dy, w: r.w, h: r.h } : null;

    // Reset stale detection — runDetection() at end will refresh
    detectedCells = null; detectedInputs = {};
    detectedHold = null; detectedNext = [null, null, null, null, null, null];
    detectedActivePiece = null; activePieceCells = null;

    if ('board' in snap) boardRect = shift(snap.board ?? null);
    if ('input' in snap) inputRect = shift(snap.input ?? null);
    if ('hold'  in snap) holdRect  = shift(snap.hold  ?? null);
    if ('level' in snap) { levelRect = shift(snap.level ?? null); lastLevelBinary = null; }
    if ('next'  in snap && Array.isArray(snap.next))
      nextRects = (snap.next as (Rect | null)[]).map(r => shift(r));

    if (snap.palette !== undefined) { palette = snap.palette; onPaletteChange(); }
    if (snap.emptyBrightness       !== undefined) emptyVPct    = snap.emptyBrightness;
    if (snap.garbageSaturation     !== undefined) garbageSPct  = snap.garbageSaturation;
    if (snap.hueTolerance !== undefined) hueTolerance = snap.hueTolerance;
    if (snap.pieceHues) {
      const newHues = { ...getDefaultHues(palette) };
      for (const { cellType, name } of PIECE_META)
        if (snap.pieceHues[name] !== undefined) newHues[cellType] = snap.pieceHues[name];
      currentHues = newHues;
    }
    if (snap.detectActivePiece !== undefined) detectActivePiece = snap.detectActivePiece;
    if (snap.diffMinCells !== undefined) diffMinCells = snap.diffMinCells;
    if (snap.diffMaxCells !== undefined) diffMaxCells = snap.diffMaxCells;
    if (snap.pressedHMin !== undefined) pressedHMin = snap.pressedHMin;
    if (snap.pressedHMax !== undefined) pressedHMax = snap.pressedHMax;
    if (snap.pressedSMin !== undefined) pressedSPct = snap.pressedSMin;
    if (snap.pressedVMin !== undefined) pressedVPct = snap.pressedVMin;
    if (snap.sampleRadiusPct  !== undefined) sampleRadiusPct  = snap.sampleRadiusPct;
    if (snap.actionOffsetXPct !== undefined) actionOffsetXPct = snap.actionOffsetXPct;
    if (snap.actionOffsetYPct !== undefined) actionOffsetYPct = snap.actionOffsetYPct;
    if (snap.buttons) {
      const valid = new Set(Object.keys(DEFAULT_TGM4_LAYOUT.buttons));
      const nb = { ...layoutButtons };
      for (const [k, v] of Object.entries(snap.buttons))
        if (valid.has(k)) (nb as Record<string, [number, number]>)[k] = [v[0], v[1]];
      layoutButtons = nb;
    }
    runDetection();
  }

  /**
   * Apply a preset. If boardRect is currently defined AND the preset has a board rect,
   * rescale all other rects from the preset's board space into the current board space.
   * Thresholds and layout are always applied as-is.
   */
  function applyPreset(preset: Partial<ConfigSnapshot>) {
    if (boardRect && preset.board) {
      const sb = preset.board;  // saved board (reference space)
      const cb = boardRect;     // current board (target space)
      let sx = cb.w / sb.w;
      let sy = cb.h / sb.h;
      // Snap to 1.0 when close — avoids amplifying small board-drawing imprecision
      // for distant rects (e.g. level rect ~5-6x farther from board than next)
      if (Math.abs(sx - 1) < 0.05) sx = 1;
      if (Math.abs(sy - 1) < 0.05) sy = 1;
      if (sx === 1 && sy === 1) {
        // Same resolution — translate board-adjacent rects (next, hold) by board offset,
        // keep independent UI rects (level, input) at absolute preset coordinates
        const dx = cb.x - sb.x;
        const dy = cb.y - sb.y;
        const translate = (r: Rect | null): Rect | null => r ? {
          x: r.x + dx, y: r.y + dy, w: r.w, h: r.h,
        } : null;
        applySnapshot({
          ...preset,
          board: cb,
          hold:  translate(preset.hold  ?? null),
          next:  preset.next?.map(translate),
        });
      } else {
        // Different resolution — full proportional rescale
        const rescale = (r: Rect | null): Rect | null => r ? {
          x: Math.round(cb.x + (r.x - sb.x) * sx),
          y: Math.round(cb.y + (r.y - sb.y) * sy),
          w: Math.round(r.w * sx),
          h: Math.round(r.h * sy),
        } : null;
        applySnapshot({
          ...preset,
          board: cb,
          input: rescale(preset.input ?? null),
          hold:  rescale(preset.hold  ?? null),
          level: rescale(preset.level ?? null),
          next:  preset.next?.map(rescale),
        });
      }
    } else {
      applySnapshot(preset);
    }
  }

  function savePreset() {
    const name = newPresetName.trim();
    if (!name) return;
    const entry = { ...getConfigSnapshot(), name };
    presets = [...presets.filter(p => p.name !== name), entry];
    localStorage.setItem(PRESET_KEY, JSON.stringify(presets));
    newPresetName = '';
  }

  function deletePreset(name: string) {
    presets = presets.filter(p => p.name !== name);
    localStorage.setItem(PRESET_KEY, JSON.stringify(presets));
  }

  async function copyFullConfig() {
    await navigator.clipboard.writeText(JSON.stringify(getConfigSnapshot(), null, 2));
    copyConfigStatus = 'Copied!';
    setTimeout(() => (copyConfigStatus = ''), 2000);
  }

  function applyPastedConfig(toBoard = false) {
    pasteConfigError = '';
    try {
      const obj = JSON.parse(pasteConfigText) as ConfigSnapshot;
      if (toBoard) applyPreset(obj); else applySnapshot(obj);
      pasteConfigText = '';
    } catch (e) {
      pasteConfigError = 'Invalid JSON: ' + String(e);
    }
  }

  // ── Layout selection (step 2) ─────────────────────────────────────────────────
  function selectLayout(name: string | 'none') {
    selectedLayout = name;
    if (name !== 'none') {
      const preset = allPresets.find(p => p.name === name);
      if (preset) applyPreset(preset);
    }
    dragMode = 'board';
  }

  onDestroy(stopCapture);
</script>

<svelte:window on:mousemove={onWindowMousemove} on:mouseup={onWindowMouseup} />
<video bind:this={videoEl} on:loadedmetadata={onVideoLoaded} muted playsinline style="display:none"></video>

<div class="capture-panel">
  <div class="panel-header">
    <span class="panel-title">Capture Board from Screen</span>
    {#if stream}
      <button class="change-win-btn" on:click={changeCapture} title="Select a different window to capture">⛶ Change window</button>
    {/if}
    <button class="close-btn" on:click={() => showCapture.set(false)}>✕ Close</button>
  </div>

  <!-- Preview canvas (always visible) -->
  <div class="preview-row">
    <div class="canvas-wrap">
      <canvas bind:this={previewCanvas} class="preview-canvas" on:mousedown={onCanvasMousedown}></canvas>
      {#if !stream}
        <div class="playfield-overlay">
          <button class="playfield-overlay-box playfield-cta" on:click={startCapture}>
            <svg width="36" height="36" viewBox="0 0 36 36" fill="none" stroke="currentColor" stroke-width="1.8">
              <rect x="2" y="4" width="32" height="22" rx="2"/>
              <line x1="12" y1="26" x2="12" y2="32"/>
              <line x1="24" y1="26" x2="24" y2="32"/>
              <line x1="8"  y1="32" x2="28" y2="32"/>
            </svg>
            <span>Select a window to capture</span>
          </button>
        </div>
        {#if streamError}<div class="stream-error">{streamError}</div>{/if}
      {:else if !boardRect}
        <div class="playfield-overlay">
          <div class="playfield-overlay-box">
            <svg width="40" height="40" viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="4 3">
              <rect x="4" y="4" width="32" height="32" rx="2"/>
            </svg>
            <span>Drag to select the playfield</span>
          </div>
        </div>
      {/if}
    </div>
      <div class="mini-board-wrap">
        <span class="mini-label">Detection</span>
        {#if manualSelectMode}
          <span class="mini-label manual-pick-hint">Click cells to mark as active piece ({manualActiveCells?.size ?? 0}/4)</span>
        {/if}
        <canvas bind:this={miniCanvas} class="mini-canvas"
          width={gridCols * MINI_CW} height={gridRows * MINI_CH}
          on:click={onMiniBoardClick}
          style:cursor={manualSelectMode ? 'crosshair' : 'default'}></canvas>
        {#if manualSelectMode}
          <div class="manual-pick-btns">
            <button class="btn btn-sm btn-primary" disabled={!manualActiveCells || manualActiveCells.size === 0}
              on:click={applyManualOverride}>Set</button>
            <button class="btn btn-sm" on:click={cancelManualSelect}>Cancel</button>
          </div>
        {/if}
        {#if inputRect}
          <span class="mini-label" style="margin-top:6px">Inputs</span>
          <div class="input-preview">
            <InputDisplay inputs={detectedInputs} />
          </div>
        {/if}
        <span class="mini-label" style="margin-top:6px">Zoom</span>
        <canvas bind:this={loupeCanvas} class="loupe-side"
          width={LOUPE_DST_W} height={LOUPE_DST_H}></canvas>
        {#if detectedCells}
          <div class="dim-row">
            <span class="mini-label">Overlay</span>
            <input class="dim-slider" type="range" min="0" max="100" bind:value={dimPct} />
            <span class="dim-val">{dimPct}%</span>
          </div>
        {/if}
      </div>
    </div>

    <!-- Predefined layout row -->
    <div class="layout-row" class:section-disabled={!stream}>
      <span class="layout-row-label">Predefined layout</span>
      <div class="layout-grid">
        <button class="layout-btn layout-btn-none" class:active={selectedLayout === 'none'}
          on:click={() => selectLayout('none')}>None</button>
        {#each BUILTIN_PRESETS as p}
          <button class="layout-btn" class:active={selectedLayout === p.name}
            on:click={() => selectLayout(p.name)}>{p.name}</button>
        {/each}
        {#each presets as p}
          <button class="layout-btn layout-btn-saved" class:active={selectedLayout === p.name}
            on:click={() => selectLayout(p.name)} title="User preset">{p.name}</button>
        {/each}
      </div>
    </div>

    {#if stream}
      <!-- Instruction row -->
      {#if !boardRect}
        <div class="playfield-step">
          <span class="playfield-inst">
            {#if selectedLayout === 'none'}
              Drag a rectangle over the Tetris board. Then drag Hold, Next, and Input regions as needed.
            {:else}
              Drag a rectangle over the Tetris board — hold/next/input windows will auto-fill from the preset.
            {/if}
          </span>
        </div>
      {:else}
        <div class="inst-row">
          {#if dragMode === 'hold'}
            <span class="inst-text" style="color:var(--clr-yellow)">Drag over the Hold piece display</span>
          {:else if dragMode === 'input'}
            <span class="inst-text" style="color:var(--clr-magenta)">Drag over the TGM4 input display widget</span>
          {:else if dragMode === 'level'}
            <span class="inst-text" style="color:#ff8c28">Drag over the Level number display</span>
          {:else if dragMode !== 'board'}
            <span class="inst-text" style="color:var(--clr-cyan)">Drag over the Next {parseInt(dragMode.slice(4)) + 1} piece preview</span>
          {:else}
            <span class="inst-text"></span>
          {/if}
        </div>
      {/if}

      <!-- Drag-mode selector (mode row) -->
      <div class="mode-row">
        <span class="ctrl-label">Detection regions:</span>
        <div class="toggle-group">
          <button class="toggle-btn" class:active={dragMode === 'board'}
            on:click={() => dragMode = 'board'} title="Next drag = board region">Board</button>
          <button class="toggle-btn toggle-input" class:active={dragMode === 'input'}
            on:click={() => dragMode = 'input'} title="Next drag = TGM4 input widget">Inputs</button>
          <button class="toggle-btn toggle-level" class:active={dragMode === 'level'}
            on:click={() => dragMode = 'level'} title="Next drag = Level display region (for auto-record trigger)">Level</button>
        </div>
        <!-- Piece capture slots: Hold + Next 1–6 -->
        <div class="piece-slots">
          <button class="piece-slot-btn piece-slot-hold" class:active={dragMode === 'hold'}
            on:click={() => dragMode = 'hold'} title="Next drag = Hold piece region">
            {#if holdRect !== null}
              <span class="slot-dot" style="background:{detectedHold !== null ? CELL_FILL[PIECE_META[detectedHold].cellType] ?? '#888' : 'var(--slot-empty)'}"></span>
            {/if}
            H
          </button>
          {#each [0,1,2,3,4,5] as ni}
            <button class="piece-slot-btn" class:active={(dragMode as string) === `next${ni}`}
              on:click={() => (dragMode = ('next' + ni) as DragMode)} title="Next drag = Next {ni+1} piece region">
              {#if nextRects[ni] !== null}
                <span class="slot-dot" style="background:{detectedNext[ni] !== null ? CELL_FILL[PIECE_META[detectedNext[ni]!].cellType] ?? '#888' : 'var(--slot-empty)'}"></span>
              {/if}
              {ni+1}
            </button>
          {/each}
          {#if holdRect !== null || nextRects.some(r => r !== null)}
            <button class="clear-btn" on:click={() => {
              holdRect = null; nextRects = [null, null, null, null, null, null];
              detectedHold = null; detectedNext = [null, null, null, null, null, null];
            }} title="Clear all piece capture regions">Clear pieces capture regions</button>
          {/if}
        </div>
        {#if inputRect}
          <button class="clear-btn" on:click={() => { inputRect = null; detectedInputs = {}; }}>✕ inputs</button>
        {/if}
        {#if levelRect}
          <button class="clear-btn" on:click={() => { levelRect = null; lastLevelBinary = null; levelChanged = false; currentLevelBinary = null; }}>✕ level</button>
          {#if levelChanged}<span class="level-changed-badge">Lv changed</span>{/if}
          <span class="level-preview-group">
            <span class="level-preview-label">now</span>
            <canvas bind:this={levelCurrentCanvas} class="level-preview-canvas"></canvas>
            <span class="level-preview-label">baseline</span>
            <canvas bind:this={levelBaselineCanvas} class="level-preview-canvas"></canvas>
            <button class="clear-btn" on:click={() => { lastLevelBinary = currentLevelBinary ? currentLevelBinary.slice() : null; levelChanged = false; drawBinaryToCanvas(levelBaselineCanvas, lastLevelBinary, levelBinaryW, levelBinaryH); }}
              title="Set current frame as the new baseline">↺</button>
          </span>
        {/if}
      </div>

      <!-- Step 4: Palette -->
      <div class="palette-step-row">
        <span class="ctrl-label">Palette</span>
        <div class="toggle-group">
          <button class="toggle-btn" class:active={palette === 'ars'}
            on:click={() => { palette = 'ars'; onPaletteChange(); runDetection(); }}
            title="Classic/TGM: I=red, T=cyan, S=purple, Z=green">ARS</button>
          <button class="toggle-btn" class:active={palette === 'srs'}
            on:click={() => { palette = 'srs'; onPaletteChange(); runDetection(); }}
            title="Guideline: I=cyan, T=purple, S=green, Z=red">SRS</button>
        </div>
        <label class="live-label" style="margin-left:12px" title="Import all stack cells as garbage (grey) regardless of detected colour">
          <input type="checkbox" bind:checked={stackAsGarbage} />
          <span>Stack as garbage</span>
        </label>
      </div>

      <!-- Step 5: Detection controls -->
      <div class="controls-row">
        <!-- Live detect -->
        {#if boardRect}
          <label class="live-label">
            <input type="checkbox" bind:checked={liveDetect}
              on:change={() => { if (liveDetect) runDetection(); }} />
            <span class:live-on={liveDetect}>Live detection</span>
            <input class="num-in" type="number" min="16" max="1000" step="10" bind:value={liveDetectIntervalMs} style="width:48px" title="Detection interval in ms" />
            <span class="ctrl-label">ms</span>
          </label>
          <label class="live-label">
            <input type="checkbox" bind:checked={detectActivePiece}
              on:change={() => { lastLockedBoard = null; manualActiveCells = null; manualSelectMode = false; runDetection(); }} />
            <span>Active piece</span>
            <span class="tip-icon" data-tip="Detect the active (falling) piece by comparing against a locked board baseline. New cells that form a valid piece shape are identified as the active piece.">?</span>
            {#if detectActivePiece && detectedActivePiece}
              <span style="color:var(--clr-green);font-size:11px">✓</span>
            {:else if detectActivePiece && detectedCells && !detectedActivePiece && !manualSelectMode}
              <span style="color:var(--clr-yellow);font-size:11px"
                title="Found {diffCandidateCount} new cells (need exactly 4). Try resetting baseline or pick cells manually."
              >{diffCandidateCount} new</span>
            {/if}
          </label>
          {#if detectActivePiece && detectedCells && !manualSelectMode}
            <button class="btn btn-sm" on:click={enterManualSelect}
              title="Manually click cells on the mini-board to define the active piece">Pick cells</button>
            <button class="btn btn-sm" on:click={setNoActivePiece}
              title="Mark the current board as having no active piece (resets baseline)">No active piece</button>
          {/if}
        {/if}

        <!-- Auto-record -->
        {#if boardRect}
          <button class="btn-record" class:btn-record-active={autoRecord} disabled={!liveDetect}
            on:click={() => { autoRecord = !autoRecord; if (autoRecord) enableAutoRecord(); else { lastAutoBoard = null; } }}
            title="Appends a new diagram frame whenever the board changes by at least Δ cells. The whole session is undoable with one Ctrl+Z.">
            {#if autoRecord}⏹ Stop recording{:else}<span style="color:var(--clr-red)">⏺</span> Start recording{/if}
          </button>
          <div class="ctrl-group" class:group-disabled={!liveDetect}>
            <div class="toggle-group">
              <button class="toggle-btn" class:active={autoRecordMode === 'diff'}
                on:click={() => autoRecordMode = 'diff'}>Cell diff</button>
              <button class="toggle-btn toggle-level" class:active={autoRecordMode === 'level'}
                disabled={!levelRect}
                on:click={() => autoRecordMode = 'level'}
                title={!levelRect ? 'Draw a Level region first' : 'Trigger new frame when level display changes'}>Level change</button>
            </div>
          </div>
          {#if autoRecordMode === 'diff'}
            <div class="ctrl-group" class:group-disabled={!liveDetect}>
              <span class="ctrl-label">Add new frame when</span>
              <input class="num-in" type="number" min="1" max="40" bind:value={autoRecordThreshold} style="width:36px" />
              <span class="ctrl-label">cells are modified</span>
              <span class="tip-icon" data-tip="Minimum number of changed cells between two detections to trigger a new frame. Lower = more sensitive; raise it to ignore minor noise.">?</span>
            </div>
          {:else}
            <div class="ctrl-group" class:group-disabled={!liveDetect}>
              <span class="ctrl-label">Brightness</span>
              <input class="num-in" type="number" min="0" max="255" bind:value={levelBrightnessThreshold} style="width:44px" />
              <span class="ctrl-label">Diff %</span>
              <input class="num-in" type="number" min="1" max="50" bind:value={levelDiffPct} style="width:36px" />
              <span class="tip-icon" data-tip="Brightness threshold for binarizing the level region. Diff % = minimum percentage of pixels that must change to trigger a new frame.">?</span>
            </div>
            <div class="ctrl-group" class:group-disabled={!liveDetect}>
              <span class="ctrl-label">Lookback</span>
              <input class="num-in" type="number" min="0" max="1000" step="50"
                bind:value={levelLookbackMs} style="width:48px" />
              <span class="ctrl-unit">ms</span>
              <span class="tip-icon" data-tip="When the level changes, use the board state from this many ms ago instead of the current one. Helps avoid capturing the next piece that already spawned.">?</span>
            </div>
          {/if}
        {/if}

        <!-- Action buttons -->
        <div class="action-btns">
          {#if boardRect}
            {#if !liveDetect}
              <button class="btn btn-sm" on:click={runDetection}>Re-detect</button>
            {/if}
            <button class="btn btn-import" disabled={!detectedCells} on:click={doImport}>
              {importStatus === 'Overwritten!' ? 'Overwritten!' : 'Overwrite Frame'}
            </button>
            <button class="btn btn-new-frame" disabled={!detectedCells} on:click={doImportAsNewFrame}>
              {importStatus === 'Frame added!' ? 'Frame added!' : '+ New Frame'}
            </button>
          {/if}
          <button class="btn btn-sm btn-undo" disabled={!$canUndo} on:click={undo}
            title="Undo entire capture session (same as Ctrl+Z)">↩ Undo session</button>
          <button class="btn btn-sm btn-stop" on:click={stopCapture}>Stop</button>
        </div>
      </div>

      <!-- ── Fine-tune detection ─────────────────────────────────────────────── -->
      <details class="thresh-section">
        <summary class="thresh-title">Fine-tune detection</summary>

        <!-- Grid + brightness/saturation thresholds -->
        <div class="finetune-row">
          <span class="ctrl-label">Grid</span>
          <label>Cols <input class="num-in" type="number" min="4" max="16" bind:value={gridCols} on:change={runDetection} /></label>
          <label>Rows <input class="num-in" type="number" min="4" max="40" bind:value={gridRows} on:change={runDetection} /></label>
          <span class="ctrl-label" style="margin-left:8px" title="Pixels below this brightness → Empty">Dark&lt;</span>
          <input class="num-in" type="number" min="0" max="80" step="5" bind:value={emptyVPct} on:input={runDetection} />%
          <span class="ctrl-label" style="margin-left:4px" title="Pixels below this saturation → Garbage">Gray&lt;</span>
          <input class="num-in" type="number" min="0" max="80" step="5" bind:value={garbageSPct} on:input={runDetection} />%
        </div>

        {#if detectActivePiece}
        <div class="finetune-row">
          <span class="ctrl-label">Active piece</span>
          <label title="Min new cells to attempt piece matching">Min cells
            <input class="num-in" type="number" min="1" max="8" step="1" bind:value={diffMinCells} on:input={runDetection} /></label>
          <label title="Max new cells to attempt piece matching">Max cells
            <input class="num-in" type="number" min="4" max="12" step="1" bind:value={diffMaxCells} on:input={runDetection} /></label>
          <button class="btn btn-sm" on:click={() => { lastLockedBoard = detectedCells?.map(r => [...r]) ?? null; manualActiveCells = null; manualSelectMode = false; runDetection(); }}
            title="Snapshot current board as the locked baseline (use when no active piece is visible)">Reset baseline</button>
        </div>
        {/if}

        <!-- Piece hue thresholds -->
        <details class="thresh-section thresh-nested">
        <summary class="thresh-title">
          Piece Hues
          <button class="reset-btn" on:click|stopPropagation={resetHues} title="Reset all hues to palette defaults">↺ Reset</button>
        </summary>
        <div class="hue-grid">
          {#each PIECE_META as { cellType, name }}
            {@const hue = currentHues[cellType] ?? 0}
            {@const swatchColor = CELL_FILL[cellType] ?? '#888'}
            <div class="hue-row">
              <span class="piece-swatch" style="background:{swatchColor};color:{(() => { const [r,g,b] = hexToRgb(swatchColor); return (r*299+g*587+b*114)/1000 > 128 ? '#111' : '#fff'; })()}">{name}</span>
              <input
                class="hue-slider" type="range" min="0" max="359"
                value={hue}
                on:input={(e) => setHue(cellType, Number((e.target as HTMLInputElement).value))}
              />
              <input
                class="num-in hue-num" type="number" min="0" max="359"
                value={hue}
                on:change={(e) => setHue(cellType, ((Number((e.target as HTMLInputElement).value) % 360) + 360) % 360)}
              />
              <span class="hue-swatch" style="background:hsl({hue},80%,50%)"></span>
              <button
                class="mask-toggle" class:mask-on={activeMasks.has(cellType)}
                style={activeMasks.has(cellType) ? `border-color:${color};color:${color}` : ''}
                on:click={() => toggleMask(cellType)}
                title="Show pixel mask for {name}"
              >M</button>
            </div>
          {/each}
          <div class="hue-row">
            <span class="thresh-sub-label">Tolerance</span>
            <input class="hue-slider pct-slider" type="range" min="10" max="180"
              bind:value={hueTolerance} on:input={runDetection} />
            <input class="num-in hue-num" type="number" min="10" max="180"
              bind:value={hueTolerance} on:change={runDetection} />
            <span class="deg-unit">°</span>
          </div>
        </div>
      </details>

      <!-- ── Input detection thresholds ───────────────────────────────────────── -->
      {#if inputRect}
        <details class="thresh-section thresh-nested" open>
          <summary class="thresh-title">
            Input Detection (pressed colour)
            <button
              class="mask-toggle" class:mask-on={activeMasks.has('pressed')}
              on:click|stopPropagation={() => toggleMask('pressed')}
              title="Show pressed-colour pixel mask"
            >M</button>
          </summary>
          <p class="detect-hint">
            White dots on the preview mark each button's sampling centre. The detector averages
            the pixels in a small patch around each dot and checks whether the result falls
            within the <strong>Hue</strong> range with sufficient <strong>S</strong> (saturation) and
            <strong>V</strong> (brightness) — if so, the button is detected as pressed.<br>
            To calibrate: press a button in-game, then toggle <strong>M</strong> to see which
            pixels match — the highlighted region should cover the dot for that button.
            Widen the Hue range or lower S/V if buttons are missed; narrow it if false
            positives appear.
          </p>
          <div class="input-thresh-grid">
            <span class="thresh-sub-label">Radius</span>
            <div class="hue-range-row">
              <input class="hue-slider short-slider" type="range" min="2" max="25"
                bind:value={sampleRadiusPct} on:input={runDetection} />
              <span class="num-in-static">{sampleRadiusPct}%</span>
              <button class="reset-btn" on:click={resetLayout} title="Reset all dot positions, offsets and radius to defaults">↺ Layout</button>
            </div>

            <span class="thresh-sub-label">Action X</span>
            <div class="hue-range-row">
              <input class="offset-slider short-slider" type="range" min="-50" max="50" step="1"
                bind:value={actionOffsetXPct} on:input={runDetection} />
              <span class="num-in-static">{actionOffsetXPct > 0 ? '+' : ''}{actionOffsetXPct}%</span>
            </div>

            <span class="thresh-sub-label">Action Y</span>
            <div class="hue-range-row">
              <input class="offset-slider short-slider" type="range" min="-50" max="50" step="1"
                bind:value={actionOffsetYPct} on:input={runDetection} />
              <span class="num-in-static">{actionOffsetYPct > 0 ? '+' : ''}{actionOffsetYPct}%</span>
            </div>

            <span class="thresh-sub-label">Hue</span>
            <div class="hue-range-row">
              <input class="hue-slider short-slider" type="range" min="0" max="359"
                bind:value={pressedHMin} on:input={runDetection} />
              <span class="num-in-static">{pressedHMin}°</span>
              <span class="thresh-sub-label">–</span>
              <input class="hue-slider short-slider" type="range" min="0" max="359"
                bind:value={pressedHMax} on:input={runDetection} />
              <span class="num-in-static">{pressedHMax}°</span>
              <span class="hue-swatch" style="background:linear-gradient(to right,hsl({pressedHMin},80%,50%),hsl({pressedHMax},80%,50%))"></span>
            </div>

            <span class="thresh-sub-label">S min</span>
            <div class="hue-range-row">
              <input class="hue-slider short-slider" type="range" min="0" max="100"
                bind:value={pressedSPct} on:input={runDetection} />
              <span class="num-in-static">{pressedSPct}%</span>
            </div>

            <span class="thresh-sub-label">V min</span>
            <div class="hue-range-row">
              <input class="hue-slider short-slider" type="range" min="0" max="100"
                bind:value={pressedVPct} on:input={runDetection} />
              <span class="num-in-static">{pressedVPct}%</span>
            </div>
          </div>
        </details>
      {/if}

      <!-- ── Config / Presets ─────────────────────────────────────────────────── -->
      <details class="thresh-section thresh-nested">
        <summary class="thresh-title">
          Config / Presets
          <button class="reset-btn" on:click|stopPropagation={copyFullConfig}>
            {copyConfigStatus || 'Copy JSON'}
          </button>
        </summary>

        <!-- Current configuration -->
        <span class="ctrl-label" style="margin-bottom:2px">Current configuration</span>
        <pre class="config-pre">{configJson}</pre>

        <div class="preset-controls">
          <!-- Built-in presets -->
          <div class="preset-list">
            <div class="config-hint" style="margin-bottom:2px">Built-in</div>
            {#each BUILTIN_PRESETS as p}
              <div class="preset-row-item">
                <span class="preset-item-name">{p.name}</span>
                <button class="btn btn-sm" on:click={() => applyPreset(p)}
                  title={boardRect && p.board ? 'Scale to current board size and position' : 'Apply at saved absolute coordinates'}>
                  Apply
                </button>
              </div>
            {/each}
          </div>

          <!-- Saved presets -->
          <div class="preset-list">
            <div class="config-hint" style="margin-bottom:2px">Saved</div>
            {#each presets as p}
              <div class="preset-row-item">
                <span class="preset-item-name" title={p.name}>{p.name}</span>
                <button class="btn btn-sm" on:click={() => applyPreset(p)}
                  title={boardRect && p.board ? 'Scale hold/next/input to current board size and position' : 'Apply at saved absolute coordinates'}>
                  Apply
                </button>
                <button class="btn btn-sm btn-stop" on:click={() => deletePreset(p.name)}>✕</button>
              </div>
            {:else}
              <div class="config-hint" style="font-style:italic;margin-left:4px">None yet</div>
            {/each}
          </div>

          <!-- Save current config as preset -->
          <div class="preset-save-row">
            <input class="preset-name-in" bind:value={newPresetName} placeholder="Preset name…" />
            <button class="btn btn-sm" on:click={savePreset} disabled={!newPresetName.trim()}>Save preset</button>
          </div>

          <!-- Paste JSON to apply -->
          <textarea class="capture-textarea" rows="2" bind:value={pasteConfigText}
            placeholder="Paste config JSON to apply…"></textarea>
          {#if pasteConfigError}
            <div class="capture-error">{pasteConfigError}</div>
          {/if}
          <div class="paste-apply-row">
            <button class="btn btn-sm" on:click={() => applyPastedConfig(false)}
              disabled={!pasteConfigText.trim()}>Apply JSON</button>
            <button class="btn btn-sm" on:click={() => applyPastedConfig(true)}
              disabled={!pasteConfigText.trim() || !boardRect}
              title="Scale hold/next/input to current board size and position">
              Apply
            </button>
          </div>
        </div>
      </details>

      </details><!-- /Fine-tune detection -->

    {/if}<!-- /stream -->
</div>

<style>
  .capture-panel {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 2px;
  }

  .panel-title { font-size: 16px; font-weight: 700; color: var(--txt-head); }

 

  .inst-row { min-height: 18px; }
  .inst-text { font-size: 12px; color: var(--txt-2); }

  /* ── Preview row ── */
  .preview-row {
    display: flex;
    gap: 10px;
    align-items: flex-start;
  }

  .canvas-wrap {
    flex: 1 1 auto;
    min-width: 0;
    position: relative;
  }

  .preview-canvas {
    display: block;
    width: 100%;
    border: 1px solid var(--brd-2);
    border-radius: var(--r);
    cursor: crosshair;
    user-select: none;
  }

  .playfield-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
    border-radius: var(--r);
    background: rgba(0, 0, 0, 0.35);
  }

  .playfield-overlay-box {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    padding: 18px 28px;
    background: rgba(8, 8, 8, 0.80);
    border: 2px dashed rgba(120, 120, 130, 0.45);
    border-radius: var(--r-lg);
    color: rgba(160, 160, 170, 0.85);
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0.04em;
  }

  .playfield-cta {
    pointer-events: auto;
    cursor: pointer;
    transition: border-color 0.15s, background 0.15s;
  }
  .playfield-cta:hover {
    border-color: rgba(140, 140, 150, 0.75);
    background: rgba(20, 20, 20, 0.90);
  }

  .stream-error {
    position: absolute;
    bottom: 8px;
    left: 50%;
    transform: translateX(-50%);
    pointer-events: none;
    background: rgba(60, 10, 10, 0.90);
    border: 1px solid var(--err-brd);
    border-radius: var(--r);
    color: var(--err-txt);
    font-size: 11px;
    padding: 4px 10px;
    white-space: nowrap;
  }

  .mini-board-wrap {
    flex: 0 0 160px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
  }

  .mini-label {
    font-size: 10px;
    color: var(--txt-dim);
    font-weight: 700;
    letter-spacing: 0.05em;
  }
  .manual-pick-hint {
    color: var(--clr-cyan);
    font-weight: 600;
    font-size: 11px;
    letter-spacing: 0;
  }
  .manual-pick-btns {
    display: flex;
    gap: 4px;
    margin-top: 2px;
  }

  .mini-canvas {
    display: block;
    border: 1px solid var(--bg-3);
    border-radius: 2px;
    image-rendering: pixelated;
  }

  .loupe-side {
    display: block;
    border: 1px solid var(--bg-3);
    border-radius: 2px;
    image-rendering: pixelated;
    width: 160px;
    height: 120px;
  }

  /* ── Mode row ── */
  .mode-row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    padding: 4px 0;
    border-top: 1px solid var(--bg-1);
  }

  .toggle-input.active { background: var(--magenta-bg); border-color: var(--magenta-brd); color: var(--clr-magenta); }
  .toggle-level.active { background: rgba(255,140,40,0.12); border-color: #ff8c28; color: #ff8c28; }
  .level-changed-badge {
    font-size: 10px; font-weight: 700; color: #ff8c28;
    background: rgba(255,140,40,0.15); border: 1px solid rgba(255,140,40,0.4);
    border-radius: var(--r-sm); padding: 1px 6px;
  }
  .level-preview-group {
    display: inline-flex; align-items: center; gap: 4px; margin-left: 4px;
  }
  .level-preview-label {
    font-size: 9px; font-weight: 700; color: var(--txt-dim); letter-spacing: 0.03em;
  }
  .level-preview-canvas {
    display: block;
    height: 18px;
    border: 1px solid var(--brd-2);
    border-radius: 2px;
    image-rendering: pixelated;
  }

  /* ── Piece capture slots ── */
  .piece-slots {
    display: flex;
    align-items: center;
    gap: 3px;
    flex-wrap: wrap;
  }

  .piece-slot-btn {
    background: var(--bg-input);
    border: 1px solid var(--brd-1);
    border-radius: var(--r-sm);
    color: var(--txt-dim);
    cursor: pointer;
    font-size: 11px;
    font-weight: 700;
    padding: 2px 5px;
    min-width: 22px;
    text-align: center;
    display: inline-flex;
    align-items: center;
    gap: 3px;
    transition: background 0.1s;
  }
  .piece-slot-btn:hover { background: var(--bg-1); color: var(--txt-mid); }
  .piece-slot-btn.active { background: var(--rec-bg); border-color: var(--clr-cyan); color: var(--clr-cyan); }
  .piece-slot-hold.active { background: var(--hold-active-bg); border-color: var(--clr-yellow); color: var(--clr-yellow); }

  .slot-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex: 0 0 7px;
    display: inline-block;
  }

  .clear-btn {
    background: var(--bg-1); border: 1px solid var(--brd-2); border-radius: var(--r-sm);
    color: var(--txt-2); cursor: pointer; font-size: 11px; padding: 2px 7px;
  }
  .clear-btn:hover { background: var(--bg-2); }

  .input-preview {
    display: flex;
    align-items: center;
    padding: 2px 6px;
    background: var(--bg-deep);
    border: 1px solid var(--brd-1);
    border-radius: var(--r);
  }

  /* ── Controls row ── */
  .controls-row {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
    padding: 4px 0;
    border-top: 1px solid var(--bg-1);
  }

  .ctrl-group { display: flex; align-items: center; gap: 5px; }

  .ctrl-label {
    font-size: 11px; font-weight: 700;
    color: var(--txt-dim); letter-spacing: 0.05em; white-space: nowrap;
  }


  .num-in {
    width: 44px; background: var(--bg-input); border: 1px solid var(--brd-1);
    border-radius: var(--r-sm); color: var(--txt-0); font-size: 12px;
    padding: 2px 4px; text-align: center; outline: none;
  }
  .num-in:focus { border-color: var(--txt-dim); }

  .toggle-group { display: flex; }
  .toggle-btn {
    background: var(--bg-input); border: 1px solid var(--brd-1); color: var(--txt-dim);
    cursor: pointer; font-size: 11px; font-weight: 700; padding: 2px 8px;
    transition: background 0.1s;
  }
  .toggle-btn:first-child { border-radius: var(--r-sm) 0 0 3px; }
  .toggle-btn:last-child  { border-radius: 0 3px 3px 0; border-left: none; }
  .toggle-btn:hover       { background: var(--bg-1); color: var(--txt-mid); }
  .toggle-btn.active      { background: var(--bg-3); border-color: var(--accent); color: var(--txt-0); }

  .dim-row { display: flex; align-items: center; gap: 5px; margin-top: 5px; width: 100%; }
  .dim-row .mini-label { margin-top: 0 !important; }
  .dim-slider { flex: 1; min-width: 0; accent-color: var(--accent); cursor: pointer; }
  .dim-val    { font-size: 11px; color: var(--txt-2); min-width: 28px; }

  .live-label {
    display: flex; align-items: center; gap: 4px;
    font-size: 11px; font-weight: 700; color: var(--txt-dim);
    cursor: pointer; user-select: none; letter-spacing: 0.05em;
  }
  .live-label input[type="checkbox"] { accent-color: var(--clr-green); cursor: pointer; }
  .live-on { color: var(--clr-green); }
  .group-disabled { opacity: 0.4; pointer-events: none; }

  .tip-icon {
    display: inline-flex; align-items: center; justify-content: center;
    width: 14px; height: 14px; border-radius: 50%;
    background: var(--bg-1); border: 1px solid var(--brd-2);
    color: var(--txt-dim); font-size: 9px; font-weight: 900;
    cursor: default; flex-shrink: 0; position: relative;
    transition: background 0.1s, color 0.1s;
  }
  .tip-icon:hover { background: var(--bg-3); color: var(--txt-mid); border-color: var(--brd-3); }
  .tip-icon::after {
    content: attr(data-tip);
    position: absolute;
    bottom: calc(100% + 7px);
    left: 50%;
    transform: translateX(-50%);
    background: var(--bg-input);
    border: 1px solid var(--brd-2);
    border-radius: var(--r);
    color: var(--txt-1);
    font-size: 11px; font-weight: 400; letter-spacing: 0;
    line-height: 1.55;
    padding: 6px 9px;
    width: 230px;
    white-space: normal;
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.15s;
    z-index: 200;
  }
  .tip-icon:hover::after { opacity: 1; }

  .action-btns { display: flex; gap: 6px; margin-left: auto; }

  .btn {
    background: var(--bg-2); border: 1px solid var(--brd-2); border-radius: var(--r);
    color: var(--txt-0); cursor: pointer; font-size: 13px; padding: 5px 12px;
    transition: background 0.1s;
  }
  .btn:hover:not(:disabled) { background: var(--bg-3); }
  .btn:disabled { opacity: 0.4; cursor: default; }
  .btn-sm { font-size: 11px; padding: 3px 8px; }
  .btn-primary { background: var(--accent); color: #fff; border-color: var(--accent); }
  .btn-primary:disabled { opacity: 0.4; }

  .btn-import { background: var(--indigo-bg); border-color: var(--indigo-brd); color: var(--indigo-text); }
  .btn-import:hover:not(:disabled) { background: var(--indigo-bg-hi); }
  .btn-new-frame { background: var(--teal-bg); border-color: var(--teal-brd); color: var(--teal-text); }
  .btn-new-frame:hover:not(:disabled) { background: var(--rec-bg-hi); }
  .btn-record {
    background: var(--rec-bg); border: 1px solid var(--rec-brd); border-radius: var(--r);
    color: var(--rec-text); cursor: pointer; font-size: 13px; font-weight: 700;
    padding: 6px 16px; transition: background 0.1s, border-color 0.1s;
  }
  .btn-record:hover:not(:disabled) { background: var(--rec-bg-hi); border-color: var(--rec-brd-hi); color: var(--rec-text-hi); }
  .btn-record:disabled { opacity: 0.4; cursor: default; }
  .btn-record-active {
    background: var(--err-bg); border-color: var(--danger-brd); color: var(--danger);
  }
  .btn-record-active:hover:not(:disabled) { background: var(--danger-bg-deep); border-color: var(--danger-brd-hi); }
  .btn-undo { color: var(--txt-1); border-color: var(--brd-2); }
  .btn-undo:hover:not(:disabled) { background: var(--bg-1); }
  .btn-stop { color: var(--stop-text); border-color: var(--stop-brd); }
  .btn-stop:hover { background: var(--danger-bg); }

  /* ── Threshold sections ── */
  .thresh-section {
    border: 1px solid var(--brd-1);
    border-radius: var(--r);
    padding: 0;
    overflow: hidden;
  }

  .thresh-section[open] { padding-bottom: 8px; }

  .thresh-title {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 11px;
    font-weight: 700;
    color: var(--txt-dim);
    letter-spacing: 0.06em;
    padding: 5px 8px;
    cursor: pointer;
    list-style: none;
    background: var(--bg-deep);
    user-select: none;
  }
  .thresh-title::-webkit-details-marker { display: none; }
  .thresh-title::before { content: '▶'; font-size: 9px; margin-right: 2px; transition: transform 0.15s; }
  details[open] > .thresh-title::before { transform: rotate(90deg); }

  .reset-btn {
    margin-left: auto;
    background: var(--bg-1); border: 1px solid var(--brd-2); border-radius: var(--r-sm);
    color: var(--txt-dim); cursor: pointer; font-size: 10px; padding: 1px 6px;
  }
  .reset-btn:hover { background: var(--bg-2); color: var(--txt-mid); }

  /* ── Piece hue grid ── */
  .hue-grid {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 6px 8px 0;
  }

  .hue-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .piece-swatch {
    width: 18px; height: 18px;
    border-radius: var(--r-sm);
    font-size: 10px; font-weight: 900;
    display: flex; align-items: center; justify-content: center;
    flex: 0 0 18px;
  }

  .thresh-sub-label {
    font-size: 10px; font-weight: 700; color: var(--txt-dim);
    min-width: 60px; flex: 0 0 60px;
    white-space: nowrap;
  }

  .hue-slider {
    flex: 1 1 auto;
    min-width: 80px;
    height: 14px;
    cursor: pointer;
    border-radius: 7px;
    outline: none;
    border: none;
    /* Hue rainbow gradient for the track */
    background: linear-gradient(to right,
      hsl(0,80%,45%), hsl(30,80%,45%), hsl(60,80%,45%), hsl(90,80%,45%),
      hsl(120,80%,45%), hsl(150,80%,45%), hsl(180,80%,45%), hsl(210,80%,45%),
      hsl(240,80%,45%), hsl(270,80%,45%), hsl(300,80%,45%), hsl(330,80%,45%), hsl(360,80%,45%)
    );
    -webkit-appearance: none;
    appearance: none;
  }
  .hue-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 14px; height: 14px;
    border-radius: 50%;
    background: white;
    border: 2px solid var(--brd-1);
    cursor: pointer;
  }

  .hue-num { width: 38px; flex: 0 0 38px; }

  /* Override rainbow background for non-hue sliders (e.g. tolerance in degrees) */
  .hue-slider.pct-slider {
    background: linear-gradient(to right, var(--bg-2), var(--accent));
  }

  .hue-swatch {
    width: 18px; height: 18px;
    border-radius: var(--r-sm);
    flex: 0 0 18px;
    border: 1px solid var(--brd-1);
  }

  .deg-unit { font-size: 11px; color: var(--txt-dim); }

  .detect-hint {
    font-size: 11px;
    color: var(--txt-dim);
    line-height: 1.6;
    margin: 6px 8px 4px;
    padding: 6px 8px;
    background: var(--bg-base);
    border-left: 2px solid var(--bg-3);
    border-radius: 0 3px 3px 0;
  }
  .detect-hint strong { color: var(--txt-mid); font-weight: 700; }

  .mask-toggle {
    width: 18px; height: 18px;
    background: var(--bg-input);
    border: 1px solid var(--brd-1);
    border-radius: var(--r-sm);
    color: var(--brd-2);
    font-size: 10px; font-weight: 900;
    cursor: pointer;
    padding: 0;
    flex: 0 0 18px;
    transition: background 0.1s, color 0.1s, border-color 0.1s;
  }
  .mask-toggle:hover { background: var(--bg-1); color: var(--txt-2); }
  .mask-toggle.mask-on { background: var(--bg-base); }

  /* ── Input threshold grid ── */
  .input-thresh-grid {
    display: grid;
    grid-template-columns: auto 1fr;
    align-items: center;
    gap: 5px 8px;
    padding: 6px 8px 0;
  }

  .hue-range-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .short-slider { min-width: 60px; flex: 1 1 auto; }
  .offset-slider {
    flex: 1 1 auto; min-width: 60px;
    cursor: pointer; accent-color: var(--accent);
  }

  .num-in-static {
    font-size: 11px; color: var(--txt-1);
    min-width: 34px;
  }

  /* ── Config / Presets section ── */
  .config-pre {
    font-size: 10px; font-family: monospace; color: var(--txt-2);
    background: var(--bg-deep); border: 1px solid var(--bg-1); border-radius: var(--r-sm);
    padding: 6px 8px; margin: 4px 8px 0;
    max-height: 160px; overflow-y: auto; overflow-x: auto;
    white-space: pre; line-height: 1.5;
  }

  .preset-controls {
    display: flex; flex-direction: column; gap: 6px;
    padding: 6px 8px 0;
  }

  .config-hint { font-size: 11px; color: var(--txt-dim); font-style: italic; }

  .preset-list { display: flex; flex-direction: column; gap: 3px; }

  .preset-row-item {
    display: flex; align-items: center; gap: 4px;
  }

  .preset-item-name {
    flex: 1; font-size: 11px; color: var(--txt-mid); font-weight: 600;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0;
  }

  .paste-apply-row { display: flex; gap: 6px; flex-wrap: wrap; }

  .preset-save-row {
    display: flex; gap: 6px; align-items: center;
  }

  .preset-name-in {
    flex: 1; background: var(--bg-input); border: 1px solid var(--brd-1); border-radius: var(--r-sm);
    color: var(--txt-0); font-size: 11px; padding: 3px 6px; outline: none;
  }
  .preset-name-in:focus { border-color: var(--txt-dim); }
  .preset-name-in::placeholder { color: var(--brd-2); }

  /* ── Fine-tune detection nested sections ── */
  .thresh-nested {
    border: none;
    border-top: 1px solid var(--bg-deep);
    border-radius: 0;
    margin: 0 -8px;
  }
  .thresh-nested > .thresh-title { padding-left: 16px; }
  .thresh-nested[open] { padding-bottom: 0; }

  .finetune-row {
    display: flex; align-items: center; gap: 5px;
    padding: 6px 8px 4px;
    flex-wrap: wrap;
  }
  .finetune-row label {
    display: flex; align-items: center; gap: 3px;
    font-size: 12px; color: var(--txt-2);
  }

  /* ── Layout selector (step 2) ── */
  /* ── Predefined layout row ── */
  .layout-row {
    display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
    padding: 8px 0 4px; border-top: 1px solid var(--bg-1);
  }
  .section-disabled { opacity: 0.35; pointer-events: none; }
  .layout-row-label {
    font-size: 11px; font-weight: 700; color: var(--txt-dim); letter-spacing: 0.06em;
    white-space: nowrap;
  }

  .layout-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
  }

  .layout-btn {
    background: var(--bg-1); border: 1px solid var(--brd-2); border-radius: var(--r);
    color: var(--txt-mid); cursor: pointer; font-size: 12px; font-weight: 600;
    padding: 4px 12px; transition: background 0.1s;
  }
  .layout-btn:hover { background: var(--bg-2); border-color: var(--txt-dim); color: var(--txt-0); }
  .layout-btn.active { background: var(--bg-3); border-color: var(--accent); color: var(--txt-0); }
  .layout-btn-saved { border-color: var(--saved-brd); color: var(--saved-text); }
  .layout-btn-saved:hover { background: var(--saved-bg-hi); border-color: var(--saved-brd-hi); color: var(--saved-text-hi); }
  .layout-btn-saved.active { background: var(--saved-bg-act); border-color: var(--saved-brd-act); color: var(--saved-text-hi); }
  .layout-btn-none { border-color: var(--brd-1); color: var(--txt-dim); }
  .layout-btn-none:hover { background: var(--bg-1); border-color: var(--brd-3); color: var(--txt-mid); }
  .layout-btn-none.active { background: var(--bg-1); border-color: var(--brd-3); color: var(--txt-2); }

  /* ── Playfield instruction banner ── */
  .playfield-step {
    padding: 5px 8px; background: var(--bg-deep);
    border: 1px solid var(--brd-1); border-radius: var(--r);
  }
  .playfield-inst { font-size: 12px; color: var(--txt-2); line-height: 1.5; }

  /* ── Step 4 palette row ── */
  .palette-step-row {
    display: flex; align-items: center; gap: 8px;
    padding: 4px 0; border-top: 1px solid var(--bg-1);
  }

  /* ── Config textarea / error (local copies) ── */
  .capture-textarea {
    width: 100%; box-sizing: border-box;
    background: var(--bg-input); border: 1px solid var(--brd-1); border-radius: var(--r);
    color: var(--txt-0); font-size: 11px; font-family: monospace;
    padding: 5px 7px; outline: none; resize: vertical;
  }
  .capture-textarea::placeholder { color: var(--brd-2); }
  .capture-textarea:focus { border-color: var(--txt-dim); }
  .capture-error {
    background: var(--err-bg); border: 1px solid var(--err-brd); border-radius: var(--r);
    color: var(--err-txt); font-size: 11px; padding: 5px 7px;
  }

  /* ── Misc ── */
  .change-win-btn {
    background: var(--bg-1); border: 1px solid var(--purple-brd); border-radius: var(--r);
    color: var(--purple-mid); cursor: pointer; font-size: 12px; padding: 3px 10px;
    margin-left: auto;
  }
  .change-win-btn:hover { color: var(--txt-0); border-color: var(--purple-mid); }

  .close-btn {
    background: var(--bg-1); border: 1px solid var(--brd-2); border-radius: var(--r);
    color: var(--txt-2); cursor: pointer; font-size: 12px; padding: 3px 10px;
  }
  .close-btn:hover { background: var(--bg-2); }
</style>
