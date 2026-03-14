import { BOARD_ROWS } from '../types/board';

/**
 * Convert client pixel coordinates to board cell [col, row].
 * Row 0 = floor, row BOARD_ROWS-1 = top visible row.
 * Out-of-bounds values are returned as-is; callers handle clamping.
 */
export function clientToCell(
  clientX: number,
  clientY: number,
  rect: DOMRect,
  cellSize: number,
): [number, number] {
  const col = Math.floor((clientX - rect.left) / cellSize);
  const row = BOARD_ROWS - 1 - Math.floor((clientY - rect.top) / cellSize);
  return [col, row];
}

/**
 * Extract { clientX, clientY } from the primary touch in a TouchEvent.
 * Falls back to changedTouches (useful in touchend where touches may be empty).
 * Returns null if no touch is found.
 */
export function primaryTouchCoords(e: TouchEvent): { clientX: number; clientY: number } | null {
  const touch = e.touches[0] ?? e.changedTouches[0] ?? null;
  if (!touch) return null;
  return { clientX: touch.clientX, clientY: touch.clientY };
}
