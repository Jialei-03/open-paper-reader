import type { PdfRect } from "../features/PdfAnnotations";

/** What the reader asks the assistant about: a selection, a page or a boxed region. */
export type ReaderAction =
  | "ask"
  | "explain"
  | "translate"
  /** A boxed formula: explained, or written out as LaTeX. */
  | "formula"
  | "latex";

export type AskRequest = {
  paperId: string;
  fileId: string;
  versionId?: string;
  page: number;
  source: "selection" | "page" | "region";
  action: ReaderAction;
  /** The selected text, when the source is a selection. */
  quote?: string;
  /** Up to 40 characters before the quote on its page, to tell repeats apart. */
  prefix?: string;
  /** Normalised (0–1) line boxes of the selection on its page. */
  rects?: PdfRect[];
  /** Normalised [x, y, w, h] of a boxed region. */
  rect?: number[];
  /** What the reader typed, when they asked a question. */
  question?: string;
};

/** The backend's reader_context body (backend/reader_context.py ReaderContextInput). */
export function readerContext(request: AskRequest) {
  return {
    paper_id: request.paperId,
    file_id: request.fileId,
    ...(request.versionId ? { version_id: request.versionId } : {}),
    page: request.page,
    source: request.source,
    action: request.action,
    ...(request.source === "selection" && request.quote
      ? {
          quote: request.quote,
          prefix: request.prefix ?? "",
          rects: request.rects ?? [],
        }
      : {}),
    ...(request.source === "region" && request.rect
      ? { rect: request.rect }
      : {}),
  };
}
