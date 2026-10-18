import { describe, expect, it } from "vitest";
import { placeFloating } from "./position";

const vp = { width: 1000, height: 800 };
const size = { width: 200, height: 100 };

describe("placeFloating", () => {
  it("places below, aligned to the start, when it fits", () => {
    expect(
      placeFloating({ x: 100, y: 100, width: 80, height: 30 }, size, vp, {
        side: "bottom",
        align: "start",
      }),
    ).toEqual({
      x: 100,
      y: 136,
      placement: { side: "bottom", align: "start" },
    });
  });

  it("flips to the top near the bottom edge", () => {
    const r = placeFloating(
      { x: 100, y: 740, width: 80, height: 30 },
      size,
      vp,
      { side: "bottom", align: "start" },
    );
    expect(r.placement.side).toBe("top");
    expect(r.y).toBe(740 - 6 - 100);
  });

  it("shifts left to stay inside the right edge", () => {
    const r = placeFloating(
      { x: 950, y: 100, width: 40, height: 30 },
      size,
      vp,
      { side: "bottom", align: "start" },
    );
    expect(r.x).toBe(1000 - 200 - 8);
  });

  it("centers on the anchor", () => {
    expect(
      placeFloating({ x: 400, y: 100, width: 100, height: 30 }, size, vp, {
        side: "top",
        align: "center",
      }).x,
    ).toBe(350);
  });

  it("keeps the preferred side when neither side fits better", () => {
    const tall = { width: 200, height: 790 };
    expect(
      placeFloating({ x: 100, y: 10, width: 80, height: 30 }, tall, vp, {
        side: "bottom",
        align: "start",
      }).placement.side,
    ).toBe("bottom");
  });

  it("stays on the wanted side while it fits, even with more room opposite", () => {
    const r = placeFloating(
      { x: 100, y: 500, width: 80, height: 30 },
      size,
      vp,
      { side: "bottom", align: "start" },
    );
    expect(r.placement.side).toBe("bottom");
    expect(r.y).toBe(536);
  });

  it("places beside the anchor and aligns on the vertical axis", () => {
    const anchor = { x: 300, y: 200, width: 40, height: 60 };
    expect(
      placeFloating(anchor, size, vp, { side: "right", align: "start" }),
    ).toMatchObject({ x: 346, y: 200 });
    expect(
      placeFloating(anchor, size, vp, { side: "left", align: "end" }),
    ).toMatchObject({ x: 300 - 6 - 200, y: 200 + 60 - 100 });
    expect(
      placeFloating(anchor, size, vp, { side: "right", align: "center" }).y,
    ).toBe(180);
  });

  it("flips sideways near the right edge", () => {
    const r = placeFloating(
      { x: 940, y: 200, width: 40, height: 30 },
      size,
      vp,
      { side: "right", align: "start" },
    );
    expect(r.placement.side).toBe("left");
    expect(r.x).toBe(940 - 6 - 200);
  });

  it("slides back inside the left and top edges", () => {
    const r = placeFloating({ x: 0, y: 0, width: 20, height: 20 }, size, vp, {
      side: "top",
      align: "end",
    });
    // No room above: flips below, and the end alignment would hang off the left.
    expect(r.placement.side).toBe("bottom");
    expect(r).toMatchObject({ x: 8, y: 26 });
  });

  it("falls back to the padding when it is larger than the window", () => {
    const r = placeFloating(
      { x: 100, y: 100, width: 80, height: 30 },
      { width: 1200, height: 900 },
      vp,
      { side: "bottom", align: "start" },
    );
    expect(r).toMatchObject({ x: 8, y: 8 });
  });

  it("uses the offset and the padding it is given", () => {
    const r = placeFloating(
      { x: 100, y: 100, width: 80, height: 30 },
      size,
      vp,
      { side: "bottom", align: "start" },
      10,
      20,
    );
    expect(r.y).toBe(140);
    expect(
      placeFloating(
        { x: 950, y: 100, width: 40, height: 30 },
        size,
        vp,
        {
          side: "bottom",
          align: "start",
        },
        10,
        20,
      ).x,
    ).toBe(1000 - 200 - 20);
  });

  it("moves away with an anchor that has scrolled out of view", () => {
    const above = { x: 100, y: -200, width: 80, height: 30 };
    expect(
      placeFloating(above, size, vp, { side: "bottom", align: "start" }),
    ).toMatchObject({ y: -200 + 30 + 6, placement: { side: "bottom" } });
    expect(
      placeFloating(above, size, vp, { side: "top", align: "start" }),
    ).toMatchObject({ y: -200 + 30 + 6, placement: { side: "bottom" } });

    const below = { x: 100, y: 1000, width: 80, height: 30 };
    expect(
      placeFloating(below, size, vp, { side: "top", align: "start" }),
    ).toMatchObject({ y: 1000 - 6 - 100, placement: { side: "top" } });
    expect(
      placeFloating(below, size, vp, { side: "bottom", align: "start" }),
    ).toMatchObject({ y: 1000 - 6 - 100, placement: { side: "top" } });

    const left = { x: -300, y: 100, width: 40, height: 30 };
    expect(
      placeFloating(left, size, vp, { side: "right", align: "start" }),
    ).toMatchObject({ x: -300 + 40 + 6, placement: { side: "right" } });
  });

  it("holds the main axis inside the window only when neither side fits", () => {
    const tall = { width: 200, height: 790 };
    expect(
      placeFloating({ x: 100, y: 10, width: 80, height: 30 }, tall, vp, {
        side: "bottom",
        align: "start",
      }),
    ).toMatchObject({ y: 8, placement: { side: "bottom" } });
    // It does fit on the far side, once flipped: no clamping there.
    expect(
      placeFloating({ x: 100, y: 780, width: 80, height: 30 }, size, vp, {
        side: "bottom",
        align: "start",
      }),
    ).toMatchObject({ y: 780 - 6 - 100, placement: { side: "top" } });
  });
});
