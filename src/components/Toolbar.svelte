<script lang="ts">
  import { activeTool, canUndo, canRedo } from '../editor/store';
  import type { ToolMode } from '../editor/store';
  import { undo, redo } from '../editor/history';
  import { selectTool } from '../editor/actions';

  const mainTools: { id: ToolMode; label: string; icon: string; key: string }[] = [
    { id: 'draw',         label: 'Draw',         icon: '✏️', key: 'D' },
    { id: 'erase',        label: 'Erase',        icon: '⬜', key: 'E' },
    { id: 'fill',         label: 'Fill',         icon: '🪣', key: 'F' },
    { id: 'callout',      label: 'Callout',      icon: '💬', key: 'C' },
    { id: 'overlay',      label: 'Overlay',      icon: '⬡',  key: 'O' },
  ];

</script>

<div class="toolbar">
  <div class="section-label">EDIT</div>
  <div class="history-row">
    <button class="hist-btn" on:click={undo} disabled={!$canUndo} title="Undo (Ctrl+Z)">
      ↩ <span class="key">Ctrl+Z</span>
    </button>
    <button class="hist-btn" on:click={redo} disabled={!$canRedo} title="Redo (Ctrl+Y)">
      ↪ <span class="key">Ctrl+Y</span>
    </button>
  </div>

  <div class="section-label" style="margin-top: 8px;">TOOL</div>
  {#each mainTools as tool}
    <button
      class="tool-btn"
      class:active={$activeTool === tool.id}
      on:click={() => selectTool(tool.id)}
      title="{tool.label} ({tool.key})"
    >
      <span class="icon">{tool.icon}</span>
      <span class="name">{tool.label}</span>
      <span class="key">{tool.key}</span>
    </button>
  {/each}
</div>

<style>
  .toolbar {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .section-label {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.1em;
    color: var(--txt-dim);
    margin-bottom: 4px;
  }

  .tool-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    background: var(--bg-1);
    border: 1px solid var(--brd-1);
    border-radius: var(--r);
    color: var(--txt-1);
    cursor: pointer;
    padding: 5px 8px;
    font-size: 12px;
    transition: background 0.1s, border-color 0.1s;
    text-align: left;
    width: 100%;
  }
  .tool-btn:hover:not(:disabled) { background: var(--bg-2); border-color: var(--brd-3); }
  .tool-btn.active { background: var(--bg-3); border-color: var(--accent); color: var(--txt-0); }
  .tool-btn:disabled { opacity: 0.35; cursor: default; }

  .history-row {
    display: flex;
    gap: 2px;
  }

  .hist-btn {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    background: var(--bg-1);
    border: 1px solid var(--brd-1);
    border-radius: var(--r);
    color: var(--txt-1);
    cursor: pointer;
    padding: 4px 4px;
    font-size: 13px;
    transition: background 0.1s, border-color 0.1s;
  }
  .hist-btn:hover:not(:disabled) { background: var(--bg-2); border-color: var(--brd-3); }
  .hist-btn:disabled { opacity: 0.35; cursor: default; }

  .icon { width: 16px; text-align: center; }
  .name { flex: 1; }
  .key {
    font-size: 10px;
    color: var(--txt-dim);
    font-family: monospace;
    background: var(--bg-input);
    padding: 1px 3px;
    border-radius: 2px;
  }
</style>
