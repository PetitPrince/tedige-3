<script lang="ts">
  import { get } from 'svelte/store';
  import { diagram, currentFrameIndex, currentFrame, isRecordMode, pieceCollision, showBoundingBox, getFrameState } from '../editor/store';
  import { checkpoint } from '../editor/history';
  import { updateFrame, cloneFrame, advanceFrame } from '../engine/frame-ops';
  import { getRotationSystem } from '../rotation/index';
  import { recordMove, recordRotate, recordHardDrop } from '../editor/record-mode';
  import { holdPiece } from '../engine/play-ops';
  import { rotateActivePiece, shiftStack } from '../editor/actions';
  import { PieceType, PIECE_NAMES } from '../types/piece';
  import { keyMap, formatBinding } from '../editor/keybindings';
  import { boardWithPiece } from '../engine/board';
  import { detectFullRows, clearSpecificRows, freeFall } from '../engine/line-clear';
  import { CellType, BOARD_COLS, BOARD_ROWS, BOARD_TOTAL_ROWS, cloneBoard } from '../types/board';
  import { mirrorFrame } from '../engine/mirror';
  import { LC_DEFAULT_PRE_MS, LC_DEFAULT_SWIPE_MS, LC_DEFAULT_POST_MS } from '../types/frame';
  import type { InputState } from '../types/frame';
  import timings from '../rotation/timings.json';

  /**
   * Handles the change in record mode state.
   * @param {Event} e - The event triggered by the record mode checkbox.
   */
  function onRecordChange(e: Event) {
    const checked = (e.target as HTMLInputElement).checked;
    if (checked) checkpoint();
    isRecordMode.set(checked);
  }

  /**
   * Indicates whether inputs should be synchronized.
   * @type {boolean}
   */
  let syncInputs = false;

  /**
   * Determines if the next piece should be distributed.
   * @type {boolean}
   */
  let distributeNextPiece = true;

  /**
   * Translates the active piece by a specified number of columns and rows.
   * @param {number} deltaCol - The change in columns (delta column).
   * @param {number} deltaRow - The change in rows (delta row).
   */
  function translatePiece(deltaCol: number, deltaRow: number) {
    if (get(isRecordMode)) { recordMove(deltaCol, deltaRow); return; }
    const { d, idx, frame } = getFrameState();
    if (!frame.activePiece) return;
    const moved = { ...frame.activePiece, col: frame.activePiece.col + deltaCol, row: frame.activePiece.row + deltaRow };
    if ($pieceCollision) {
      if (getRotationSystem(d.rotationSystem).collides(moved, frame.board)) return;
    }
    const inputId = deltaCol === -1 ? 'left' : deltaCol === 1 ? 'right' : deltaRow === -1 ? 'down' : 'up';
    const inputs = syncInputs ? { [inputId]: 'pressed' as InputState } : frame.inputs;
    checkpoint();
    diagram.set(updateFrame(d, idx, { ...frame, activePiece: moved, inputs }));
  }

  /**
   * Rotates the active piece in a specified direction.
   * @param {string} dir - The direction of rotation ('cw' for clockwise, 'ccw' for counterclockwise).
   */
  function doRotate(dir: 'cw' | 'ccw') {
    if (get(isRecordMode)) { recordRotate(dir); return; }
    rotateActivePiece(dir);
    if (!syncInputs) return;
    const { d, idx } = getFrameState();
    diagram.set(updateFrame(d, idx, { ...d.frames[idx], inputs: { [dir]: 'pressed' as InputState } }));
  }

  /**
   * Clears the active piece from the board.
   */
  function clearActivePiece() {
    const { d, idx, frame } = getFrameState();
    checkpoint();
    diagram.set(updateFrame(d, idx, { ...frame, activePiece: undefined }));
  }

  /**
   * Locks the active piece onto the board.
   */
  function lockPiece() {
    const { d, idx, frame } = getFrameState();
    if (!frame.activePiece) return;
    const rotSys = getRotationSystem(d.rotationSystem);
    const shape = rotSys.getShape(frame.activePiece.type, frame.activePiece.rotation);
    checkpoint();

    // Flash frame: piece still visible, flagged for white-flash in player
    const flashFrame = { ...frame, lockFlash: true as const };

    // Settled frame: piece stamped onto board, no longer active
    const newBoard = boardWithPiece(frame.board, frame.activePiece, shape);
    let newActivePiece: typeof frame.activePiece | undefined = undefined;
    let newQueue = frame.nextQueue;
    if (distributeNextPiece && frame.nextQueue.length > 0) {
      const [nextType, ...remainingQueue] = frame.nextQueue;
      // rotSys.spawn() places pieces in the buffer zone (row 21), above the visible board.
      // Use its col, but pin the row to BOARD_ROWS-1 so the piece is visible.
      const bufferSpawn = rotSys.spawn(nextType, newBoard);
      const spawnCol = bufferSpawn?.col ?? 3;
      const visiblePiece = { type: nextType, rotation: 0 as const, col: spawnCol, row: BOARD_ROWS - 1 };
      newActivePiece = rotSys.collides(visiblePiece, newBoard) ? undefined : visiblePiece;
      newQueue = remainingQueue;
    }

    const settledFrame = {
      ...frame,
      board: newBoard,
      activePiece: newActivePiece,
      nextQueue: newQueue,
      lockFlash: undefined as undefined,
    };

    const newFrames = [...d.frames];
    newFrames[idx] = flashFrame;
    newFrames.splice(idx + 1, 0, settledFrame);
    diagram.set({ ...d, frames: newFrames });
    currentFrameIndex.set(idx + 1);
  }

  /**
   * Cycles the piece type forward.
   * @param {number} dir - The direction of cycling (1 for forward, -1 for backward).
   */
  function cyclePieceType(dir: 1 | -1 = 1) {
    const { d, idx, frame } = getFrameState();
    if (!frame.activePiece) return;
    const newType = ((frame.activePiece.type + dir + 7) % 7) as PieceType;
    checkpoint();
    diagram.set(updateFrame(d, idx, { ...frame, activePiece: { ...frame.activePiece, type: newType } }));
  }

  /**
   * Holds the active piece.
   */
  function doHold() {
    const { d, idx, frame } = getFrameState();
    if (!frame.activePiece) return;
    const rotSys = getRotationSystem(d.rotationSystem);
    const result = holdPiece(frame, rotSys);
    if (!result) return;
    checkpoint();
    diagram.set(updateFrame(d, idx, result));
  }

  /**
   * Sets the ghost piece.
   * @param {boolean} v - Whether to show the ghost piece.
   */
  function setGhost(v: boolean) {
    const { d, idx, frame } = getFrameState();
    diagram.set(updateFrame(d, idx, { ...frame, showGhost: v }));
  }

  // ── Timing level ─────────────────────────────────────────────────────────────

  type GameMode = 'TGM1' | 'TAP-N' | 'TAP-M' | 'TAP-D' | 'TGM3' | 'TGM3-S';
  type GameSeries = 'TGM1' | 'TAP' | 'TGM3';

  const GAME_SERIES: { id: GameSeries; label: string }[] = [
    { id: 'TGM1', label: 'TGM1' },
    { id: 'TAP',  label: 'TAP'  },
    { id: 'TGM3', label: 'TGM3' },
  ];

  const SERIES_MODES: Record<GameSeries, { id: GameMode; label: string }[]> = {
    TGM1: [{ id: 'TGM1',  label: 'TGM1'    }],
    TAP:  [
      { id: 'TAP-N', label: 'Normal' },
      { id: 'TAP-M', label: 'Master' },
      { id: 'TAP-D', label: 'Death'  },
    ],
    TGM3: [
      { id: 'TGM3',   label: 'Master'  },
      { id: 'TGM3-S', label: 'Shirase' },
    ],
  };


  const TGM1_GRAV  = timings.TGM1.gravity as any[];
  const TAPN_GRAV  = (timings.TAP as any).Normal.gravity as any[];
  const TAPM_GRAV  = TGM1_GRAV; // "same as TGM1"

  /**
   * Looks up the gravity unit for a given level from a gravity table.
   * @param {any[]} table - The gravity table containing level and gravity mappings.
   * @param {number} level - The current level to find the gravity for.
   * @returns {number} - The gravity value corresponding to the level.
   */
  function lookupGravUnit(table: any[], level: number): number {
    let val: number = table[0].gravity;
    for (const e of table) {
      if (level >= e.level) val = e.gravity;
      else break;
    }
    return val;
  }

  /**
   * Converts a gravity unit to the number of frames it takes for a piece to fall.
   * @param {number} g - The gravity unit.
   * @returns {number} - The number of frames for the piece to fall.
   */
  function gravUnitToFrames(g: number): number {
    return g >= 256 ? 1 : Math.max(1, Math.round(256 / g));
  }

  /**
   * Parses a range string into a tuple of numbers.
   * @param {string} r - The range string (e.g., "1-10", "5+", or "3").
   * @returns {[number, number]} - A tuple representing the range.
   */
  function parseRange(r: string): [number, number] {
    if (r.endsWith('+')) return [parseInt(r), Infinity];
    const m = r.match(/^(\d+)-(\d+)$/);
    if (m) return [parseInt(m[1]), parseInt(m[2])];
    const n = parseInt(r);
    return [n, n];
  }

  /**
   * Looks up the lock delay for a given level from a delay table.
   * @param {any[]} delays - The delay table containing level ranges and lock delays.
   * @param {number} level - The current level to find the lock delay for.
   * @returns {number} - The lock delay value corresponding to the level.
   */
  function lookupLock(delays: any[], level: number): number {
    for (const d of delays) {
      const [lo, hi] = parseRange(d.levelRange as string);
      if (level >= lo && level <= hi) return d.lock as number;
    }
    return delays[delays.length - 1].lock as number;
  }

  /**
   * Retrieves gravity and lock delay timings for a specific game mode and level.
   * @param {GameMode} game - The game mode (e.g., "TGM1", "TAP-N").
   * @param {number} level - The current level.
   * @returns {{ gravFrames: number; ldFrames: number }} - The gravity and lock delay timings.
   */
  function lookupTimings(game: GameMode, level: number): { gravFrames: number; ldFrames: number } {
    const tap  = timings.TAP  as any;
    const tgm3 = timings.TGM3 as any;
    switch (game) {
      case 'TGM1':  return { gravFrames: gravUnitToFrames(lookupGravUnit(TGM1_GRAV,  level)), ldFrames: lookupLock(timings.TGM1.delays as any[], level) };
      case 'TAP-N': return { gravFrames: gravUnitToFrames(lookupGravUnit(TAPN_GRAV,  level)), ldFrames: lookupLock(tap.Normal.delays,  level) };
      case 'TAP-M': return { gravFrames: gravUnitToFrames(lookupGravUnit(TAPM_GRAV,  level)), ldFrames: lookupLock(tap.Master.delays,  level) };
      case 'TAP-D': return { gravFrames: 1,                                                   ldFrames: lookupLock(tap.Death.delays,   level) };
      case 'TGM3':  return { gravFrames: gravUnitToFrames(lookupGravUnit(TAPM_GRAV,  level)), ldFrames: lookupLock(tgm3.delays,         level) };
      case 'TGM3-S':return { gravFrames: 1,                                                   ldFrames: lookupLock(tgm3.Shirase.delays, level) };
    }
  }

  let selectedSeries: GameSeries | 'custom' = 'custom';
  let selectedGame: GameMode = 'TGM1';

  function selectSeries(series: GameSeries) {
    selectedSeries = series;
    selectedGame = SERIES_MODES[series][0].id;
  }

  let levelInput = 0;

  // ── Gravity ─────────────────────────────────────────────────────────────────
  let gravityTotalFrames = 64;
  let gravityRemaining   = 64;
  let stepGravFrames     = 1;

  function setGravityTotal(total: number) {
    gravityTotalFrames = total;
    gravityRemaining   = Math.min(gravityRemaining, total);
    if (gravityRemaining < 1) gravityRemaining = total;
  }

  // ── Lock delay ─────────────────────────────────────────────────────────────
  let lockDelayTotalFrames = 30;
  let stepLdFrames = 5;

  // Ghost is shown only in TGM1 / TAP Master / TGM3 Master at levels 0–100
  function ghostForMode(game: GameMode, level: number): boolean {
    return (game === 'TGM1' || game === 'TAP-M' || game === 'TGM3') && level <= 100;
  }

  // Apply level → update gravity + lock delay totals + ghost (not in custom mode)
  $: if (selectedSeries !== 'custom') {
    const t = lookupTimings(selectedGame, levelInput);
    setGravityTotal(t.gravFrames);
    lockDelayTotalFrames = t.ldFrames;
    setGhost(ghostForMode(selectedGame, levelInput));
  }

  $: ldRemaining = Math.round((1 - ($currentFrame?.lockDelayProgress ?? 0)) * lockDelayTotalFrames);

  function setLockDelayRemaining(remaining: number) {
    const { d, idx } = getFrameState();
    const clamped = Math.max(0, Math.min(lockDelayTotalFrames, remaining));
    const progress = clamped < lockDelayTotalFrames
      ? (lockDelayTotalFrames - clamped) / lockDelayTotalFrames
      : undefined;
    diagram.set(updateFrame(d, idx, { ...d.frames[idx], lockDelayProgress: progress }));
  }

  /**
   * Automatically steps the game forward by advancing gravity or lock delay.
   */
  function autoStep() {
    const { d, idx, frame } = getFrameState();
    if (!frame.activePiece) return;

    const rotSys = getRotationSystem(d.rotationSystem);
    const piece = frame.activePiece;
    const atRest = rotSys.collides({ ...piece, row: piece.row - 1 }, frame.board);

    if (atRest) {
      // Advance lock delay
      const step = stepLdFrames / lockDelayTotalFrames;
      const next = (frame.lockDelayProgress ?? 0) + step;
      if (next >= 1) {
        checkpoint();
        const result = advanceFrame(d, idx, rotSys);
        diagram.set(result.diagram);
        currentFrameIndex.set(result.newIndex);
        gravityRemaining = gravityTotalFrames;
        return;
      }
      checkpoint();
      const newFrame = cloneFrame(frame);
      newFrame.lockDelayProgress = next;
      newFrame.comment = '';
      newFrame.callouts = [];
      const frames = [...d.frames];
      frames.splice(idx + 1, 0, newFrame);
      diagram.set({ ...d, frames });
      currentFrameIndex.set(idx + 1);
      return;
    }

    // Advance gravity countdown
    gravityRemaining -= stepGravFrames;
    if (gravityRemaining <= 0) {
      // Drop 1 row
      const below = { ...piece, row: piece.row - 1 };
      gravityRemaining = gravityTotalFrames + gravityRemaining; // absorb overshoot
      if (gravityRemaining <= 0) gravityRemaining = gravityTotalFrames;
      checkpoint();
      const newFrame = cloneFrame(frame);
      newFrame.activePiece = below;
      newFrame.lockDelayProgress = undefined;
      newFrame.comment = '';
      newFrame.callouts = [];
      const frames = [...d.frames];
      frames.splice(idx + 1, 0, newFrame);
      diagram.set({ ...d, frames });
      currentFrameIndex.set(idx + 1);
    }
    // Gravity not yet expired — in record mode, still append a frame
    if (get(isRecordMode)) {
      checkpoint();
      const newFrame = cloneFrame(frame);
      newFrame.comment = '';
      newFrame.callouts = [];
      const frames = [...d.frames];
      frames.splice(idx + 1, 0, newFrame);
      diagram.set({ ...d, frames });
      currentFrameIndex.set(idx + 1);
    }
  }

  // ── Line clear ──────────────────────────────────────────────────────────────
  $: currentClearingRows = $currentFrame?.clearingRows ?? [];

  let raiseHoleCol = 4; // 0-indexed

  /**
   * Applies a raise operation to the board, shifting rows upward.
   */
  function applyRaise() {
    const { d, idx, frame } = getFrameState();
    checkpoint();
    const newBoard = cloneBoard(frame.board);
    for (let r = BOARD_TOTAL_ROWS - 1; r > 0; r--) {
      for (let c = 0; c < BOARD_COLS; c++) {
        newBoard[r * BOARD_COLS + c] = newBoard[(r - 1) * BOARD_COLS + c];
      }
    }
    for (let c = 0; c < BOARD_COLS; c++) {
      newBoard[c] = c === raiseHoleCol ? CellType.Empty : CellType.Garbage;
    }
    diagram.set(updateFrame(d, idx, { ...frame, board: newBoard }));
  }

  /**
   * Mirrors the current frame horizontally.
   */
  function applyMirror() {
    const { d, idx, frame } = getFrameState();
    const rotSys = getRotationSystem(d.rotationSystem);
    checkpoint();
    const mirrored = mirrorFrame(frame, rotSys);
    diagram.set(updateFrame(d, idx, mirrored));
  }

  /**
   * Applies free fall to the board, clearing empty rows below pieces.
   */
  function applyFreeFall() {
    const { d, idx, frame } = getFrameState();
    checkpoint();
    diagram.set(updateFrame(d, idx, { ...frame, board: freeFall(frame.board) }));
  }

  /**
   * Marks rows that are full and need to be cleared.
   */
  function markClearingRows() {
    const { d, idx, frame } = getFrameState();
    const fullRows = detectFullRows(frame.board);
    if (!fullRows.length) return;
    checkpoint();
    diagram.set(updateFrame(d, idx, { ...frame, clearingRows: fullRows }));
  }

  /**
   * Clears the marked rows from the board.
   */
  function applyClearLines() {
    const { d, idx, frame } = getFrameState();
    const rowsToClear = (frame.clearingRows && frame.clearingRows.length > 0)
      ? frame.clearingRows
      : detectFullRows(frame.board);
    if (!rowsToClear.length) return;
    checkpoint();
    const newBoard = clearSpecificRows(frame.board, rowsToClear);
    diagram.set(updateFrame(d, idx, { ...frame, board: newBoard, clearingRows: undefined }));
  }

  /**
   * Sets the pre-line-clear delay in milliseconds.
   * @param {Event} e - The event triggered by the input change.
   */
  function setLcPreMs(e: Event) {
    const raw = (e.target as HTMLInputElement).value;
    const val = raw.trim() === '' ? undefined : Math.max(0, parseInt(raw));
    const { d, idx } = getFrameState();
    diagram.set(updateFrame(d, idx, { ...d.frames[idx], lineClearPreMs: val }));
  }

  /**
   * Sets the swipe-line-clear delay in milliseconds.
   * @param {Event} e - The event triggered by the input change.
   */
  function setLcSwipeMs(e: Event) {
    const raw = (e.target as HTMLInputElement).value;
    const val = raw.trim() === '' ? undefined : Math.max(0, parseInt(raw));
    const { d, idx } = getFrameState();
    diagram.set(updateFrame(d, idx, { ...d.frames[idx], lineClearSwipeMs: val }));
  }

  /**
   * Sets the post-line-clear delay in milliseconds.
   * @param {Event} e - The event triggered by the input change.
   */
  function setLcPostMs(e: Event) {
    const raw = (e.target as HTMLInputElement).value;
    const val = raw.trim() === '' ? undefined : Math.max(0, parseInt(raw));
    const { d, idx } = getFrameState();
    diagram.set(updateFrame(d, idx, { ...d.frames[idx], lineClearPostMs: val }));
  }
