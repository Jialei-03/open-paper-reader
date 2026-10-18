import type { AlignmentUnit } from "../compare/scroll-map";

/**
 * How the translated PDF is made: `latex` translates an arXiv paper's LaTeX
 * source and compiles it again; `pdf` (BabelDOC) re-typesets the original PDF.
 */
export type Engine = "latex" | "pdf";

/** `external_id` names a fixed arXiv version (`arxiv:2504.19413v1`): its source can be fetched. */
export const isArxivVersion = (externalId: string | undefined): boolean =>
  /^arxiv:.+v\d+$/i.test((externalId ?? "").trim());

/** A translation job as the service lists it (`GET /papers/{id}/translations`); only what the reader reads. */
export interface LayoutJob {
  id: string;
  engine?: Engine;
  /** The paper version translated: a LaTeX translation is of the whole version, not of one PDF. */
  version_id?: string;
  status: string;
  /** What the job is doing, in the service's words. */
  stage: string;
  /** For a layout translation these are out of 100: the percentage done. */
  completed: number;
  total: number;
  error: string;
  /** A LaTeX translation failed because arXiv has no LaTeX source for the version. */
  no_source?: boolean;
  /** The PDF that was translated. */
  source_file: string;
  /** The PDF that came of it; empty until the job has completed. */
  translated_file: string;
  /**
   * Where each unit of text is in the original and in the translation (a LaTeX
   * translation's "建立原译文对照" stage); empty for a layout translation.
   */
  alignment?: AlignmentUnit[];
}

export const isActive = (job: LayoutJob | null): boolean =>
  job !== null && (job.status === "queued" || job.status === "running");

/** The two ways, in the order the reader lists them. */
export const ENGINES: readonly Engine[] = ["latex", "pdf"];

/** A job that has a translated PDF to show. */
const isDone = (job: LayoutJob) =>
  job.status === "completed" && job.translated_file !== "";

/**
 * The layout translation of this PDF that matters, from the paper's jobs
 * (newest first, as the service lists them): the one that is running; else the
 * newest that has completed (a later one that failed or was stopped does not
 * take the translation away); else the newest, which is the failure to explain.
 * Both ways count: the layout translations of this PDF, and the LaTeX
 * translations of the paper's current version.
 */
export function pickJob(
  jobs: LayoutJob[],
  fileId: string,
  /** The paper's current version; without it LaTeX translations are left out. */
  versionId = "",
  /** Only this method's jobs; each method keeps its own result, so the reader asks for them one by one. */
  engine?: Engine,
): LayoutJob | null {
  const mine = jobs.filter(
    (job) =>
      (engine === undefined || job.engine === engine) &&
      (job.engine === "latex"
        ? versionId !== "" && job.version_id === versionId
        : job.engine === "pdf" && job.source_file === fileId),
  );
  return (
    mine.find(isActive) ?? mine.find(isDone) ?? mine.find(() => true) ?? null
  );
}

/** What the paper area says about the translation. */
export type LayoutState =
  /** Nothing is going on: it can be started. */
  "idle" | "running" | "failed" | "done";

export function layoutState(job: LayoutJob | null): LayoutState {
  if (!job) return "idle";
  if (isActive(job)) return "running";
  if (isDone(job)) return "done";
  // A job that was stopped is not a failure to explain.
  return job.status === "failed" ? "failed" : "idle";
}

/** How far a running job has got, 0 to 100; `null` while that is not known. */
export function percentOf(job: LayoutJob): number | null {
  if (!(job.total > 0)) return null;
  return Math.max(
    0,
    Math.min(100, Math.round((job.completed / job.total) * 100)),
  );
}

/**
 * A LaTeX translation that failed because arXiv has no LaTeX source for this
 * version (the service's `NO_SOURCE`): trying again cannot help, the PDF way can.
 */
export const lacksSource = (job: LayoutJob | null): boolean =>
  job !== null &&
  job.engine === "latex" &&
  job.status === "failed" &&
  job.no_source === true;

const choiceKey = (paperId: string) => `paper-translation-engine:${paperId}`;

/** The method the person last chose to read for this paper, if any (the browser may not keep it). */
export function readChoice(paperId: string): Engine | null {
  try {
    const value = localStorage.getItem(choiceKey(paperId));
    return value === "latex" || value === "pdf" ? value : null;
  } catch {
    return null;
  }
}

export function writeChoice(paperId: string, engine: Engine): void {
  try {
    localStorage.setItem(choiceKey(paperId), engine);
  } catch {
    // Not kept; the choice still holds for this visit.
  }
}

/**
 * Which method's result the reader shows. The person's own choice for the paper
 * if it can be made; else the one that has completed (LaTeX first), else the one
 * running; else LaTeX for an arXiv paper and the PDF way for the rest.
 */
export function defaultEngine(
  states: Record<Engine, LayoutState>,
  arxiv: boolean,
  chosen: Engine | null,
): Engine {
  const usable = (engine: Engine) =>
    engine === "pdf" || arxiv || states[engine] !== "idle";
  if (chosen && usable(chosen)) return chosen;
  for (const wanted of ["done", "running"] as const) {
    const found = ENGINES.find((engine) => states[engine] === wanted);
    if (found) return found;
  }
  return arxiv ? "latex" : "pdf";
}
