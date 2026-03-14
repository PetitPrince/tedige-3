import { writable, derived, get } from 'svelte/store';
import type { Diagram, Frame, RotationSystemId } from '../types/frame';
import type { CellType } from '../types/board';
import { emptyDiagram } from '../types/frame';
import { CellType as CT } from '../types/board';
import type { RenderConfig } from '../renderer/board-renderer';
import { DEFAULT_RENDER_CONFIG } from '../renderer/board-renderer';
import { GUIDELINE_SKIN, CLASSIC_SKIN, NES_SKIN } from '../renderer/colors';
import type { PieceType, Rotation } from '../types/piece';
import { encodeDiagram } from '../export/url-codec';

export type ToolMode = 'draw' | 'erase' | 'fill' | 'callout' | 'overlay';
export type SkinId = 'guideline' | 'classic' | 'nes';
export type ThemeMode = 'dark' | 'light' | 'os';

const RS_SKIN: Record<RotationSystemId, SkinId> = { ars: 'classic', srs: 'guideline', nes: 'nes' };

// ── Default rotation system (persisted) ─────────────────────────────────────
const _storedDefaultRS = (
  typeof localStorage !== 'undefined' ? localStorage.getItem('tedige-default-rs') : null
) as RotationSystemId | null;
export const defaultRotationSystem = writable<RotationSystemId>(_storedDefaultRS ?? 'ars');
defaultRotationSystem.subscribe(v => {
  if (typeof localStorage !== 'undefined') localStorage.setItem('tedige-default-rs', v);
});

// ── Diagram (the document) ──────────────────────────────────────────────────
const _initDiagram = emptyDiagram();
_initDiagram.rotationSystem = _storedDefaultRS ?? 'ars';
export const diagram = writable<Diagram>(_initDiagram);

// ── Auto-save to localStorage ────────────────────────────────────────────────
let _saveTimer: ReturnType<typeof setTimeout> | null = null;
diagram.subscribe(d => {
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    try { localStorage.setItem('tedige-diagram', encodeDiagram(d)); } catch {}
  }, 500);
});

export function clearSavedDiagram() {
  if (typeof localStorage !== 'undefined') localStorage.removeItem('tedige-diagram');
}

// ── Frame order ──────────────────────────────────────────────────────────────
const _storedFrameOrder = typeof localStorage !== 'undefined' ? localStorage.getItem('tedige-frame-order-desc') : null;
export const frameOrderDesc = writable<boolean>(_storedFrameOrder === 'true');
frameOrderDesc.subscribe(v => {
  if (typeof localStorage !== 'undefined') localStorage.setItem('tedige-frame-order-desc', String(v));
});

// ── Cursor ──────────────────────────────────────────────────────────────────
export const currentFrameIndex = writable<number>(0);

export const currentFrame = derived(
  [diagram, currentFrameIndex],
  ([$d, $i]): Frame => $d.frames[Math.min($i, $d.frames.length - 1)],
);

// ── Tool state ───────────────────────────────────────────────────────────────
export const activeTool = writable<ToolMode>('draw');
export const drawCellType = writable<CellType>(CT.Garbage);
// Tracks which palette section was last clicked — drives cycle-type shortcut direction.
export const lastPaletteSection = writable<'cell' | 'piece'>('cell');

// ── Callout editing ───────────────────────────────────────────────────────────
export const editingCallout = writable<{ col: number; row: number } | null>(null);
currentFrameIndex.subscribe(() => editingCallout.set(null));

// ── Piece placement ───────────────────────────────────────────────────────────
// When non-null, clicking the board places this piece type instead of drawing cells.
export const selectedPieceType = writable<PieceType | null>(null);
// Rotation state to use when placing a piece (0=spawn, 1=CW, 2=180°, 3=CCW).
export const selectedRotation = writable<Rotation>(0);
// Whether placement/movement/rotation respects board collisions.
export const pieceCollision = writable<boolean>(true);

// ── Playback ─────────────────────────────────────────────────────────────────
export const isPlaying = writable<boolean>(false);

// ── Overlay tool ──────────────────────────────────────────────────────────────
export const overlayColor = writable<string>('#ffdd44');
export const overlayEmoji = writable<string | null>(null);
export const overlayBlockType = writable<number | null>(null); // CellType | null
export const showBoundingBox = writable<boolean>(false);

// ── Easter eggs ───────────────────────────────────────────────────────────────
export const fishMode = writable<boolean>(false);

// ── Record mode ───────────────────────────────────────────────────────────────
export const isRecordMode = writable<boolean>(false);

// ── UI panels ─────────────────────────────────────────────────────────────────
export const showSettings  = writable<boolean>(false);
export const showExport    = writable<boolean>(false);
export const showShortcuts = writable<boolean>(false);
export const showCapture   = writable<boolean>(false);

// ── Undo/redo ─────────────────────────────────────────────────────────────────
export const canUndo = writable<boolean>(false);
export const canRedo = writable<boolean>(false);

// ── Theme ──────────────────────────────────────────────────────────────────────
const _storedTheme = (typeof localStorage !== 'undefined' ? localStorage.getItem('tedige-theme') : null) as ThemeMode | null;
export const themeMode = writable<ThemeMode>(_storedTheme ?? 'dark');
themeMode.subscribe(v => { if (typeof localStorage !== 'undefined') localStorage.setItem('tedige-theme', v); });

// ── Next queue layout ─────────────────────────────────────────────────────────
export type NextQueueLayout = 'horizontal' | 'vertical';
const _storedNQL = (typeof localStorage !== 'undefined' ? localStorage.getItem('tedige-nq-layout') : null) as NextQueueLayout | null;
export const nextQueueLayout = writable<NextQueueLayout>(_storedNQL ?? 'horizontal');
nextQueueLayout.subscribe(v => { if (typeof localStorage !== 'undefined') localStorage.setItem('tedige-nq-layout', v); });

// ── Render config ─────────────────────────────────────────────────────────────
// Default skin matches the default rotation system
export const skinId = writable<SkinId>(RS_SKIN[_storedDefaultRS ?? 'ars']);
export const renderConfig = writable<RenderConfig>(DEFAULT_RENDER_CONFIG);

skinId.subscribe(id => {
  renderConfig.update(c => ({
    ...c,
    skin: id === 'classic' ? CLASSIC_SKIN : id === 'nes' ? NES_SKIN : GUIDELINE_SKIN,
  }));
});

// ── Helpers ───────────────────────────────────────────────────────────────────
export function getFrameState(): { d: Diagram; idx: number; frame: Frame } {
  const d = get(diagram);
  const idx = get(currentFrameIndex);
  return { d, idx, frame: d.frames[idx] };
}
