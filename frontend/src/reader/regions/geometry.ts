import type { PdfRect } from "../../features/PdfAnnotations";
import { readerHash } from "../route";

/** A box smaller than this, in pixels on either side, is a click that wobbled, not a region. */
export const MIN_REGION_PIXELS = 14;

const clamp = (value: number) => Math.min(1, Math.max(0, value));
/** Four places: a thousandth of a pixel on any page, and short enough for an address. */
const round = (value: number) => Math.round(value * 10000) / 10000;

export interface Point {
  x: number;
  y: number;
}

/**
 * The region between two points of one page, in fractions of the page from its
 * top left (the service's own terms, `rect` of a reader context). Points past
 * the page's edge are held to it; `null` for a box too small to mean anything.
 */
export function regionBetween(
  from: Point,
  to: Point,
  page: { width: number; height: number },
): PdfRect | null {
  if (!page.width || !page.height) return null;
  const x1 = clamp(Math.min(from.x, to.x));
  const y1 = clamp(Math.min(from.y, to.y));
  const x2 = clamp(Math.max(from.x, to.x));
  const y2 = clamp(Math.max(from.y, to.y));
  if (
    (x2 - x1) * page.width < MIN_REGION_PIXELS ||
    (y2 - y1) * page.height < MIN_REGION_PIXELS
  )
    return null;
  const x = Math.min(round(x1), 0.9999);
  const y = Math.min(round(y1), 0.9999);
  // Rounding must not push the box past the page (the service refuses that).
  return {
    x,
    y,
    w: Math.min(round(x2 - x1), round(1 - x)),
    h: Math.min(round(y2 - y1), round(1 - y)),
  };
}

/** The region as the service and the address write it: `x,y,w,h`. */
export const rectParameter = (rect: PdfRect) =>
  `${rect.x},${rect.y},${rect.w},${rect.h}`;

/** The picture of the region, drawn by the server from the PDF itself (sharp at any zoom). */
export const regionImageUrl = (fileId: string, page: number, rect: PdfRect) =>
  `/api/v1/agent/files/${fileId}/image?page=${page}&rect=${rectParameter(rect)}`;

/** What kind of thing the reader says the box holds; the service keeps it with the question. */
export type RegionKind = "explain" | "formula" | "latex";

/**
 * The block a region adds to the note: its picture, what was made of it (the
 * explanation or the LaTeX, already Markdown), then the way back to the box
 * (`source` is its text, e.g. "原文 · 第 3 页").
 */
export function regionMarkdown(args: {
  paperId: string;
  fileId: string;
  page: number;
  rect: PdfRect;
  /** The explanation, or the formula as LaTeX; empty to keep the picture alone. */
  text?: string;
  latex?: boolean;
  source: string;
  alt: string;
}): string {
  const { paperId, fileId, page, rect, text = "", latex, source, alt } = args;
  const link = readerHash({
    paperId,
    fileId,
    page,
    rect: rectParameter(rect),
  });
  const blocks = [
    `![${alt.replace(/[[\]]/g, "")}](${regionImageUrl(fileId, page, rect)})`,
  ];
  const body = text.trim();
  if (body) blocks.push(latex ? `$$\n${body}\n$$` : body);
  blocks.push(`[${source.replace(/[[\]]/g, "")}](${link})`);
  return blocks.join("\n\n");
}

/** The model may fence or wrap a formula although it was asked not to: the LaTeX alone. */
export function bareLatex(text: string): string {
  let value = text.trim();
  const fenced = /^```[a-z]*\n([\s\S]*?)\n?```$/i.exec(value);
  if (fenced) value = fenced[1].trim();
  const display = /^\$\$([\s\S]*)\$\$$/.exec(value);
  if (display) return display[1].trim();
  const inline = /^\$([^$]*)\$$/.exec(value);
  if (inline) return inline[1].trim();
  const bracket = /^\\\[([\s\S]*)\\\]$/.exec(value);
  return bracket ? bracket[1].trim() : value;
}
