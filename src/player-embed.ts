import { mount, unmount } from 'svelte';
import PlayerView from './player/PlayerView.svelte';
import { decodeDiagram } from './export/url-codec';
import { DEFAULT_RENDER_CONFIG } from './renderer/board-renderer';
import type { RenderConfig } from './renderer/board-renderer';
import { CLASSIC_SKIN, GUIDELINE_SKIN } from './renderer/colors';
import { BOARD_COLS } from './types/board';

/**
 * Registers the <tedige-player> custom element.
 * Safe to call multiple times (no-op if already registered).
 *
 * Usage on any web page after including the script:
 *   <tedige-player data="v4@..." cell-size="28" skin="classic" autoplay></tedige-player>
 *
 * Attributes:
 *   data       — encoded diagram string (v4@…), required
 *   cell-size  — board cell size in px; defaults to auto-size based on element width
 *   skin       — "classic" | "guideline"; defaults to matching the diagram's rotation system
 *   autoplay   — presence flag; starts animation immediately
 */
export function registerPlayerEmbed(): void {
  if (customElements.get('tedige-player')) return;

  class TedigePlayerElement extends HTMLElement {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private _app: any = null;
    private _host: HTMLDivElement | null = null;

    static observedAttributes = ['data', 'cell-size', 'skin', 'autoplay'];

    connectedCallback()  { this._mount(); }
    disconnectedCallback() { this._destroy(); }

    attributeChangedCallback() {
      if (this._app) { this._destroy(); this._mount(); }
    }

    private _mount() {
      const encoded = this.getAttribute('data') ?? '';
      if (!encoded) return;

      let diagram;
      try {
        diagram = decodeDiagram(encoded);
      } catch {
        this.textContent = '[tedige-player: invalid diagram data]';
        return;
      }

      const rawCs  = parseInt(this.getAttribute('cell-size') ?? '0') || 0;
      const cellSize     = rawCs > 0 ? rawCs : this._autoCs();

      const skinAttr = this.getAttribute('skin')
        ?? (diagram.rotationSystem === 'ars' ? 'classic' : 'guideline');
      const skin = skinAttr === 'guideline' ? GUIDELINE_SKIN : CLASSIC_SKIN;

      const autoplay = this.hasAttribute('autoplay');

      const config: RenderConfig = { ...DEFAULT_RENDER_CONFIG, cellSize: cellSize, skin };

      this._host = document.createElement('div');
      this.innerHTML = '';
      this.appendChild(this._host);

      this._app = mount(PlayerView, {
        target: this._host,
        props: { diagram, config, autoplay },
      });
    }

    private _destroy() {
      if (this._app) { unmount(this._app); this._app = null; }
      if (this._host) { this._host.remove(); this._host = null; }
    }

    /** Compute a cell size that fits the board within this element's dimensions. */
    private _autoCs(): number {
      const elW = this.clientWidth  || 200;
      const elH = this.clientHeight;  // 0 if not explicitly sized

      // Height constraint (subtract ~60px for seekbar + controls)
      const csH = elH > 0 ? Math.floor((elH - 60) / BOARD_ROWS) : 40;

      // Try full mode (board + side panels: +5.2 col-equivalents + 16px gap)
      const csW_full    = Math.floor((elW - 16) / (BOARD_COLS + 5.2));
      // Compact mode (board only)
      const csW_compact = Math.floor(elW / BOARD_COLS);

      let cellSize: number;
      if (Math.min(csH, csW_full) >= 24) {
        cellSize = Math.min(csH, csW_full);
      } else {
        cellSize = Math.min(csH, csW_compact);
      }
      return Math.max(10, Math.min(40, cellSize));
    }
  }

  customElements.define('tedige-player', TedigePlayerElement);
}
