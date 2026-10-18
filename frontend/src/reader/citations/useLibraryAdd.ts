import { useCallback, useEffect, useRef, useState } from "react";
import { importArxiv } from "../../lib/arxiv-import";

/** Where adding a cited arXiv paper to the library has got to, by arXiv id. */
export type AddState =
  | { status: "adding" }
  | { status: "added"; paperId: string }
  | { status: "failed"; message: string };

/** Adding cited papers to the library through the existing arXiv import; one try at a time per paper. */
export function useLibraryAdd() {
  const [states, setStates] = useState<Record<string, AddState>>({});
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const add = useCallback((arxiv: string) => {
    setStates((all) =>
      all[arxiv]?.status === "adding" || all[arxiv]?.status === "added"
        ? all
        : { ...all, [arxiv]: { status: "adding" } },
    );
    importArxiv(arxiv).then(
      (paper) =>
        mounted.current &&
        setStates((all) => ({
          ...all,
          [arxiv]: { status: "added", paperId: paper.id },
        })),
      (error: unknown) =>
        mounted.current &&
        setStates((all) => ({
          ...all,
          [arxiv]: {
            status: "failed",
            message: error instanceof Error ? error.message : String(error),
          },
        })),
    );
  }, []);
  return { states, add };
}
