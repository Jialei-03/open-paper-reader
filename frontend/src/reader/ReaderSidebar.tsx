import type { Paper } from "../api";
import { AppSidebar } from "../app/AppSidebar";

/**
 * The reader's navigation: the app's own sidebar, with the paper being read
 * marked among the papers read last.
 */
export function ReaderSidebar({
  floating,
  paperId,
  papers,
  current,
  visits,
  go,
}: {
  /** The window is too narrow for the sidebar beside the paper (see `AppSidebar`). */
  floating: boolean;
  paperId: string;
  papers: Paper[];
  /** This paper, once it has loaded. */
  current: Paper | null;
  /** When each paper was last opened on this device, by id. */
  visits: Record<string, number>;
  /** Takes an address without its `#`, as everywhere in the workspace. */
  go: (hash: string) => void;
}) {
  return (
    <AppSidebar
      floating={floating}
      screen="reader"
      paperId={paperId}
      papers={papers}
      current={current}
      visits={visits}
      go={go}
    />
  );
}
