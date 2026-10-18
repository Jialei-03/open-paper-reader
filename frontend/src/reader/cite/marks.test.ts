import { describe, expect, it } from "vitest";
import {
  citedMarkdown,
  citeRoute,
  leadingMark,
  markKey,
  marksIn,
  numbering,
  splitMarks,
  stripMarks,
  verifiedText,
  writeMark,
} from "./marks";

const A = { page: 3, quote: "we reduce latency by 40%" };
const B = { page: 5, quote: "the baseline is stronger" };
const text = `It is faster. [[p3: "we reduce latency by 40%"]] But not always. [[p5: "the baseline is stronger"]]`;

describe("splitMarks", () => {
  it("cuts the text at its markers and drops the space before one", () => {
    expect(splitMarks(text)).toEqual([
      { kind: "text", text: "It is faster." },
      { kind: "cite", mark: A },
      { kind: "text", text: " But not always." },
      { kind: "cite", mark: B },
    ]);
  });

  it("reads the other quote styles and a spaced or full-width colon", () => {
    const pieces = splitMarks(
      'a [[ P.2 ：“curly one”]] b [[p4: 「with "inner" quote」]]',
    );
    expect(marksIn("a [[ P.2 ：“curly one”]]")).toEqual([
      { page: 2, quote: "curly one" },
    ]);
    expect(pieces.filter((p) => p.kind === "cite")).toHaveLength(2);
    expect(marksIn('[[p4: 「with "inner" quote」]]')[0].quote).toBe(
      'with "inner" quote',
    );
  });

  it("drops a half-written marker at the end of a growing text", () => {
    expect(stripMarks('Claim. [[p3: "we reduce')).toBe("Claim.");
    expect(stripMarks("Claim. [[p")).toBe("Claim.");
    expect(stripMarks("Claim. [[")).toBe("Claim.");
  });

  it("drops a closed but malformed marker", () => {
    expect(stripMarks("Claim [[p3]] and [[p3: no quotes]] more")).toBe(
      "Claim and more",
    );
  });

  it("leaves text without markers as it is", () => {
    expect(stripMarks("Plain [link](#x) text, a[0] and [[not one]].")).toBe(
      "Plain [link](#x) text, a[0] and [[not one]].",
    );
  });

  it("keeps markup in a quote as text, never as anything to run", () => {
    const [cite] = marksIn(
      '[[p1: "<img src=x onerror=alert(1)> [a](javascript:alert(1))"]]',
    );
    expect(cite.quote).toBe(
      "<img src=x onerror=alert(1)> [a](javascript:alert(1))",
    );
    // The route carries it as an encoded parameter, not as a link of its own.
    const route = citeRoute("p1", "f1", cite);
    expect(route).toEqual({
      paperId: "p1",
      fileId: "f1",
      page: 1,
      quote: cite.quote,
    });
  });
});

describe("writeMark", () => {
  it("writes the canonical marker, with corner brackets for a straight quote", () => {
    expect(writeMark(A)).toBe('[[p3: "we reduce latency by 40%"]]');
    expect(writeMark({ page: 2, quote: 'says "x" twice' })).toBe(
      '[[p2: 「says "x" twice」]]',
    );
  });
  it("refuses words that cannot sit in a marker", () => {
    expect(writeMark({ page: 2, quote: "a ]] b" })).toBeNull();
    expect(writeMark({ page: 2, quote: "x".repeat(301) })).toBeNull();
    expect(writeMark({ page: 2, quote: "  " })).toBeNull();
  });
  it("round-trips through the reader", () => {
    const mark = { page: 7, quote: 'a "q" and more words' };
    expect(marksIn(writeMark(mark) ?? "")).toEqual([mark]);
  });
});

describe("leadingMark", () => {
  it("takes only a marker at the very start", () => {
    expect(leadingMark('[[p2: "some words here"]] after')?.raw).toBe(
      '[[p2: "some words here"]]',
    );
    expect(leadingMark('x [[p2: "some words here"]]')).toBeNull();
  });
});

describe("numbering and Markdown", () => {
  it("numbers by first appearance; the same words are one number", () => {
    const numbers = numbering([
      text,
      `again [[p3: "we reduce latency by 40%"]]`,
    ]);
    expect(numbers.get(markKey(A))).toBe(1);
    expect(numbers.get(markKey(B))).toBe(2);
    expect(numbers.size).toBe(2);
  });

  it("numbers the marks as the paper has them, and only those it has", () => {
    const resolve = (mark: { page: number; quote: string }) =>
      mark.page === 3 ? { ...mark, page: 4 } : null;
    const numbers = numbering([text], resolve);
    expect([...numbers.entries()]).toEqual([[markKey({ ...A, page: 4 }), 1]]);
    expect(citedMarkdown(text, numbers, resolve)).toBe(
      "It is faster.[1](#cite-1) But not always.",
    );
  });

  it("keeps what is stored true: found markers corrected, others gone", () => {
    const stored = verifiedText(text, (mark) =>
      mark.page === 3 ? { ...mark, page: 4 } : null,
    );
    expect(stored).toBe(
      'It is faster.[[p4: "we reduce latency by 40%"]] But not always.',
    );
  });
});
