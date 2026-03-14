import { writable } from 'svelte/store';

// ── Action registry ────────────────────────────────────────────────────────────

export type KeyAction =
  | 'rotate-cw' | 'rotate-ccw'
  | 'frame-prev' | 'frame-next' | 'frame-insert' | 'frame-delete' | 'frame-advance'
  | 'play-pause'
  | 'tool-draw' | 'tool-erase' | 'tool-fill'
  | 'undo' | 'redo'
  | 'piece-lock' | 'piece-step' | 'piece-hold' | 'piece-cycle-type' | 'piece-cycle-type-prev';

export interface KeyBinding {
  key: string;    // lowercase e.key value (e.g. "z", "arrowleft", " ")
  ctrl?: boolean; // true = Ctrl (Win/Linux) or Cmd (Mac) required
  shift?: boolean;
}

export type KeyMap = Record<KeyAction, KeyBinding>;

// ── Defaults ──────────────────────────────────────────────────────────────────

export const DEFAULT_KEYMAP: KeyMap = {
  'rotate-cw':        { key: 'x' },
  'rotate-ccw':       { key: 'z' },
  'frame-prev':       { key: 'arrowleft' },
  'frame-next':       { key: 'arrowright' },
  'frame-insert':     { key: 'n' },
  'frame-delete':     { key: 'delete', shift: true },
  'frame-advance':    { key: 'enter' },
  'play-pause':       { key: ' ' },
  'tool-draw':        { key: 'd' },
  'tool-erase':       { key: 'e' },
  'tool-fill':        { key: 'f' },
  'undo':             { key: 'z', ctrl: true },
  'redo':             { key: 'y', ctrl: true },
  'piece-lock':       { key: 'enter', shift: true },
  'piece-step':       { key: '.' },
  'piece-hold':       { key: 'h' },
  'piece-cycle-type':      { key: 't' },
  'piece-cycle-type-prev': { key: 't', shift: true },
};

// ── Metadata ──────────────────────────────────────────────────────────────────

export const ACTION_LABEL: Record<KeyAction, string> = {
  'rotate-cw':        'Rotate CW',
  'rotate-ccw':       'Rotate CCW',
  'frame-prev':       'Previous frame',
  'frame-next':       'Next frame',
  'frame-insert':     'Insert frame',
  'frame-delete':     'Delete frame',
  'frame-advance':    'Advance frame (lock)',
  'play-pause':       'Play / Pause',
  'tool-draw':        'Draw tool',
  'tool-erase':       'Erase tool',
  'tool-fill':        'Fill tool',
  'undo':             'Undo',
  'redo':             'Redo',
  'piece-lock':       'Lock piece',
  'piece-step':       'Step piece (soft drop)',
  'piece-hold':       'Hold piece',
  'piece-cycle-type':      'Cycle piece type / cell type',
  'piece-cycle-type-prev': 'Cycle piece type / cell type (reverse)',
};

export const ACTION_GROUPS: { label: string; actions: KeyAction[] }[] = [
  { label: 'Rotation',  actions: ['rotate-cw', 'rotate-ccw'] },
  { label: 'Frames',    actions: ['frame-prev', 'frame-next', 'frame-insert', 'frame-delete', 'frame-advance'] },
  { label: 'Playback',  actions: ['play-pause'] },
  { label: 'Tools',     actions: ['tool-draw', 'tool-erase', 'tool-fill'] },
  { label: 'Edit',      actions: ['undo', 'redo'] },
  { label: 'Piece',     actions: ['piece-lock', 'piece-step', 'piece-hold', 'piece-cycle-type', 'piece-cycle-type-prev'] },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

const KEY_DISPLAY: Record<string, string> = {
  ' ':           'Space',
  'arrowleft':   '←',
  'arrowright':  '→',
  'arrowup':     '↑',
  'arrowdown':   '↓',
  'delete':      'Del',
  'backspace':   'Bksp',
  'enter':       'Enter',
  'escape':      'Esc',
  'tab':         'Tab',
  'insert':      'Ins',
  'home':        'Home',
  'end':         'End',
  'pageup':      'PgUp',
  'pagedown':    'PgDn',
};

export function formatBinding(b: KeyBinding | undefined): string {
  if (!b) return '—';
  const parts: string[] = [];
  if (b.ctrl)  parts.push('Ctrl');
  if (b.shift) parts.push('Shift');
  const raw = b.key.toLowerCase();
  parts.push(KEY_DISPLAY[raw] ?? b.key.toUpperCase());
  return parts.join('+');
}

/** Returns true when the keyboard event matches the binding. */
export function matches(e: KeyboardEvent, b: KeyBinding): boolean {
  return e.key.toLowerCase()           === b.key.toLowerCase()
      && (e.ctrlKey || e.metaKey)      === (b.ctrl  ?? false)
      && e.shiftKey                    === (b.shift ?? false);
}

// ── Store (localStorage-persisted) ────────────────────────────────────────────

const LS_KEY = 'tedige-keymap';

function load(): KeyMap {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return { ...DEFAULT_KEYMAP, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { ...DEFAULT_KEYMAP };
}

export const keyMap = writable<KeyMap>(load());
keyMap.subscribe(km => {
  try { localStorage.setItem(LS_KEY, JSON.stringify(km)); } catch { /* ignore */ }
});

// Signal to pause the main keyboard handler while a binding is being captured.
export const isCapturingKey = writable<boolean>(false);
