import { describe, expect, it } from "vitest";
import { scrollMap } from "./scroll-map";

describe("scrollMap", () => {
  const alignment = [
    { source: { page: 10 }, translated: { page: 12 } },
    { source: { page: 3 }, translated: { page: 3 } },
  ];

  it("keeps the panes page for page, at the same point down the page", () => {
    const map = scrollMap(alignment, 26, 30);
    expect(map.forward(9.4)).toBe(9.4);
    expect(map.backward(9.4)).toBe(9.4);
    expect(map.anchors).toBe(0);
  });

  it("ignores the content alignment, so the page numbers never drift", () => {
    const map = scrollMap(alignment, 26, 30);
    for (const position of [0, 2.5, 9.99, 15.3, 20])
      expect(map.forward(map.backward(map.forward(position)))).toBe(position);
  });

  it("stays inside the shorter document", () => {
    const map = scrollMap(null, 26, 30);
    expect(map.backward(28.5)).toBeLessThan(26);
    expect(map.backward(28.5)).toBeGreaterThan(25.99);
    expect(map.forward(-1)).toBe(0);
    expect(map.forward(Number.NaN)).toBe(0);
  });
});
