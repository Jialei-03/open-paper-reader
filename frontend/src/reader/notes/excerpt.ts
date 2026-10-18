import { readerHash } from "../route";
import type { AskRequest } from "../types";

/** What is kept in the note from the paper: the selected words, and their translation when there is one. */
export type Excerpt = Pick<
  AskRequest,
  "paperId" | "fileId" | "page" | "quote" | "prefix"
> & { translation?: string };

/**
 * Text from a PDF, written so that the note shows it as it is: the characters
 * Markdown would read as formatting (emphasis, links, code, formulas, tables,
 * headings and lists at the start of a line) are escaped.
 */
export function plainMarkdown(text: string): string {
  return text
    .replace(/[\\`*_[\]<>$|~#]/g, "\\$&")
    .replace(/^(\s*)([-+=])/gm, "$1\\$2")
    .replace(/^(\s*\d+)([.)])/gm, "$1\\$2");
}

/**
 * The address of the excerpt's place in the reader, as a Markdown link can
 * carry it: the parentheses a sentence may hold would end the link early.
 */
export function excerptHref(excerpt: Excerpt): string {
  return readerHash({
    paperId: excerpt.paperId,
    fileId: excerpt.fileId,
    page: excerpt.page,
    quote: excerpt.quote,
    prefix: excerpt.prefix,
  }).replace(/[()]/g, (char) => (char === "(" ? "%28" : "%29"));
}

/**
 * The block an excerpt adds to the note: the words as a quotation, the
 * translation (if any) under it, then a link back to the place in the paper
 * (`source` is its text, e.g. "原文 · 第 3 页").
 */
export function excerptMarkdown(excerpt: Excerpt, source: string): string {
  const quote = (excerpt.quote ?? "").replace(/\r\n?/g, "\n").trim();
  const blocks: string[] = [];
  if (quote)
    blocks.push(
      plainMarkdown(quote)
        .split("\n")
        .map((line) => (line.trim() ? `> ${line}` : ">"))
        .join("\n"),
    );
  const translation = excerpt.translation?.replace(/\r\n?/g, "\n").trim();
  if (translation) blocks.push(plainMarkdown(translation));
  blocks.push(`[${plainMarkdown(source)}](${excerptHref(excerpt)})`);
  return blocks.join("\n\n");
}
