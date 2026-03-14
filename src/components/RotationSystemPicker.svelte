<script lang="ts">
  import { get } from 'svelte/store';
  import { diagram, skinId } from '../editor/store';
  import { checkpoint } from '../editor/history';
  import { changeRotationSystem } from '../engine/frame-ops';
  import { getRotationSystem } from '../rotation/index';
  import type { RotationSystemId } from '../types/frame';
  import type { SkinId } from '../editor/store';

  const OPTIONS: { id: RotationSystemId; label: string; skin: SkinId }[] = [
    { id: 'ars', label: 'ARS', skin: 'classic'   },
    { id: 'srs', label: 'SRS', skin: 'guideline' },
    { id: 'nes', label: 'NES', skin: 'nes'        },
  ];

  function onChange(e: Event) {
    const id = (e.target as HTMLSelectElement).value as RotationSystemId;
    checkpoint();
    const d = get(diagram);
    const rotSys = getRotationSystem(id);
    diagram.set(changeRotationSystem(d, id, rotSys));
    skinId.set(OPTIONS.find(o => o.id === id)!.skin);
  }
</script>

<div class="picker">
  <label for="rot-sys" class="label">Rotation:</label>
  <select id="rot-sys" value={$diagram.rotationSystem} on:change={onChange}>
    {#each OPTIONS as opt}
      <option value={opt.id}>{opt.label}</option>
    {/each}
  </select>
</div>

<style>
  .picker { display: flex; align-items: center; gap: 6px; }
  .label { font-size: 12px; color: var(--txt-2); }
  select {
    background: var(--bg-2); border: 1px solid var(--brd-2); border-radius: var(--r);
    color: var(--txt-0); font-size: 13px; padding: 2px 6px; cursor: pointer;
  }
</style>
