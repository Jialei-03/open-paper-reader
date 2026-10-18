import clsx from "clsx";
import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from "react";
import type { SourceFile } from "../../api";
import { useI18n } from "../../i18n/I18nProvider";
import { PdfRenderRetention } from "../../lib/pdf-render-retention";
import { usePdfTouchPan } from "../../lib/use-pdf-touch-pan";
import { usePdfZoom } from "../../lib/use-pdf-zoom";
import { currentPlatformIsMac, matchesShortcut } from "../../ui/shortcut";
import {
  PageWatcher,
  PdfPageView,
  type PageGeometry,
  type PageSize,
} from "./PdfPageView";
import styles from "./PdfPages.module.css";
import "./pdf-engine.css";

export type { PageGeometry } from "./PdfPageView";

/** "auto": the page's own size, but never wider than the room; "fit": as wide as the room; a number: that scale. */
export type PdfZoom = "auto" | "fit" | number;

/**
 * What the rest of the reader can do with the pages. A new controller is
 * handed to `controllerRef` whenever `zoom` or `percent` change, so a state
 * setter given as the ref re-renders with them.
 */
export type PdfController = {
  /** Scroll so that the page's top (or `offset`, a fraction of its height, below it) is just under the top. */
  scrollToPage(page: number, offset?: number): void;
  /** Where the reading is: the page under the top (from 0) plus how far down it is, e.g. 11.25. */
  position(): number;
  zoomIn(): void;
  zoomOut(): void;
  setZoom(zoom: PdfZoom): void;
  zoom: PdfZoom;
  /** The scale in percent, e.g. 122.2. */
  percent: number;
  /** The scroller. */
  root: HTMLElement | null;
};

export interface PdfPagesProps {
  doc: PDFDocumentProxy;
  file: SourceFile;
  /** The page to show: a change from outside scrolls there; scrolling reports through `onPageChange`. */
  page: number;
  onPageChange(page: number): void;
  controllerRef: Ref<PdfController>;
  /** Drawn inside each page while it is drawn, over its text. */
  pageOverlays?: (page: number, geometry: PageGeometry) => ReactNode;
  /** A page's text layer, and whether its text is there (`rendered`); `null` when the page goes. */
  textLayerRef?: (
    page: number,
    element: HTMLDivElement | null,
    rendered: boolean,
  ) => void;
  /** A page has been drawn: its canvas and its text. */
  onPageRendered?: (page: number) => void;
}

/** The pages inside the scroller, for the zoom (`lib/use-pdf-zoom`) to find. */
const PAGE = "[data-page]";
/** How many pages that left the view keep their drawing, as in the old reader. */
const KEEP = 3;
/** The narrowest the pages are laid out for, however narrow the card. */
const MIN_WIDTH = 160;

const ZOOM_IN = ["mod+=", "mod++", "mod+shift++"];
const ZOOM_OUT = ["mod+-"];
const FIT = ["mod+0"];

/**
 * The zoom shortcuts (mod+= and mod+- step, mod+0 fits the width), for the
 * card around the pages to listen with: they work wherever the keyboard is in
 * it. Whether `event` was one (then the caller prevents the browser's own zoom).
 */
export function zoomShortcut(
  event: Pick<
    KeyboardEvent,
    | "key"
    | "metaKey"
    | "ctrlKey"
    | "shiftKey"
    | "altKey"
    | "defaultPrevented"
    | "isComposing"
  >,
  controller: PdfController | null,
): boolean {
  if (!controller || event.defaultPrevented || event.isComposing) return false;
  const mac = currentPlatformIsMac();
  const is = (specs: string[]) =>
    specs.some((spec) => matchesShortcut(event, spec, mac));
  if (is(ZOOM_IN)) controller.zoomIn();
  else if (is(ZOOM_OUT)) controller.zoomOut();
  else if (is(FIT)) controller.setZoom("fit");
  else return false;
  return true;
}

type Row = { top: number; height: number };

const clamp = (value: number, low: number, high: number) =>
  Math.max(low, Math.min(high, value));

/**
 * The PDF as one long scroll of pages on the desk. Every page holds its place
 * from the start (sized from the first page until its own size is known), and
 * only the pages near the view are drawn. The page under the middle of the view
 * is reported as the current one; the reading position is kept through zooming,
 * resizing and pages finding their real size.
 */
