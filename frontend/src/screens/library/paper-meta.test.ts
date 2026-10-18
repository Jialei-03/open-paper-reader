import { describe, expect, it } from "vitest";
import { authorList, paperIds, progressOf } from "./paper-meta";

describe("paperIds", () => {
  it("reads arXiv ids and the year", () => {
    expect(paperIds("arxiv:2301.12345v2")).toEqual({
      arxiv: "2301.12345",
      doi: "",
      year: 2023,
    });
  });
  it("reads a DOI", () => {
    expect(paperIds("10.1145/3292500.3330701").doi).toBe(
      "10.1145/3292500.3330701",
    );
  });
  it("knows nothing from nothing", () => {
    expect(paperIds("")).toEqual({ arxiv: "", doi: "", year: 0 });
  });
});

describe("authorList / progressOf", () => {
  it("splits names", () => {
    expect(authorList("A B, C D and E F")).toEqual(["A B", "C D", "E F"]);
  });
  it("clamps progress", () => {
    expect(progressOf(5, 10)).toBe(0.5);
    expect(progressOf(null, 10)).toBe(0);
    expect(progressOf(20, 10)).toBe(1);
  });
});
