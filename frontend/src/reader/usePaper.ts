import { useEffect, useMemo, useState } from "react";
import { api, ApiError, type Paper, type SourceFile } from "../api";
import { useI18n } from "../i18n/I18nProvider";

export interface PaperState {
  paper: Paper | null;
  files: SourceFile[];
  /** The file the address names if it is a PDF, else the paper's first PDF. */
  pdf: SourceFile | null;
  /** Why the paper is not here, in a sentence for the person; empty while it is or while loading. */
  error: string;
  /** The service says there is no such paper (`error` then says so, and trying again will not help). */
  missing: boolean;
  loading: boolean;
  /** Ask again after an `error`. */
  retry(): void;
}

type Answer =
  | { key: string; paper: Paper; files: SourceFile[] }
  | { key: string; error: string; missing: boolean }
  | { key: string; crash: Error };

const isPdf = (file: SourceFile) => file.mime === "application/pdf";
const NO_FILES: SourceFile[] = [];

/**
 * Reads a paper and its files. What the service answers with a reason (the paper
 * is not there, it refuses) comes back as `error`, to be explained. An answer that
 * is no answer at all (a body that cannot be read, no network) is not something
 * to explain: it is thrown while drawing, for the boundary around the card to
 * catch and offer a retry. So call this inside that boundary.
 */
export function usePaper(paperId: string, fileId?: string): PaperState {
  const { t } = useI18n();
  const [attempt, setAttempt] = useState(0);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const key = `${paperId}:${attempt}`;

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    const id = encodeURIComponent(paperId);
    Promise.all([
      api<Paper>(`/papers/${id}`, { signal }),
      api<SourceFile[]>(`/papers/${id}/files`, { signal }),
    ]).then(
      ([paper, files]) => {
        if (!signal.aborted) setAnswer({ key, paper, files });
      },
      (reason: unknown) => {
        if (signal.aborted) return;
        if (reason instanceof ApiError) {
          const missing = reason.status === 404;
          setAnswer({
            key,
            error: missing
              ? t("reader.notFound")
              : reason.message || t("reader.loadFailed"),
            missing,
          });
        } else {
          setAnswer({
            key,
            crash: reason instanceof Error ? reason : new Error(String(reason)),
          });
        }
      },
    );
    return () => controller.abort();
    // The language changing (`t`) is no reason to ask again.
  }, [key]);

  // An answer to an earlier paper (or attempt) is not this one's.
  const current = answer?.key === key ? answer : null;
  if (current && "crash" in current) throw current.crash;

  const loaded = current && "paper" in current ? current : null;
  const files = loaded?.files;
  const pdf = useMemo(() => {
    if (!files) return null;
    return (
      files.find((file) => file.id === fileId && isPdf(file)) ??
      files.find(isPdf) ??
      null
    );
  }, [files, fileId]);

  return {
    paper: loaded?.paper ?? null,
    files: files ?? NO_FILES,
    pdf,
    error: current && "error" in current ? current.error : "",
    missing: current !== null && "missing" in current && current.missing,
    loading: current === null,
    retry: () => setAttempt((count) => count + 1),
  };
}
