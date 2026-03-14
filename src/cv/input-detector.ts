import { rgbToHsv, sampleRegionAvg } from './color-utils';
import type { InputId, InputState } from '../types/frame';

/**
 * Normalized (0..1) button-centre positions within the input-display region
 * the user dragged around.
 *
 * Default calibration is for TGM4's on-screen input widget:
 *   Left 38 % : d-pad (3×3 cross — up/left/right/down)
 *   Right 55 % : action buttons
 *                 Row 1 : CCW · CW · CCW2 · Rewind
 *                 Row 2 : Hold · CW2 · Extra
 */
export type TgmInputLayout = {
  buttons: Record<InputId, [normX: number, normY: number]>;
  /**
   * Half-size of the sampling patch as a fraction of the input rect's width and height.
   * The patch centred on each button is `[width*r × height*r]` pixels.
   * Default 0.08.
   */
  sampleRadius?: number;
};

// ── Layout geometry ────────────────────────────────────────────────────────────

const PAD  = 0.05;
const INNER = 1 - 2 * PAD;

const DPAD_FRAC = 0.33;
const DPAD_CW   = (INNER * DPAD_FRAC) / 3;
const DPAD_CH   = INNER / 3;
const DPAD_X0   = PAD;
const DPAD_Y0   = PAD;

const ACT_X0  = PAD + INNER * (DPAD_FRAC + 0.06) + 0.10;
const ACT_CW  = (INNER * (1 - DPAD_FRAC - 0.06)) / 4;

function deltaCol(col: number, row: number): [number, number] {
  return [DPAD_X0 + (col + 0.5) * DPAD_CW, DPAD_Y0 + (row + 0.5) * DPAD_CH];
}
// Action rows start at the d-pad middle row (same y as left/right) and step by DPAD_CH:
//   row 0 → aligned with left/right (d-pad row 1)
//   row 1 → aligned with down       (d-pad row 2)
function ac(col: number, row: number): [number, number] {
  return [ACT_X0 + (col + 0.5) * ACT_CW, DPAD_Y0 + (row + 1 + 0.5) * DPAD_CH];
}

export const DEFAULT_TGM4_LAYOUT: TgmInputLayout = {
  buttons: {
    up:     deltaCol(1, 0),
    left:   deltaCol(0, 1),
    right:  deltaCol(2, 1),
    down:   deltaCol(1, 2),
    ccw:    ac(0, 0),
    cw:     ac(1, 0),
    ccw2:   ac(2, 0),
    rewind: ac(3, 0),
    hold:   ac(0, 1),
    cw2:    ac(1, 1),
    extra:  ac(2, 1),
  },
};

// ── Threshold types ────────────────────────────────────────────────────────────

/**
 * HSV thresholds for classifying a pixel as "pressed" (bright blue in TGM4).
 * All other button states (gray d-pad, golden action) are considered not-pressed.
 */
export interface InputDetectThresholds {
  /** Minimum hue for "pressed" colour (default 195°). */
  pressedHMin: number;
  /** Maximum hue for "pressed" colour (default 245°). */
  pressedHMax: number;
  /** Minimum saturation for "pressed" colour (0–1, default 0.45). */
  pressedSMin: number;
  /** Minimum value/brightness for "pressed" colour (0–1, default 0.35). */
  pressedVMin: number;
}

export const DEFAULT_INPUT_THRESHOLDS: InputDetectThresholds = {
  pressedHMin: 195,
  pressedHMax: 245,
  pressedSMin: 0.45,
  pressedVMin: 0.35,
};

// ── Button-colour classifier ───────────────────────────────────────────────────

function isPressed(r: number, g: number, b: number, t: InputDetectThresholds): boolean {
  const [h, s, v] = rgbToHsv(r, g, b);
  return (
    h >= t.pressedHMin && h <= t.pressedHMax &&
    s >= t.pressedSMin &&
    v >= t.pressedVMin
  );
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Detect which TGM4 input buttons are pressed in `imageData`.
 * `imageData` should be cropped to the input-display region.
 * Returns a sparse map — only pressed buttons are included.
 */
export function detectTgm4Inputs(
  imageData: ImageData,
  layout: TgmInputLayout = DEFAULT_TGM4_LAYOUT,
  thresholds: InputDetectThresholds = DEFAULT_INPUT_THRESHOLDS,
): Partial<Record<InputId, InputState>> {
  const { data, width, height } = imageData;
  const r = layout.sampleRadius ?? 0.08;
  const sampleW = Math.max(3, width  * r);
  const sampleH = Math.max(3, height * r);

  const result: Partial<Record<InputId, InputState>> = {};

  for (const [id, [nx, ny]] of Object.entries(layout.buttons) as [InputId, [number, number]][]) {
    const cx = nx * width;
    const cy = ny * height;
    const [r, g, b] = sampleRegionAvg(
      data, width,
      cx - sampleW / 2, cy - sampleH / 2,
      sampleW, sampleH,
      0.1,
    );
    if (isPressed(r, g, b, thresholds)) {
      result[id] = 'pressed';
    }
  }

  return result;
}