export function PdfPages({
  doc,
  file,
  page,
  onPageChange,
  controllerRef,
  pageOverlays,
  textLayerRef,
  onPageRendered,
}: PdfPagesProps) {
  const { t } = useI18n();
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  /** The width the pages are laid out for; 0 until measured. */
  const [width, setWidth] = useState(0);
  const widthNow = useRef(0);
  /** Room above the first page: a page scrolled to stands this far below the top. */
  const inset = useRef(0);
  /** The first page's size: the guess for every page whose own size is not known yet. */
  const [first, setFirst] = useState<PageSize | null>(null);
  const sizes = useRef<(PageSize | undefined)[]>([]);
  const [measured, setMeasured] = useState(0);
  const retention = useMemo(() => new PdfRenderRetention(KEEP), []);
  const watcher = useMemo(() => new PageWatcher(), []);
  const zoom = usePdfZoom(root, width, undefined, undefined, PAGE);
  usePdfTouchPan(root);

  /** Each page's top in the scroller and the distance to the next one; cleared whenever the layout changes. */
  const rows = useRef<Row[] | null>(null);
  /** The last page reported through `onPageChange` (or asked for through `page`). */
  const reported = useRef(1);
  /** A page scrolled to on purpose: it stays the current page, and in view, until the person scrolls. */
  const hold = useRef<{ page: number; offset: number; top: number } | null>(
    null,
  );
  /** A position to come back to once a change of layout (a new width, a page's real size) is drawn. */
  const kept = useRef<number | null>(null);
  const onPageChangeNow = useRef(onPageChange);
  onPageChangeNow.current = onPageChange;
  const textLayerNow = useRef(textLayerRef);
  textLayerNow.current = textLayerRef;
  const renderedNow = useRef(onPageRendered);
  renderedNow.current = onPageRendered;

  const metrics = (): Row[] => {
    if (rows.current) return rows.current;
    const scroller = root.current;
    const pages = list.current;
    if (!scroller || !pages) return [];
    const origin =
      scroller.getBoundingClientRect().top +
      scroller.clientTop -
      scroller.scrollTop;
    const boxes = [...pages.children].map((child) =>
      child.getBoundingClientRect(),
    );
    // No pages yet: nothing to remember.
    if (!boxes.length) return [];
    return (rows.current = boxes.map((box, index) => ({
      top: box.top - origin,
      height: Math.max(1, (boxes[index + 1]?.top ?? box.bottom) - box.top),
    })));
  };

  /** The index of the last row that starts at or above `y`. */
  const rowAt = (all: Row[], y: number) => {
    let low = 0;
    let high = all.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (all[middle].top <= y) low = middle;
      else high = middle - 1;
    }
    return low;
  };

  const position = () => {
    const scroller = root.current;
    const all = metrics();
    if (!scroller || !all.length) return 0;
    const y = scroller.scrollTop + inset.current;
    const index = rowAt(all, y);
    const row = all[index];
    return index + clamp((y - row.top) / row.height, 0, 0.9999);
  };

  /** Scroll to a position; the scroll top it got (the scroller may not go that far). */
  const place = (number: number, offset: number) => {
    const scroller = root.current;
    const row = metrics()[number - 1];
    if (!scroller || !row) return null;
    scroller.scrollTop = row.top - inset.current + offset * row.height;
    return scroller.scrollTop;
  };

  const report = (number: number) => {
    if (number === reported.current) return;
    reported.current = number;
    onPageChangeNow.current(number);
  };

  const scrollToPage = (target: number, offset = 0) => {
    const number = clamp(Math.floor(target) || 1, 1, doc.numPages);
    const fraction = clamp(offset, 0, 0.9999);
    // A zoom still settling must not pull the view back where it was.
    zoom.releaseAnchor();
    kept.current = null;
    const top = place(number, fraction);
    if (top === null) {
      // Not laid out yet: as the page asked for, it is scrolled to once it is.
      onPageChangeNow.current(number);
      return;
    }
    hold.current = { page: number, offset: fraction, top };
    report(number);
  };

  const move = (value: number) => {
    const index = clamp(Math.floor(value), 0, doc.numPages - 1);
    place(index + 1, value - index);
  };

  /** Called before a change that moves the pages under the view, so the view can follow. */
  const keep = () => {
    if (kept.current === null && !hold.current && !zoom.zooming.current)
      kept.current = position();
  };

  const track = () => {
    const scroller = root.current;
    if (!scroller || zoom.zooming.current) return;
    const held = hold.current;
    if (held) {
      if (Math.abs(scroller.scrollTop - held.top) <= 2) return;
      hold.current = null;
    }
    const all = metrics();
    if (!all.length) return;
    // The page under the middle of the view: right for short pages and tall ones.
    const middle = scroller.scrollTop + scroller.clientHeight / 2;
    let low = 0;
    let high = all.length - 1;
    while (low < high) {
      const index = (low + high) >> 1;
      if (all[index].top + all[index].height > middle) high = index;
      else low = index + 1;
    }
    report(low + 1);
  };
  const trackNow = useRef(track);
  trackNow.current = track;

  // Scrolling reports the page at most once a frame.
  const frame = useRef(0);
  const scheduleTrack = useCallback(() => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      trackNow.current();
    });
  }, []);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  // The room the pages have: the scroller's width less the padding around them.
  useLayoutEffect(() => {
    const scroller = root.current!;
    const pages = list.current!;
    const measure = () => {
      const style = getComputedStyle(pages);
      inset.current = parseFloat(style.paddingTop) || 0;
      const room = Math.max(
        MIN_WIDTH,
        scroller.clientWidth -
          (parseFloat(style.paddingLeft) || 0) -
          (parseFloat(style.paddingRight) || 0),
      );
      if (room === widthNow.current) return;
      if (widthNow.current) keepNow.current();
      widthNow.current = room;
      setWidth(room);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, []);

  // The first page's size, before any page is laid out.
  useEffect(() => {
    let cancelled = false;
    doc.getPage(1).then(
      (loaded) => {
        const { width, height } = loaded.getViewport({ scale: 1 });
        if (!cancelled) setFirst({ width, height });
      },
      () => {
        // The page will say it failed; hold the places at a letter page meanwhile.
        if (!cancelled) setFirst({ width: 612, height: 792 });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [doc]);

  const firstNow = useRef(first);
  firstNow.current = first;
  const keepNow = useRef(keep);
  keepNow.current = keep;
  const onSize = useCallback((number: number, size: PageSize) => {
    const guess = sizes.current[number - 1] ?? firstNow.current;
    sizes.current[number - 1] = size;
    if (
      guess &&
      Math.abs(guess.width - size.width) < 0.5 &&
      Math.abs(guess.height - size.height) < 0.5
    )
      return;
    keepNow.current();
    setMeasured((count) => count + 1);
  }, []);

  // Pages watch the view through one observer, rooted in the scroller.
  useLayoutEffect(() => {
    watcher.connect(root.current!);
    return () => watcher.disconnect();
  }, [watcher]);

  // Any change in the pages' sizes moves them: measure again, and see which page is under the view.
  useEffect(() => {
    const observer = new ResizeObserver(() => {
      rows.current = null;
      scheduleTrack();
    });
    observer.observe(list.current!);
    return () => observer.disconnect();
  }, [scheduleTrack]);

  const ready = width > 0 && first !== null;

  // After a new width or a page's real size: stay on what was being read.
  useLayoutEffect(() => {
    rows.current = null;
    if (!ready || zoom.zooming.current) return;
    const held = hold.current;
    if (held) {
      const top = place(held.page, held.offset);
      if (top !== null) held.top = top;
    } else if (kept.current !== null) move(kept.current);
    kept.current = null;
    // `place` and `move` read the layout of this render.
  }, [ready, width, measured]);

  // A page asked for from outside (an address, a link, the page field) is scrolled to.
  useLayoutEffect(() => {
    if (!ready || page === reported.current) return;
    scrollToPage(page);
  }, [ready, page]);

  const actions = useRef({ scrollToPage, position, zoom });
  actions.current = { scrollToPage, position, zoom };
  const zoomValue: PdfZoom =
    zoom.zoom === "auto" || zoom.zoom === "fit" ? zoom.zoom : Number(zoom.zoom);
  const percent = Number(zoom.percent) || 100;
  useImperativeHandle(
    controllerRef,
    () => ({
      scrollToPage: (target, offset) =>
        actions.current.scrollToPage(target, offset),
      position: () => actions.current.position(),
      zoomIn: () => {
        hold.current = null;
        actions.current.zoom.step(1);
      },
      zoomOut: () => {
        hold.current = null;
        actions.current.zoom.step(-1);
      },
      setZoom: (value) => {
        hold.current = null;
        const { fit, automatic, apply } = actions.current.zoom;
        if (value === "fit") fit();
        else if (value === "auto") automatic();
        else apply(String(value * 100));
      },
      zoom: zoomValue,
      percent,
      get root() {
        return root.current;
      },
    }),
    [zoomValue, percent],
  );

  const onText = useCallback(
    (number: number, element: HTMLDivElement | null, rendered: boolean) =>
      textLayerNow.current?.(number, element, rendered),
    [],
  );
  const onRendered = useCallback(
    (number: number) => renderedNow.current?.(number),
    [],
  );

  const pages: ReactNode[] = [];
  if (ready)
    for (let number = 1; number <= doc.numPages; number++) {
      const native = sizes.current[number - 1] ?? first;
      const scale =
        zoomValue === "auto"
          ? Math.min(1, width / native.width)
          : zoomValue === "fit"
            ? width / native.width
            : zoomValue;
      pages.push(
        <PdfPageView
          key={number}
          doc={doc}
          page={number}
          width={native.width * scale}
          height={native.height * scale}
          scale={scale}
          nativeWidth={native.width}
          watcher={watcher}
          retention={retention}
          onSize={onSize}
          overlays={pageOverlays}
          onText={onText}
          onRendered={onRendered}
        />,
      );
    }

  return (
    <div
      ref={root}
      className={clsx("opr-pdf", styles.scroller)}
      data-file={file.id}
      // The keyboard scrolls it (arrows, Page Up / Down, Space) once it has the focus.
      tabIndex={0}
      role="region"
      aria-label={t("reader.pdf.region")}
      onScroll={scheduleTrack}
    >
      {/* During a pinch the pages are scaled as they are; they are drawn anew once it ends. */}
      <div ref={list} className={styles.pages} style={{ zoom: zoom.preview }}>
        {pages}
      </div>
    </div>
  );
}
