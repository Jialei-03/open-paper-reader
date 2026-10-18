import { useEffect, useRef, useState, type RefObject } from "react";
import { api, type Paper, type SourceFile } from "../../api";

/** What is known about a paper's PDF once it has been looked up. */
export interface PaperPdf {
  file: SourceFile | null;
  /**
   * Where the small picture of the first page is served from (the server draws
   * it once and the browser keeps it); empty when the paper has no PDF.
   */
  thumb: string;
}

/** How many file lists are fetched at once. */
const PARALLEL = 4;

const known = new Map<string, PaperPdf>();
const running = new Map<string, Promise<PaperPdf>>();
const waiting: (() => void)[] = [];
let active = 0;

/** Runs `job` when fewer than PARALLEL others are running. */
function slot<T>(job: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const start = () => {
      active += 1;
      job()
        .then(resolve, reject)
        .finally(() => {
          active -= 1;
          waiting.shift()?.();
        });
    };
    if (active < PARALLEL) start();
    else waiting.push(start);
  });
}

/** Finds a paper's PDF, once per session (a later call gets the first answer). */
export function loadPaperPdf(paper: Paper): Promise<PaperPdf> {
  const key = paper.id + ":" + paper.current_version;
  const hit = known.get(key);
  if (hit) return Promise.resolve(hit);
  const pending = running.get(key);
  if (pending) return pending;
  const job = slot(async () => {
    const files = await api<SourceFile[]>("/papers/" + paper.id + "/files");
    const file =
      files.find(
        (f) =>
          f.version_id === paper.current_version &&
          f.mime === "application/pdf",
      ) ??
      files.find((f) => f.mime === "application/pdf") ??
      null;
    const answer = {
      file,
      thumb: file ? "/api/v1/files/" + file.id + "/thumbnail" : "",
    };
    known.set(key, answer);
    return answer;
  });
  running.set(key, job);
  void job.then(
    () => running.delete(key),
    () => running.delete(key),
  );
  return job;
}

/** The PDF of `paper`, looked up once the element in `target` is near the view. */
export function usePaperPdf(
  paper: Paper,
  target: RefObject<HTMLElement | null>,
): PaperPdf | null {
  const key = paper.id + ":" + paper.current_version;
  const [answer, setAnswer] = useState<{ key: string; pdf: PaperPdf } | null>(
    () => {
      const hit = known.get(key);
      return hit ? { key, pdf: hit } : null;
    },
  );
  const latest = useRef(paper);
  latest.current = paper;
  useEffect(() => {
    if (known.has(key)) {
      setAnswer({ key, pdf: known.get(key)! });
      return;
    }
    const element = target.current;
    if (!element) return;
    let live = true;
    const start = () =>
      loadPaperPdf(latest.current).then(
        (pdf) => live && setAnswer({ key, pdf }),
        () => live && setAnswer({ key, pdf: { file: null, thumb: "" } }),
      );
    if (typeof IntersectionObserver === "undefined") {
      void start();
      return () => {
        live = false;
      };
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        void start();
      },
      { rootMargin: "200px" },
    );
    observer.observe(element);
    return () => {
      live = false;
      observer.disconnect();
    };
  }, [key, target]);
  return answer?.key === key ? answer.pdf : null;
}
