import type {
  PdfAnnotation,
  usePdfAnnotations,
} from "../../features/PdfAnnotations";
import { toast } from "../../ui";
import { excerptMarkdown, plainMarkdown } from "../notes/excerpt";

export type HighlightStore = ReturnType<typeof usePdfAnnotations>;

/**
 * The block a highlight adds to the note: its words quoted, its comment under
 * them, and the way back to it in the paper (`source`, e.g. "原文 · 第 3 页").
 */
export function highlightMarkdown(
  row: PdfAnnotation,
  paperId: string,
  source: string,
): string {
  const block = excerptMarkdown(
    {
      paperId,
      fileId: row.file_id,
      page: row.page,
      quote: row.quote,
      prefix: row.prefix,
    },
    source,
  );
  const comment = row.comment.replace(/\r\n?/g, "\n").trim();
  if (!comment) return block;
  // The comment goes between the quotation and the link back.
  const cut = block.lastIndexOf("\n\n");
  return `${block.slice(0, cut)}\n\n${plainMarkdown(comment)}${block.slice(cut)}`;
}

/**
 * Takes a highlight away, and says so with a way to put it back (as it was:
 * its words, color and comment).
 */
export async function removeHighlight(
  store: HighlightStore,
  row: PdfAnnotation,
  words: { removed: string; undo: string; failed: string },
) {
  if (!(await store.remove(row))) {
    toast.show({ message: words.failed, tone: "error" });
    return false;
  }
  toast.show({
    message: words.removed,
    action: {
      label: words.undo,
      onClick: () =>
        void store.add(
          {
            text: row.quote,
            prefix: row.prefix,
            page: row.page,
            rects: row.rects,
          },
          row.color,
          row.comment,
        ),
    },
  });
  return true;
}
