import { PanelRight } from "lucide-react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
  type RefObject,
} from "react";
import type { Paper, SourceFile } from "../api";
import { usePdfAnnotations, type PdfRect } from "../features/PdfAnnotations";
import { usePdfInk } from "../features/PdfInk";
import type { PdfDestination } from "../features/PdfLinks";
import { useI18n } from "../i18n/I18nProvider";
import { pdfRegion } from "../lib/pdf-region";
import { useReferenceHighlight } from "../lib/reference";
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
import { AnnotationLayer, pageBox } from "./engine/layers/AnnotationLayer";
import { InkLayer } from "./engine/layers/InkLayer";
import { PageLinkLayer } from "./engine/layers/LinkLayer";
import { useLinkPreview, type LinkPreview } from "./engine/LinkPreview";
import {
  PdfPages,
  zoomShortcut,
  type PageGeometry,
  type PdfController,
  type PdfPagesProps,
} from "./engine/PdfPages";
import { usePdfDocument } from "./engine/usePdfDocument";
import { FindBar, useFind, type Find } from "./FindBar";
import { PaperHeader } from "./PaperHeader";
import { ReaderSidebar } from "./ReaderSidebar";
import { RegionBoundary } from "./RegionBoundary";
import { RightPanel } from "./RightPanel";
import { linkTarget } from "./outline";
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

/** What the card lays over the pages, besides what is saved with the PDF. */
interface Overlays {
  /** A link inside the PDF was clicked. */
  onLink(dest: PdfDestination): void;
  preview: LinkPreview;
  /** The region of a page the address points at. */
  region: { page: number; rect: PdfRect } | null;
}

/**
 * The pages, with what is laid over each one: the highlights and handwriting
 * saved on the PDF (shown, not edited, here), its links, and the region the
 * address points at.
 */
function PaperPages({
  overlays: { onLink, preview, region },
  ...props
}: Omit<PdfPagesProps, "pageOverlays"> & { overlays: Overlays }) {
  const { doc, file } = props;
  const annotations = usePdfAnnotations(file.id).rows;
  const strokes = usePdfInk(file.id).strokes;
  const { hover, close, describedBy } = preview;
  const pageOverlays = useCallback(
    (page: number, geometry: PageGeometry) => (
      <>
        <AnnotationLayer
          annotations={annotations}
          page={page}
          rotation={geometry.rotation}
        />
        <InkLayer
          strokes={strokes}
          page={page}
          rotation={geometry.rotation}
          size={{
            width: geometry.width / geometry.scale,
            height: geometry.height / geometry.scale,
          }}
        />
        <PageLinkLayer
          doc={doc}
          page={page}
          onInternal={onLink}
          onExternal={close}
          onPreview={hover}
          describedBy={describedBy}
        />
        {region?.page === page && (
          <div
            className="pdf-reference-region"
            style={pageBox(region.rect)}
            aria-hidden="true"
          />
        )}
      </>
    ),
    [annotations, strokes, doc, onLink, hover, close, describedBy, region],
  );
  return <PdfPages {...props} pageOverlays={pageOverlays} />;
}

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
  overlays,
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
  overlays: Overlays;
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
    <PaperPages
      key={pdf.id}
      doc={pdfDocument.doc}
      file={pdf}
      page={page}
      onPageChange={onPageChange}
      controllerRef={controllerRef}
      textLayerRef={textLayerRef}
      overlays={overlays}
    />
  );
}

/** Where the reading was when a link was followed, to come back to. */
interface Spot {
  /** The desk's scroll position. */
  top: number;
  left: number;
  /** And the same as a position in the pages, for a zoom that has changed since. */
  position: number;
  percent: number;
}

