import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../api";

/** The list with `item` put in at `at` (the end when `at` is not a place in it). */
function inserted<T>(list: T[], at: number, item: T): T[] {
  const place = at < 0 || at > list.length ? list.length : at;
  return [...list.slice(0, place), item, ...list.slice(place)];
}

/** One suggested paper, with the library papers it relates to. */
export interface Recommendation {
  key: string;
  title: string;
  authors: string[];
  year: number | null;
  venue: string;
  abstract: string;
  citation_count: number | null;
  doi: string;
  arxiv: string;
  url: string;
  why: { paper_id: string; title: string }[];
}

export interface Recommendations {
  /** `no_seeds`: nothing in the library names a public paper; `offline`: this server looks nothing up. */
  state: "ok" | "no_seeds" | "offline" | "unavailable";
  items: Recommendation[];
  source?: string;
  fetched_at?: string;
  /** Set when the list could not be renewed and is an older one. */
  stale?: "offline" | "unavailable" | null;
}

export type RecommendationsStatus = "loading" | "ready" | "failed";

/**
 * The recommendations for the person's library. `limit` is how many the screen
 * shows; `refresh()` asks the service to look again (it answers at most once a
 * minute). `dismiss` hides one at once and tells the server; the server keeps it hidden.
 */
export function useRecommendations(limit: number) {
  const [data, setData] = useState<Recommendations | null>(null);
  const [status, setStatus] = useState<RecommendationsStatus>("loading");
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const controller = useRef<AbortController | null>(null);

  const load = useCallback(
    (refresh: boolean) => {
      controller.current?.abort();
      const mine = new AbortController();
      controller.current = mine;
      if (refresh) setRefreshing(true);
      else setStatus("loading");
      api<Recommendations>(
        `/discover/recommendations?limit=${limit}${refresh ? "&refresh=true" : ""}`,
        { signal: mine.signal },
      ).then(
        (answer) => {
          if (mine.signal.aborted) return;
          setData(answer);
          setStatus("ready");
          setError("");
          setRefreshing(false);
        },
        (failure: unknown) => {
          if (mine.signal.aborted) return;
          setRefreshing(false);
          setError(
            failure instanceof Error ? failure.message : String(failure),
          );
          // A list that was there stays; the failure is told beside it.
          setStatus((now) => (refresh && now === "ready" ? "ready" : "failed"));
        },
      );
    },
    [limit],
  );

  useEffect(() => {
    load(false);
    return () => controller.current?.abort();
  }, [load]);

  const dismiss = useCallback(async (item: Recommendation) => {
    const place = { at: -1 };
    setData((now) => {
      if (!now) return now;
      place.at = now.items.findIndex((i) => i.key === item.key);
      return { ...now, items: now.items.filter((i) => i.key !== item.key) };
    });
    try {
      await api("/discover/dismissed", {
        method: "POST",
        body: JSON.stringify({ key: item.key, title: item.title }),
      });
    } catch (failure) {
      // Not kept, so it comes back where it was.
      setData((now) =>
        now && !now.items.some((i) => i.key === item.key)
          ? {
              ...now,
              items: inserted(now.items, place.at, item),
            }
          : now,
      );
      throw failure;
    }
    return place.at;
  }, []);

  const undo = useCallback(async (item: Recommendation, at: number) => {
    await api(`/discover/dismissed?key=${encodeURIComponent(item.key)}`, {
      method: "DELETE",
    });
    setData((now) =>
      now && !now.items.some((i) => i.key === item.key)
        ? { ...now, items: inserted(now.items, at, item) }
        : now,
    );
  }, []);

  return {
    data,
    status,
    error,
    refreshing,
    reload: () => load(false),
    refresh: () => load(true),
    dismiss,
    undo,
  };
}
