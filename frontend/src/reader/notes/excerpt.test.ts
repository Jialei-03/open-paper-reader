import { describe, expect, it } from "vitest";
import { parseReaderRoute } from "../route";
import { excerptHref, excerptMarkdown, plainMarkdown } from "./excerpt";

const excerpt = {
  paperId: "paper-1",
  fileId: "file-2",
  page: 3,
  quote: "Evidence stays connected",
  prefix: "We show that",
};

describe("excerptMarkdown", () => {
  it("quotes the words, then links back to their place", () => {
    expect(excerptMarkdown(excerpt, "原文 · 第 3 页")).toBe(
      "> Evidence stays connected\n\n" +
        "[原文 · 第 3 页](#read/paper-1?file=file-2&page=3&quote=Evidence%20stays%20connected&prefix=We%20show%20that)",
    );
  });

  it("puts the translation between the quotation and the link", () => {
    expect(
      excerptMarkdown(
        {
          ...excerpt,
          quote: "line one\nline two\n\nnext",
          translation: "译文",
        },
        "Source · p. 3",
      ).split("\n\n"),
    ).toEqual([
      "> line one\n> line two\n>\n> next",
      "译文",
      expect.stringMatching(/^\[Source · p\. 3\]\(#read\/paper-1\?/),
    ]);
  });

  it("keeps a link whose sentence has parentheses whole, and readable by the reader", () => {
    const href = excerptHref({ ...excerpt, quote: "a (b) c" });
    expect(href).not.toMatch(/[()]/);
    expect(parseReaderRoute(href.slice(1))).toMatchObject({
      quote: "a (b) c",
      page: 3,
    });
  });
});

describe("plainMarkdown", () => {
  it("escapes what Markdown would read as formatting", () => {
    expect(plainMarkdown("x_i * y [1] $5 `c` <b>")).toBe(
      "x\\_i \\* y \\[1\\] \\$5 \\`c\\` \\<b\\>",
    );
    expect(plainMarkdown("- item\n2. step\n# title")).toBe(
      "\\- item\n2\\. step\n\\# title",
    );
  });
});
