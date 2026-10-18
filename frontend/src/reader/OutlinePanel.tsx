import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useI18n } from "../i18n/I18nProvider";
import { Floating, SegmentedControl, Spinner, type DismissReason } from "../ui";
import { outlineOf, type OutlineNode } from "./outline";
import { RenderQueue } from "./render-queue";
import styles from "./OutlinePanel.module.css";

/** A thumbnail is the page at this scale: a letter page is about 120px wide. */
const THUMBNAIL_SCALE = 0.2;
/** At most this many thumbnails are drawn at a time. */
const CONCURRENT_DRAWS = 2;
/** A thumbnail is drawn from this far (px) before it comes into view, and let go this far after it leaves. */
const NEAR = 240;

type View = "outline" | "pages";

/** Gives a canvas's memory back at once (Safari holds on to it otherwise) and takes it off the page. */
function release(element: Element) {
  if (element instanceof HTMLCanvasElement) element.width = element.height = 0;
  element.remove();
}

/**
 * One IntersectionObserver for all the thumbnails (a long PDF has thousands),
 * rooted in the scroller: each says whether it is near enough the view to be drawn.
 */
interface Watcher {
  watch(element: Element, onChange: (near: boolean) => void): () => void;
}

function useWatcher(root: HTMLElement | null): Watcher | null {
  const [watcher, setWatcher] = useState<Watcher | null>(null);
  useEffect(() => {
    if (!root) return;
    const callbacks = new Map<Element, (near: boolean) => void>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries)
          callbacks.get(entry.target)?.(entry.isIntersecting);
      },
      { root, rootMargin: `${NEAR}px 0px` },
    );
    setWatcher({
      watch(element, onChange) {
        callbacks.set(element, onChange);
        observer.observe(element);
        return () => {
          callbacks.delete(element);
          observer.unobserve(element);
        };
      },
    });
    return () => {
      observer.disconnect();
      setWatcher(null);
    };
  }, [root]);
  return watcher;
}

function Thumbnail({
  doc,
  number,
  current,
  watcher,
  queue,
  onNavigate,
}: {
  doc: PDFDocumentProxy;
  number: number;
  current: boolean;
  /** Tells whether the thumbnail is near the view of the scroller: it is drawn while it is. */
  watcher: Watcher | null;
  queue: RenderQueue;
  onNavigate: (page: number) => void;
}) {
  const { t } = useI18n();
  const cell = useRef<HTMLButtonElement>(null);
  const holder = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const [drawn, setDrawn] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!watcher || !cell.current) return;
    return watcher.watch(cell.current, setNear);
  }, [watcher]);

  // Drawn while near, in turn with the others; let go of when it is not (a long PDF must not keep every picture).
  useEffect(() => {
    if (!near) return;
    const target = holder.current;
    if (!target) return;
    let cancelled = false;
    let task: RenderTask | undefined;
    let canvas: HTMLCanvasElement | undefined;
    const forget = queue.add(async () => {
      if (cancelled) return;
      try {
        const page = await doc.getPage(number);
        if (cancelled) return;
        // Sharp on a dense screen, at the size of the scale on the page.
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        const viewport = page.getViewport({ scale: THUMBNAIL_SCALE * ratio });
        canvas = document.createElement("canvas");
        canvas.className = styles.canvas;
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        canvas.style.width = `${canvas.width / ratio}px`;
        task = page.render({
          canvas,
          canvasContext: canvas.getContext("2d")!,
          viewport,
        });
        await task.promise;
        if (cancelled) return;
        for (const old of [...target.children]) release(old);
        target.append(canvas);
        canvas = undefined;
        setDrawn(true);
      } catch (error) {
        const stopped =
          error instanceof Error &&
          error.name === "RenderingCancelledException";
        if (!cancelled && !stopped) setFailed(true);
      }
    });
    return () => {
      cancelled = true;
      forget();
      task?.cancel();
      if (canvas) release(canvas);
      for (const old of [...target.children]) release(old);
      setDrawn(false);
    };
  }, [near, doc, number, queue]);

  return (
    <button
      ref={cell}
      type="button"
      className={styles.thumbnail}
      aria-label={t("reader.thumbnail.goto", { page: number })}
      aria-current={current ? "page" : undefined}
      data-rendered={drawn}
      onClick={() => onNavigate(number)}
    >
      <span className={styles.sheet}>
        <span ref={holder} className={styles.picture} aria-hidden="true" />
        {failed && (
          <span className={styles.unavailable}>
            {t("reader.thumbnail.failed")}
          </span>
        )}
      </span>
      <span className={styles.number}>{number}</span>
    </button>
  );
}

