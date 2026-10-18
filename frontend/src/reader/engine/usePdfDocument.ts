import { useEffect, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { useI18n } from "../../i18n/I18nProvider";
import type { MessageKey } from "../../i18n/i18n";

export interface PdfDocumentState {
  /** The open document; `null` while it loads, after it failed, and without a file. */
  doc: PDFDocumentProxy | null;
  /** Bytes received so far, and of how many (`total` is 0 while the size is unknown). */
  progress: { loaded: number; total: number };
  /** Why the document could not be opened, in a sentence for the person; empty otherwise. */
  error: string;
  /** Open it again after an `error`. */
  retry(): void;
}

type Answer =
  | { key: string; doc: PDFDocumentProxy }
  | { key: string; progress: { loaded: number; total: number } }
  | { key: string; reason: MessageKey };

const NOTHING = { loaded: 0, total: 0 };

/** What went wrong, from the name pdf.js gives its errors (they cross from its worker as plain errors). */
function reasonFor(error: unknown): MessageKey {
  const name = error instanceof Error ? error.name : "";
  const status = (error as { status?: number } | null)?.status;
  if (name === "PasswordException") return "reader.pdf.password";
  if (name === "InvalidPDFException") return "reader.pdf.invalid";
  if (name === "ResponseException")
    return status === 404 ? "reader.pdf.missing" : "reader.pdf.network";
  // A fetch that never got an answer (offline, the connection dropped).
  if (error instanceof TypeError) return "reader.pdf.network";
  return "reader.pdf.failed";
}

/**
 * Opens the PDF of a file through pdf.js, a range at a time (as the old reader
 * does), and reports how far the download has got. Changing `fileId`, or
 * leaving, closes the document and its worker.
 */
export function usePdfDocument(fileId: string | null): PdfDocumentState {
  const { t } = useI18n();
  const [attempt, setAttempt] = useState(0);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const key = `${fileId}:${attempt}`;

  useEffect(() => {
    if (!fileId) return;
    let cancelled = false;
    // pdf.js keeps reporting progress as later ranges arrive; once open, that is not news here.
    let opened = false;
    let task: ReturnType<typeof import("pdfjs-dist").getDocument> | undefined;
    import("pdfjs-dist")
      .then(async (pdfjs) => {
        if (cancelled) return;
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.min.mjs",
          import.meta.url,
        ).toString();
        task = pdfjs.getDocument({
          url: "/api/v1/files/" + fileId + "/content",
          withCredentials: true,
          isEvalSupported: false,
          disableAutoFetch: true,
          disableStream: true,
          rangeChunkSize: 256 * 1024,
          cMapUrl: "/assets/pdfjs/cmaps/",
          cMapPacked: true,
          standardFontDataUrl: "/assets/pdfjs/standard_fonts/",
          wasmUrl: "/assets/pdfjs/wasm/",
        });
        task.onProgress = ({ loaded, total }: typeof NOTHING) => {
          if (!cancelled && !opened)
            setAnswer({ key, progress: { loaded, total: total || 0 } });
        };
        const doc = await task.promise;
        opened = true;
        if (!cancelled) setAnswer({ key, doc });
      })
      .catch((error: unknown) => {
        if (!cancelled) setAnswer({ key, reason: reasonFor(error) });
      });
    return () => {
      cancelled = true;
      // Destroying the task destroys the document it opened, and its worker.
      void task?.destroy();
    };
  }, [key, fileId]);

  // What was answered for an earlier file (or attempt) is not this one's: that document is closed.
  const current = answer?.key === key ? answer : null;
  return {
    doc: current && "doc" in current ? current.doc : null,
    progress: current && "progress" in current ? current.progress : NOTHING,
    error: current && "reason" in current ? t(current.reason) : "",
    retry: () => setAttempt((count) => count + 1),
  };
}
