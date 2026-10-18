import type { PdfRect, PdfSelection } from "../../features/PdfAnnotations";
import type { Rect } from "../../ui";

/**
 * Where a layer over a selection is pinned: a box on one page, in fractions of
 * the page, so that it goes along with the page when the paper scrolls. A box
 * in window coordinates would stay where the selection was.
 */
export interface PageSpot {
  page: number;
  rect: PdfRect;
}

const sheetOf = (scroller: HTMLElement, page: number) =>
  scroller.querySelector<HTMLElement>(`[data-page="${page}"]`);

/**
 * The spot of a selection: the point it was right-clicked at (`at`), else its
 * last line, the lowest box on the last page it touches. This reader never
 * turns its pages, so the boxes are where they are drawn.
 */
export function selectionSpot(
  scroller: HTMLElement,
  selection: PdfSelection,
  at?: { x: number; y: number },
): PageSpot | null {
  if (at)
    for (const sheet of scroller.querySelectorAll<HTMLElement>("[data-page]")) {
      const box = sheet.getBoundingClientRect();
      if (!box.width || !box.height || at.y < box.top || at.y > box.bottom)
        continue;
      return {
        page: Number(sheet.dataset.page),
        rect: {
          x: (at.x - box.left) / box.width,
          y: (at.y - box.top) / box.height,
          w: 0,
          h: 0,
        },
      };
    }
  const last = selection.parts?.at(-1) ?? selection;
  let lowest: PdfRect | null = null;
  for (const rect of last.rects)
    if (!lowest || rect.y + rect.h >= lowest.y + lowest.h) lowest = rect;
  return lowest ? { page: last.page, rect: lowest } : null;
}

/** The spot in window coordinates as the page is now; null while its page is not in the scroller. */
export function spotRect(scroller: HTMLElement, spot: PageSpot): Rect | null {
  const sheet = sheetOf(scroller, spot.page);
  if (!sheet) return null;
  const box = sheet.getBoundingClientRect();
  return {
    x: box.left + spot.rect.x * box.width,
    y: box.top + spot.rect.y * box.height,
    width: spot.rect.w * box.width,
    height: spot.rect.h * box.height,
  };
}

/** Whether the box has gone out of the scroller's view altogether. */
export function outOfView(scroller: HTMLElement, rect: Rect): boolean {
  const view = scroller.getBoundingClientRect();
  return (
    rect.y + rect.height < view.top ||
    rect.y > view.bottom ||
    rect.x + rect.width < view.left ||
    rect.x > view.right
  );
}
