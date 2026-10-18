import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "../../api";

export type Relation = "references" | "citations";

/** One paper on the list, as `GET /papers/{id}/citations` gives it. */
export interface RelatedWork {
  title: string;
  authors: string[];
  year: number | null;
  venue: string;
  abstract: string;
  citation_count: number | null;
  doi: string;
  arxiv: string;
  s2_id: string;
}

export interface RelationState {
  items: RelatedWork[];
  /** The offset of the next page, or `null` when the list has ended. */
  next: number | null;
  status: "idle" | "loading" | "failed" | "done";
  /** Why it failed, in the terms the tab can word. */
  problem?: {
    kind: "noId" | "notIndexed" | "unavailable" | "other";
    message: string;
  };
}

const EMPTY: RelationState = { items: [], next: 0, status: "idle" };

function problemOf(error: unknown): NonNullable<RelationState["problem"]> {
  if (error instanceof ApiError) {
    if (error.status === 422) return { kind: "noId", message: error.message };
    if (error.status === 404)
      return { kind: "notIndexed", message: error.message };
    if (error.status === 503 || error.status === 429)
      return { kind: "unavailable", message: error.message };
    return { kind: "other", message: error.message };
  }
  return {
    kind: "other",
    message: error instanceof Error ? error.message : String(error),
  };
}

/**
 * The references of a paper and the papers that cite it, one page at a time and
 * only once asked for (`active`). Each list keeps what it has loaded while the
 * other one is shown; another paper starts both again.
 */
export function useRelations(paperId: string, active: boolean) {
  const [relation, setRelation] = useState<Relation>("references");
  const [lists, setLists] = useState<Record<Relation, RelationState>>({
    references: EMPTY,
    citations: EMPTY,
  });
  const inflight = useRef<Record<Relation, AbortController | null>>({
    references: null,
    citations: null,
  });
  const latest = useRef(lists);
  latest.current = lists;

  useEffect(() => {
    const requests = inflight.current;
    setLists({ references: EMPTY, citations: EMPTY });
    setRelation("references");
    return () => {
      requests.references?.abort();
      requests.citations?.abort();
      requests.references = requests.citations = null;
    };
  }, [paperId]);

  const load = useCallback(
    (which: Relation) => {
      const current = latest.current[which];
      if (current.status === "loading" || current.next === null) return;
      const controller = new AbortController();
      inflight.current[which] = controller;
      const patch = (change: Partial<RelationState>) =>
        setLists((all) => ({ ...all, [which]: { ...all[which], ...change } }));
      patch({ status: "loading", problem: undefined });
      api<{ items: RelatedWork[]; next: number | null }>(
        `/papers/${encodeURIComponent(paperId)}/citations?relation=${which}&offset=${current.next}`,
        { signal: controller.signal },
      ).then(
        (page) => {
          if (controller.signal.aborted) return;
          setLists((all) => ({
            ...all,
            [which]: {
              items: [...all[which].items, ...page.items],
              next: page.next,
              status: page.next === null ? "done" : "idle",
            },
          }));
        },
        (error: unknown) => {
          if (controller.signal.aborted) return;
          patch({ status: "failed", problem: problemOf(error) });
        },
      );
    },
    [paperId],
  );

  // The shown list starts when the tab is first shown, and when it is chosen.
  const state = lists[relation];
  useEffect(() => {
    if (active && state.status === "idle" && state.items.length === 0)
      load(relation);
  }, [active, relation, state.status, state.items.length, load]);

  return {
    relation,
    setRelation,
    state,
    more: () => load(relation),
    retry: () => load(relation),
  };
}