/** How many links followed one after another can be come back from. */
const TRAIL = 50;
/** Room left above the line a link leads to, in the PDF's units (a third of an inch). */
const LINK_LEAD = 24;

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
  const preview = useLinkPreview(route.paperId, doc);
  const controllerNow = useRef(controller);
  controllerNow.current = controller;
  const docNow = useRef(doc);
  docNow.current = doc;

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
  // from the start, unless somebody is typing, or an address with a quote (which goes to the quote,
  // and gives the paper the keyboard once it is there, below).
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

  // Following a link inside the PDF leaves a way back to where the reading was; the page field,
  // the steps and the contents do not.
  const [trail, setTrail] = useState<Spot[]>([]);
  useEffect(() => setTrail([]), [doc]);
  const followLinkInPaper = useCallback(
    async (dest: PdfDestination) => {
      preview.close();
      const opened = docNow.current;
      if (!opened) return;
      const target = await linkTarget(opened, dest, LINK_LEAD);
      const pages = controllerNow.current;
      const desk = pages?.root;
      // A link that leads nowhere is not followed; nor one whose paper has gone meanwhile.
      if (!target || !pages || !desk || docNow.current !== opened) return;
      const spot: Spot = {
        top: desk.scrollTop,
        left: desk.scrollLeft,
        position: pages.position(),
        percent: pages.percent,
      };
      setTrail((trail) => [...trail.slice(1 - TRAIL), spot]);
      pages.scrollToPage(target.page, target.offset);
    },
    [preview.close],
  );
  const back = () => {
    const spot = trail.at(-1);
    const desk = controller?.root;
    if (!spot || !controller || !desk) return;
    setTrail(trail.slice(0, -1));
    if (Math.abs(controller.percent - spot.percent) < 0.01) {
      desk.scrollTop = spot.top;
      desk.scrollLeft = spot.left;
    } else {
      // The pages are another size now: the same place in them.
      const index = Math.floor(spot.position);
      controller.scrollToPage(index + 1, spot.position - index);
    }
    // The button goes with the last way back: the keyboard goes to the paper rather than nowhere.
    if (trail.length === 1) desk.focus({ preventScroll: true });
  };

  // The reference of the address: the sentence (`quote`, after `prefix`) is marked on its page and
  // brought to the middle of the view, else the region (`rect`) is; else the page's top is shown.
  const referencePage = route.page ?? 1;
  const quote = route.quote ?? "";
  const prefix = route.prefix ?? "";
  const region = useMemo(() => {
    const rect = route.rect ? pdfRegion(route.rect) : null;
    return rect ? { page: referencePage, rect } : null;
  }, [route.rect, referencePage]);
  // The text layers that are drawn, by page: the reference's is where the sentence is looked for.
  const textLayers = useRef(new Map<number, HTMLDivElement>());
  const referencePageNow = useRef(referencePage);
  referencePageNow.current = referencePage;
  const [referenceLayer, setReferenceLayer] = useState<HTMLDivElement | null>(
    null,
  );
  useEffect(() => {
    setReferenceLayer(textLayers.current.get(referencePage) ?? null);
  }, [referencePage]);
  const findOnTextLayer = find.onTextLayer;
  const onTextLayer = useCallback(
    (number: number, element: HTMLDivElement | null, rendered: boolean) => {
      findOnTextLayer(number, element, rendered);
      if (rendered && element) textLayers.current.set(number, element);
      else textLayers.current.delete(number);
      if (number === referencePageNow.current)
        setReferenceLayer(rendered ? element : null);
    },
    [findOnTextLayer],
  );
  // The same address entered again (a link to where the reader already is): to its page again, and
  // the highlight marks the sentence anew. Before the highlight below, which then centres it.
  const [visits, setVisits] = useState(0);
  useEffect(() => {
    const again = () => setVisits((count) => count + 1);
    window.addEventListener("reference-navigate", again);
    return () => window.removeEventListener("reference-navigate", again);
  }, []);
  // So does a new reference in the address, on a page the paper may have scrolled away from.
  const referenceKey = JSON.stringify([
    referencePage,
    quote,
    prefix,
    route.rect ?? "",
  ]);
  const sought = useRef({ key: referenceKey, visits });
  useEffect(() => {
    const before = sought.current;
    sought.current = { key: referenceKey, visits };
    if (!reference || (before.key === referenceKey && before.visits === visits))
      return;
    controllerNow.current?.scrollToPage(referencePage);
  }, [referenceKey, visits]);
  const referenceRoot = useRef<HTMLDivElement | null>(null);
  referenceRoot.current = referenceLayer;
  useReferenceHighlight(
    referenceRoot,
    referenceLayer ? quote : "",
    prefix,
    referenceLayer,
    false,
    undefined,
    "fill",
  );
  // Once the reference's page is drawn: the region to the middle if the sentence was not found there,
  // and the keyboard to the paper (as on any opening), once for each time the address is entered.
  const landed = useRef<string | null>(null);
  useEffect(() => {
    if (!reference || !referenceLayer) return;
    const key = `${referenceKey}\n${visits}`;
    if (landed.current === key) return;
    landed.current = key;
    if (referenceLayer.dataset.referenceFound !== "true")
      referenceLayer.parentElement
        ?.querySelector(".pdf-reference-region")
        ?.scrollIntoView({
          block: "center",
          inline: "nearest",
          behavior: "instant",
        });
    if (!typing(document.activeElement))
      controllerNow.current?.root?.focus({ preventScroll: true });
  }, [reference, referenceLayer, referenceKey, visits]);

  const overlays: Overlays = { onLink: followLinkInPaper, preview, region };

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
        onBack={trail.length ? back : undefined}
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
          textLayerRef={onTextLayer}
          overlays={overlays}
        />
      </RegionBoundary>
      {preview.element}
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
