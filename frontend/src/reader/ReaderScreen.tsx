import { PanelRight } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type RefObject,
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
import { PdfPages, zoomShortcut, type PdfController } from "./engine/PdfPages";
import { usePdfDocument } from "./engine/usePdfDocument";
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

/** Megabytes with one decimal, as the download progress shows them. */
const megabytes = (bytes: number) => (bytes / 1024 / 1024).toFixed(1);

/**
 * Under the card's header: the paper's PDF, or why it is not there (loading,
 * not found, refused, no PDF, a PDF that would not open). What breaks while it
 * draws is caught around it, so the header above stays.
 */
function PaperBody({
  route,
  go,
  onPaper,
  onPages,
  page,
  onPageChange,
  controllerRef,
}: {
  route: ReaderRoute;
  go: (hash: string) => void;
  onPaper: (paper: Paper) => void;
  /** How many pages the PDF has; 0 while there is none. */
  onPages: (pages: number) => void;
  page: number;
  onPageChange: (page: number) => void;
  controllerRef: RefObject<PdfController | null>;
}) {
  const { t } = useI18n();
  const { paper, pdf, error, missing, loading, retry } = usePaper(
    route.paperId,
    route.fileId,
  );
  const pdfDocument = usePdfDocument(pdf?.id ?? null);
  const pages = pdfDocument.doc?.numPages ?? 0;
  useEffect(() => {
    if (paper) onPaper(paper);
  }, [paper, onPaper]);
  useEffect(() => {
    onPages(pages);
    return () => onPages(0);
  }, [pages, onPages]);

  if (loading)
    return (
      <div
        className={styles.state}
        role="status"
        aria-label={t("common.loading")}
      >
        <Spinner />
      </div>
    );
  if (error)
    return (
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
    );
  if (!pdf)
    return (
      <div className={styles.state}>
        <p className={styles.message}>{t("reader.pdf.none")}</p>
      </div>
    );
  if (pdfDocument.error)
    return (
      <div className={styles.state}>
        <p className={styles.message} role="alert">
          {pdfDocument.error}
        </p>
        <Button onClick={pdfDocument.retry}>{t("common.retry")}</Button>
      </div>
    );
  if (!pdfDocument.doc) {
    const { loaded, total } = pdfDocument.progress;
    return (
      <div className={styles.state} role="status">
        <Spinner />
        <p className={styles.progress}>
          {total > 0
            ? t("reader.pdf.progress", {
                loaded: megabytes(Math.min(loaded, total)),
                total: megabytes(total),
              })
            : loaded > 0
              ? t("reader.pdf.received", { loaded: megabytes(loaded) })
              : t("reader.pdf.opening")}
        </p>
      </div>
    );
  }
  return (
    <PdfPages
      key={pdf.id}
      doc={pdfDocument.doc}
      file={pdf}
      page={page}
      onPageChange={onPageChange}
      controllerRef={controllerRef}
    />
  );
}

/**
 * The inside of the paper's card, for one paper (it is made anew for the next):
 * the header, with the title, the page and the side panel's toggle, and the
 * body. Only the body fails on its own, so the header and the toggle stay.
 */
function PaperCard({
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
  const [paper, setPaper] = useState<Paper | null>(null);
  const [page, setPage] = useState(route.page ?? 1);
  const [pages, setPages] = useState(0);
  const controller = useRef<PdfController>(null);

  // An address that names a page (a link into the paper) goes there.
  useEffect(() => {
    if (route.page) setPage(route.page);
  }, [route.page]);

  const found = useCallback(
    (value: Paper) => {
      setPaper(value);
      onPaper(value);
    },
    [onPaper],
  );

  return (
    // The zoom shortcuts work wherever the keyboard is in the card.
    <div
      className={styles.frame}
      onKeyDown={(event) => {
        if (zoomShortcut(event.nativeEvent, controller.current))
          event.preventDefault();
      }}
    >
      <CardHeader>
        {paper ? (
          <h1 className={styles.title}>
            {paper.title || t("reader.untitled")}
          </h1>
        ) : (
          <span className={styles.title} />
        )}
        {pages > 0 && (
          <span className={styles.pageStatus} aria-live="polite">
            {t("reader.page.status", { page, pages })}
          </span>
        )}
        {panelToggle}
      </CardHeader>
      <RegionBoundary region="paper">
        <PaperBody
          route={route}
          go={go}
          onPaper={found}
          onPages={setPages}
          page={page}
          onPageChange={setPage}
          controllerRef={controller}
        />
      </RegionBoundary>
    </div>
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
          {/* A new paper starts afresh, its boundary too: a failure is not carried over to it. */}
          <PaperCard
            key={paperId}
            route={route}
            go={go}
            panelToggle={panelToggle}
            onPaper={setLoaded}
          />
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
