/** Additional view rotation relative to the PDF's embedded page rotation. */
export function rotatePoint(
  x: number,
  y: number,
  degrees: number,
): [number, number] {
  switch (((degrees % 360) + 360) % 360) {
    case 90:
      return [1 - y, x];
    case 180:
      return [1 - x, 1 - y];
    case 270:
      return [y, 1 - x];
    default:
      return [x, y];
  }
}
export function rotateRect(
  rect: { x: number; y: number; w: number; h: number },
  degrees: number,
) {
  const a = rotatePoint(rect.x, rect.y, degrees);
  const b = rotatePoint(rect.x + rect.w, rect.y + rect.h, degrees);
  return {
    x: Math.min(a[0], b[0]),
    y: Math.min(a[1], b[1]),
    w: Math.abs(b[0] - a[0]),
    h: Math.abs(b[1] - a[1]),
  };
}
