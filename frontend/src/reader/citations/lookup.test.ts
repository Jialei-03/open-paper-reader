import { describe, expect, it } from "vitest";
import { arxivAddress, byline, doiAddress, webUrl } from "./lookup";

describe("citation helpers", () => {
  it("offers only web addresses", () => {
    expect(webUrl("https://arxiv.org/abs/1706.03762")).toBe(
      "https://arxiv.org/abs/1706.03762",
    );
    expect(webUrl("javascript:alert(1)")).toBeUndefined();
    expect(webUrl("not a url")).toBeUndefined();
  });
  it("builds the arXiv and DOI addresses", () => {
    expect(arxivAddress("1706.03762")).toBe("https://arxiv.org/abs/1706.03762");
    expect(doiAddress("10.1000/a b")).toBe("https://doi.org/10.1000/a%20b");
  });
  it("cuts a long author list short", () => {
    const etAl = (names: string) => `${names} et al.`;
    expect(
      byline(
        { authors: ["A", "B", "C", "D"], venue: "NeurIPS", year: 2017 },
        etAl,
      ),
    ).toBe("A, B, C et al. · NeurIPS · 2017");
    expect(byline({ authors: ["A"], venue: "", year: null }, etAl)).toBe("A");
  });
});
