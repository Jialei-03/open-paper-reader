/**
 * Where to put the other pane. A position is a page index from 0 plus how far
 * down the page it is (11.25: a quarter of the way down the twelfth page), as
 * `PdfController.position` gives it.
 *
 * The panes are kept page for page: page N of the original beside page N of
 * the translation, at the same point down the page. Matching by content drifts
 * where the translation runs longer and cannot find its way back; the page
 * number never drifts, so every scroll lands the other pane exactly.
 */

/** One unit of the job's `alignment`: where its text was found in each PDF (`null`: not found for sure). */
export interface AlignmentUnit {
  source?: { page?: number } | null;
  translated?: { page?: number } | null;
}

/** Maps a position of one PDF to the other's, and back. */
export interface ScrollMap {
  /** From the original's position to the translation's. */
  forward(position: number): number;
  /** From the translation's position to the original's. */
  backward(position: number): number;
  /** Always 0: the panes follow page numbers, not the alignment. */
  anchors: number;
}

/** The same place in a document of `pages` pages, kept inside its last page. */
function within(position: number, pages: number): number {
  if (!Number.isFinite(position) || pages < 1) return 0;
  return Math.min(Math.max(position, 0), pages - 1e-6);
}

/** Page for page between the original (`sourcePages`) and the translation (`translatedPages`). */
export function scrollMap(
  _alignment: readonly AlignmentUnit[] | null | undefined,
  sourcePages: number,
  translatedPages: number,
): ScrollMap {
  return {
    forward: (position) => within(position, translatedPages),
    backward: (position) => within(position, sourcePages),
    anchors: 0,
  };
}

/** How many units of the alignment name a page in both PDFs. */
export function alignedUnits(
  alignment: readonly AlignmentUnit[] | null | undefined,
): number {
  return (alignment ?? []).filter(
    (unit) => unit.source?.page && unit.translated?.page,
  ).length;
}
