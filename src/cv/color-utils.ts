/**
 * Convert RGB (0–255 each) to HSV.
 * Returns [hue (0–360°), saturation (0–1), value (0–1)].
 */
export function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  const v = max;
  const s = max === 0 ? 0 : d / max;
  let h = 0;
  if (d > 0) {
    if      (max === rn) h = ((gn - bn) / d + 6) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else                 h = (rn - gn) / d + 4;
    h *= 60;
  }
  return [h, s, v];
}

/**
 * Average the RGB values of the center region of a cell within raw ImageData.
 * `margin` (0–0.49) trims that fraction from each edge to avoid grid-line bleed.
 */
export function sampleRegionAvg(
  data: Uint8ClampedArray,
  imgWidth: number,
  x: number, y: number,
  w: number, h: number,
  margin = 0.2,
): [number, number, number] {
  const x0 = Math.round(x + w * margin);
  const y0 = Math.round(y + h * margin);
  const x1 = Math.round(x + w * (1 - margin));
  const y1 = Math.round(y + h * (1 - margin));
  if (x1 <= x0 || y1 <= y0) return [0, 0, 0];

  let rS = 0, gS = 0, bS = 0, n = 0;
  for (let py = y0; py < y1; py++) {
    for (let px = x0; px < x1; px++) {
      const i = (py * imgWidth + px) * 4;
      rS += data[i]; gS += data[i + 1]; bS += data[i + 2];
      n++;
    }
  }
  return n ? [rS / n, gS / n, bS / n] : [0, 0, 0];
}
