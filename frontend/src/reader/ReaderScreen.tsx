import { BoxSelect, PanelRight } from "lucide-react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
  type RefObject,
} from "react";
import type { Paper, SourceFile } from "../api";
import { usePdfAnnotations, type PdfRect } from "../features/PdfAnnotations";
import { usePdfInk } from "../features/PdfInk";
import type { PdfDestination } from "../features/PdfLinks";
import { usePreference } from "../screens/library/usePreference";
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
  toast,
} from "../ui";
import { recentPapers, rememberPaper } from "../lib/recent-papers";
import { AnnotationLayer, pageBox } from "./engine/layers/AnnotationLayer";
import { InkLayer } from "./engine/layers/InkLayer";
import { PageLinkLayer } from "./engine/layers/LinkLayer";
import { useLinkPreview, type LinkPreview } from "./engine/LinkPreview";
import { lastPage, rememberPage } from "./engine/page-memory";
import {
  PdfPages,
  zoomShortcut,
  type PageGeometry,
  type PdfController,
  type PdfPagesProps,
} from "./engine/PdfPages";
import { usePdfDocument } from "./engine/usePdfDocument";
import { FindBar, useFind, type Find } from "./FindBar";
import {
  ParallelPage,
  useParallelTranslation,
  useQuoteHighlight,
  type HoverQuote,
} from "./modes/parallel";
import { PaperHeader } from "./PaperHeader";
import { ReaderSidebar } from "./ReaderSidebar";
import { RegionBoundary } from "./RegionBoundary";
import { RightPanel, type PanelView } from "./RightPanel";
import { RegionTool } from "./regions/RegionTool";
import { SelectionMenu, type SelectionNote } from "./selection/SelectionMenu";
import { Composer, useAssistant } from "./assistant";
import { useComposerDock, useComposerDraft } from "./assistant/useComposerDock";
import { excerptMarkdown } from "./notes/excerpt";
import { useNotes } from "./notes/useNotes";
import { KeypointLayer, useKeypoints, type Keypoint } from "./keypoints";
import type { AskRequest } from "./types";
import { linkTarget } from "./outline";
import {
  CompareBar,
  CompareView,
  ENGINES,
  EngineSwitch,
  LayoutPanel,
  ModeControls,
  alignedUnits,
  useTranslatedView,
  useWide,
  type AlignmentUnit,
  type Side,
  useFoldedModeEntries,
  useLayoutTranslation,
  useTranslationLanguage,
  type ReadingMode,
} from "./modes";
import { followLink, readerHash, type ReaderRoute } from "./route";
import { useMediaQuery } from "./useMediaQuery";
import { usePaper } from "./usePaper";
import styles from "./ReaderScreen.module.css";

/**
 * Narrower than this, the right panel no longer fits beside the paper: it folds
 * away and a button in the paper's header opens it over the paper. The fold is
 * done from here, not by a media query in the stylesheet, so that the button,
 * the keyboard and the panel always agree on whether it is folded.
 */
const PANEL_FOLDS = "(max-width: 1099.98px)";

/**
 * Narrower than this, the sidebar no longer has its 220px to spare: it is the
 * 56px rail of icons, and opened it floats over the paper's card, which keeps
 * the rest of the width. Decided here for the same reason as the panel's fold.
 */
const SIDEBAR_FLOATS = "(max-width: 899.98px)";

/** Megabytes with one decimal, as the download progress shows them. */
const megabytes = (bytes: number) => (bytes / 1024 / 1024).toFixed(1);

/** What the card lays over the pages, besides what is saved with the PDF. */
interface Overlays {
  /** A link inside the PDF was clicked. */
  onLink(dest: PdfDestination): void;
  preview: LinkPreview;
  /** The region of a page the address points at. */
  region: { page: number; rect: PdfRect } | null;
  /** For the menu over selected text: the paper, and the pages' scroller. */
  paper: Paper | null;
  scroller: HTMLElement | null;
  /** The menu's explain and ask, and its keeping in the note. */
  onAsk(request: AskRequest): void;
  onNote(request: SelectionNote): void;
  /** The key sentences to underline on the pages (of the categories that are shown). */
  keypoints?: readonly Keypoint[];
  /** Region mode (the toolbar's): a drag on a page boxes a figure, table or formula. */
  regionMode: boolean;
  onRegionMode(active: boolean): void;
}

