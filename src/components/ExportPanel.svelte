<script lang="ts">
  import { get } from 'svelte/store';
  import { diagram, currentFrame, currentFrameIndex, showExport, renderConfig, getFrameState } from '../editor/store';
  import { getRotationSystem } from '../rotation/index';
  import { encodeDiagram, decodeDiagram, diagramToUrlHash } from '../export/url-codec';
  import { downloadJSON, loadJSONFile } from '../export/json-export';
  import { downloadPNG } from '../export/png-export';
  import { downloadSVG } from '../export/svg-export';
  import { exportGIF, downloadGIF } from '../export/gif-export';
  import { frameToWikiMarkup } from '../export/wiki-export';
  import { importWikiMarkup } from '../export/wiki-import';
  import { clearHistory, checkpoint } from '../editor/history';
  import { importFumen } from '../export/fumen-import';
  import { exportFumen } from '../export/fumen-export';
  import type { RotationSystemId } from '../types/frame';

  let gifProgress = 0;
  let gifExporting = false;
  let copyStatus = '';
  let playerCopyStatus = '';
  let wikiCopyStatus = '';
  let wikiImportText = '';
  let wikiImportError = '';

  let fumenText = '';
  let fumenError = '';
  let fumenRs: RotationSystemId = get(diagram).rotationSystem;
  let fumenExportResult = '';
  let fumenExportCopyStatus = '';
  let fumenExportError = '';

  function doFumenExport() {
    fumenExportError = '';
    try {
      const d = get(diagram);
      fumenExportResult = exportFumen(d.frames, d.rotationSystem);
    } catch (e) {
      fumenExportError = `Export failed: ${e}`;
    }
  }

  async function copyFumenExport() {
    await navigator.clipboard.writeText(fumenExportResult);
    fumenExportCopyStatus = 'Copied!';
    setTimeout(() => (fumenExportCopyStatus = ''), 2000);
  }

  function doFumenImport() {
    fumenError = '';
    const result = importFumen(fumenText, fumenRs);
    if (result.error) {
      fumenError = result.error;
      return;
    }
    diagram.set({ ...get(diagram), frames: result.frames, rotationSystem: fumenRs });
    currentFrameIndex.set(0);
    clearHistory();
    showExport.set(false);
  }

  function getPlayerUrl(): string {
    const hash = diagramToUrlHash(get(diagram));
    // Resolve player.html relative to current page
    const loc = window.location;
    const dir = loc.pathname.endsWith('/')
      ? loc.pathname
      : loc.pathname.substring(0, loc.pathname.lastIndexOf('/') + 1);
    return loc.origin + dir + 'player.html' + hash;
  }

  function openPlayer() {
    window.open(getPlayerUrl(), '_blank', 'noopener');
  }

  async function copyIframeSnippet() {
    const src = getPlayerUrl();
    const snippet = `<iframe src="${src}" width="420" height="590" style="border:none;background:#0d0d1a" allowfullscreen></iframe>`;
    await navigator.clipboard.writeText(snippet);
    playerCopyStatus = 'Copied!';
    setTimeout(() => (playerCopyStatus = ''), 2000);
  }

  async function copyURL() {
    const d = get(diagram);
    const hash = diagramToUrlHash(d);
    // Update URL without navigation
    history.replaceState(null, '', hash);
    await navigator.clipboard.writeText(window.location.href);
    copyStatus = 'Copied!';
    setTimeout(() => (copyStatus = ''), 2000);
  }

  function doWikiImport() {
    wikiImportError = '';
    const result = importWikiMarkup(wikiImportText);
    if (result.error) { wikiImportError = result.error; return; }
    checkpoint();
    const { d, idx } = getFrameState();
    const frames = d.frames.map((f, i) => i === idx ? { ...f, board: result.board } : f);
    diagram.set({ ...d, frames });
    wikiImportText = '';
  }

  async function copyWikiMarkup() {
    const frame = get(currentFrame);
    const rotSys = getRotationSystem(get(diagram).rotationSystem);
    const markup = frameToWikiMarkup(frame, rotSys);
    await navigator.clipboard.writeText(markup);
    wikiCopyStatus = 'Copied!';
    setTimeout(() => (wikiCopyStatus = ''), 2000);
  }

  async function doGIFExport() {
    gifExporting = true;
    gifProgress = 0;
    try {
      const blob = await exportGIF(get(diagram), {
        skin: get(renderConfig).skin,
        onProgress: r => (gifProgress = r),
      });
      downloadGIF(blob);
    } finally {
      gifExporting = false;
      gifProgress = 0;
    }
  }

  function doPNGExport() {
    const frame = get(currentFrame);
    const rotSys = getRotationSystem(get(diagram).rotationSystem);
    downloadPNG(frame, rotSys, get(renderConfig));
  }

  function doSVGExport() {
    const frame = get(currentFrame);
    const config = get(renderConfig);
    const rotSys = getRotationSystem(get(diagram).rotationSystem);
    downloadSVG(frame, rotSys, config.cellSize, config.skin);
  }

  function doJSONExport() {
    downloadJSON(get(diagram));
  }

  async function doJSONImport() {
    try {
      const d = await loadJSONFile();
      diagram.set(d);
      clearHistory();
    } catch (e) {
      alert('Failed to load JSON: ' + String(e));
    }
  }

  function doLoadURL() {
    const url = prompt('Paste a Tedige URL or v1@ code:');
    if (!url) return;
    let code = url.trim();
    // Extract from full URL
    const hashIdx = code.indexOf('#');
    if (hashIdx !== -1) code = code.slice(hashIdx + 1);
    try {
      const d = decodeDiagram(code);
      diagram.set(d);
      clearHistory();
    } catch (e) {
      alert('Failed to decode: ' + String(e));
    }
  }
