/** Clamp value between lo and hi (inclusive). */
export function clamp(value: number, lo: number, hi: number): number {
  return Math.min(Math.max(value, lo), hi);
}

/** True modulo (always non-negative, unlike JS %). */
export function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

/** Generate array [start, start+1, ..., end-1]. */
export function range(start: number, end: number): number[] {
  return Array.from({ length: end - start }, (_, i) => start + i);
}

/** Darken a hex color by a ratio (0=unchanged, 1=black). */
export function darkenHex(hex: string, ratio: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const f = 1 - ratio;
  const toHex = (v: number) => Math.round(v * f).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/** Lighten a hex color by mixing with white. ratio=1 => white. */
export function lightenHex(hex: string, ratio: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const toHex = (v: number) => Math.round(v + (255 - v) * ratio).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}