/**
 * The pages, with what is laid over each one: the highlights and handwriting
 * saved on the PDF (shown, not edited, here), its links, and the region the
 * address points at.
 */
function PaperPages({
  overlays: {
    onLink,
    preview,
    region,
    paper,
    scroller,
    onAsk,
    onNote,
    keypoints,
    regionMode,
    onRegionMode,
  },
  translated,
  ...props
}: Omit<PdfPagesProps, "pageOverlays"> & {
  overlays: Overlays;
  /** The pages are the paper's translated PDF, not its own: what is selected there is not highlighted. */
  translated: boolean;
}) {
  const { t } = useI18n();
  const { doc, file } = props;
  const store = usePdfAnnotations(file.id);
  const annotations = store.rows;
  const strokes = usePdfInk(file.id).strokes;
  const { hover, close, describedBy, key: previewKey } = preview;
  const pageOverlays = useCallback(
    (page: number, geometry: PageGeometry) => (
      <>
        <AnnotationLayer
          annotations={annotations}
          page={page}
          rotation={geometry.rotation}
        />
        {keypoints && !translated && (
          <KeypointLayer items={keypoints} page={page} />
        )}
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
          onPreviewKey={previewKey}
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
    [
      annotations,
      strokes,
      doc,
      onLink,
      hover,
      close,
      describedBy,
      previewKey,
      region,
      keypoints,
      translated,
    ],
  );
  return (
    <>
      <PdfPages {...props} pageOverlays={pageOverlays} />
      {paper && (
        <SelectionMenu
          scroller={scroller}
          paper={paper}
          file={file}
          annotations={store}
          onAsk={onAsk}
          onNote={onNote}
          noHighlight={
            translated ? t("reader.selection.highlightTranslated") : undefined
          }
        />
      )}
      {paper && (
        <RegionTool
          scroller={scroller}
          paper={paper}
          file={file}
          active={regionMode}
          onActiveChange={onRegionMode}
          onAsk={onAsk}
          onNote={onNote}
        />
      )}
    </>
  );
}

/** The translation beside the original shows no previews of its links: they are followed, not previewed. */
const NO_PREVIEW: LinkPreview = {
  hover: () => undefined,
  close: () => undefined,
  describedBy: () => undefined,
  element: null,
};

/** The translated PDF read in the card (译文 mode): the strip over the pages, and, side by side, the second pane. */
interface Translation {
  /** The translated PDF. */
  file: SourceFile;
  /** The strip over the pages. */
  bar: ReactNode;
  /** The original and the translation, two panes; else the one pane is `shown`. */
  sideBySide: boolean;
  alignment: readonly AlignmentUnit[] | undefined;
  linked: boolean;
  swapped: boolean;
  /** The original pane's controller (the card's). */
  originalController: PdfController | null;
}

/** Room for a link's target above it in the translated pane, as in the original. */
const TRANSLATED_LEAD = 24;

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
  shown = null,
  instead = null,
  pageAside,
  onVisiblePages,
  translation = null,
}: Pick<PdfPagesProps, "pageAside" | "onVisiblePages"> & {
  /** In 译文 mode with a translated PDF: the strip over the pages, and the second pane beside the original. */
  translation?: Translation | null;
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
  /** A file of the paper to draw in place of its PDF (the translated one). */
  shown?: SourceFile | null;
  /** Put where the pages would be (the translated view with nothing to show yet); the pages are not drawn. */
  instead?: ReactNode;
}) {
  const { t } = useI18n();
  const { paper, pdf, error, missing, loading, retry } = usePaper(
    route.paperId,
    route.fileId,
  );
  const drawn = shown ?? pdf;
  const pdfDocument = usePdfDocument(drawn?.id ?? null);
  const doc = pdfDocument.doc;
  // Side by side the translation is a second document with its own pages, scroll and zoom.
  const sideBySide = translation?.sideBySide === true;
  const translatedDocument = usePdfDocument(
    sideBySide ? translation!.file.id : null,
  );
  const [translatedController, setTranslatedController] =
    useState<PdfController | null>(null);
  const [translatedPage, setTranslatedPage] = useState(1);
  const translatedNow = useRef(translatedController);
  translatedNow.current = translatedController;
  const translatedDoc = translatedDocument.doc;
  const followInTranslation = useCallback(
    async (dest: PdfDestination) => {
      if (!translatedDoc) return;
      const target = await linkTarget(translatedDoc, dest, TRANSLATED_LEAD);
      if (target)
        translatedNow.current?.scrollToPage(target.page, target.offset);
    },
    [translatedDoc],
  );
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
  if (instead) return instead;
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
  const single = (
    <PaperPages
      key={drawn!.id}
      doc={pdfDocument.doc}
      file={drawn!}
      page={page}
      onPageChange={onPageChange}
      controllerRef={controllerRef}
      textLayerRef={textLayerRef}
      overlays={overlays}
      translated={drawn!.id !== pdf.id}
      pageAside={pageAside}
      onVisiblePages={onVisiblePages}
    />
  );
  if (!translation) return single;
  if (!translation.sideBySide)
    return (
      <>
        {translation.bar}
        {single}
      </>
    );
  return (
    <>
      {translation.bar}
      <CompareView
        original={translation.originalController}
        translated={translatedController}
        pages={{
          original: pdfDocument.doc.numPages,
          translated: translatedDoc?.numPages ?? 0,
        }}
        alignment={translation.alignment}
        linked={translation.linked}
        swapped={translation.swapped}
        panes={{
          original: single,
          translated: translatedDoc ? (
            <PaperPages
              key={translation.file.id}
              doc={translatedDoc}
              file={translation.file}
              page={translatedPage}
              onPageChange={setTranslatedPage}
              controllerRef={setTranslatedController}
              overlays={{
                onLink: followInTranslation,
                preview: NO_PREVIEW,
                region: null,
                paper: overlays.paper,
                scroller: translatedController?.root ?? null,
                onAsk: overlays.onAsk,
                onNote: overlays.onNote,
                regionMode: overlays.regionMode,
                onRegionMode: overlays.onRegionMode,
              }}
              translated
              lazyText
            />
          ) : translatedDocument.error ? (
            <div className={styles.state}>
              <p className={styles.message} role="alert">
                {translatedDocument.error}
              </p>
              <Button onClick={translatedDocument.retry}>
                {t("common.retry")}
              </Button>
            </div>
          ) : (
            <div className={styles.state} role="status">
              <Spinner />
            </div>
          ),
        }}
      />
    </>
  );
}

