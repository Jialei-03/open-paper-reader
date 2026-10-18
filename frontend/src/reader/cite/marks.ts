import type { ReaderRoute } from "../route";

/**
 * Sentence-level citations, as the model writes them and as every reader view
 * (guide, answer, note) reads them:
 *
 *     [[p3: "words copied from page 3"]]
 *
 * The syntax is documented and checked on the service side, in
 * `backend/citation_marks.py`; keep the two alike. Besides the straight double
 * quote, corner brackets (`「…」`, for a quote that holds a straight quote) and
 * curly quotes are read.
 *
 * A marker is only ever *shown* as a citation once the service has found its
 * words on the page (`useVerified`); until then, and when they are not found,
 * the sentence stands without it.
 */
export interface CiteMark {
  page: number;
  quote: string;
}

/** A stretch of text, or a marker in it. */
export type Piece =
  | { kind: "text"; text: string }
  | { kind: "cite"; mark: CiteMark };

const MARK =
  /\[\[\s*[pP]\.?\s*(\d{1,4})\s*[:\uff1a]\s*(?:"(.+?)"|\u201c(.+?)\u201d|\u300c(.+?)\u300d)\s*\]\]/gs;
/** A marker that is closed but not well formed. */
const LOOSE = /[ \t]*\[\[\s*[pP]\.?\s*\d{1,4}\b[^[\]\n]*\]\]/g;
/** A marker still being written, at the end of a text that is still growing. */
const UNFINISHED = /[ \t]*\[\[\s*[pP]?[^\]]{0,700}$/;

export const MAX_QUOTE = 300;

/** The canonical marker for a page and its words; `null` when the words cannot be written in one. */
export function writeMark(mark: CiteMark): string | null {
  const quote = mark.quote.replace(/\s+/g, " ").trim();
  if (
    !quote ||
    quote.length > MAX_QUOTE ||
    quote.includes("[[") ||
    quote.includes("]]")
  )
    return null;
  if (!quote.includes('"')) return `[[p${mark.page}: "${quote}"]]`;
  if (!quote.includes("\u300d"))
    return `[[p${mark.page}: \u300c${quote}\u300d]]`;
  return null;
}

const LEADING =
  /^\[\[\s*[pP]\.?\s*(\d{1,4})\s*[:\uff1a]\s*(?:"(.+?)"|\u201c(.+?)\u201d|\u300c(.+?)\u300d)\s*\]\]/s;

/** The marker that begins `src`, if one does: what a Markdown reader needs to take it as one token. */
export function leadingMark(
  src: string,
): { raw: string; mark: CiteMark } | null {
  const found = LEADING.exec(src);
  if (!found) return null;
  const page = Number(found[1]);
  const quote = (found[2] ?? found[3] ?? found[4] ?? "").trim();
  return page >= 1 && quote ? { raw: found[0], mark: { page, quote } } : null;
}

const dropLoose = (text: string) => text.replace(LOOSE, "");

/**
 * The text cut at its markers. A half-written marker at the end (the text is
 * still streaming in) and a malformed one are left out.
 */
export function splitMarks(text: string): Piece[] {
  const pieces: Piece[] = [];
  let at = 0;
  const add = (end: number) => {
    if (end > at) pieces.push({ kind: "text", text: text.slice(at, end) });
  };
  for (const found of text.matchAll(MARK)) {
    const page = Number(found[1]);
    const quote = found[2] ?? found[3] ?? found[4] ?? "";
    add(found.index);
    at = found.index + found[0].length;
    if (page >= 1 && quote.trim())
      pieces.push({ kind: "cite", mark: { page, quote: quote.trim() } });
  }
  add(text.length);
  // Loose and unfinished leftovers are cleaned from the text pieces only; a
  // marker follows its sentence directly, without the space before it.
  return pieces
    .map((piece, index): Piece => {
      if (piece.kind !== "text") return piece;
      let value = dropLoose(piece.text);
      if (index === pieces.length - 1) value = value.replace(UNFINISHED, "");
      if (pieces[index + 1]?.kind === "cite")
        value = value.replace(/[ \t]+$/, "");
      return { kind: "text", text: value };
    })
    .filter((piece) => piece.kind === "cite" || piece.text !== "");
}

/** The markers of a text, in order (each as many times as it is written). */
export function marksIn(text: string): CiteMark[] {
  return splitMarks(text).flatMap((piece) =>
    piece.kind === "cite" ? [piece.mark] : [],
  );
}

/** The text with no markers in it: how it reads before they are verified, or where they cannot be shown. */
export function stripMarks(text: string): string {
  return splitMarks(text)
    .map((piece) => (piece.kind === "text" ? piece.text : ""))
    .join("");
}

/** What tells two marks apart: the page and the words, whitespace aside. */
export const markKey = (mark: CiteMark) =>
  `${mark.page}\n${mark.quote.replace(/\s+/g, "")}`;

/** The address that leads to the words in the reader: the page, and the sentence marked on it. */
export function citeRoute(
  paperId: string,
  fileId: string,
  mark: CiteMark,
): ReaderRoute {
  return { paperId, fileId, page: mark.page, quote: mark.quote };
}

/** What copying a citation leaves in plain text. */
export const copiedCite = (page: number) => ` (p. ${page})`;

/**
 * The numbers of the citations of some texts, by first appearance: the same
 * words on the same page are the same number. `resolve` gives a mark as the
 * paper has it (a page the model got wrong, corrected), or `null` for one that
 * is not shown; the numbers are of the resolved marks.
 */
export function numbering(
  texts: readonly string[],
  resolve: (mark: CiteMark) => CiteMark | null = (mark) => mark,
): Map<string, number> {
  const numbers = new Map<string, number>();
  for (const text of texts)
    for (const mark of marksIn(text)) {
      const found = resolve(mark);
      if (!found) continue;
      const key = markKey(found);
      if (!numbers.has(key)) numbers.set(key, numbers.size + 1);
    }
  return numbers;
}

/**
 * The text as Markdown for a renderer that draws links as it likes: every
 * shown marker becomes `[<n>](#cite-<n>)` (its number, which the renderer
 * looks up), every other marker goes. Where a citation is read the same way
 * everywhere, a sentence keeps its place in the line.
 */
export function citedMarkdown(
  text: string,
  numbers: ReadonlyMap<string, number>,
  resolve: (mark: CiteMark) => CiteMark | null,
): string {
  return splitMarks(text)
    .map((piece) => {
      if (piece.kind === "text") return piece.text;
      const found = resolve(piece.mark);
      const n = found ? numbers.get(markKey(found)) : undefined;
      return n ? `[${n}](#cite-${n})` : "";
    })
    .join("");
}

/**
 * Markers kept as they are but with their pages and words as the service found
 * them; those it did not find leave. For a text that is stored (a note kept from
 * an answer), so that what is stored is true.
 */
export function verifiedText(
  text: string,
  resolve: (mark: CiteMark) => CiteMark | null,
): string {
  return splitMarks(text)
    .map((piece) => {
      if (piece.kind === "text") return piece.text;
      const found = resolve(piece.mark);
      return found ? (writeMark(found) ?? "") : "";
    })
    .join("");
}
