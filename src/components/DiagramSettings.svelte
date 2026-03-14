<script lang="ts">
  import { diagram, renderConfig, nextQueueLayout, fishMode } from '../editor/store';
  import RotationSystemPicker from './RotationSystemPicker.svelte';
  import { ALL_INPUT_CATEGORIES } from '../types/frame';
  import type { InputCategory } from '../types/frame';

  let extraClickCount = 0;

  const INPUT_CAT_LABELS: Record<InputCategory, string> = {
    dir: 'Dir', ccw: 'CCW', cw: 'CW', ccw2: '2nd CCW',
    rewind: 'Rewind', cw2: '2nd CW', hold: 'Hold', extra: 'Extra',
  };

  /**
   * Toggles the visibility of the specified input category.
   * @param {InputCategory} cat - The input category to toggle.
   */
  function toggleInputCategory(cat: InputCategory) {
    if (cat === 'extra') {
      extraClickCount++;
      if (extraClickCount >= 10) fishMode.set(true);
    } else {
      extraClickCount = 0;
    }
    diagram.update(d => {
      const hidden = new Set(d.hiddenInputs ?? []);
      if (hidden.has(cat)) hidden.delete(cat); else hidden.add(cat);
      return { ...d, hiddenInputs: hidden.size ? [...hidden] : undefined };
    });
  }
</script>

<details class="diagram-settings" open>
  <summary class="sb-label">DIAGRAM</summary>

  <input
    class="sb-text-input"
    type="text"
    placeholder="Diagram title…"
    value={$diagram.metadata.title}
    on:input={e => diagram.update(d => ({ ...d, metadata: { ...d.metadata, title: (e.target as HTMLInputElement).value } }))}
  />

  <RotationSystemPicker />

  <label class="sb-row">
    <span>Next queue <span class="sb-val">{$diagram.nextQueueLength ?? 6}</span></span>
    <input type="range" min="0" max="6" step="1" value={$diagram.nextQueueLength ?? 6}
      on:input={e => diagram.update(d => ({ ...d, nextQueueLength: Number((e.target as HTMLInputElement).value) }))} />
  </label>

  <div class="sb-label" style="margin-top: 6px;">APPEARANCE</div>
  <div class="sb-row">
    <span>Next queue</span>
    <div class="nq-toggle">
      <button class:active={$nextQueueLayout === 'horizontal'} on:click={() => nextQueueLayout.set('horizontal')}>Horizontal</button>
      <button class:active={$nextQueueLayout === 'vertical'}   on:click={() => nextQueueLayout.set('vertical')}>Vertical</button>
    </div>
  </div>

  <label class="sb-row">
    <span>Cell size <span class="sb-val">{$renderConfig.cellSize}px</span></span>
    <input type="range" min="12" max="64" step="4" value={$renderConfig.cellSize}
      on:input={e => renderConfig.update(c => ({ ...c, cellSize: Number((e.target as HTMLInputElement).value) }))} />
  </label>

  <label class="sb-row">
    <span>Ghost <span class="sb-val">{Math.round($renderConfig.ghostAlpha * 100)}%</span></span>
    <input type="range" min="0" max="1" step="0.05" value={$renderConfig.ghostAlpha}
      on:input={e => renderConfig.update(c => ({ ...c, ghostAlpha: Number((e.target as HTMLInputElement).value) }))} />
  </label>

  <label class="sb-checkbox">
    <input type="checkbox" checked={$renderConfig.showGrid}
      on:change={e => renderConfig.update(c => ({ ...c, showGrid: (e.target as HTMLInputElement).checked }))} />
    Show grid
  </label>

  <label class="sb-row">
    <span>Animation <span class="sb-val">{$diagram.animationDelayMs}ms</span></span>
    <input type="range" min="16" max="3000" step="50" value={$diagram.animationDelayMs}
      on:input={e => diagram.update(d => ({ ...d, animationDelayMs: Number((e.target as HTMLInputElement).value) }))} />
  </label>

  <div class="sb-label" style="margin-top: 6px;">INPUT OVERLAY</div>
  <div class="sb-input-vis">
    {#each ALL_INPUT_CATEGORIES as cat}
      {@const hidden = ($diagram.hiddenInputs ?? []).includes(cat)}
      <label class="sb-input-check">
        <input type="checkbox" checked={!hidden} on:change={() => toggleInputCategory(cat)} />
        {cat === 'extra' && $fishMode ? '🐟' : INPUT_CAT_LABELS[cat]}
      </label>
    {/each}
  </div>
</details>

<style>
  .diagram-settings {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .diagram-settings > summary { margin-bottom: 2px; }

  .sb-label {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.1em;
    color: var(--txt-dim);
    text-transform: uppercase;
    cursor: pointer;
    user-select: none;
    list-style: none;
  }
  .sb-label::-webkit-details-marker { display: none; }
  .sb-label::before { content: '▾ '; }
  details:not([open]) > .sb-label::before { content: '▸ '; }

  .sb-val {
    color: var(--txt-0);
    font-weight: 600;
  }

  .sb-row {
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: 11px;
    color: var(--txt-2);
  }

  .sb-checkbox {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: var(--txt-2);
    cursor: pointer;
  }

  .sb-text-input {
    width: 100%;
    box-sizing: border-box;
    background: var(--bg-input);
    border: 1px solid var(--brd-1);
    border-radius: var(--r-sm);
    color: var(--txt-0);
    font-size: 11px;
    padding: 3px 6px;
    outline: none;
  }
  .sb-text-input::placeholder { color: var(--brd-2); }
  .sb-text-input:focus { border-color: var(--txt-dim); }

  input[type=range] { width: 100%; accent-color: var(--accent); }

  .nq-toggle {
    display: flex;
    gap: 2px;
  }
  .nq-toggle button {
    flex: 1;
    padding: 2px 0;
    background: var(--bg-input);
    border: 1px solid var(--brd-1);
    border-radius: var(--r-sm);
    color: var(--txt-2);
    font-size: 10px;
    font-weight: 600;
    cursor: pointer;
    letter-spacing: 0.03em;
  }
  .nq-toggle button:hover { background: var(--bg-2); color: var(--txt-1); }
  .nq-toggle button.active { background: var(--bg-3); border-color: var(--accent); color: var(--txt-0); }

  .sb-input-vis {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .sb-input-check {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: var(--txt-2);
    cursor: pointer;
  }
  .sb-input-check input[type=checkbox] { accent-color: var(--accent); cursor: pointer; }
</style>
