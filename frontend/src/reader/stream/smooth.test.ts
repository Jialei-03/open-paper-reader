import { describe, expect, it } from "vitest";
import {
  MIN_RATE,
  advance,
  constructSpans,
  holdBack,
  releaseRate,
  reveal,
  settle,
} from "./smooth";

describe("release rate", () => {
  it("never goes below the calm pace, and speeds up the further behind", () => {
    expect(releaseRate(5, false)).toBe(MIN_RATE);
    expect(releaseRate(1000, false)).toBeGreaterThan(releaseRate(100, false));
  });
  it("finishes within a fraction of a second once the stream is done", () => {
    const backlog = 600;
    expect(releaseRate(backlog, true) * 0.3).toBeGreaterThanOrEqual(backlog);
    expect(releaseRate(backlog, true)).toBeGreaterThan(
      releaseRate(backlog, false),
    );
  });
});

describe("advance", () => {
  it("carries fractions so a slow rate still moves", () => {
    let carry = 0;
    let total = 0;
    for (let frame = 0; frame < 60; frame += 1) {
      const step = advance(carry, 1000, 1000 / 60, false);
      carry = step.carry;
      total += step.whole;
    }
    expect(Math.abs(total - releaseRate(1000, false))).toBeLessThanOrEqual(1);
  });
  it("never releases more than is left, and nothing without a gap", () => {
    expect(advance(0, 3, 1000, true).whole).toBe(3);
    expect(advance(0.9, 0, 16, false)).toEqual({ whole: 0, carry: 0 });
  });
  it("flushes a done stream within 300 ms of frames", () => {
    let backlog = 500;
    let carry = 0;
    let ms = 0;
    while (backlog > 0 && ms < 2000) {
      const step = advance(carry, backlog, 16, true);
      carry = step.carry;
      backlog -= step.whole;
      ms += 16;
    }
    expect(backlog).toBe(0);
    expect(ms).toBeLessThanOrEqual(300);
  });
});

describe("holding back an unfinished tail", () => {
  it("shows everything of a finished stream", () => {
    expect(holdBack("see [第 3", true)).toBe(8);
  });
  it("holds a citation until it is closed", () => {
    const text = "答案见 [第 3 页](#paper/1?page=3&quo";
    expect(holdBack(text, false)).toBe(text.indexOf("["));
    expect(holdBack("答案见 [第", false)).toBe(4);
    expect(holdBack("a [b]", false)).toBe(2);
    const closed = "答案见 [第 3 页](#paper/1?page=3) 然后";
    expect(holdBack(closed, false)).toBe(closed.length);
  });
  it("holds an open formula, code span or bold run", () => {
    expect(holdBack("then $x^2 +", false)).toBe(5);
    expect(holdBack("then $x^2$ and", false)).toBe(14);
    expect(holdBack("use `foo", false)).toBe(4);
    expect(holdBack("a **bold", false)).toBe(2);
    expect(holdBack("$$ a", false)).toBe(0);
  });
  it("does not wait for an opener that has gone on far too long", () => {
    const text = "[" + "x".repeat(400);
    expect(holdBack(text, false)).toBe(text.length);
  });
  it("does not hold back an escaped dollar", () => {
    expect(holdBack("costs \\$5 here", false)).toBe(14);
  });
});

describe("cutting between whole constructs and characters", () => {
  const text = "ab [第 3 页](#paper/1?page=3) cd $x^2$ e";
  const spans = constructSpans(text);
  it("finds the complete constructs", () => {
    expect(spans.map(([a, b]) => text.slice(a, b))).toEqual([
      "[第 3 页](#paper/1?page=3)",
      "$x^2$",
    ]);
  });
  it("jumps over a construct instead of cutting it", () => {
    const start = text.indexOf("[");
    expect(settle(text, spans, start + 3)).toBe(text.indexOf(")") + 1);
    expect(settle(text, spans, start)).toBe(start);
  });
  it("never cuts a surrogate pair or an emoji sequence", () => {
    const emoji = "a😀b👨‍👩‍👧c";
    expect(settle(emoji, [], 2)).toBe(3);
    expect(settle(emoji, [], 5)).toBe(emoji.length - 1);
    expect(settle("éx", [], 1)).toBe(2);
  });
  it("waits when the next cut is past the limit", () => {
    const start = text.indexOf("[");
    expect(reveal(text, spans, start, 2, start + 5)).toBe(start);
    expect(reveal(text, spans, 0, 2, text.length)).toBe(2);
    expect(reveal(text, spans, 10, 0, text.length)).toBe(10);
  });
});