</script>

<div class="active-piece-controls">
  {#if $currentFrame?.activePiece}
  <div class="dpad">
    <div class="dpad-row">
      <button class="dpad-btn" on:click={() => $isRecordMode ? recordHardDrop() : translatePiece(0, 1)} title={$isRecordMode ? 'Hard drop' : 'Move up'}>↑</button>
    </div>
    <div class="dpad-row">
      <button class="dpad-btn" on:click={() => translatePiece(-1, 0)} title="Move left">←</button>
      <button class="dpad-btn" on:click={() => translatePiece(0, -1)} title="Move down">↓</button>
      <button class="dpad-btn" on:click={() => translatePiece(1, 0)}  title="Move right">→</button>
    </div>
  </div>

  <div class="rotate-row">
    <button class="rot-btn" on:click={() => doRotate('ccw')} title="Rotate CCW ({formatBinding($keyMap['rotate-ccw'])})">↺</button>
    <button class="rot-btn" on:click={() => doRotate('cw')}  title="Rotate CW ({formatBinding($keyMap['rotate-cw'])})">↻</button>
    <button class="rot-btn type-cycle-btn" on:click={() => cyclePieceType(1)} disabled={!$currentFrame?.activePiece}
      title="Cycle piece type forward ({formatBinding($keyMap['piece-cycle-type'])}) - right-click for previous"
      on:contextmenu|preventDefault={() => cyclePieceType(-1)}
    >{$currentFrame?.activePiece ? PIECE_NAMES[$currentFrame.activePiece.type] : '·'}↻</button>
    <button class="rot-btn clear" on:click={clearActivePiece} title="Remove piece">✕</button>
  </div>

  <div class="lock-step-row">
    <button class="lock-btn" on:click={lockPiece} title="Lock piece onto the board — creates a flash frame then a settled frame">Lock</button>
    <button class="hold-btn" on:click={doHold} disabled={!$currentFrame?.activePiece} title="Hold: swap active piece with hold slot (or move to hold if empty), spawn next piece">Hold</button>
    <button class="ld-step-btn" on:click={autoStep} title="Step frame: advance gravity countdown or lock delay depending on piece state">Step →</button>
  </div>

  <div class="piece-toggles">
    <label class="piece-check piece-check-record" class:record-active={$isRecordMode} title="Record moves — each input (move/rotate/drop) appends a new frame">
      <input type="checkbox" checked={$isRecordMode} on:change={onRecordChange} />
      <span class="rec-dot"></span>
      <span>Record moves</span>
    </label>
    {#if $isRecordMode}
      <div class="record-keys-hint">← → ↓ ↑ · Space · Z/X · C — inputs captured</div>
    {/if}
    <label class="piece-check" title="Stamp the corresponding input button on each move/rotate">
      <input type="checkbox" bind:checked={syncInputs} />
      <span>Sync to input display</span>
    </label>
    <label class="piece-check" title="When locking, spawn the next piece from the queue onto the settled frame">
      <input type="checkbox" bind:checked={distributeNextPiece} />
      <span>Distribute next piece</span>
    </label>
    <label class="piece-check" title="Check for piece collision when moving/rotating active piece">
      <input type="checkbox" bind:checked={$pieceCollision} />
      <span>Collision</span>
    </label>
    <label class="piece-check" title="Show ghost piece (drop preview)">
      <input type="checkbox" checked={$currentFrame?.showGhost} on:change={(e) => setGhost((e.target as HTMLInputElement).checked)} />
      <span>Show ghost</span>
    </label>
    <label class="piece-check" title="Show bounding box overlay">
      <input type="checkbox" bind:checked={$showBoundingBox} />
      <span>Bounding box</span>
    </label>

    <label class="piece-check" title="Render piece at 2× size (big mode)">
      <input type="checkbox"
        checked={!!$currentFrame?.activePiece?.big}
        on:change={(e) => {
          const { d, idx, frame } = getFrameState();
          if (!frame.activePiece) return;
          const big = (e.target as HTMLInputElement).checked || undefined;
          diagram.set(updateFrame(d, idx, { ...frame, activePiece: { ...frame.activePiece, big } }));
        }}
      />
      <span>Big piece</span>
    </label>
  </div>

  <!-- ── Timing level preset ── -->
  <div class="sub-label">TIMING LEVEL</div>

  <div class="timing-game-row">
    <button
      class="timing-game-btn timing-custom-btn"
      class:active={selectedSeries === 'custom'}
      on:click={() => { selectedSeries = 'custom'; }}
    >Custom</button>
    {#each GAME_SERIES as gs}
      <button
        class="timing-game-btn"
        class:active={selectedSeries === gs.id}
        on:click={() => selectSeries(gs.id)}
      >{gs.label}</button>
    {/each}
  </div>

  {#if selectedSeries !== 'custom'}
    {#if SERIES_MODES[selectedSeries].length > 1}
      <div class="timing-game-row timing-mode-row">
        {#each SERIES_MODES[selectedSeries] as mode}
          <button
            class="timing-game-btn timing-mode-btn"
            class:active={selectedGame === mode.id}
            on:click={() => { selectedGame = mode.id; }}
          >{mode.label}</button>
        {/each}
      </div>
    {/if}

    <div class="timing-level-row">
      <span class="ld-hint">Lv</span>
      <input
        class="timing-level-input"
        type="number" min="0" max="1300"
        bind:value={levelInput}
        title="Level — sets gravity and lock delay totals from game data"
      />
    </div>
    <div class="timing-computed-row">
      <span class="timing-computed-label">Gravity rate</span>
      <span class="timing-computed-value">{gravityTotalFrames === 1 ? 'instant' : `${gravityTotalFrames} frames / row`}</span>
    </div>
    <div class="timing-computed-row">
      <span class="timing-computed-label">Lock delay</span>
      <span class="timing-computed-value">{lockDelayTotalFrames} frames</span>
    </div>
  {/if}

  <!-- ── Gravity ── -->
  <div class="sub-label timing-sub">GRAVITY DELAY</div>

  <div class="ld-slider-row">
    <input
      class="ld-slider"
      type="range" min="1" max={gravityTotalFrames} step="1"
      bind:value={gravityRemaining}
    />
    <input
      class="ld-num-input"
      type="number" min="1" max={gravityTotalFrames}
      bind:value={gravityRemaining}
      title="Gravity frames remaining"
    />
    <span class="ld-denom">/{gravityTotalFrames}f</span>
  </div>

  <!-- ── Lock delay ── -->
  <div class="sub-label timing-sub">LOCK DELAY</div>

  <div class="ld-slider-row">
    <input
      class="ld-slider"
      type="range" min="0" max={lockDelayTotalFrames} step="1"
      value={ldRemaining}
      on:input={(e) => setLockDelayRemaining(parseInt(e.currentTarget.value))}
    />
    <input
      class="ld-num-input"
      type="number" min="0" max={lockDelayTotalFrames}
      value={ldRemaining}
      on:change={(e) => setLockDelayRemaining(parseInt(e.currentTarget.value))}
      title="Frames remaining"
    />
    <span class="ld-denom">/{lockDelayTotalFrames}f</span>
  </div>

  <div class="ld-step-row">
    <span class="ld-hint">grav</span>
    <input class="ld-step-num" type="number" min="1" max="999" bind:value={stepGravFrames} title="Gravity frames per step" />
    <span class="ld-hint">f</span>
    <span class="ld-sep">·</span>
    <span class="ld-hint">LD</span>
    <input class="ld-step-num" type="number" min="1" max="999" bind:value={stepLdFrames} title="Lock-delay frames per step" />
    <span class="ld-hint">f per step</span>
  </div>
  {/if}

  <div class="sub-label">STACK OPERATIONS</div>

  {#if currentClearingRows.length > 0}
    <span class="lc-rows-hint">rows: {currentClearingRows.map(r => r + 1).join(', ')}</span>
    <div class="lc-timing-row">
      <span class="lc-timing-label">pre</span>
      <input class="lc-timing-input" type="number" min="0" step="25"
        value={$currentFrame?.lineClearPreMs ?? ''} placeholder={String(LC_DEFAULT_PRE_MS)}
        on:change={setLcPreMs} />
      <span class="lc-timing-unit">ms</span>
    </div>
    <div class="lc-timing-row">
      <span class="lc-timing-label">swipe</span>
      <input class="lc-timing-input" type="number" min="0" step="25"
        value={$currentFrame?.lineClearSwipeMs ?? ''} placeholder={String(LC_DEFAULT_SWIPE_MS)}
        on:change={setLcSwipeMs} />
      <span class="lc-timing-unit">ms</span>
    </div>
    <div class="lc-timing-row">
      <span class="lc-timing-label">post</span>
      <input class="lc-timing-input" type="number" min="0" step="25"
        value={$currentFrame?.lineClearPostMs ?? ''} placeholder={String(LC_DEFAULT_POST_MS)}
        on:change={setLcPostMs} />
      <span class="lc-timing-unit">ms</span>
    </div>
  {/if}
  <div class="lc-btn-row">
    <span class="lc-group-label">Lines</span>
    <button class="lc-btn" on:click={markClearingRows} title="Auto-detect full rows and mark them as clearing">Mark</button>
    <button class="lc-btn lc-btn-danger" on:click={applyClearLines} title="Clear marked (or all full) rows from board immediately">Clear</button>
  </div>
  <div class="raise-section">
    <div class="raise-header">
      <span class="lc-group-label">Raise — hole at col {raiseHoleCol + 1}</span>
      <button class="lc-btn lc-btn-compact" on:click={applyRaise} title="Insert a garbage row at the bottom with hole at column {raiseHoleCol + 1}">Add</button>
    </div>
    <div class="raise-hole-picker" title="Click a column to set the hole position">
      {#each Array(10) as _, c}
        <button
          class="hole-cell"
          class:hole-selected={raiseHoleCol === c}
          on:click={() => { raiseHoleCol = c; }}
          title="Hole at column {c + 1}"
        ><span class="hole-col-label">{c + 1}</span></button>
      {/each}
    </div>
  </div>
  <div class="lc-btn-row">
    <button class="lc-btn" on:click={applyFreeFall} title="Free fall: all floating blocks drop to the lowest available row in their column (TGM2 item gravity)">Fall</button>
    <button class="lc-btn" on:click={applyMirror} title="Horizontally mirror the entire board">Mirror</button>
  </div>
  <div class="lc-btn-row">
    <span class="lc-group-label">Shift</span>
    <button class="lc-btn" on:click={() => shiftStack('left')}  title="Shift stack left">←</button>
    <button class="lc-btn" on:click={() => shiftStack('up')}    title="Shift stack up">↑</button>
    <button class="lc-btn" on:click={() => shiftStack('down')}  title="Shift stack down">↓</button>
    <button class="lc-btn" on:click={() => shiftStack('right')} title="Shift stack right">→</button>
  </div>
</div>

<style>
  .active-piece-controls {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .piece-check-record { color: var(--txt-dim); }
  .piece-check-record.record-active { color: var(--rec-dot-text); }
  .piece-check-record.record-active input[type="checkbox"] { accent-color: var(--rec-dot-check); }

  .rec-dot {
    width: 7px; height: 7px; border-radius: 50%;
    background: var(--rec-dot); flex-shrink: 0;
    opacity: 0.5;
    position: relative; top: 0.5px;
  }
  .record-active .rec-dot { opacity: 1; }

  .record-keys-hint {
    font-size: 11px;
    color: var(--txt-2);
    padding: 2px 4px;
  }

  .sub-label {
    font-size: 10px; font-weight: 700; letter-spacing: 0.1em; color: var(--txt-dim);
    margin-top: 4px;
  }

  /* dimmer sub-labels for gravity/lock delay — secondary to level preset */
  .sub-label.timing-sub {
    font-size: 11px; letter-spacing: 0.06em; color: var(--brd-2); margin-top: 2px;
  }

  .dpad {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
  }

  .dpad-row { display: flex; gap: 2px; }

  .dpad-btn {
    width: 28px; height: 24px;
    background: var(--bg-2); border: 1px solid var(--brd-2); border-radius: var(--r-sm);
    color: var(--txt-1); font-size: 13px; cursor: pointer; padding: 0;
    display: flex; align-items: center; justify-content: center;
  }
  .dpad-btn:hover { background: var(--bg-3); }

  @media (max-width: 699px) {
    /* D-pad */
    .dpad-btn { width: 56px; height: 52px; font-size: 20px; border-radius: var(--r); }
    .dpad-row { gap: 4px; }
    .dpad { gap: 4px; }

    /* Rotate / clear row */
    .rot-btn { min-height: 44px; font-size: 18px; padding: 6px; }

    /* Lock + Step */
    .lock-btn { min-height: 44px; font-size: 13px; }
    .hold-btn { min-height: 44px; font-size: 13px; }
    .ld-step-btn { min-height: 44px; font-size: 15px; padding: 4px 14px; }

    /* Checkboxes */
    .piece-check { min-height: 36px; font-size: 13px; gap: 8px; }
    .piece-check input[type="checkbox"] { width: 20px; height: 20px; }

    /* Timing game-mode buttons */
    .timing-game-btn { min-height: 36px; font-size: 12px; padding: 6px 8px; }
    .timing-level-input { min-height: 36px; font-size: 13px; width: 56px; }
    .timing-computed-label { font-size: 12px; width: 80px; }
    .timing-computed-value { font-size: 12px; }

    /* Gravity / Lock delay sliders */
    .ld-slider { height: 20px; }
    .ld-slider::-webkit-slider-thumb { width: 28px; height: 28px; }
    .ld-slider::-moz-range-thumb    { width: 28px; height: 28px; }
    .ld-num-input { min-height: 36px; width: 40px; font-size: 13px; }
    .ld-denom { font-size: 12px; }
    .ld-step-num { min-height: 36px; width: 40px; font-size: 13px; }
    .ld-hint { font-size: 12px; }
    .ld-step-row { gap: 6px; }

    /* Stack operation buttons */
    .lc-btn { min-height: 44px; font-size: 13px; padding: 8px 6px; }
    .lc-btn-compact { min-height: 44px; padding: 8px 12px; }
    .lc-group-label { font-size: 12px; }

    /* Line-clear timing inputs */
    .lc-timing-input { min-height: 36px; font-size: 13px; }
    .lc-timing-label { font-size: 12px; width: 38px; }
    .lc-timing-unit { font-size: 12px; }

    /* Section labels */
    .sub-label { font-size: 12px; margin-top: 8px; }
    .sub-label.timing-sub { font-size: 11px; }
  }

  .rotate-row { display: flex; gap: 4px; }

  .rot-btn {
    flex: 1; background: var(--bg-2); border: 1px solid var(--brd-2); border-radius: var(--r-sm);
    color: var(--txt-1); font-size: 14px; cursor: pointer; padding: 3px;
    display: flex; align-items: center; justify-content: center; gap: 3px;
  }
  .rot-btn:hover { background: var(--bg-3); }
  .rot-btn.clear { color: var(--danger); }
  .type-cycle-btn { font-size: 11px; font-weight: 700; letter-spacing: 0.02em; }
  .type-cycle-btn:disabled { opacity: 0.35; cursor: default; }

  .lock-step-row {
    display: flex;
    gap: 4px;
  }

  .lock-btn {
    flex: 1;
    background: var(--bg-2); border: 1px solid var(--brd-2); border-radius: var(--r-sm);
    color: var(--txt-1); font-size: 11px; font-weight: 600; cursor: pointer; padding: 4px 8px;
    transition: background 0.1s, border-color 0.1s;
  }
  .lock-btn:hover { background: var(--bg-3); border-color: var(--brd-3); }

  .hold-btn {
    flex: 1;
    background: var(--bg-2); border: 1px solid var(--brd-2); border-radius: var(--r-sm);
    color: var(--txt-1); font-size: 11px; font-weight: 600; cursor: pointer; padding: 4px 8px;
    transition: background 0.1s, border-color 0.1s;
  }
  .hold-btn:hover:not(:disabled) { background: var(--hold-active-bg); border-color: var(--brd-3); }
  .hold-btn:disabled { opacity: 0.35; cursor: default; }

  .piece-toggles {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .piece-check {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    color: var(--txt-2);
    cursor: pointer;
    user-select: none;
  }
  .piece-check input[type="checkbox"] { accent-color: var(--accent); cursor: pointer; }

/* ── Timing level preset ─────────────────────────────────────────────────── */
  .timing-game-row {
    display: flex;
    gap: 2px;
  }

  .timing-game-btn {
    background: var(--bg-1); border: 1px solid var(--brd-1); border-radius: var(--r-sm);
    color: var(--txt-dim); font-size: 10px; padding: 2px 5px; cursor: pointer;
    line-height: 1; flex: 1;
    transition: background 0.1s, color 0.1s;
  }
  .timing-game-btn:hover { background: var(--bg-2); border-color: var(--brd-3); color: var(--txt-1); }
  .timing-game-btn.active { background: var(--bg-2); border-color: var(--accent); color: var(--accent); }

  .timing-mode-row { margin-top: 1px; }
  .timing-mode-btn { font-size: 9px; color: var(--brd-3); }
  .timing-mode-btn.active { color: var(--accent); }

  .timing-level-row {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .timing-level-input {
    width: 42px; flex-shrink: 0;
    background: var(--bg-input); border: 1px solid var(--brd-2); border-radius: var(--r-sm);
    color: var(--txt-0); font-size: 11px; font-variant-numeric: tabular-nums;
    padding: 2px 3px; text-align: center; outline: none;
    -moz-appearance: textfield;
  }
  .timing-level-input::-webkit-outer-spin-button,
  .timing-level-input::-webkit-inner-spin-button { -webkit-appearance: none; }
  .timing-level-input:focus { border-color: var(--accent); }

  .timing-computed-row {
    display: flex;
    align-items: baseline;
    gap: 6px;
  }

  .timing-computed-label {
    font-size: 10px; color: var(--txt-dim); flex-shrink: 0; width: 62px;
  }

  .timing-computed-value {
    font-size: 10px; color: var(--accent); font-variant-numeric: tabular-nums;
  }

  /* ── Gravity / Lock delay ────────────────────────────────────────────────── */
  .ld-slider-row {
    display: flex;
    align-items: center;
    gap: 3px;
  }

  .ld-slider {
    flex: 1; min-width: 0;
    -webkit-appearance: none; appearance: none;
    height: 4px; border-radius: 2px; background: var(--brd-1);
    outline: none; cursor: pointer;
  }
  .ld-slider::-webkit-slider-thumb {
    -webkit-appearance: none; appearance: none;
    width: 12px; height: 12px; border-radius: 50%;
    background: var(--accent); cursor: pointer; border: 2px solid var(--bg-base);
  }
  .ld-slider::-moz-range-thumb {
    width: 12px; height: 12px; border-radius: 50%;
    background: var(--accent); cursor: pointer; border: 2px solid var(--bg-base);
  }

  .ld-num-input {
    width: 32px; flex-shrink: 0;
    background: var(--bg-input); border: 1px solid var(--brd-1); border-radius: var(--r-sm);
    color: var(--txt-0); font-size: 13px; font-variant-numeric: tabular-nums;
    padding: 2px 2px; text-align: center; outline: none;
    -moz-appearance: textfield;
  }
  .ld-num-input::-webkit-outer-spin-button,
  .ld-num-input::-webkit-inner-spin-button { -webkit-appearance: none; }
  .ld-num-input:focus { border-color: var(--txt-dim); }

  .ld-denom {
    font-size: 13px; color: var(--txt-dim); white-space: nowrap;
    font-variant-numeric: tabular-nums; flex-shrink: 0;
  }

  .ld-step-row {
    display: flex;
    align-items: center;
    gap: 3px;
  }

  .ld-hint {
    font-size: 10px; color: var(--brd-2); white-space: nowrap; flex-shrink: 0;
  }

  .ld-sep {
    font-size: 10px; color: var(--brd-1); flex-shrink: 0;
  }

  .ld-step-num {
    width: 26px; flex-shrink: 0;
    background: var(--bg-input); border: 1px solid var(--brd-1); border-radius: var(--r-sm);
    color: var(--accent); font-size: 10px; font-variant-numeric: tabular-nums;
    padding: 2px 2px; text-align: center; outline: none;
    -moz-appearance: textfield;
  }
  .ld-step-num::-webkit-outer-spin-button,
  .ld-step-num::-webkit-inner-spin-button { -webkit-appearance: none; }
  .ld-step-num:focus { border-color: var(--txt-dim); }

  .ld-step-btn {
    flex-shrink: 0;
    background: var(--blue-bg); border: 1px solid var(--blue-brd); border-radius: var(--r-sm);
    color: var(--blue-step); font-size: 13px; padding: 1px 7px;
    cursor: pointer; line-height: 1;
    transition: background 0.1s, color 0.1s;
  }
  .ld-step-btn:hover { background: var(--blue-bg-hi); color: var(--blue-step-hi); border-color: var(--blue-brd-hi); }

  /* ── Line clear ─────────────────────────────────────────────────────────── */
  .lc-rows-hint {
    font-size: 10px; color: var(--accent); font-variant-numeric: tabular-nums;
  }

  .lc-btn-row {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .lc-group-label {
    font-size: 10px; color: var(--brd-2); white-space: nowrap; flex-shrink: 0;
  }

  .raise-section {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .raise-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .raise-hole-picker {
    display: flex;
    gap: 2px;
  }

  .hole-cell {
    flex: 1; height: 32px;
    background: var(--brown-bg); border: 1px solid var(--brown-brd); border-radius: 2px;
    cursor: pointer; padding: 0;
    display: flex; align-items: flex-end; justify-content: center; padding-bottom: 3px;
    transition: background 0.08s;
  }
  .hole-cell:hover { background: var(--brown); }
  .hole-cell.hole-selected {
    background: var(--bg-base);
    border-color: var(--brd-3);
  }

  .hole-col-label {
    font-size: 9px;
    color: var(--brown);
    line-height: 1;
    pointer-events: none;
    user-select: none;
  }
  .hole-cell.hole-selected .hole-col-label {
    color: var(--txt-dim);
  }

  .lc-btn-compact {
    flex: none; padding: 3px 6px;
  }

  .lc-btn {
    flex: 1;
    background: var(--bg-1); border: 1px solid var(--brd-1); border-radius: var(--r-sm);
    color: var(--txt-mid); font-size: 10px; padding: 3px 4px; cursor: pointer;
    line-height: 1; text-align: center;
    transition: background 0.1s, color 0.1s;
  }
  .lc-btn:hover { background: var(--bg-2); border-color: var(--brd-3); color: var(--txt-0); }

  .lc-btn-danger { color: var(--danger-dim); border-color: var(--danger-brd-dim); }
  .lc-btn-danger:hover { background: var(--danger-bg); border-color: var(--danger-brd-mid); color: var(--danger-hi); }

  .lc-timing-row {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .lc-timing-label {
    font-size: 10px; color: var(--brd-3); white-space: nowrap; flex-shrink: 0; width: 30px;
  }

  .lc-timing-input {
    flex: 1; min-width: 0;
    background: var(--bg-input); border: 1px solid var(--brd-1); border-radius: var(--r-sm);
    color: var(--accent); font-size: 10px; font-variant-numeric: tabular-nums;
    padding: 2px 3px; text-align: right; outline: none;
    -moz-appearance: textfield;
  }
  .lc-timing-input::-webkit-outer-spin-button,
  .lc-timing-input::-webkit-inner-spin-button { -webkit-appearance: none; }
  .lc-timing-input:focus { border-color: var(--txt-dim); color: var(--txt-0); }
  .lc-timing-input::placeholder { color: var(--brd-2); }

  .lc-timing-unit {
    font-size: 10px; color: var(--brd-2); flex-shrink: 0;
  }
</style>
