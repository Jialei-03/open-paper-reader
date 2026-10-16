import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { api } from "../api";

/** Discover artifacts created by background preparation, including an empty initial list. */
export function useReadingArtifacts<T extends { id: string }>(
  paperId: string,
  onRows: Dispatch<SetStateAction<T[]>>,
) {
  const callback = useRef(onRows);
  callback.current = onRows;
  useEffect(() => {
    const controller = new AbortController();
    let live = true;
    let inFlight = false;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      if (!live || inFlight || document.hidden || !navigator.onLine) return;
      clearTimeout(timer);
      inFlight = true;
      try {
        const rows = await api<T[]>(`/papers/${paperId}/reading-artifacts`, {
          signal: controller.signal,
        });
        if (live)
          callback.current((previous) => {
            // Keep unchanged result objects stable: polling must not reset an
            // existing sentence hover when another page advances in the background.
            const existing = new Map(previous.map((row) => [row.id, row]));
            const next = rows.map((row) => {
              const old = existing.get(row.id);
              return old && JSON.stringify(old) === JSON.stringify(row)
                ? old
                : row;
            });
            return next.length === previous.length &&
              next.every((row, index) => row === previous[index])
              ? previous
              : next;
          });
      } catch {
        // Keep already available content usable when offline.
      } finally {
        inFlight = false;
        if (live) timer = setTimeout(refresh, 5000);
      }
    };
    const prepared = (event: Event) => {
      if ((event as CustomEvent).detail === paperId) void refresh();
    };
    const visible = () => {
      if (!document.hidden) void refresh();
    };
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("online", visible);
    window.addEventListener("paper-preparation-updated", prepared);
    timer = setTimeout(refresh, 1500);
    return () => {
      live = false;
      controller.abort();
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("online", visible);
      window.removeEventListener("paper-preparation-updated", prepared);
    };
  }, [paperId]);
}
