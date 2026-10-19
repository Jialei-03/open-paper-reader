/** The four kinds of key sentence, in the order they are listed. */
export const CATEGORIES = ["novelty", "method", "results", "limits"] as const;
export type Category = (typeof CATEGORIES)[number];

/** A sentence of the paper the service found and checked against the paper's own text. */
export type Keypoint = {
  /** Its place in the list; the same sentence keeps it while the list is the same. */
  id: string;
  page: number;
  /** The sentence as the paper has it: what it is found by on its page. */
  quote: string;
  category: Category;
  /** One line on why it matters; empty when none was given. */
  reason: string;
};

/** A reading artifact as the service sends it, as far as the key sentences read it. */
export type KeypointArtifact = {
  id: string;
  file_id: string;
  kind: string;
  status: string;
  error?: string;
  result?: unknown;
  /** What a new run is replacing: still used until the new one completes. */
  previous?: unknown;
};

const isCategory = (value: unknown): value is Category =>
  typeof value === "string" &&
  (CATEGORIES as readonly string[]).includes(value);

/** The well formed sentences of a result; one that is odd is left out, never breaking the rest. */
export function readKeypoints(value: unknown): Keypoint[] {
  const list =
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>).keypoints
      : null;
  if (!Array.isArray(list)) return [];
  const found: Keypoint[] = [];
  for (const entry of list) {
    if (typeof entry !== "object" || entry === null) continue;
    const row = entry as Record<string, unknown>;
    if (
      !Number.isInteger(row.page) ||
      (row.page as number) < 1 ||
      typeof row.quote !== "string" ||
      !row.quote.trim() ||
      !isCategory(row.category)
    )
      continue;
    found.push({
      id: `${found.length}`,
      page: row.page as number,
      quote: row.quote,
      category: row.category,
      reason: typeof row.reason === "string" ? row.reason : "",
    });
  }
  return found;
}

export const isWorking = (row: KeypointArtifact | null) =>
  row !== null && (row.status === "queued" || row.status === "running");

/** The key sentences of a PDF among a paper's reading artifacts: one being made, else a finished one, else the latest. */
export function pickKeypoints(
  rows: readonly KeypointArtifact[],
  fileId: string,
): KeypointArtifact | null {
  const mine = rows.filter(
    (row) => row.kind === "keypoints" && row.file_id === fileId,
  );
  return (
    mine.find(isWorking) ??
    mine.find(
      (row) =>
        row.status === "completed" && readKeypoints(row.result).length > 0,
    ) ??
    mine[0] ??
    null
  );
}

/** Whether a guide for the PDF has been written: the sentences are asked for after it, not beside it. */
export function guideDone(
  rows: readonly KeypointArtifact[],
  fileId: string,
): boolean {
  return rows.some(
    (row) =>
      row.kind === "guide" &&
      row.file_id === fileId &&
      row.status === "completed",
  );
}

/** The sentences of the categories that are shown, in the paper's order. */
export const shown = (
  items: readonly Keypoint[],
  hidden: ReadonlySet<Category>,
): Keypoint[] => items.filter((item) => !hidden.has(item.category));
