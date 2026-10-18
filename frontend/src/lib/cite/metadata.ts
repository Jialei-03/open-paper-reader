import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { api, ApiError } from "../../api";
import type { PaperMetadata } from "./types";

/**
 * The public records kept for the papers of the library, shared by the list, the
 * sheet and the reader so that a refresh in one shows in the others.
 */
let records: Record<string, PaperMetadata> = {};
const listeners = new Set<() => void>();
const publish = (next: Record<string, PaperMetadata>) => {
  records = next;
  listeners.forEach((listener) => listener());
};

export function putMetadata(meta: PaperMetadata) {
  publish({ ...records, [meta.paper_id]: meta });
}

export async function loadMetadata() {
  const all = await api<Record<string, PaperMetadata>>("/paper-metadata");
  publish(all);
}

/** Looks the paper up again on the public sources; throws the service's own words when it cannot. */
export async function refreshMetadata(paperId: string) {
  const meta = await api<PaperMetadata>(
    `/papers/${encodeURIComponent(paperId)}/metadata/refresh`,
    { method: "POST" },
  );
  putMetadata(meta);
  return meta;
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** Every record the library holds, loaded once when the first caller mounts. */
export function useMetadataMap() {
  const map = useSyncExternalStore(subscribe, () => records);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    loadMetadata()
      .then(() => setReady(true))
      .catch(() => undefined);
  }, []);
  return { map, ready };
}

export interface MetadataState {
  meta: PaperMetadata | null;
  loading: boolean;
  /** Why the last look-up failed (`slow`, `noId` or `failed`); empty otherwise. */
  error: "" | "slow" | "noId" | "failed";
  refresh(): void;
}

/**
 * One paper's record. A paper never looked up is looked up once, when this
 * is first asked for; after that only `refresh` does.
 */
export function usePaperMetadata(paperId: string | null): MetadataState {
  const map = useSyncExternalStore(subscribe, () => records);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<MetadataState["error"]>("");

  const refresh = useCallback(() => {
    if (!paperId) return;
    setLoading(true);
    setError("");
    refreshMetadata(paperId)
      .catch((reason: unknown) =>
        setError(
          reason instanceof ApiError && reason.status === 429
            ? "slow"
            : reason instanceof ApiError && reason.status === 422
              ? "noId"
              : "failed",
        ),
      )
      .finally(() => setLoading(false));
  }, [paperId]);

  useEffect(() => {
    setError("");
    setLoading(false);
    if (!paperId) return;
    const controller = new AbortController();
    void (async () => {
      let meta = records[paperId];
      if (!meta) {
        try {
          meta = await api<PaperMetadata>(
            `/papers/${encodeURIComponent(paperId)}/metadata`,
            { signal: controller.signal },
          );
        } catch {
          return;
        }
        if (controller.signal.aborted) return;
        if (meta.status !== "none") putMetadata(meta);
      }
      if (meta.status === "none") {
        refresh();
      }
    })();
    return () => controller.abort();
  }, [paperId, refresh]);

  return {
    meta: paperId ? (map[paperId] ?? null) : null,
    loading,
    error,
    refresh,
  };
}

const FILL_LIMIT = 40;
const FILL_GAP_MS = 6000;

/**
 * Fills in the papers that have a DOI or arXiv number and no record yet, slowly
 * (the service allows a dozen a minute) and quietly: a failure ends the run.
 * Only public identifiers are looked up this way, never a title.
 */
export function useMetadataFill(
  papers: { id: string; external_id: string }[],
  map: Record<string, PaperMetadata>,
  ready: boolean,
) {
  const wanted = papers
    .filter(
      (paper) =>
        !map[paper.id] &&
        /10\.\d{4,9}\/|\d{4}\.\d{4,5}|[a-z-]+\/\d{7}/i.test(paper.external_id),
    )
    .map((paper) => paper.id)
    .slice(0, FILL_LIMIT)
    .join(",");
  useEffect(() => {
    if (!ready || !wanted) return;
    let stopped = false;
    let timer = 0;
    const queue = wanted.split(",");
    const next = () => {
      const id = queue.shift();
      if (!id || stopped) return;
      refreshMetadata(id)
        .then(() => {
          timer = window.setTimeout(next, FILL_GAP_MS);
        })
        .catch(() => undefined);
    };
    timer = window.setTimeout(next, 800);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [wanted, ready]);
}
