export function pdfRegion(value: string) {
  if (!value) return null;
  const parts = value.split(",").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  const [x, y, w, h] = parts;
  return x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= 1.001 && y + h <= 1.001
    ? { x, y, w, h }
    : null;
}
