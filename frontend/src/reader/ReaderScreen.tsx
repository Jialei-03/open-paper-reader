import { PanelRight } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { Paper } from "../api";
import { useI18n } from "../i18n/I18nProvider";
import {
  Button,
  Card,
  CardHeader,
  IconButton,
  Spinner,
  Toaster,
  Shell,
} from "../ui";
import { recentPapers, rememberPaper } from "../lib/recent-papers";
import { ReaderSidebar } from "./ReaderSidebar";
import { RegionBoundary } from "./RegionBoundary";
import { RightPanel } from "./RightPanel";
import { followLink, type ReaderRoute } from "./route";
import { usePaper } from "./usePaper";
import styles from "./ReaderScreen.module.css";

/**
 * Narrower than this, the right panel no longer fits beside the paper: it folds
 * away and a button in the paper's header opens it over the paper. The fold is
 * done from here, not by a media query in the stylesheet, so that the button,
 * the keyboard and the panel always agree on whether it is folded.
 */
const NARROW = "(max-width: 1099.98px)";

function subscribeNarrow(notify: () => void) {
  const query = window.matchMedia(NARROW);
  query.addEventListener("change", notify);
  return () => query.removeEventListener("change", notify);
}

function useNarrowWindow(): boolean {
  return useSyncExternalStore(
    subscribeNarrow,
    () => window.matchMedia(NARROW).matches,
    () => false,
  );
}

/** The inside of the paper's card: its header, then the paper. */
function PaperContent({
  route,
  go,
  panelToggle,
  onPaper,
}: {
  route: ReaderRoute;
  go: (hash: string) => void;
  panelToggle: ReactNode;
  onPaper: (paper: Paper) => void;
}) {
  const { t } = useI18n();
  const { paper, error, missing, loading, retry } = usePaper(
    route.paperId,
    route.fileId,
  );
  useEffect(() => {
    if (paper) onPaper(paper);
  }, [paper, onPaper]);

  return (
    <>
      <CardHeader>
        {paper ? (
          <h1 className={styles.title}>
            {paper.title || t("reader.untitled")}
          </h1>
        ) : (
          <span className={styles.title} />
        )}
        {panelToggle}
      </CardHeader>
      {loading ? (
        <div
          className={styles.state}
          role="status"
          aria-label={t("common.loading")}
        >
          <Spinner />
        </div>
      ) : error ? (
        <div className={styles.state}>
          {/* A paper that is not there is news, not an alarm; anything else the service refused is. */}
          <p className={styles.message} role={missing ? undefined : "alert"}>
            {error}
          </p>
          {!missing && <Button onClick={retry}>{t("common.retry")}</Button>}
          <a
            className={styles.link}
            href="#library"
            onClick={followLink(go, "library")}
          >
            {t("reader.backToLibrary")}
          </a>
        </div>
      ) : (
        <div className={styles.body}>
          <p className={styles.placeholder}>{t("reader.paper.placeholder")}</p>
        </div>
      )}
    </>
  );
}

export interface ReaderScreenProps {
  paperId: string;
  route: ReaderRoute;
  /** Takes an address without its `#`, as everywhere in the workspace. */
  go: (hash: string) => void;
  /** The signed-in user's id: whose reading history this is. */
  owner: string;
  /** The library's papers, for naming the ones in the sidebar. */
  papers: Paper[];
}

/**
 * The reader: the window's shell, with the sidebar, the paper's card and the
 * right panel. Each of the three fails by itself (a retry in its own place)
 * instead of taking the screen down with it.
 */
export function ReaderScreen({
  paperId,
  route,
  go,
  owner,
  papers,
}: ReaderScreenProps) {
  const { t } = useI18n();
  const narrow = useNarrowWindow();
  const [panelOpen, setPanelOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const [loaded, setLoaded] = useState<Paper | null>(null);
  const [visits, setVisits] = useState(() => recentPapers(owner));

  // The panel only opens over the paper; a window that has grown wide shows it docked, and shut when narrowed again.
  useEffect(() => {
    if (!narrow) setPanelOpen(false);
  }, [narrow]);

  // A paper that is there has been read: remember it, as the old reader does.
  useEffect(() => {
    if (loaded?.id !== paperId) return;
    rememberPaper(owner, paperId);
    setVisits(recentPapers(owner));
  }, [owner, paperId, loaded]);

  const panelToggle = narrow ? (
    <IconButton
      ref={toggle}
      icon={PanelRight}
      label={t(panelOpen ? "reader.panel.hide" : "reader.panel.show")}
      aria-expanded={panelOpen}
      onClick={() => setPanelOpen((open) => !open)}
    />
  ) : null;

  return (
    <div className={styles.root}>
      <Shell
        sidebar={
          <RegionBoundary region="sidebar" className={styles.sidebarFailure}>
            <ReaderSidebar
              paperId={paperId}
              papers={papers}
              current={loaded}
              visits={visits}
              go={go}
            />
          </RegionBoundary>
        }
      >
        <Card
          as="main"
          aria-label={t("reader.region.paper")}
          className={styles.paper}
        >
          <RegionBoundary region="paper">
            <PaperContent
              key={paperId}
              route={route}
              go={go}
              panelToggle={panelToggle}
              onPaper={setLoaded}
            />
          </RegionBoundary>
        </Card>
        <RightPanel
          paperId={paperId}
          overlay={
            narrow
              ? {
                  open: panelOpen,
                  onClose: () => setPanelOpen(false),
                  returnFocus: toggle,
                }
              : undefined
          }
        />
      </Shell>
      <Toaster />
    </div>
  );
}
