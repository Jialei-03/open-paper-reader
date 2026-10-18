import { PanelRight } from "lucide-react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
  type RefObject,
} from "react";
import type { Paper, SourceFile } from "../api";
import { useI18n } from "../i18n/I18nProvider";
import {
  Button,
  Card,
  IconButton,
  Spinner,
  Toaster,
  Shell,
  currentPlatformIsMac,
  matchesShortcut,
} from "../ui";
import { recentPapers, rememberPaper } from "../lib/recent-papers";
import { PdfPages, zoomShortcut, type PdfController } from "./engine/PdfPages";
import { usePdfDocument } from "./engine/usePdfDocument";
import { FindBar, useFind, type Find } from "./FindBar";
import { PaperHeader } from "./PaperHeader";
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
  onSource,
  page,
  onPageChange,
  controllerRef,
  textLayerRef,
}: {
  route: ReaderRoute;
  go: (hash: string) => void;
  onPaper: (paper: Paper) => void;
  /** The paper's PDF, and the open document once it has loaded; `null` while there is no PDF. */
  onSource: (source: Source | null) => void;
  page: number;
  onPageChange: (page: number) => void;
  controllerRef: Ref<PdfController>;
  textLayerRef: Find["onTextLayer"];
}) {
  const { t } = useI18n();
  const { paper, pdf, error, missing, loading, retry } = usePaper(
    route.paperId,
    route.fileId,
  );
  const pdfDocument = usePdfDocument(pdf?.id ?? null);
  const doc = pdfDocument.doc;
  useEffect(() => {
    if (paper) onPaper(paper);
  }, [paper, onPaper]);
  useEffect(() => {
    onSource(pdf ? { file: pdf, doc } : null);
    return () => onSource(null);
  }, [pdf, doc, onSource]);

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
      textLayerRef={textLayerRef}
    />
  );
}

/** The paper's PDF, and the document once it has opened. */
interface Source {
  file: SourceFile;
  doc: PDFDocumentProxy | null;
}

/** What the card offers the screen around it. */
interface PaperActions {
  /** Opens the find bar (or takes the keyboard to it); whether it could be opened. */
  find(): boolean;
}

/** Whether the keyboard is in a field that takes text, where letters are for typing. */
function typing(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.tagName === "SELECT")
  );
}

/**
 * The inside of the paper's card, for one paper (it is made anew for the next):
 * the header, with the title, the page, the zoom, find and the contents, and the
 * body. Only the body fails on its own, so the header and the toggle stay.
 */
function PaperCard({
  route,
  go,
  panelToggle,
  onPaper,
  actions,
}: {
  route: ReaderRoute;
  go: (hash: string) => void;
  panelToggle: ReactNode;
  onPaper: (paper: Paper) => void;
  actions: RefObject<PaperActions | null>;
}) {
  const [paper, setPaper] = useState<Paper | null>(null);
  const [page, setPage] = useState(route.page ?? 1);
  const [source, setSource] = useState<Source | null>(null);
  const [controller, setController] = useState<PdfController | null>(null);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const doc = source?.doc ?? null;
  const pages = doc?.numPages ?? 0;
  const find = useFind(doc, controller);

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

  /** Through the pages when they are there; else the page is kept for them to go to once they are. */
  const navigate = (target: number) => {
    if (controller) controller.scrollToPage(target);
    else setPage(target);
  };

  // The keys of the paper work from wherever the keyboard is in the card, so the paper has the keyboard
  // from the start, unless somebody is typing, or an address with a quote (which goes to the quote).
  const focused = useRef<PDFDocumentProxy | null>(null);
  const reference =
    route.quote !== undefined ||
    route.prefix !== undefined ||
    route.rect !== undefined;
  useEffect(() => {
    const desk = controller?.root;
    if (!doc || !desk || focused.current === doc) return;
    focused.current = doc;
    if (reference || typing(document.activeElement)) return;
    desk.focus({ preventScroll: true });
  }, [doc, controller, reference]);

  // The screen's mod+f reaches the find bar through this.
  useEffect(() => {
    actions.current = {
      find() {
        if (!doc) return false;
        find.show();
        return true;
      },
    };
    return () => {
      actions.current = null;
    };
  });

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const key = event.nativeEvent;
    if (key.isComposing) return;
    // The zoom shortcuts work wherever the keyboard is in the card.
    if (zoomShortcut(key, controller)) {
      event.preventDefault();
      return;
    }
    // Esc closes the bar, unless something else (a menu, the page field) has taken it.
    if (event.key === "Escape" && find.open && !event.defaultPrevented) {
      event.preventDefault();
      find.close();
      return;
    }
    // [ and ] turn the pages, but are letters while a field is being typed in.
    if (!pages || typing(event.target)) return;
    const mac = currentPlatformIsMac();
    if (matchesShortcut(key, "[", mac)) navigate(Math.max(1, page - 1));
    else if (matchesShortcut(key, "]", mac))
      navigate(Math.min(pages, page + 1));
    else return;
    event.preventDefault();
  };

  return (
    <div className={styles.frame} onKeyDown={onKeyDown}>
      <PaperHeader
        paper={paper}
        file={source?.file ?? null}
        doc={doc}
        page={page}
        pages={pages}
        controller={controller}
        onNavigate={navigate}
        findOpen={find.open}
        onFind={find.toggle}
        outlineOpen={outlineOpen}
        onOutline={() => setOutlineOpen((open) => !open)}
        onPaperChange={found}
        panelToggle={panelToggle}
      />
      {/* No height of its own: the bar floats over the top of the paper, and the pages do not move for it. */}
      {find.open && (
        <div className={styles.findAnchor}>
          <FindBar find={find} />
        </div>
      )}
      <RegionBoundary region="paper">
        <PaperBody
          route={route}
          go={go}
          onPaper={found}
          onSource={setSource}
          page={page}
          onPageChange={setPage}
          controllerRef={setController}
          textLayerRef={find.onTextLayer}
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
  const actions = useRef<PaperActions>(null);

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
    <div
      className={styles.root}
      onKeyDown={(event) => {
        // mod+f is the paper's find wherever the keyboard is on this screen, instead of the browser's.
        if (event.defaultPrevented || event.nativeEvent.isComposing) return;
        if (
          matchesShortcut(event.nativeEvent, "mod+f", currentPlatformIsMac()) &&
          actions.current?.find()
        )
          event.preventDefault();
      }}
    >
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
            actions={actions}
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
