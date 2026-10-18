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

/** What a destination is looked up in. */
export type DestinationSource = Pick<
  OutlineSource,
  "getDestination" | "getPageIndex" | "numPages"
>;

/**
 * A destination looked up: the page it points at, from 1, and the array that
 * says where on it. A destination is such an array, whose first item is the page
 * (a number, or a reference to look up), or the name of one the document defines.
 * `null` for whatever does not lead to a page of this document: a name nothing
 * defines, a reference that is not a page, a failure.
 */
export async function resolveDestination(
  doc: DestinationSource,
  dest: unknown,
): Promise<{ page: number; target: unknown[] } | null> {
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
      ? { page, target }
      : null;
  } catch {
    return null;
  }
}

/** The page a destination points at, from 1; `null` as for `resolveDestination`. */
export async function destinationPage(
  doc: DestinationSource,
  dest: unknown,
): Promise<number | null> {
  return (await resolveDestination(doc, dest))?.page ?? null;
}

/**
 * The point on the page a destination's array names, in the PDF's units (from
 * the page's bottom left), as far as it names one: `[page, /XYZ, left, top,
 * zoom]`, `[page, /FitH, top]`, `[page, /FitBH, top]`, `[page, /FitR, left,
 * bottom, right, top]`. Anything else (`/Fit`, a `null` left as "unchanged") is
 * `null` there.
 */
export function destinationPoint(target: readonly unknown[]): {
  left: number | null;
  top: number | null;
} {
  const kind = (target[1] as { name?: unknown } | null | undefined)?.name;
  const number = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value) ? value : null;
  switch (kind) {
    case "XYZ":
      return { left: number(target[2]), top: number(target[3]) };
    case "FitH":
    case "FitBH":
      return { left: null, top: number(target[2]) };
    case "FitR":
      return { left: number(target[2]), top: number(target[5]) };
    default:
      return { left: null, top: null };
  }
}

/** What a link is followed in: looking up its destination, and the page it lands on. */
export type LinkSource = DestinationSource & Pick<PDFDocumentProxy, "getPage">;

/**
 * Where following a link inside the PDF goes: the page, from 1, and how far down
 * it the destination is, as a fraction of the page's height (0, the top, when the
 * destination does not say), `lead` units of the PDF above it so that the line
 * it names is not hard against the edge. `null` for a destination that leads nowhere.
 */
export async function linkTarget(
  doc: LinkSource,
  dest: unknown,
  lead = 0,
): Promise<{ page: number; offset: number } | null> {
  const resolved = await resolveDestination(doc, dest);
  if (!resolved) return null;
  const { top } = destinationPoint(resolved.target);
  if (top === null) return { page: resolved.page, offset: 0 };
  try {
    const viewport = (await doc.getPage(resolved.page)).getViewport({
      scale: 1,
    });
    // The PDF counts up from the page's foot: room above the point is a larger y.
    const [, y] = viewport.convertToViewportPoint(0, top + lead);
    const offset = y / viewport.height;
    return {
      page: resolved.page,
      offset: Number.isFinite(offset) ? Math.max(0, Math.min(1, offset)) : 0,
    };
  } catch {
    return { page: resolved.page, offset: 0 };
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
