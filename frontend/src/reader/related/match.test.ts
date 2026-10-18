import { describe, expect, it } from "vitest";
import type { Paper } from "../../api";
import { inLibrary, libraryIndex } from "./match";

const paper = (id: string, title: string, external_id = ""): Paper =>
  ({ id, title, external_id }) as Paper;

describe("matching a work to the library", () => {
  const index = libraryIndex(
    [
      paper("a", "Attention Is All You Need", "arxiv:1706.03762v5"),
      paper("b", "Some scanned report", "doi:10.1234/Report.7"),
      paper("c", "Deep Residual Learning for Image Recognition"),
      paper("d", "Untitled scan", ""),
    ],
    { d: { arxiv: "2001.00001" } },
  );

  it("matches by arXiv id whatever the version or address form", () => {
    expect(inLibrary(index, { arxiv: "1706.03762" })).toBe("a");
    expect(
      inLibrary(index, { arxiv: "https://arxiv.org/abs/1706.03762v1" }),
    ).toBe("a");
  });
  it("matches by DOI ignoring case, and arXiv papers by their DataCite DOI", () => {
    expect(inLibrary(index, { doi: "10.1234/report.7" })).toBe("b");
    expect(inLibrary(index, { doi: "10.48550/arXiv.1706.03762" })).toBe("a");
  });
  it("matches by normalized title when nothing else is shared", () => {
    expect(
      inLibrary(index, {
        title: "Deep residual learning for image recognition.",
      }),
    ).toBe("c");
  });
  it("uses the public record of a paper whose id field is empty", () => {
    expect(inLibrary(index, { arxiv: "2001.00001" })).toBe("d");
  });
  it("does not match short titles or strangers", () => {
    expect(inLibrary(index, { title: "Untitled" })).toBeUndefined();
    expect(
      inLibrary(index, {
        arxiv: "2999.99999",
        title: "Another thing entirely",
      }),
    ).toBeUndefined();
  });
});
