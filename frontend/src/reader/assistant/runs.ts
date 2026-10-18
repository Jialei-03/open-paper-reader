import { parseReaderRoute, type ReaderRoute } from "../route";

/**
 * A run of the assistant as the service lists it (`GET /agent/sessions/{id}/runs`,
 * backend agents.py `output`): the question, the answer as it is written, and
 * the steps taken on the way. Pure functions over it, so the thread, the
 * composer and the tests read a run the same way.
 */
export type RunStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

/** A tool the assistant called: what it was given, and what came back. */
export interface AgentStep {
  name: string;
  label?: string;
  /** `running`, `completed` or `failed`. */
  status: string;
  arguments?: unknown;
  result?: { summary?: string; truncated?: boolean };
  error?: string;
}

/** What the reader pointed at when asking, as the service froze it (backend reader_context.py). */
export interface RunContext {
  paper_id: string;
  file_id: string;
  version_id?: string | null;
  page: number;
  source: "selection" | "page" | "region" | "paper";
  action?: string | null;
  category?: string | null;
  quote?: string;
  prefix?: string;
  rect?: number[] | null;
  rects?: { x: number; y: number; w: number; h: number }[];
  /** Added by the service for showing; not sent back. */
  title?: string;
  file_name?: string;
  file_sha256?: string;
  source_url?: string;
}

export interface AgentRun {
  id: string;
  prompt: string;
  /** Grows while the run is running. */
  response: string;
  status: RunStatus | (string & {});
  error: string;
  steps: AgentStep[];
  runtime?: {
    phase?: string;
    execution_seconds?: number;
    waiting_seconds?: number;
    reader_context?: RunContext;
  };
}

/** Still being worked on: waiting its turn, or running. */
export const isActive = (run: AgentRun) =>
  run.status === "queued" || run.status === "running";

/**
 * The runs the thread shows, oldest first. A translation of a selection is
 * shown beside the selection instead (it is the reading, not a question).
 */
export const conversation = (runs: AgentRun[]) =>
  runs.filter((run) => run.runtime?.reader_context?.action !== "translate");

/** The fields of a frozen context the service takes again (ReaderContextInput); the rest it added itself. */
const INPUT_FIELDS = [
  "paper_id",
  "file_id",
  "version_id",
  "page",
  "source",
  "action",
  "category",
  "quote",
  "prefix",
  "rect",
  "rects",
] as const;

/** A run's context as a `reader_context` body, to ask the same again. */
export function resendable(
  context: RunContext | undefined,
): Record<string, unknown> | undefined {
  if (!context) return undefined;
  const body: Record<string, unknown> = {};
  for (const key of INPUT_FIELDS) {
    const value = context[key];
    if (value !== undefined && value !== null) body[key] = value;
  }
  return body;
}

const whole = (value: unknown): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 1
    ? value
    : null;

const args = (step: AgentStep) =>
  step.arguments && typeof step.arguments === "object"
    ? (step.arguments as Record<string, unknown>)
    : {};

/** The pages a reading step read, first and last; `null` when it does not say. */
function pagesRead(step: AgentStep): [number, number] | null {
  const given = args(step);
  const first = whole(given.page);
  if (!first) return null;
  if (step.name === "read_file")
    return [first, first + (whole(given.pages) ?? 1) - 1];
  return [first, first];
}

/** What the collapsed line says about a run. */
export interface ProcessSummary {
  /** How long it has worked, in whole seconds; `null` before it has started. */
  seconds: number | null;
  /** The pages it read (each counted once). */
  pages: number;
  searches: number;
  /** Every other step. */
  others: number;
}

const READS = new Set(["read_file", "read_region"]);
const SEARCHES = new Set(["search_file"]);

export function summarize(run: AgentRun): ProcessSummary {
  const pages = new Set<number>();
  let unnamed = 0;
  let searches = 0;
  let others = 0;
  for (const step of run.steps ?? []) {
    if (READS.has(step.name)) {
      const range = pagesRead(step);
      if (range)
        for (let page = range[0]; page <= range[1]; page++) pages.add(page);
      else unnamed += 1;
    } else if (SEARCHES.has(step.name)) searches += 1;
    else others += 1;
  }
  const seconds = run.runtime?.execution_seconds;
  return {
    seconds:
      typeof seconds === "number" && Number.isFinite(seconds)
        ? Math.max(0, Math.round(seconds))
        : null,
    pages: pages.size + unnamed,
    searches,
    others,
  };
}

/** One step, as the expanded list names it. */
export type StepDescription =
  | { kind: "read"; first: number | null; last: number | null }
  | { kind: "region"; page: number | null }
  | { kind: "image"; page: number | null }
  | { kind: "search"; query: string; found: number | null }
  | { kind: "tool"; name: string };

/** The summary of a result is JSON cut at 2000 characters: read what is whole of it. */
function resultOf(step: AgentStep): Record<string, unknown> | null {
  const summary = step.result?.summary;
  if (!summary) return null;
  try {
    const value: unknown = JSON.parse(summary);
    return value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function describeStep(step: AgentStep): StepDescription {
  const given = args(step);
  switch (step.name) {
    case "read_file": {
      const range = pagesRead(step);
      return {
        kind: "read",
        first: range?.[0] ?? null,
        last: range?.[1] ?? null,
      };
    }
    case "read_region":
      return { kind: "region", page: whole(given.page) };
    case "view_image":
      return { kind: "image", page: whole(given.page) };
    case "search_file": {
      const total = resultOf(step)?.total;
      return {
        kind: "search",
        query: typeof given.query === "string" ? given.query : "",
        found: typeof total === "number" && total >= 0 ? total : null,
      };
    }
    default:
      return { kind: "tool", name: step.name };
  }
}

/**
 * Where a link in an answer leads, when it leads into a paper: the assistant
 * cites as the old reader addresses (`#paper/<id>?file=…&page=…&quote=…`), and
 * the new reader reads the same query after `#read/`. Anything else is `null`.
 */
export function citedRoute(href: string | undefined): ReaderRoute | null {
  if (!href) return null;
  const hash = href.startsWith("#") ? href.slice(1) : href;
  if (hash.startsWith("paper/"))
    return parseReaderRoute("read/" + hash.slice("paper/".length));
  if (hash.startsWith("read/")) return parseReaderRoute(hash);
  return null;
}

/** At most `length` characters of `text` on one line, with an ellipsis when cut. */
export function shorten(text: string, length: number): string {
  const line = text.replace(/\s+/g, " ").trim();
  const chars = Array.from(line);
  return chars.length > length
    ? chars
        .slice(0, length - 1)
        .join("")
        .trimEnd() + "…"
    : line;
}