/** The pages as small pictures, two to a row, each drawn when it is near enough to be seen. */
function Thumbnails({
  doc,
  page,
  root,
  onNavigate,
}: {
  doc: PDFDocumentProxy;
  page: number;
  root: HTMLElement | null;
  onNavigate: (page: number) => void;
}) {
  const { t } = useI18n();
  const grid = useRef<HTMLDivElement>(null);
  const queue = useMemo(() => new RenderQueue(CONCURRENT_DRAWS), []);
  const watcher = useWatcher(root);
  // Every cell holds the place of the first page's shape until its own picture says otherwise.
  const [shape, setShape] = useState("612 / 792");

  useEffect(() => {
    let live = true;
    doc.getPage(1).then(
      (first) => {
        const { width, height } = first.getViewport({ scale: 1 });
        if (live) setShape(`${width} / ${height}`);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [doc]);

  // Opens at the page being read.
  useLayoutEffect(() => {
    const here = grid.current?.querySelector<HTMLElement>(
      '[aria-current="page"]',
    );
    if (root && here)
      root.scrollTop =
        here.offsetTop - (root.clientHeight - here.offsetHeight) / 2;
    // Once, when the scroller is there: reading on does not move the list under the pointer.
  }, [root]);

  return (
    <div
      ref={grid}
      role="group"
      aria-label={t("reader.thumbnail.list")}
      className={styles.grid}
      style={{ "--thumbnail-shape": shape } as CSSProperties}
    >
      {Array.from({ length: doc.numPages }, (_, index) => (
        <Thumbnail
          key={index + 1}
          doc={doc}
          number={index + 1}
          current={index + 1 === page}
          watcher={watcher}
          queue={queue}
          onNavigate={onNavigate}
        />
      ))}
    </div>
  );
}

/** The document's own table of contents, a row for each entry, indented by its level. */
function OutlineList({
  outline,
  onNavigate,
}: {
  outline: OutlineNode[];
  onNavigate: (page: number) => void;
}) {
  return (
    <ul className={styles.tree}>
      {outline.map((node, index) => {
        const title = node.title || "—";
        const indent = { "--depth": node.depth } as CSSProperties;
        return (
          <li key={index}>
            {node.page === null ? (
              // Its destination leads nowhere: the title is all there is.
              <span className={styles.entry} style={indent}>
                <span className={styles.title}>{title}</span>
              </span>
            ) : (
              <button
                type="button"
                className={styles.entry}
                style={indent}
                onClick={() => onNavigate(node.page!)}
              >
                <span className={styles.title}>{title}</span>
                <span className={styles.page} aria-hidden="true">
                  {node.page}
                </span>
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** What is in the panel while it is open; it is made anew each time it opens. */
function OutlineContent({
  doc,
  page,
  onNavigate,
}: {
  doc: PDFDocumentProxy;
  page: number;
  onNavigate: (page: number) => void;
}) {
  const { t } = useI18n();
  const ids = useId();
  const tabs = useRef<HTMLDivElement>(null);
  const [body, setBody] = useState<HTMLDivElement | null>(null);
  const [outline, setOutline] = useState<OutlineNode[] | null>(null);
  const [chosen, setChosen] = useState<View | null>(null);

  useEffect(() => {
    let live = true;
    void outlineOf(doc).then((nodes) => {
      if (live) setOutline(nodes);
    });
    return () => {
      live = false;
    };
  }, [doc]);

  // A PDF with no outline of its own opens on its pages, unless a tab has been chosen.
  const view: View = chosen ?? (outline?.length === 0 ? "pages" : "outline");

  // Opening puts the keyboard on the tabs, once it is known which one is chosen.
  const known = outline !== null;
  useEffect(() => {
    if (known)
      tabs.current
        ?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
        ?.focus();
  }, [known]);

  const panels: View[] = ["outline", "pages"];
  return (
    <div
      role="dialog"
      aria-label={t("reader.outline.open")}
      className={styles.panel}
    >
      <div ref={tabs} className={styles.tabs}>
        <SegmentedControl
          kind="tabs"
          size="sm"
          label={t("reader.outline.views")}
          options={panels.map((value) => ({
            value,
            label: t(`reader.outline.tab.${value}`),
            panelId: `${ids}-${value}`,
          }))}
          value={view}
          onChange={setChosen}
        />
      </div>
      <div ref={setBody} className={styles.body}>
        {panels.map((value) => (
          <div
            key={value}
            role="tabpanel"
            id={`${ids}-${value}`}
            aria-labelledby={`${ids}-${value}-tab`}
            hidden={view !== value}
          >
            {view !== value ? null : value === "outline" ? (
              outline === null ? (
                <div className={styles.loading} role="status">
                  <Spinner />
                </div>
              ) : outline.length === 0 ? (
                <p className={styles.note}>{t("reader.outline.none")}</p>
              ) : (
                <OutlineList outline={outline} onNavigate={onNavigate} />
              )
            ) : (
              <>
                {outline?.length === 0 && (
                  <p className={styles.note}>{t("reader.outline.none")}</p>
                )}
                <Thumbnails
                  doc={doc}
                  page={page}
                  root={body}
                  onNavigate={onNavigate}
                />
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export interface OutlinePanelProps {
  open: boolean;
  /** The button that opens it: the panel hangs under it. */
  anchor: HTMLElement | null;
  doc: PDFDocumentProxy;
  /** The page being read: marked among the thumbnails. */
  page: number;
  /** A row or a thumbnail was chosen. */
  onNavigate: (page: number) => void;
  /** Esc was pressed, or the pointer went down outside it. */
  onDismiss: (reason: DismissReason) => void;
}

/**
 * The PDF's contents, anchored to the button that opens it: its own table of
 * contents (each entry leads to a page, nested as the PDF nests them), and the
 * pages as thumbnails. A PDF with no table of contents opens on the pages.
 */
export function OutlinePanel({
  open,
  anchor,
  doc,
  page,
  onNavigate,
  onDismiss,
}: OutlinePanelProps) {
  return (
    <Floating
      open={open}
      anchor={anchor}
      placement={{ side: "bottom", align: "end" }}
      ignore={anchor}
      onDismiss={onDismiss}
    >
      <OutlineContent doc={doc} page={page} onNavigate={onNavigate} />
    </Floating>
  );
}
