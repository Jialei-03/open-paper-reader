import { rotateRect } from "./pdf-rotation";
import type { PdfRect, PdfSelection } from "../features/PdfAnnotations";

const MAX_TEXT = 10000;
type Fragment = NonNullable<PdfSelection["parts"]>[number];

/** One rect per visual line, in unrotated page units (0–1). */
function lineRects(range: Range, box: DOMRect, rotation: number): PdfRect[] {
  const raw = Array.from(range.getClientRects())
    .filter((rect) => rect.width > 0.5 && rect.height > 0.5)
    .map((rect) => {
      const x = Math.max(0, Math.min(1, (rect.left - box.left) / box.width));
      const y = Math.max(0, Math.min(1, (rect.top - box.top) / box.height));
      return {
        x,
        y,
        w: Math.max(0, Math.min(1 - x, rect.width / box.width)),
        h: Math.max(0, Math.min(1 - y, rect.height / box.height)),
      };
    })
    .filter((rect) => rect.w > 0 && rect.h > 0)
    .map((rect) => rotateRect(rect, -rotation));
  const lines: PdfRect[] = [];
  for (const rect of raw) {
    const line = lines.find(
      (line) =>
        Math.abs(line.y - rect.y) < 0.002 &&
        Math.abs(line.h - rect.h) < 0.002 &&
        rect.x <= line.x + line.w + 0.008 &&
        rect.x + rect.w >= line.x - 0.008,
    );
    if (line) {
      const right = Math.max(line.x + line.w, rect.x + rect.w);
      line.x = Math.min(line.x, rect.x);
      line.w = right - line.x;
    } else lines.push({ ...rect });
  }
  return lines;
}

/**
 * Reads the browser's text selection inside one PDF view.
 *
 * A reader drags across a page break as naturally as across a line, so the
 * selection is split per page: `page`, `prefix` and `rects` describe the page
 * where it starts (what "locate" and "explain" need), while `parts` — present
 * only when it spans pages — carries every page's own fragment so a highlight
 * can be stored on each page it touches.
 *
 * `at` places the menu at the pointer (right-click); otherwise it follows the
 * end of the selection.
 */
export function readPdfSelection(
  root: HTMLElement,
  rotation: number,
  at?: { x: number; y: number },
): PdfSelection | null {
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (
    !root.contains(range.startContainer) ||
    !root.contains(range.endContainer)
  )
    return null;
  const parts: Fragment[] = [];
  for (const layer of root.querySelectorAll<HTMLElement>(".textLayer")) {
    if (!range.intersectsNode(layer)) continue;
    const piece = range.cloneRange();
    if (!layer.contains(range.startContainer)) piece.setStart(layer, 0);
    if (!layer.contains(range.endContainer))
      piece.setEnd(layer, layer.childNodes.length);
    const text = piece.toString();
    if (!text.trim()) continue;
    const page = Number(
      layer.closest<HTMLElement>("[data-pdf-page]")?.dataset.pdfPage,
    );
    if (!page) continue;
    const before = document.createRange();
    before.selectNodeContents(layer);
    before.setEnd(piece.startContainer, piece.startOffset);
    parts.push({
      page,
      text,
      prefix: before.toString().slice(-40),
      rects: lineRects(
        piece,
        (layer.parentElement ?? layer).getBoundingClientRect(),
        rotation,
      ),
    });
  }
  const text = selection.toString().slice(0, MAX_TEXT);
  if (!parts.length || !text) return null;
  let anchor = at;
  if (!anchor) {
    const caret = range.cloneRange();
    if (selection.focusNode && root.contains(selection.focusNode)) {
      caret.setStart(selection.focusNode, selection.focusOffset);
      caret.collapse(true);
    } else caret.collapse(false);
    const end =
      caret.getClientRects()[0] ||
      Array.from(range.getClientRects()).at(-1) ||
      range.getBoundingClientRect();
    anchor = { x: end.right, y: end.bottom };
  }
  return {
    text,
    prefix: parts[0].prefix,
    page: parts[0].page,
    rects: parts[0].rects,
    anchor,
    ...(parts.length > 1 ? { parts } : {}),
  };
}

export function sameSelection(a: PdfSelection | null, b: PdfSelection | null) {
  if (!a || !b) return a === b;
  return (
    a.text === b.text &&
    a.page === b.page &&
    a.prefix === b.prefix &&
    a.rects.length === b.rects.length &&
    (a.parts?.length ?? 0) === (b.parts?.length ?? 0)
  );
}
