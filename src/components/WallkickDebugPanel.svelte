<script lang="ts">
  import {
    wallkickDebugMode,
    wallkickDebugTrace,
    wallkickDebugStep,
    diagram,
  } from '../editor/store';
  import {
    stepTitle, stepIcon, stepColor, stepDescription,
  } from '../rotation/wallkick-trace';
  import type { WallkickStep } from '../rotation/wallkick-trace';

  const PIECE_LABEL = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'] as const;
  const DIR_LABEL: Record<string, string> = { cw: 'CW ↻', ccw: 'CCW ↺', '180': '180°' };

  /**
   * Moves to the previous wallkick debug step.
   */
  function prevStep() {
    wallkickDebugStep.update(s => Math.max(0, s - 1));
  }
  /**
   * Moves to the next wallkick debug step.
   */
  function nextStep() {
    const len = $wallkickDebugTrace?.steps.length ?? 0;
    wallkickDebugStep.update(s => Math.min(len - 1, s + 1));
  }

  // Phase grouping for visual dividers in the step list
  type Phase = 'start' | 'basic' | 'io-rule' | 'centre-col' | 'kick' | 'result';
  /**
   * Determines the phase of the specified wallkick step.
   * @param {WallkickStep} step - The wallkick step to determine the phase for.
   * @returns {Phase} - The phase of the step.
   */
  function stepPhase(step: WallkickStep): Phase {
    switch (step.kind) {
      case 'init': return 'start';
      case 'basic-test': case 'basic-pass': case 'basic-fail': return 'basic';
      case 'no-kick-io': return 'io-rule';
      case 'centre-col-skip': case 'centre-col-mino':
      case 'centre-col-reject': case 'centre-col-allow': return 'centre-col';
      case 'kick-test': case 'kick-pass': case 'kick-fail': return 'kick';
      case 'result': return 'result';
    }
  }

  const PHASE_LABEL: Record<Phase, string> = {
    'start':      'START',
    'basic':      'BASIC ROTATION',
    'io-rule':    'I/O RULE',
    'centre-col': 'CENTRE-COL CHECK',
    'kick':       'KICK ATTEMPTS',
    'result':     'RESULT',
  };
</script>