</script>

<div class="export-panel">

  <div class="group-head">Import</div>

  <section>
    <h4>Load diagram</h4>
    <div class="btn-group">
      <button class="btn" on:click={doLoadURL}>From URL / code</button>
      <button class="btn" on:click={doJSONImport}>From JSON file</button>
    </div>
  </section>

  <section>
    <h4>Fumen</h4>
    <div class="fumen-import">
      <textarea
        class="fumen-input"
        rows="3"
        placeholder="Paste fumen v115@…"
        bind:value={fumenText}
      ></textarea>
      <div class="fumen-controls">
        <div class="rs-buttons">
          <button class="rs-btn" class:active={fumenRs === 'srs'} on:click={() => (fumenRs = 'srs')}>SRS</button>
          <button class="rs-btn" class:active={fumenRs === 'ars'} on:click={() => (fumenRs = 'ars')}>ARS</button>
        </div>
        <button class="btn" on:click={doFumenImport} disabled={!fumenText.trim()}>Import fumen</button>
      </div>
      {#if fumenError}
        <div class="fumen-error">{fumenError}</div>
      {/if}
    </div>
  </section>

  <section>
    <h4>Tetris Wiki</h4>
    <div class="fumen-import">
      <textarea
        class="fumen-input"
        rows="3"
        placeholder="Paste <playfield>…</playfield> to import into current frame"
        bind:value={wikiImportText}
      ></textarea>
      <button class="btn" on:click={doWikiImport} disabled={!wikiImportText.trim()}>
        Import to current frame
      </button>
      {#if wikiImportError}
        <div class="fumen-error">{wikiImportError}</div>
      {/if}
    </div>
  </section>

  <div class="group-divider"></div>
  <div class="group-head">Export</div>

  <section>
    <h4>Share</h4>
    <button class="btn" on:click={copyURL}>
      {copyStatus || 'Copy URL'}
    </button>
  </section>

  <section>
    <h4>Player</h4>
    <button class="btn btn-player" on:click={openPlayer}>Open Player ↗</button>
    <button class="btn" on:click={copyIframeSnippet}>
      {playerCopyStatus || 'Copy iframe snippet'}
    </button>
  </section>

  <section>
    <h4>Download</h4>
    <div class="btn-group">
      <button class="btn" on:click={doJSONExport}>JSON</button>
      <button class="btn" on:click={doPNGExport}>PNG</button>
      <button class="btn" on:click={doSVGExport}>SVG</button>
      <button class="btn" on:click={doGIFExport} disabled={gifExporting}>
        {gifExporting ? `GIF ${Math.round(gifProgress * 100)}%` : 'GIF'}
      </button>
    </div>
    {#if gifExporting}
      <div class="progress-bar">
        <div class="progress-fill" style="width: {gifProgress * 100}%"></div>
      </div>
    {/if}
  </section>

  <section>
    <h4>Fumen</h4>
    <button class="btn" on:click={doFumenExport}>Export as Fumen</button>
    {#if fumenExportResult}
      <textarea class="fumen-input" rows="3" readonly value={fumenExportResult}></textarea>
      <button class="btn" on:click={copyFumenExport}>{fumenExportCopyStatus || 'Copy fumen string'}</button>
    {/if}
    {#if fumenExportError}
      <div class="fumen-error">{fumenExportError}</div>
    {/if}
  </section>

  <section>
    <h4>Tetris Wiki</h4>
    <button class="btn" on:click={copyWikiMarkup}>
      {wikiCopyStatus || 'Copy <playfield> markup'}
    </button>
    <div class="wiki-note">Exports the current frame as tetris.wiki &lt;playfield&gt; markup. Includes the active piece and ghost.</div>
  </section>

  <button class="close-btn" on:click={() => showExport.set(false)}>Close</button>
</div>

<style>
  .export-panel { display: flex; flex-direction: column; gap: 16px; }
  h4 { font-size: 12px; color: var(--txt-dim); letter-spacing: 0.08em; margin-bottom: 6px; }
  section { display: flex; flex-direction: column; gap: 6px; }

  .group-head {
    font-size: 11px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase;
    color: var(--txt-dim); padding: 2px 0;
  }
  .group-divider {
    border-top: 1px solid var(--brd-1); margin-top: 4px;
  }

  .btn-group { display: flex; flex-wrap: wrap; gap: 6px; }

  .btn {
    background: var(--bg-2); border: 1px solid var(--brd-2); border-radius: var(--r);
    color: var(--txt-0); font-size: 13px; cursor: pointer; padding: 5px 12px;
    transition: background 0.1s;
  }
  .btn:hover:not(:disabled) { background: var(--bg-3); }
  .btn:disabled { opacity: 0.5; cursor: default; }
  .btn-player { background: var(--blue-bg); border-color: var(--blue-brd); color: var(--indigo-text); }
  .btn-player:hover { background: var(--blue-bg-hi); }

  .progress-bar {
    height: 4px; background: var(--brd-1); border-radius: 2px; overflow: hidden;
  }
  .progress-fill { height: 100%; background: var(--accent); transition: width 0.2s; }

  .fumen-import { display: flex; flex-direction: column; gap: 6px; }

  .fumen-input {
    width: 100%; box-sizing: border-box;
    background: var(--bg-input); border: 1px solid var(--brd-1); border-radius: var(--r);
    color: var(--txt-0); font-size: 11px; font-family: monospace;
    padding: 5px 7px; outline: none; resize: vertical;
  }
  .fumen-input::placeholder { color: var(--brd-2); }
  .fumen-input:focus { border-color: var(--txt-dim); }

  .fumen-controls { display: flex; align-items: center; gap: 8px; }

  .rs-buttons { display: flex; gap: 3px; }

  .rs-btn {
    padding: 3px 8px; background: var(--bg-1); border: 1px solid var(--brd-1);
    border-radius: var(--r-sm); color: var(--txt-dim); cursor: pointer; font-size: 11px;
    font-weight: 600;
  }
  .rs-btn:hover { background: var(--bg-2); border-color: var(--brd-3); color: var(--txt-1); }
  .rs-btn.active { background: var(--bg-3); border-color: var(--accent); color: var(--txt-0); }

  .fumen-error {
    background: var(--err-bg); border: 1px solid var(--err-brd); border-radius: var(--r);
    color: var(--err-txt); font-size: 11px; padding: 5px 7px;
  }

  .wiki-note {
    font-size: 10px;
    color: var(--txt-dim);
    line-height: 1.5;
  }

  .close-btn {
    align-self: flex-end;
    background: var(--bg-1); border: 1px solid var(--brd-2); border-radius: var(--r);
    color: var(--txt-2); cursor: pointer; padding: 4px 12px; font-size: 12px;
  }
  .close-btn:hover { background: var(--bg-2); }
</style>
