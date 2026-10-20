import { describe, expect, it } from "vitest";
import {
  formatSize,
  mention,
  parentOf,
  parseDelimited,
  settledKey,
} from "./files-api";

describe("parseDelimited", () => {
  it("reads quoted fields, doubled quotes and line breaks in quotes", () => {
    const { rows, more } = parseDelimited(
      'a,b\n1,"x, ""y"""\r\n2,"two\nlines"\n',
    );
    expect(rows).toEqual([
      ["a", "b"],
      ["1", 'x, "y"'],
      ["2", "two\nlines"],
    ]);
    expect(more).toBe(false);
  });

  it("reads tabs, and stops at the limit", () => {
    expect(parseDelimited("a\tb\n1\t2", "\t").rows).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
    const { rows, more } = parseDelimited("1\n2\n3\n4\n", ",", 2);
    expect(rows).toEqual([["1"], ["2"]]);
    expect(more).toBe(true);
  });
});

describe("files helpers", () => {
  it("names a path for the composer", () => {
    expect(mention("src/train.py")).toBe("@src/train.py ");
    expect(mention("my data/a.csv")).toBe('@"my data/a.csv" ');
  });

  it("formats sizes and parents", () => {
    expect(formatSize(12)).toBe("12 B");
    expect(formatSize(1536)).toBe("1.5 KB");
    expect(formatSize(200 * 1024 * 1024)).toBe("200 MB");
    expect(parentOf("a/b/c.txt")).toBe("a/b");
    expect(parentOf("c.txt")).toBe("");
  });

  it("changes its key only when a round or a job ends", () => {
    const running = settledKey(
      [{ id: "s1", status: "running" }],
      [{ id: "j1", status: "running" }],
    );
    expect(running).toBe("0:0");
    expect(
      settledKey(
        [{ id: "s1", status: "ended" }],
        [{ id: "j1", status: "running" }],
      ),
    ).toBe("1:0");
    expect(
      settledKey(
        [{ id: "s1", status: "ended" }],
        [{ id: "j1", status: "succeeded" }],
      ),
    ).toBe("1:1");
  });
});
