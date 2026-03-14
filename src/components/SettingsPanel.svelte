<script lang="ts">
  import { showSettings, defaultRotationSystem, skinId } from '../editor/store';
  import type { SkinId } from '../editor/store';
  import type { RotationSystemId } from '../types/frame';
  import {
    keyMap, isCapturingKey, DEFAULT_KEYMAP,
    ACTION_LABEL, ACTION_GROUPS, formatBinding,
  } from '../editor/keybindings';
  import type { KeyAction, KeyBinding } from '../editor/keybindings';

  const RS_OPTIONS: { id: RotationSystemId; label: string; skin: SkinId }[] = [
    { id: 'ars', label: 'ARS', skin: 'classic' },
    { id: 'srs', label: 'SRS', skin: 'guideline' },
    { id: 'nes', label: 'NES', skin: 'nes' },
  ];

  function onDefaultRsChange(e: Event) {
    const id = (e.target as HTMLSelectElement).value as RotationSystemId;
    defaultRotationSystem.set(id);
    skinId.set(RS_OPTIONS.find(o => o.id === id)!.skin);
  }

  // ── Key bindings ──────────────────────────────────────────────────────────
  let capturingAction: KeyAction | null = null;

  /**
   * Starts capturing a key binding for the specified action.
   * @param {KeyAction} action - The action to capture a key binding for.
   */
  function startCapture(action: KeyAction) {
    capturingAction = action;
    isCapturingKey.set(true);
  }

  /**
   * Cancels the current key binding capture.
   */
  function cancelCapture() {
    capturingAction = null;
    isCapturingKey.set(false);
  }

  /**
   * Handles the keydown event during key binding capture.
   * @param {KeyboardEvent} e - The keydown event.
   */
  function handleCaptureKeydown(e: KeyboardEvent) {
    if (capturingAction === null) return;
    e.preventDefault();
    e.stopPropagation();

    if (e.key === 'Escape') {
      cancelCapture();
      return;
    }
    // Ignore bare modifier keypresses
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;

    const binding: KeyBinding = {
      key: e.key.toLowerCase(),
      ...(e.ctrlKey || e.metaKey ? { ctrl: true }  : {}),
      ...(e.shiftKey              ? { shift: true } : {}),
    };

    keyMap.update(km => ({ ...km, [capturingAction!]: binding }));
    cancelCapture();
  }

  /**
   * Resets all key bindings to their default values.
   */
  function resetAll() {
    keyMap.set({ ...DEFAULT_KEYMAP });
  }

  /**
   * Clears the key binding for the specified action.
   * @param {KeyAction} action - The action to clear the key binding for.
   */
  function clearBinding(action: KeyAction) {
    // We can't leave a binding undefined in the current type, so reset to default
    keyMap.update(km => ({ ...km, [action]: DEFAULT_KEYMAP[action] }));
  }
</script>

<svelte:window on:keydown={handleCaptureKeydown} />

<div class="settings">
  <div class="settings-section">
    <div class="section-label">New diagram defaults</div>
    <div class="setting-row">
      <label for="default-rs">Rotation system</label>
      <select id="default-rs" value={$defaultRotationSystem} on:change={onDefaultRsChange}>
        {#each RS_OPTIONS as opt}
          <option value={opt.id}>{opt.label}</option>
        {/each}
      </select>
    </div>
  </div>

  <div class="kb-header">
      <span class="kb-hint">Click a binding to remap it. Press Esc to cancel.</span>
      <button class="reset-btn" on:click={resetAll}>Reset all</button>
    </div>

    {#each ACTION_GROUPS as group}
      <div class="kb-group">
        <div class="kb-group-label">{group.label}</div>
        {#each group.actions as action}
          {@const binding = $keyMap[action]}
          {@const isCapturing = capturingAction === action}
          <div class="kb-row" class:capturing={isCapturing}>
            <span class="kb-action">{ACTION_LABEL[action]}</span>
            <button
              class="kb-key"
              class:active={isCapturing}
              on:click={() => isCapturing ? cancelCapture() : startCapture(action)}
              title={isCapturing ? 'Press any key (Esc to cancel)' : 'Click to remap'}
            >
              {#if isCapturing}
                <span class="capture-prompt">press key…</span>
              {:else}
                {formatBinding(binding)}
              {/if}
            </button>
          </div>
        {/each}
      </div>
    {/each}

  <button class="close-btn" on:click={() => { showSettings.set(false); cancelCapture(); }}>Close</button>
</div>

<style>
  .settings { display: flex; flex-direction: column; gap: 14px; min-width: 340px; }

  /* New diagram defaults */
  .settings-section { display: flex; flex-direction: column; gap: 6px; }
  .section-label {
    font-size: 10px; font-weight: 700; letter-spacing: 0.1em;
    color: var(--brd-2); text-transform: uppercase;
  }
  .setting-row {
    display: flex; align-items: center; justify-content: space-between;
    padding: 3px 6px; border-radius: var(--r-sm);
  }
  .setting-row label { font-size: 12px; color: var(--purple-2); }
  .setting-row select {
    background: var(--bg-2); border: 1px solid var(--brd-2);
    border-radius: var(--r-sm); color: var(--txt-0);
    font-size: 12px; padding: 2px 6px; cursor: pointer;
  }
  .setting-row select:hover { border-color: var(--purple-brd-hi); }

  /* Key bindings */
  .kb-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .kb-hint { font-size: 11px; color: var(--purple-dim); }
  .reset-btn {
    background: var(--bg-1); border: 1px solid var(--purple-brd); border-radius: var(--r-sm);
    color: var(--purple-mid); cursor: pointer; font-size: 11px; padding: 2px 8px;
  }
  .reset-btn:hover { color: var(--txt-0); border-color: var(--purple-mid); }

  .kb-group { display: flex; flex-direction: column; gap: 2px; }
  .kb-group-label {
    font-size: 10px; font-weight: 700; letter-spacing: 0.1em;
    color: var(--brd-2); text-transform: uppercase; margin-bottom: 2px; margin-top: 4px;
  }
  .kb-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 3px 6px;
    border-radius: var(--r-sm);
    border: 1px solid transparent;
    transition: background 0.1s;
  }
  .kb-row:hover     { background: var(--bg-input); }
  .kb-row.capturing { background: var(--ok-bg-sub); border-color: var(--ok-brd); }
  .kb-action { font-size: 12px; color: var(--purple-2); }
  .kb-key {
    background: var(--bg-2);
    border: 1px solid var(--brd-2);
    border-radius: var(--r-sm);
    color: var(--txt-0);
    cursor: pointer;
    font-size: 11px;
    font-family: monospace;
    min-width: 72px;
    padding: 2px 8px;
    text-align: center;
    transition: background 0.1s, border-color 0.1s;
  }
  .kb-key:hover  { background: var(--bg-3); border-color: var(--purple-brd-hi); }
  .kb-key.active { background: var(--ok-bg-sub); border-color: var(--ok); color: var(--ok-hi); }
  .capture-prompt { font-style: italic; color: var(--ok); font-family: sans-serif; font-size: 11px; }

  /* Close button */
  .close-btn {
    align-self: flex-end;
    background: var(--bg-2); border: 1px solid var(--brd-2); border-radius: var(--r);
    color: var(--purple-hi); cursor: pointer; padding: 5px 14px; margin-top: 4px;
  }
  .close-btn:hover { background: var(--bg-3); }
</style>
