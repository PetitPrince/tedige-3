<script lang="ts">
  import { showShortcuts } from '../editor/store';

  type ShortcutEntry = { key: string; action: string; section?: boolean };

  const shortcuts: ShortcutEntry[] = [
    { key: '← / →', action: 'Previous / Next frame' },
    { key: 'Space', action: 'Play / Pause animation' },
    { key: 'Enter', action: 'Simulate lock (advance frame)' },
    { key: 'N', action: 'Insert new frame' },
    { key: 'Shift+Del', action: 'Delete current frame' },
    { key: 'Ctrl+Z / Ctrl+Y', action: 'Undo / Redo' },
    { key: 'D', action: 'Draw tool' },
    { key: 'E', action: 'Erase tool' },
    { key: 'F', action: 'Fill tool' },
    { key: 'M', action: 'Move piece tool' },
    { key: 'C', action: 'Callout tool' },
    { key: 'O', action: 'Overlay tool' },
    { key: '1–7', action: 'Select piece colour (I/O/T/S/Z/J/L)' },
    { key: '8', action: 'Garbage/grey colour' },
    { key: 'Z / X', action: 'Rotate active piece CCW / CW' },
    { key: 'Shift+← / →', action: 'Move active piece left / right' },
    { key: 'Shift+↓', action: 'Soft drop active piece' },
    { key: 'Shift+↑', action: 'Sonic drop (ARS) / Hard drop (SRS)' },
    { key: 'Shift+Enter', action: 'Lock active piece (flash + settle)' },
    { key: '.', action: 'Step: drop piece 1 row (appends frame)' },
    { key: 'H', action: 'Hold active piece' },
    { key: 'T', action: 'Cycle active piece type (right-click button for previous)' },
    { key: '— Record mode —', action: 'Active when "Record moves" is checked', section: true },
    { key: '← → ↓ ↑', action: 'Move active piece (appends frame)' },
    { key: 'Space', action: 'Hard / sonic drop (appends frame)' },
    { key: 'Z / X', action: 'Rotate CCW / CW (appends frame)' },
    { key: 'C', action: 'Hold piece (appends frame)' },
    { key: 'Esc', action: 'Exit record mode' },
    { key: '?', action: 'Toggle this shortcut list' },
    { key: 'Esc', action: 'Close panels' },
  ];
</script>

<div class="backdrop" on:click={() => showShortcuts.set(false)} role="presentation">
  <div class="panel" on:click|stopPropagation role="presentation">
    <h3>Keyboard Shortcuts</h3>
    <table>
      <tbody>
        {#each shortcuts as s}
          {#if s.section}
            <tr class="section-row">
              <td class="section-label" colspan="2">{s.key} <span class="section-desc">{s.action}</span></td>
            </tr>
          {:else}
            <tr>
              <td class="key"><kbd>{s.key}</kbd></td>
              <td class="action">{s.action}</td>
            </tr>
          {/if}
        {/each}
      </tbody>
    </table>
    <button on:click={() => showShortcuts.set(false)}>Close</button>
  </div>
</div>

<style>
  .backdrop {
    position: fixed; inset: 0; background: rgba(0,0,0,0.7);
    display: flex; align-items: center; justify-content: center; z-index: 200;
  }
  .panel {
    background: var(--bg-1); border: 1px solid var(--brd-2); border-radius: var(--r-lg);
    padding: 24px; max-height: 80vh; overflow-y: auto; min-width: 380px;
  }
  h3 { color: var(--txt-head); margin-bottom: 16px; }
  table { width: 100%; border-collapse: collapse; }
  tr:hover td { background: var(--bg-2); }
  td { padding: 5px 8px; font-size: 13px; border-bottom: 1px solid var(--brd-1); }
  .key { white-space: nowrap; }
  kbd {
    background: var(--bg-2); border: 1px solid var(--brd-3); border-radius: var(--r-sm);
    padding: 1px 5px; font-size: 12px; color: var(--txt-0); font-family: monospace;
  }
  .action { color: var(--txt-1); }
  .section-row td { background: var(--bg-2); border-top: 2px solid var(--brd-2); padding: 6px 8px; }
  .section-label { font-size: 11px; font-weight: 700; color: var(--txt-dim); letter-spacing: 0.06em; }
  .section-desc { font-weight: 400; color: var(--txt-2); margin-left: 6px; }
  button {
    margin-top: 16px; background: var(--bg-2); border: 1px solid var(--brd-2);
    border-radius: var(--r); color: var(--purple-hi); cursor: pointer; padding: 5px 14px;
  }
  button:hover { background: var(--bg-3); }
</style>
