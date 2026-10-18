import { describe, expect, it } from "vitest";
import {
  bareLatex,
  rectParameter,
  regionBetween,
  regionImageUrl,
  regionMarkdown,
} from "./geometry";

const page = { width: 600, height: 800 };

describe("regionBetween", () => {
  it("orders the corners whichever way the box was dragged", () => {
    expect(regionBetween({ x: 0.6, y: 0.5 }, { x: 0.2, y: 0.1 }, page)).toEqual(
      { x: 0.2, y: 0.1, w: 0.4, h: 0.4 },
    );
  });

  it("holds a box to the page", () => {
    const rect = regionBetween({ x: 0.7, y: 0.9 }, { x: 1.4, y: 1.3 }, page)!;
    expect(rect.x + rect.w).toBeLessThanOrEqual(1);
    expect(rect.y + rect.h).toBeLessThanOrEqual(1);
    expect(rect.w).toBeCloseTo(0.3, 4);
  });

  it("is nothing for a click that wobbled", () => {
    expect(
      regionBetween({ x: 0.5, y: 0.5 }, { x: 0.505, y: 0.505 }, page),
    ).toBeNull();
  });
});

describe("the region's address", () => {
  const rect = { x: 0.1, y: 0.2, w: 0.5, h: 0.25 };
  it("is x,y,w,h", () => expect(rectParameter(rect)).toBe("0.1,0.2,0.5,0.25"));
  it("draws its picture from the file", () =>
    expect(regionImageUrl("f1", 3, rect)).toBe(
      "/api/v1/agent/files/f1/image?page=3&rect=0.1,0.2,0.5,0.25",
    ));
  it("keeps the picture, the text and the way back in the note", () => {
    const markdown = regionMarkdown({
      paperId: "p1",
      fileId: "f1",
      page: 3,
      rect,
      text: "A formula",
      source: "原文 · 第 3 页",
      alt: "图",
    });
    expect(markdown).toBe(
      [
        "![图](/api/v1/agent/files/f1/image?page=3&rect=0.1,0.2,0.5,0.25)",
        "A formula",
        "[原文 · 第 3 页](#read/p1?file=f1&page=3&rect=0.1%2C0.2%2C0.5%2C0.25)",
      ].join("\n\n"),
    );
  });
  it("sets LaTeX as a display formula", () =>
    expect(
      regionMarkdown({
        paperId: "p1",
        fileId: "f1",
        page: 1,
        rect,
        text: "a^2",
        latex: true,
        source: "s",
        alt: "a",
      }),
    ).toContain("$$\na^2\n$$"));
});

describe("bareLatex", () => {
  it("takes off a fence and dollar signs", () => {
    expect(bareLatex("```latex\nx^2\n```")).toBe("x^2");
    expect(bareLatex("$$ x^2 $$")).toBe("x^2");
    expect(bareLatex("$x$")).toBe("x");
    expect(bareLatex("\\[ x \\]")).toBe("x");
    expect(bareLatex("x^2")).toBe("x^2");
  });
});
