import { useCallback, useEffect, useRef, useState } from "react";
import type { Paper } from "../api";
import { importArxiv, type ImportProgress } from "../lib/arxiv-import";
import {
  importPdf,
  isPdf,
  PDF_LIMIT_BYTES,
  type ImportStage,
} from "../lib/pdf-import";

/**
 * One import, from a dropped PDF or a pasted arXiv address, while it runs and,
 * when it fails, until it is retried or dismissed (one that worked goes away).
 */
export type ImportJob = {
  id: string;
  kind: "pdf" | "arxiv";
  /** What is being imported: the file's name or the address as typed. */
  label: string;
  status: "running" | "failed";
  /** For a PDF, the step of `importPdf`; for arXiv, the stage the service reports. */
  stage: string;
  received: number;
  total: number | null;
  /** arXiv only: the attempt (from 1) and the seconds until the next one, when it is busy. */
  attempt?: number;
  waitingSeconds?: number;
  /** Why it failed: a code this screen words (`notPdf`, `empty`, `tooLarge`), or the service's own sentence. */
  error: { code: "notPdf" | "empty" | "tooLarge" } | { message: string } | null;
};

/** Text that is an arXiv paper: an arxiv.org address, `arXiv:<id>`, or a bare new-style id. */
export function looksLikeArxiv(text: string): boolean {
  const value = text.trim();
  return (
    /arxiv\.org\/(abs|pdf|html)\/\S+/i.test(value) ||
    /^arxiv:\s*\S+$/i.test(value) ||
    /^\d{4}\.\d{4,5}(v\d+)?$/.test(value)
  );
}

/** The reason a file is refused before anything is sent, or null if it can be imported. */
function refuse(file: File): ImportJob["error"] {
  if (!isPdf(file)) return { code: "notPdf" };
  if (!file.size) return { code: "empty" };
  if (file.size > PDF_LIMIT_BYTES) return { code: "tooLarge" };
  return null;
}

const message = (error: unknown) => ({
  message: error instanceof Error ? error.message : String(error),
});

/**
 * The imports of a screen. `onImported` hears of each paper that was made, and
 * whether it was the only import started at once (the screen then opens it).
 */
export function useImports(onImported: (paper: Paper, only: boolean) => void) {
  const [jobs, setJobs] = useState<ImportJob[]>([]);
  const retries = useRef(new Map<string, () => void>());
  const mounted = useRef(true);
  const handler = useRef(onImported);
  handler.current = onImported;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const patch = useCallback((id: string, change: Partial<ImportJob>) => {
    if (mounted.current)
      setJobs((all) =>
        all.map((job) => (job.id === id ? { ...job, ...change } : job)),
      );
  }, []);
  const finish = useCallback((id: string) => {
    retries.current.delete(id);
    if (mounted.current) setJobs((all) => all.filter((job) => job.id !== id));
  }, []);

  const runPdf = useCallback(
    (id: string, file: File, only: boolean) => {
      const refused = refuse(file);
      if (refused) {
        patch(id, { status: "failed", error: refused });
        return;
      }
      patch(id, { status: "running", stage: "reading", error: null });
      importPdf(file, (stage: ImportStage) => patch(id, { stage }))
        .then((paper) => {
          finish(id);
          handler.current(paper, only);
        })
        .catch((error) =>
          patch(id, { status: "failed", error: message(error) }),
        );
    },
    [patch, finish],
  );

  const runArxiv = useCallback(
    (id: string, url: string) => {
      patch(id, {
        status: "running",
        stage: "metadata",
        received: 0,
        total: null,
        attempt: undefined,
        waitingSeconds: undefined,
        error: null,
      });
      importArxiv(url, (value: ImportProgress) =>
        patch(id, {
          stage: value.stage,
          received: value.received,
          total: value.total,
          attempt: value.attempt,
          waitingSeconds: value.waiting_seconds,
        }),
      )
        .then((paper) => {
          finish(id);
          handler.current(paper, true);
        })
        .catch((error) =>
          patch(id, { status: "failed", error: message(error) }),
        );
    },
    [patch, finish],
  );

  const blank = (kind: ImportJob["kind"], label: string): ImportJob => ({
    id: crypto.randomUUID(),
    kind,
    label,
    status: "running",
    stage: kind === "pdf" ? "reading" : "metadata",
    received: 0,
    total: null,
    error: null,
  });

  const importFiles = useCallback(
    (files: File[]) => {
      const added = files.map((file) => ({
        file,
        job: blank("pdf", file.name),
      }));
      setJobs((all) => [...all, ...added.map(({ job }) => job)]);
      const only = files.length === 1;
      for (const { file, job } of added) {
        retries.current.set(job.id, () => runPdf(job.id, file, only));
        runPdf(job.id, file, only);
      }
    },
    [runPdf],
  );

  const importUrl = useCallback(
    (url: string) => {
      const job = blank("arxiv", url.trim());
      setJobs((all) => [...all, job]);
      retries.current.set(job.id, () => runArxiv(job.id, job.label));
      runArxiv(job.id, job.label);
    },
    [runArxiv],
  );

  const retry = useCallback((id: string) => retries.current.get(id)?.(), []);
  const dismiss = useCallback((id: string) => finish(id), [finish]);

  return { jobs, importFiles, importUrl, retry, dismiss };
}

export type Imports = ReturnType<typeof useImports>;