<div class="debug-panel">
  <div class="panel-header">
    <span class="panel-title">KICK DEBUG</span>
    <button class="close-btn" on:click={() => wallkickDebugMode.set(false)} title="Close">✕</button>
  </div>

  {#if $diagram.rotationSystem !== 'ars'}
    <p class="hint warn">Wallkick debug only works with the ARS rotation system.</p>
  {:else if !$wallkickDebugTrace}
    <p class="hint">
      Use the rotation buttons (↺ / ↻) in the piece panel while a piece is active to trace a rotation.
    </p>
  {:else if $wallkickDebugTrace.steps.length === 0}
    <!-- 2-state no-op (e.g. I/S/Z 180°) -->
    <p class="hint">
      No kick logic ran — 2-state piece with no visual change ({PIECE_LABEL[$wallkickDebugTrace.fromPiece.type]}).
    </p>
  {:else}
    {@const trace = $wallkickDebugTrace}
    {@const step  = trace.steps[$wallkickDebugStep]}

    <!-- Summary bar -->
    <div class="summary">
      <span class="piece-badge">{PIECE_LABEL[trace.fromPiece.type]}</span>
      <span class="dir-badge">{DIR_LABEL[trace.direction]}</span>
      <span class="state-info">
        {trace.fromPiece.rotation} → {trace.basePiece.rotation}
      </span>
      <span class="result-badge" class:ok={trace.result !== null} class:fail={trace.result === null}>
        {trace.result !== null ? '✓ rotated' : '✗ blocked'}
      </span>
    </div>

    <!-- Step navigator -->
    <div class="step-nav">
      <button class="nav-btn" on:click={prevStep} disabled={$wallkickDebugStep <= 0} title="Previous step">◀</button>
      <span class="step-count">Step {$wallkickDebugStep + 1} / {trace.steps.length}</span>
      <button class="nav-btn" on:click={nextStep} disabled={$wallkickDebugStep >= trace.steps.length - 1} title="Next step">▶</button>
    </div>

    <!-- Step list with phase dividers -->
    <div class="step-list">
      {#each trace.steps as s, i}
        {@const phase = stepPhase(s)}
        {#if i === 0 || stepPhase(trace.steps[i - 1]) !== phase}
          <div class="phase-divider">{PHASE_LABEL[phase]}</div>
        {/if}
        <button
          class="step-item"
          class:active={i === $wallkickDebugStep}
          style="--accent: {stepColor(s)}"
          on:click={() => wallkickDebugStep.set(i)}
        >
          <span class="step-icon" style="color: {stepColor(s)}">{stepIcon(s)}</span>
          <span class="step-label">{stepTitle(s)}</span>
        </button>
      {/each}
    </div>

    <!-- Current step detail -->
    {#if step}
      <div class="step-detail">
        <div class="detail-title" style="color: {stepColor(step)}">{stepTitle(step)}</div>
        <div class="detail-desc">{stepDescription(step, trace)}</div>

        <!-- Extra: mino table for centre-col-mino (progressive scan) -->
        {#if step.kind === 'centre-col-mino'}
          <div class="mino-table">
            <div class="mino-row header">
              <span>mino</span><span>deltaCol</span><span>deltaRow</span><span>col</span><span>row</span><span>status</span>
            </div>
            {#each step.allMinos as m, i}
              <div
                class="mino-row"
                class:current={i === step.minoIndex}
                class:unchecked={!m.checked}
              >
                <span class="mino-num">{i + 1}</span>
                <span>{m.deltaCol}</span>
                <span>{m.deltaRow}</span>
                <span>{m.checked ? m.col : '·'}</span>
                <span>{m.checked ? m.row : '·'}</span>
                <span class="mino-status">
                  {#if !m.checked}
                    <span class="tag gray">—</span>
                  {:else if !m.blocked}
                    <span class="tag green">free</span>
                  {:else if m.isCentreCol}
                    <span class="tag red">CENTRE → reject</span>
                  {:else}
                    <span class="tag orange">side → kick</span>
                  {/if}
                </span>
              </div>
            {/each}
          </div>
          <p class="mino-note">Scanned in raster order (top-left first). Stops at first blocked cell.</p>
        {/if}

        <!-- Extra: mino table for centre-col summary steps -->
        {#if step.kind === 'centre-col-reject' || step.kind === 'centre-col-allow'}
          <div class="mino-table">
            <div class="mino-row header">
              <span>mino</span><span>deltaCol</span><span>deltaRow</span><span>col</span><span>row</span><span>status</span>
            </div>
            {#each step.minos as m, i}
              <div class="mino-row" class:unchecked={!m.checked} class:deciding={m.deciding}>
                <span class="mino-num">{i + 1}</span>
                <span>{m.deltaCol}</span>
                <span>{m.deltaRow}</span>
                <span>{m.checked ? m.col : '·'}</span>
                <span>{m.checked ? m.row : '·'}</span>
                <span class="mino-status">
                  {#if !m.checked}
                    <span class="tag gray">—</span>
                  {:else if !m.blocked}
                    <span class="tag green">free</span>
                  {:else if m.isCentreCol}
                    <span class="tag red">CENTRE → reject</span>
                  {:else}
                    <span class="tag orange">side → kick</span>
                  {/if}
                </span>
              </div>
            {/each}
          </div>
        {/if}

        <!-- Extra: blocked cells for basic-fail -->
        {#if step.kind === 'basic-fail' && step.blockedMinos.length > 0}
          <div class="blocked-list">
            Blocked: {#each step.blockedMinos as m, i}
              <span class="coord">(col {m.col}, row {m.row}){i < step.blockedMinos.length - 1 ? ',' : ''}</span>
            {/each}
          </div>
        {/if}

        <!-- Extra: position info for kick steps -->
        {#if step.kind === 'kick-test' || step.kind === 'kick-pass' || step.kind === 'kick-fail'}
          <div class="pos-info">
            <span class="pos-label">Offset</span><span class="pos-val">{step.deltaCol > 0 ? '+1' : '−1'} col</span>
            <span class="pos-label">Position</span><span class="pos-val">col {step.piece.col}, row {step.piece.row}</span>
          </div>
        {/if}

        <!-- Extra: result position -->
        {#if step.kind === 'result' && step.piece}
          <div class="pos-info">
            <span class="pos-label">Final col</span><span class="pos-val">{step.piece.col}</span>
            <span class="pos-label">Final row</span><span class="pos-val">{step.piece.row}</span>
            <span class="pos-label">State</span><span class="pos-val">{step.piece.rotation}</span>
          </div>
        {/if}
      </div>
    {/if}

    <!-- Colour legend -->
    <div class="legend">
      <div class="legend-title">LEGEND</div>
      <div class="legend-row"><span class="swatch" style="background:var(--wk-original)"></span>Original position</div>
      <div class="legend-row"><span class="swatch" style="background:var(--wk-test)"></span>Position under test</div>
      <div class="legend-row"><span class="swatch" style="background:var(--wk-kick)"></span>Kick candidate</div>
      <div class="legend-row"><span class="swatch" style="background:var(--ok)"></span>Free / success</div>
      <div class="legend-row"><span class="swatch" style="background:var(--clr-red)"></span>Blocked / reject</div>
      <div class="legend-row"><span class="swatch" style="background:var(--warn)"></span>Deciding mino (non-centre)</div>
      <div class="legend-row"><span class="swatch" style="background:var(--wk-dim)"></span>Not yet scanned</div>
    </div>
  {/if}
</div>

<style>
  .debug-panel {
    width: 256px;
    background: var(--bg-deep);
    border-left: 1px solid var(--brd-1);
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 8px;
    overflow-y: auto;
    font-size: 11px;
    color: var(--wk-text);
    flex-shrink: 0;
  }

  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-bottom: 6px;
    border-bottom: 1px solid var(--brd-1);
  }
  .panel-title {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.12em;
    color: var(--txt-dim);
  }
  .close-btn {
    background: none;
    border: none;
    color: var(--txt-dim);
    cursor: pointer;
    font-size: 12px;
    padding: 2px 4px;
    line-height: 1;
  }
  .close-btn:hover { color: var(--txt-0); }

  /* Summary */
  .summary {
    display: flex;
    gap: 4px;
    align-items: center;
    flex-wrap: wrap;
  }
  .piece-badge {
    background: var(--wk-bg);
    border: 1px solid var(--brd-2);
    border-radius: var(--r-sm);
    padding: 1px 5px;
    font-weight: 700;
    color: var(--txt-0);
    font-size: 12px;
  }
  .dir-badge {
    background: var(--wk-bg);
    border: 1px solid var(--brd-2);
    border-radius: var(--r-sm);
    padding: 1px 5px;
    color: var(--txt-1);
  }
  .state-info {
    font-size: 10px;
    color: var(--txt-dim);
    font-family: monospace;
  }
  .result-badge {
    border-radius: var(--r-sm);
    padding: 1px 5px;
    font-weight: 600;
    margin-left: auto;
  }
  .result-badge.ok   { background: var(--ok-bg); border: 1px solid var(--ok); color: var(--ok); }
  .result-badge.fail { background: var(--danger-bg-deep); border: 1px solid var(--clr-red); color: var(--clr-red); }

  /* Step navigator */
  .step-nav {
    display: flex;
    align-items: center;
    gap: 6px;
    justify-content: center;
  }
  .nav-btn {
    background: var(--bg-1);
    border: 1px solid var(--brd-2);
    border-radius: var(--r-sm);
    color: var(--txt-1);
    cursor: pointer;
    padding: 3px 10px;
    font-size: 13px;
  }
  .nav-btn:disabled { opacity: 0.3; cursor: default; }
  .nav-btn:not(:disabled):hover { background: var(--bg-3); }
  .step-count { font-size: 11px; color: var(--wk-step); min-width: 64px; text-align: center; }

  /* Step list */
  .step-list { display: flex; flex-direction: column; gap: 1px; }

  .phase-divider {
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.1em;
    color: var(--brd-2);
    padding: 5px 4px 2px;
    margin-top: 2px;
    text-transform: uppercase;
  }

  .step-item {
    display: flex;
    align-items: center;
    gap: 6px;
    background: var(--bg-input);
    border: 1px solid transparent;
    border-radius: var(--r-sm);
    padding: 4px 6px;
    cursor: pointer;
    text-align: left;
    color: var(--txt-2);
    font-size: 11px;
    transition: background 0.1s;
    width: 100%;
  }
  .step-item:hover { background: var(--bg-1); border-color: var(--brd-2); }
  .step-item.active {
    background: var(--bg-1);
    border-color: var(--accent, var(--txt-dim));
    color: var(--txt-0);
  }
  .step-icon { font-size: 11px; width: 12px; text-align: center; flex-shrink: 0; font-weight: 700; }
  .step-label { flex: 1; }

  /* Step detail */
  .step-detail {
    background: var(--bg-input);
    border: 1px solid var(--brd-1);
    border-radius: var(--r);
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .detail-title { font-weight: 700; font-size: 11px; }
  .detail-desc  { color: var(--txt-2); line-height: 1.5; }

  /* Mino table (centre-col scan) */
  .mino-table {
    display: flex;
    flex-direction: column;
    gap: 1px;
    font-size: 10px;
    font-family: monospace;
    margin-top: 4px;
  }
  .mino-row {
    display: grid;
    grid-template-columns: 26px 22px 22px 28px 28px 1fr;
    gap: 2px;
    padding: 2px 4px;
    border-radius: 2px;
    background: var(--bg-deep);
    color: var(--purple-2);
    border: 1px solid transparent;
  }
  .mino-row.header { color: var(--purple-dim); font-weight: 700; }
  .mino-row.current {
    background: var(--bg-1);
    border-color: var(--txt-dim);
    color: var(--txt-0);
  }
  .mino-row.deciding { background: var(--bg-1); border-color: var(--wk-dim); }
  .mino-row.unchecked { opacity: 0.4; }
  .mino-num { color: var(--purple-dim); }
  .mino-status { display: flex; align-items: center; }

  .tag { border-radius: 2px; padding: 0 3px; font-size: 9px; font-weight: 700; white-space: nowrap; }
  .tag.green  { background: var(--ok-bg); color: var(--ok); }
  .tag.red    { background: var(--danger-bg-deep); color: var(--clr-red); }
  .tag.orange { background: var(--warn-bg); color: var(--warn); }
  .tag.gray   { background: var(--bg-1); color: var(--wk-dim-text); }

  .mino-note { color: var(--wk-dim); font-size: 10px; margin: 0; }

  /* Blocked cells list */
  .blocked-list { color: var(--txt-2); font-size: 10px; font-family: monospace; line-height: 1.6; }
  .coord { color: var(--danger); }

  /* Position info for kick / result steps */
  .pos-info {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 2px 8px;
    font-size: 10px;
    font-family: monospace;
    background: var(--bg-deep);
    padding: 4px 6px;
    border-radius: var(--r-sm);
    margin-top: 2px;
  }
  .pos-label { color: var(--purple-dim); }
  .pos-val   { color: var(--txt-1); }

  /* Legend */
  .legend {
    margin-top: 4px;
    padding-top: 6px;
    border-top: 1px solid var(--wk-bg);
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .legend-title {
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.1em;
    color: var(--brd-2);
    margin-bottom: 2px;
  }
  .legend-row {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 10px;
    color: var(--txt-dim);
  }
  .swatch {
    width: 10px;
    height: 10px;
    border-radius: 2px;
    flex-shrink: 0;
    opacity: 0.85;
  }
</style>
