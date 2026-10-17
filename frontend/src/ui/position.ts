// Where a floating layer goes: beside an anchor, kept inside the window.
// Pure arithmetic in viewport coordinates, so it is tested without a browser.

export type Side = "top" | "bottom" | "left" | "right";
export type Align = "start" | "center" | "end";

export interface Placement {
  side: Side;
  align: Align;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Size {
  width: number;
  height: number;
}

const opposite: Record<Side, Side> = {
  top: "bottom",
  bottom: "top",
  left: "right",
  right: "left",
};

/** Keeps a start edge so that `length` fits between the paddings; if it cannot fit, the leading edge wins. */
function clamp(start: number, length: number, room: number, padding: number) {
  return Math.max(padding, Math.min(start, room - length - padding));
}

/**
 * The top-left corner for a layer of `size` placed against `anchor`.
 *
 * It goes on the wanted side. If it does not fit there and the opposite side has
 * more room, it flips. The cross axis is then slid back inside the window, and
 * the main axis is too as a last resort (a layer that fits on neither side).
 */
export function placeFloating(
  anchor: Rect,
  size: Size,
  viewport: Size,
  want: Placement,
  offset = 6,
  padding = 8,
): { x: number; y: number; placement: Placement } {
  const vertical = want.side === "top" || want.side === "bottom";
  const [main, cross] = vertical
    ? (["y", "x"] as const)
    : (["x", "y"] as const);
  const [mainLength, crossLength] = vertical
    ? (["height", "width"] as const)
    : (["width", "height"] as const);
  const mainRoom = viewport[mainLength];
  const crossRoom = viewport[crossLength];

  // Room between the anchor and the window edge on a side, minus the gap and the padding.
  const room = (side: Side) => {
    const before = side === "top" || side === "left";
    return before
      ? anchor[main] - offset - padding
      : mainRoom - (anchor[main] + anchor[mainLength]) - offset - padding;
  };
  let side = want.side;
  if (room(side) < size[mainLength] && room(opposite[side]) > room(side))
    side = opposite[side];

  const before = side === "top" || side === "left";
  const mainStart = before
    ? anchor[main] - offset - size[mainLength]
    : anchor[main] + anchor[mainLength] + offset;

  const crossOffset =
    want.align === "start"
      ? 0
      : want.align === "center"
        ? (anchor[crossLength] - size[crossLength]) / 2
        : anchor[crossLength] - size[crossLength];
  const crossStart = anchor[cross] + crossOffset;

  const placed = {
    [main]: clamp(mainStart, size[mainLength], mainRoom, padding),
    [cross]: clamp(crossStart, size[crossLength], crossRoom, padding),
  } as Record<"x" | "y", number>;
  return { x: placed.x, y: placed.y, placement: { side, align: want.align } };
}
