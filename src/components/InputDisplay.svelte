<script lang="ts">
  import type { InputId, InputState, InputCategory } from '../types/frame';
  import { fishMode } from '../editor/store';

  export let inputs: Partial<Record<InputId, InputState>> = {};
  export let hiddenCategories: InputCategory[] = [];
  /** If provided, buttons are interactive (clicking calls this). */
  export let onToggle: ((id: InputId) => void) | null = null;

  $: hidden = new Set(hiddenCategories);

  /**
   * Retrieves the state of the specified input.
   * @param {InputId} id - The ID of the input.
   * @returns {InputState | undefined} - The state of the input, or undefined if not found.
   */
  function state(id: InputId): InputState | undefined {
    return inputs[id];
  }

  /**
   * Handles the toggle action for the specified input.
   * @param {InputId} id - The ID of the input to toggle.
   */
  function handle(id: InputId) {
    if (onToggle) onToggle(id);
  }
</script>

<div class="input-display" class:interactive={!!onToggle}>
  {#if !hidden.has('dir')}
  <div class="input-dpad">
    <div class="input-dpad-row">
      <div class="input-dpad-spacer"></div>
      <button class="input-btn" class:pressed={state('up') === 'pressed'} class:hold={state('up') === 'hold'} on:click={() => handle('up')}>↑</button>
      <div class="input-dpad-spacer"></div>
    </div>
    <div class="input-dpad-row">
      <button class="input-btn" class:pressed={state('left') === 'pressed'} class:hold={state('left') === 'hold'} on:click={() => handle('left')}>←</button>
      <div class="input-btn dim"></div>
      <button class="input-btn" class:pressed={state('right') === 'pressed'} class:hold={state('right') === 'hold'} on:click={() => handle('right')}>→</button>
    </div>
    <div class="input-dpad-row">
      <div class="input-dpad-spacer"></div>
      <button class="input-btn" class:pressed={state('down') === 'pressed'} class:hold={state('down') === 'hold'} on:click={() => handle('down')}>↓</button>
      <div class="input-dpad-spacer"></div>
    </div>
  </div>
  {/if}
  <div class="input-actions">
    {#if !hidden.has('ccw')}   <button class="input-btn" class:pressed={state('ccw') === 'pressed'}    class:hold={state('ccw') === 'hold'}    on:click={() => handle('ccw')}    title="CCW">↺</button>   {/if}
    {#if !hidden.has('cw')}    <button class="input-btn" class:pressed={state('cw') === 'pressed'}     class:hold={state('cw') === 'hold'}     on:click={() => handle('cw')}     title="CW">↻</button>    {/if}
    {#if !hidden.has('ccw2')}  <button class="input-btn" class:pressed={state('ccw2') === 'pressed'}   class:hold={state('ccw2') === 'hold'}   on:click={() => handle('ccw2')}   title="2nd CCW">↺²</button>  {/if}
    {#if !hidden.has('rewind')}<button class="input-btn" class:pressed={state('rewind') === 'pressed'} class:hold={state('rewind') === 'hold'} on:click={() => handle('rewind')} title="Rewind">⏮</button>{/if}
    {#if !hidden.has('hold')}  <button class="input-btn" class:pressed={state('hold') === 'pressed'}   class:hold={state('hold') === 'hold'}   on:click={() => handle('hold')}   title="Hold">H</button>    {/if}
    {#if !hidden.has('cw2')}   <button class="input-btn" class:pressed={state('cw2') === 'pressed'}    class:hold={state('cw2') === 'hold'}    on:click={() => handle('cw2')}    title="2nd CW">↻²</button>   {/if}
    {#if !hidden.has('extra')} <button class="input-btn" class:pressed={state('extra') === 'pressed'}  class:hold={state('extra') === 'hold'}  on:click={() => handle('extra')}  title="Extra">{$fishMode ? '🐟' : 'E'}</button>   {/if}
  </div>
</div>

<style>
  .input-display {
    display: flex;
    gap: 6px;
    align-items: flex-start;
    padding: 4px 0 2px;
  }

  .input-display:not(.interactive) { pointer-events: none; }

  .input-dpad {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .input-dpad-row {
    display: flex;
    gap: 2px;
  }

  .input-dpad-spacer {
    width: 22px;
    height: 22px;
  }

  .input-actions {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 2px;
    align-content: start;
  }

  .input-btn {
    width: 22px; height: 22px;
    background: var(--bg-input);
    border: 1px solid var(--brd-1);
    border-radius: var(--r-sm);
    color: var(--txt-dim);
    font-size: 11px;
    cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    padding: 0;
    line-height: 1;
    transition: background 0.1s, color 0.1s, border-color 0.1s;
  }
  .interactive .input-btn:hover:not(.dim) { background: var(--bg-1); border-color: var(--brd-3); color: var(--txt-mid); }

  /* Pressed: elevated highlight */
  .input-btn.pressed {
    background: var(--bg-3);
    border-color: var(--accent-hi);
    color: var(--txt-0);
  }

  /* Hold: amber */
  .input-btn.hold {
    background: var(--input-on-bg);
    border-color: var(--input-on-brd);
    color: var(--input-on-clr);
  }

  .input-btn.dim { cursor: default; opacity: 0.2; pointer-events: none; }
</style>
