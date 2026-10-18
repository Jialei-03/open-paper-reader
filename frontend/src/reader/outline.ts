import type { PDFDocumentProxy } from "pdfjs-dist";

/** One line of a PDF's table of contents, in reading order. */
export interface OutlineNode {
  title: string;
  /** How far down it sits, from 0. */
  depth: number;
  /** The page it leads to, from 1; `null` when its destination leads nowhere (the title is all there is). */
  page: number | null;
}

/** What pdf.js gives for an entry (the part this reads). */
interface RawEntry {
  title?: string;
  dest?: string | unknown[] | null;
  items?: RawEntry[];
}

/** What of the document this reads, so that a test can stand in for it. */
export type OutlineSource = Pick<
  PDFDocumentProxy,
  "getOutline" | "getDestination" | "getPageIndex" | "numPages"
>;

/** A PDF may nest and list without end; past these the rest is left out. */
const MAX_DEPTH = 8;
const MAX_ENTRIES = 3000;

/**
 * The page a destination points at, from 1. A destination is an array whose
 * first item is the page (a number, or a reference to look up), or the name of
 * one the document defines. `null` for whatever does not lead to a page of this
 * document: a name nothing defines, a reference that is not a page, a failure.
 */
export async function destinationPage(
  doc: Pick<OutlineSource, "getDestination" | "getPageIndex" | "numPages">,
  dest: unknown,
): Promise<number | null> {
  try {
    const target =
      typeof dest === "string" ? await doc.getDestination(dest) : dest;
    if (!Array.isArray(target) || target.length === 0) return null;
    const ref = target[0];
    const index =
      typeof ref === "number"
        ? ref
        : await doc.getPageIndex(ref as { num: number; gen: number });
    const page = index + 1;
    return Number.isInteger(page) && page >= 1 && page <= doc.numPages
      ? page
      : null;
  } catch {
    return null;
  }
}

/**
 * The document's own table of contents, flattened in reading order, each entry
 * with the page it leads to. An entry whose destination cannot be followed keeps
 * its title and has no page; a document with no outline, or one that cannot be
 * read, has an empty list.
 */
export async function loadOutline(doc: OutlineSource): Promise<OutlineNode[]> {
  let raw: RawEntry[] | null;
  try {
    raw = (await doc.getOutline()) as RawEntry[] | null;
  } catch {
    return [];
  }
  const entries: { entry: RawEntry; depth: number }[] = [];
  // A stack, not recursion: a document decides how deep it nests.
  const stack = (raw ?? []).map((entry) => ({ entry, depth: 0 })).reverse();
  while (stack.length > 0 && entries.length < MAX_ENTRIES) {
    const next = stack.pop()!;
    entries.push(next);
    if (next.depth + 1 < MAX_DEPTH)
      for (const child of [...(next.entry.items ?? [])].reverse())
        stack.push({ entry: child, depth: next.depth + 1 });
  }
  return Promise.all(
    entries.map(async ({ entry, depth }) => ({
      title: (entry.title ?? "").trim(),
      depth,
      page: entry.dest ? await destinationPage(doc, entry.dest) : null,
    })),
  );
}

const loaded = new WeakMap<object, Promise<OutlineNode[]>>();

/** `loadOutline`, once per document: the panel opens and closes, the outline stays the same. */
export function outlineOf(doc: PDFDocumentProxy): Promise<OutlineNode[]> {
  let outline = loaded.get(doc);
  if (!outline) {
    outline = loadOutline(doc);
    loaded.set(doc, outline);
  }
  return outline;
}