/** Where the reading was when a link was followed, to come back to. */
interface Spot {
  /** The desk's scroll position. */
  top: number;
  left: number;
  /** And the same as a position in the pages, for a zoom (or a reading mode) that has changed since. */
  position: number;
  percent: number;
  /** The pages are laid out otherwise in another reading mode (a column beside each one). */
  mode: ReadingMode;
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
  /** Goes to a page of the paper (the guide's page chips). */
  jump(page: number): void;
}

/**
 * Whether nobody has the keyboard: it is on the page itself, or still where it
 * was when the paper was opened (`openedFrom`: the link in the sidebar that was
 * clicked to open it keeps the keyboard, as the sidebar stays when the paper
 * changes). Then the paper may take it. Once the person has put it somewhere
 * else (a field, the side panel, a button), a PDF that finishes loading later
 * does not take it from there.
 */
function keyboardFree(openedFrom: Element | null): boolean {
  const active = document.activeElement;
  return !active || active === document.body || active === openedFrom;
}

/** How long the page being read has to stay the same before it is written down. */
const REMEMBER_AFTER = 1000;

/**
 * Writes down the page being read, for the paper to open there next time: once
 * it has stayed the same for a second (not at every frame of a scroll), and at
 * once, if a change is still waiting, when the page is left or the card goes.
 * Only while the paper is open (`reading`).
 */
