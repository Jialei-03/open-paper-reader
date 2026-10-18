import { describe, expect, it } from "vitest";
import { scrollMap } from "./scroll-map";

const unit = (from: number, to: number) => ({
  source: { page: from },
  translated: { page: to },
});

describe("scrollMap", () => {
  it("carries a position in proportion to the pages without an alignment", () => {
    const map = scrollMap([], 10, 20);
    expect(map.anchors).toBe(0);
    expect(map.forward(0)).toBe(0);
    expect(map.forward(5.5)).toBeCloseTo(11);
    expect(map.backward(11)).toBeCloseTo(5.5);
    expect(map.forward(10)).toBe(20);
  });

  it("is the identity for PDFs of the same length", () => {
    const map = scrollMap(null, 7, 7);
    expect(map.forward(3.25)).toBeCloseTo(3.25);
    expect(map.backward(3.25)).toBeCloseTo(3.25);
  });

  it("follows the pages the alignment pairs, in proportion between them", () => {
    // The translation has the second page of the original starting on its fifth.
    const map = scrollMap([unit(2, 5), unit(2, 5), unit(4, 6)], 4, 8);
    expect(map.anchors).toBe(2);
    expect(map.forward(1)).toBeCloseTo(4);
    expect(map.forward(1.5)).toBeCloseTo(4.25);
    expect(map.forward(3)).toBeCloseTo(5);
    expect(map.backward(4)).toBeCloseTo(1);
    expect(map.backward(4.5)).toBeCloseTo(2);
  });

  it("leaves out a match that goes back, and units that were not found", () => {
    const map = scrollMap(
      [
        unit(1, 1),
        unit(2, 2),
        unit(3, 9),
        unit(4, 4),
        { source: { page: 5 }, translated: null },
        { source: null, translated: { page: 5 } },
        unit(99, 3),
        unit(0, 1),
      ],
      6,
      6,
    );
    expect(map.anchors).toBe(3);
    expect(map.forward(2.5)).toBeCloseTo(2.5);
  });

  it("always has two places to carry between, whatever the sizes", () => {
    const map = scrollMap([], 0, 0);
    expect(map.forward(3)).toBe(0);
    const one = scrollMap([unit(1, 1)], 1, 3);
    expect(one.forward(0.5)).toBeCloseTo(1.5);
  });
});
