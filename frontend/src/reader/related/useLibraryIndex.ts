import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type Paper } from "../../api";
import { libraryIndex, type Identity } from "./match";

/**
 * What the library holds, to tell the papers in a list from the ones that are
 * already there. Read when `active` first becomes true, and again on `refresh`.
 */
export function useLibraryIndex(active: boolean) {
  const [papers, setPapers] = useState<Paper[]>([]);
  const [records, setRecords] = useState<Record<string, Identity>>({});
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    const quiet = () => undefined;
    api<Paper[]>("/papers", { signal: controller.signal }).then(
      setPapers,
      quiet,
    );
    // The public records found for papers whose own id field is empty; without them the title is still matched.
    api<Record<string, Identity>>("/paper-metadata", {
      signal: controller.signal,
    }).then(setRecords, quiet);
    return () => controller.abort();
  }, [active, tick]);
  const index = useMemo(() => libraryIndex(papers, records), [papers, records]);
  const refresh = useCallback(() => setTick((n) => n + 1), []);
  return { index, refresh };
}