function useRememberedPage(
  owner: string,
  paperId: string,
  page: number,
  reading: boolean,
) {
  const waiting = useRef<{ page: number; timer: number } | null>(null);
  const flush = useCallback(() => {
    const change = waiting.current;
    if (!change) return;
    window.clearTimeout(change.timer);
    waiting.current = null;
    rememberPage(owner, paperId, change.page);
  }, [owner, paperId]);
  useEffect(() => {
    if (!reading) return;
    if (waiting.current) window.clearTimeout(waiting.current.timer);
    waiting.current = {
      page,
      timer: window.setTimeout(flush, REMEMBER_AFTER),
    };
  }, [page, reading, flush]);
  useEffect(() => {
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [flush]);
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
  owner,
  panelToggle,
  onPaper,
  onFile,
  onAsk,
  onNote,
  keypoints,
  actions,
}: {
  route: ReaderRoute;
  go: (hash: string) => void;
  owner: string;
  panelToggle: ReactNode;
  onPaper: (paper: Paper) => void;
  /** The paper's PDF, for the panel beside it (`null` while there is none). */
  onFile: (file: SourceFile | null) => void;
  /** Selected text to explain or ask about, and to keep in the note. */
  onAsk: Overlays["onAsk"];
  onNote: Overlays["onNote"];
  keypoints: Overlays["keypoints"];
  actions: RefObject<PaperActions | null>;
}) {
  const { t } = useI18n();
  const [paper, setPaper] = useState<Paper | null>(null);
  const [visiblePages, setVisiblePages] = useState<number[]>([]);
  const [hoverQuote, setHoverQuote] = useState<HoverQuote | null>(null);
  // A reference in the address (a sentence or a region) carries its own page.
  const reference =
    route.quote !== undefined ||
    route.prefix !== undefined ||
    route.rect !== undefined;
  // The page of the address, else the one this device last read the paper at, else the first. A page
  // past the end (the file has changed since) is brought back to the last by the pages once they are there.
  const [page, setPage] = useState(
    () =>
      route.page ?? (reference ? null : lastPage(owner, route.paperId)) ?? 1,
  );
  const [source, setSource] = useState<Source | null>(null);
  const [controller, setController] = useState<PdfController | null>(null);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [regionMode, setRegionMode] = useState(false);
  const doc = source?.doc ?? null;
  const pages = doc?.numPages ?? 0;
  const file = source?.file ?? null;
  useEffect(() => onFile(file), [file, onFile]);
  // How the paper is read, and what its translation is made with. The page is the card's, so it is kept across modes.
  const [mode, setMode] = useState<ReadingMode>("original");
  const [language, setLanguage] = useTranslationLanguage();
  const [modelId, setModelId] = useState<string | null>(null);
  const layout = useLayoutTranslation({ paper, file, modelId });
  // 译文 with a translated PDF: alone, or beside the original where the card has room for two pages.
  const frame = useRef<HTMLDivElement>(null);
  const wide = useWide(frame);
  const [view, setView] = useTranslatedView(owner, wide);
  const [side, setSide] = useState<Side>("translated");
  const [linked, setLinked] = useState(true);
  const [swapped, setSwapped] = useState(false);
  // 对照: each page's translation beside it, made in the language and with the model of the menu, for the
  // pages near the view (nothing is asked for in the other modes).
  const parallel = useParallelTranslation({
    paper,
    file,
    language,
    modelId,
    visiblePages: mode === "parallel" ? visiblePages : [],
  });
  // 译文 with no translated PDF yet: the card says how to make one, and there are no pages to move about in.
  const waiting = mode === "translated" && !layout.translatedFile;
  const translatedFile = mode === "translated" ? layout.translatedFile : null;
  const sideBySide = translatedFile !== null && wide && view === "compare";
  // What the one pane shows: the translation, or, in a card too narrow for two panes, the original when asked for.
  const shown =
    translatedFile === null || sideBySide
      ? null
      : wide || side === "translated"
        ? translatedFile
        : null;
  const translation: Translation | null = translatedFile
    ? {
        file: translatedFile,
        sideBySide,
        alignment: layout.job?.alignment,
        linked,
        swapped,
        originalController: controller,
        bar: (
          <CompareBar
            lead={<EngineSwitch layout={layout} />}
            wide={wide}
            view={view}
            onView={setView}
            side={side}
            onSide={setSide}
            linked={linked}
            onLinked={setLinked}
            swapped={swapped}
            onSwap={() => setSwapped((on) => !on)}
            aligned={alignedUnits(layout.job?.alignment) > 0}
          />
        ),
      }
    : null;
  const shownDoc = waiting ? null : doc;
  const shownPages = waiting ? 0 : pages;
  const modeControls = {
    mode,
    onMode: setMode,
    language,
    onLanguage: setLanguage,
    modelId,
    onModel: setModelId,
    onRetranslatePage:
      mode === "parallel" && !parallel.noModel
        ? () => parallel.retry(page)
        : undefined,
  };
  const foldedModes = useFoldedModeEntries(modeControls);
  const find = useFind(shownDoc, controller);
  const followLink = useRef<((dest: PdfDestination) => void) | null>(null);
  const preview = useLinkPreview(route.paperId, doc, followLink);
  const controllerNow = useRef(controller);
  controllerNow.current = controller;
  const docNow = useRef(doc);
  docNow.current = doc;
  const modeNow = useRef(mode);
  modeNow.current = mode;
  useRememberedPage(owner, route.paperId, page, doc !== null);
  // Where the keyboard was when the paper was opened: not somebody's choice, if it is still there.
  const [openedFrom] = useState(() => document.activeElement);

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
  // from the start, unless the person has already put it somewhere (typing, the side panel), or an
  // address with a quote (which goes to the quote, and gives the paper the keyboard once it is there, below).
  const focused = useRef<PDFDocumentProxy | null>(null);
  useEffect(() => {
    const desk = controller?.root;
    if (!doc || !desk || focused.current === doc) return;
    focused.current = doc;
    if (reference || !keyboardFree(openedFrom)) return;
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
        mode: modeNow.current,
      };
      setTrail((trail) => [...trail.slice(1 - TRAIL), spot]);
      pages.scrollToPage(target.page, target.offset);
    },
    [preview.close],
  );
  followLink.current = followLinkInPaper;
  const back = () => {
    const spot = trail.at(-1);
    const desk = controller?.root;
    if (!spot || !controller || !desk) return;
    setTrail(trail.slice(0, -1));
    if (
      spot.mode === mode &&
      Math.abs(controller.percent - spot.percent) < 0.01
    ) {
      desk.scrollTop = spot.top;
      desk.scrollLeft = spot.left;
    } else {
      // The pages are another size now, or laid out otherwise: the same place in them.
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
  // The sentence hovered in the translation beside a page, marked on the page.
  useQuoteHighlight(
    mode === "parallel" && hoverQuote
      ? (textLayers.current.get(hoverQuote.page) ?? null)
      : null,
    hoverQuote?.quote ?? "",
  );
  // Once the reference's page is drawn: the region to the middle if the sentence was not found there,
  // and the keyboard to the paper if nobody has it (as on any opening), once for each time the address is entered.
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
    if (keyboardFree(openedFrom))
      controllerNow.current?.root?.focus({ preventScroll: true });
  }, [reference, referenceLayer, referenceKey, visits]);

  const overlays: Overlays = {
    onLink: followLinkInPaper,
    preview,
    region,
    paper,
    scroller: controller?.root ?? null,
    onAsk,
    onNote,
    keypoints,
    regionMode,
    onRegionMode: setRegionMode,
  };

  // The screen's mod+f reaches the find bar through this.
  useEffect(() => {
    actions.current = {
      find() {
        if (!shownDoc) return false;
        find.show();
        return true;
      },
      jump: navigate,
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
    if (!shownPages || typing(event.target)) return;
    const mac = currentPlatformIsMac();
    if (matchesShortcut(key, "[", mac)) navigate(Math.max(1, page - 1));
    else if (matchesShortcut(key, "]", mac))
      navigate(Math.min(shownPages, page + 1));
    else return;
    event.preventDefault();
  };

  return (
    <div ref={frame} className={styles.frame} onKeyDown={onKeyDown}>
      <PaperHeader
        paper={paper}
        file={source?.file ?? null}
        translations={ENGINES.flatMap((engine) => {
          const file = layout.engines[engine].file;
          return file ? [{ engine, file }] : [];
        })}
        doc={shownDoc}
        page={page}
        pages={shownPages}
        controller={controller}
        onNavigate={navigate}
        findOpen={find.open}
        onFind={find.toggle}
        outlineOpen={outlineOpen}
        onOutline={() => setOutlineOpen((open) => !open)}
        onPaperChange={found}
        onBack={trail.length ? back : undefined}
        panelToggle={panelToggle}
        modes={(compact) => (
          <ModeControls compact={compact} {...modeControls} />
        )}
        modeItems={foldedModes}
        tools={
          <IconButton
            icon={BoxSelect}
            label={t("reader.region.tool")}
            aria-pressed={regionMode}
            onClick={() => setRegionMode((on) => !on)}
          />
        }
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
          // 译文: the translated PDF in the engine (alone, or beside the original) once there is one, else how to make it.
          shown={shown}
          translation={translation}
          instead={waiting ? <LayoutPanel layout={layout} /> : null}
          pageAside={
            mode === "parallel"
              ? (number) => (
                  <ParallelPage
                    parallel={parallel}
                    page={number}
                    onHoverQuote={setHoverQuote}
                  />
                )
              : undefined
          }
          onVisiblePages={setVisiblePages}
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
  const narrow = useMediaQuery(PANEL_FOLDS);
  const compact = useMediaQuery(SIDEBAR_FLOATS);
  const [panelOpen, setPanelOpen] = useState(false);
  // Wide, the docked panel can be put away (remembered on this device); the paper takes its room.
  const [panelKept, setPanelKept] = usePreference<"shown" | "collapsed">(
    `paper-panel:${owner}`,
    "shown",
    ["shown", "collapsed"],
  );
  const collapsed = !narrow && panelKept === "collapsed";
  const toggle = useRef<HTMLButtonElement>(null);
  const [loaded, setLoaded] = useState<Paper | null>(null);
  const [file, setFile] = useState<SourceFile | null>(null);
  const [visits, setVisits] = useState(() => recentPapers(owner));
  const actions = useRef<PaperActions>(null);
  // The paper and PDF the side panel is about: not the previous paper's, while the next is still loading.
  const here = loaded?.id === paperId ? loaded : null;
  const hereFile = file?.paper_id === paperId ? file : null;
  const assistant = useAssistant({ paper: here, file: hereFile });
  const [pending, setPending] = useState<AskRequest | null>(null);
  const notes = useNotes(here);
  const keypoints = useKeypoints(here?.id ?? null, hereFile?.id ?? null);
  const [tab, setTab] = useState<PanelView>("guide");
  // How far up the question box reaches over the foot of the paper's card: the pages leave that room under the last.
  const [cover, setCover] = useState(0);
  // The question box: docked in the panel's foot, or floating over the paper. Its draft is kept here, out of the box.
  const draft = useComposerDraft();
  const rootEl = useRef<HTMLDivElement>(null);
  const footEl = useRef<HTMLDivElement>(null);
  const composerDock = useComposerDock({
    owner,
    narrow,
    root: rootEl,
    dock: footEl,
  });
  const narrowNow = useRef(narrow);
  narrowNow.current = narrow;

  // The panel only opens over the paper; a window that has grown wide shows it docked, and shut when narrowed again.
  useEffect(() => {
    if (!narrow) setPanelOpen(false);
  }, [narrow]);

  // A question about the previous paper's words is not carried over to the next.
  useEffect(() => setPending(null), [paperId]);

  /** Shows a view of the side panel: folded away, the panel opens over the paper with it. */
  const show = useCallback(
    (view: PanelView) => {
      setTab(view);
      if (narrowNow.current) setPanelOpen(true);
      else setPanelKept("shown");
    },
    [setPanelKept],
  );

  // A place in the paper chosen from the panel (a citation, a page of the guide, a highlight): folded away,
  // the panel gets out of the way of where it leads (it would cover it, and the question box).
  const goFromPanel = (move: () => void) => {
    if (narrowNow.current) setPanelOpen(false);
    move();
  };
  const jumpFromPanel = (target: ReaderRoute) =>
    goFromPanel(() => go(readerHash(target).slice(1)));

  // Selected text explained is asked at once, and the answer shown; asked about, it waits in the
  // question box for the question (the box takes the keyboard when it is handed a context).
  const ask = (request: AskRequest) => {
    if (request.action === "explain") {
      show("assistant");
      void assistant.send({
        prompt: t("reader.assistant.explainPrompt"),
        request,
      });
    } else {
      setPending(request);
      // Docked, the box is in the panel: the panel opens on the assistant, where the answer will be.
      if (composerDock.mode === "docked") show("assistant");
    }
  };

  // Kept in the note: the words, their translation if they come with one, and the way back to them.
  const keep = (request: SelectionNote) => {
    const markdown =
      request.markdown ??
      excerptMarkdown(
        request,
        t("reader.notes.source", { page: request.page }),
      );
    const toNotes = {
      label: t("reader.notes.show"),
      onClick: () => show("notes"),
    };
    notes.append(markdown).then(
      // In the note's text but not kept yet is said so: adding it again would write it twice.
      (added) =>
        toast.show({
          message: t(
            added === "saved"
              ? "reader.notes.saved"
              : "reader.notes.appendUnsaved",
          ),
          tone: added === "saved" ? "success" : "error",
          action: toNotes,
        }),
      (reason: unknown) =>
        toast.show({
          message:
            reason instanceof Error && reason.message
              ? reason.message
              : t("reader.notes.appendFailed"),
          tone: "error",
          action: toNotes,
        }),
    );
  };

  // A paper that is there has been read: remember it, as the old reader does.
  useEffect(() => {
    if (loaded?.id !== paperId) return;
    rememberPaper(owner, paperId);
    setVisits(recentPapers(owner));
  }, [owner, paperId, loaded]);

  const panelShown = narrow ? panelOpen : !collapsed;
  const panelToggle = (
    <IconButton
      ref={toggle}
      icon={PanelRight}
      label={t(panelShown ? "reader.panel.hide" : "reader.panel.show")}
      aria-expanded={panelShown}
      onClick={() =>
        narrow
          ? setPanelOpen((open) => !open)
          : setPanelKept(collapsed ? "shown" : "collapsed")
      }
    />
  );

  // Docked in a panel that is put away, the question box floats over the paper until the panel is back.
  const composerDocked = composerDock.mode === "docked" && !collapsed;
  const composer = (
    <Composer
      assistant={assistant}
      pending={pending}
      onClearPending={() => setPending(null)}
      onCover={setCover}
      draft={draft}
      placement={composerDocked ? "docked" : "floating"}
      place={composerDock.place}
      lifted={composerDock.dragging}
      boxRef={composerDock.attach}
      onGrip={
        composerDock.canDetach && !collapsed ? composerDock.grip : undefined
      }
      onToggleDock={
        composerDock.canDetach && !collapsed ? composerDock.toggle : undefined
      }
      onAsk={() => show("assistant")}
    />
  );

  return (
    <div
      ref={rootEl}
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
              floating={compact}
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
          style={{ "--composer-clearance": `${cover}px` } as CSSProperties}
        >
          {/* A new paper starts afresh, its boundary too: a failure is not carried over to it. */}
          <PaperCard
            key={paperId}
            route={route}
            go={go}
            owner={owner}
            panelToggle={panelToggle}
            onPaper={setLoaded}
            onFile={setFile}
            onAsk={ask}
            onNote={keep}
            keypoints={keypoints.visible}
            actions={actions}
          />
          {!composerDocked && composer}
        </Card>
        <RightPanel
          paperId={paperId}
          paper={here}
          file={hereFile}
          onJumpToPage={(page) =>
            goFromPanel(() => actions.current?.jump(page))
          }
          assistant={assistant}
          keypoints={keypoints}
          onCite={jumpFromPanel}
          onKeep={
            here && hereFile
              ? (markdown) =>
                  keep({
                    paperId: here.id,
                    fileId: hereFile.id,
                    page: 1,
                    source: "page",
                    action: "ask",
                    markdown,
                  })
              : undefined
          }
          notes={
            here
              ? { paper: here, file: hereFile, notes, onJump: jumpFromPanel }
              : undefined
          }
          tab={tab}
          onTabChange={setTab}
          dock={{
            footRef: footEl,
            children: composerDocked ? composer : null,
            drop:
              composerDock.mode === "floating" && composerDock.dragging
                ? composerDock.over
                  ? "over"
                  : "away"
                : undefined,
          }}
          collapsed={collapsed}
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
