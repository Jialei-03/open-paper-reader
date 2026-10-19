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
import { RESIZING_ATTRIBUTE } from "../../ui/Resizer";
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
  scrollToPage(
    page: number,
    offset?: number,
    /** `follow`: the scroll only keeps this pane in step with another; it does not lay out the page's text at once. */
    options?: { follow?: boolean },
  ): void;
  /** Where the reading is: the page under the top (from 0) plus how far down it is, e.g. 11.25. */
  position(): number;
  zoomIn(): void;
  zoomOut(): void;
  setZoom(zoom: PdfZoom): void;
  zoom: PdfZoom;
  /** The scale in percent, e.g. 122.2. */
  percent: number;
  /** The scale at which the first page is as wide as the room (what "fit" is here); 0 until known. */
  fit: number;
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
  /**
   * Lay the pages' text out only once the pointer has come into the pages (or
   * been pressed on them): for a pane that is mostly watched, not read.
   */
  lazyText?: boolean;
  /** A page has been drawn: its canvas and its text. */
  onPageRendered?: (page: number) => void;
  /**
   * A column beside each page (the translation, in the 对照 reading). With it
   * the pages take `PAGE_SHARE` of the room and the column the rest; in a room
   * narrower than `STACK_BELOW` the column goes under its page instead.
   */
  pageAside?: (page: number) => ReactNode;
  /**
   * The pages in view and one either side of them, whenever they change: the
   * current page first, then the others, nearest first.
   */
  onVisiblePages?: (pages: number[]) => void;
}

/** The pages inside the scroller, for the zoom (`lib/use-pdf-zoom`) to find. */
const PAGE = "[data-page]";
/** How many pages that left the view keep their drawing, as in the old reader. */
const KEEP = 3;
/** The narrowest the pages are laid out for, however narrow the card. */
const MIN_WIDTH = 160;
/** With a column beside the pages, the share of the room the pages take, as in the old reader's 对照. */
const PAGE_SHARE = 0.56;
/** A room narrower than this has no space for a column beside a page: it goes under the page. */
const STACK_BELOW = 620;
/** How long the room must stay the same before the pages are fitted to it again. */
const RESIZE_SETTLE_MS = 150;

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

/** The room the pages have: the scroller's width less the padding around them. */
function roomOf(scroller: HTMLElement, pages: HTMLElement) {
  const style = getComputedStyle(pages);
  return Math.max(
    MIN_WIDTH,
    scroller.clientWidth -
      (parseFloat(style.paddingLeft) || 0) -
      (parseFloat(style.paddingRight) || 0),
  );
}

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
  pageAside,
  onVisiblePages,
  lazyText,
}: PdfPagesProps) {
  const { t } = useI18n();
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  /** The width the pages are laid out for; 0 until measured. */
  const [width, setWidth] = useState(0);
  const widthNow = useRef(0);
  /** Room above the first page: a page scrolled to stands this far below the top. */
  const inset = useRef(0);
  /** Between a page and the column beside it (the stylesheet's `--aside-gap`). */
  const [asideGap, setAsideGap] = useState(0);
  /** The first page's size: the guess for every page whose own size is not known yet. */
  const [first, setFirst] = useState<PageSize | null>(null);
  const sizes = useRef<(PageSize | undefined)[]>([]);
  const [measured, setMeasured] = useState(0);
  /** A lazy pane has had the pointer in it: its pages may lay their text out. */
  const [engaged, setEngaged] = useState(false);
  const retention = useMemo(() => new PdfRenderRetention(KEEP), []);
  const watcher = useMemo(() => new PageWatcher(), []);

  /** Each page's top in the scroller and the distance to the next one; cleared whenever the layout changes. */
  const rows = useRef<Row[] | null>(null);
  /** The last page reported through `onPageChange` (or asked for through `page`). */
  const reported = useRef(1);
  /** A page scrolled to on purpose: it stays the current page, and in view, until the person scrolls. */
  const hold = useRef<{ page: number; offset: number; top: number } | null>(
    null,
  );

  // Scrolling reports the page at most once a frame.
  const trackNow = useRef<() => void>(() => undefined);
  const frame = useRef(0);
  const scheduleTrack = useCallback(() => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      trackNow.current();
    });
  }, []);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  // With a column beside the pages, the pages are laid out for their share of the room.
  const aside = pageAside !== undefined;
  const columns = aside && width >= STACK_BELOW;
  const basis = columns
    ? Math.max(MIN_WIDTH, (width - asideGap) * PAGE_SHARE)
    : width;
  /** The column's width: the rest of the room beside the page, or all of it under the page. */
  const asideWidth = columns ? Math.max(0, width - asideGap - basis) : width;

  const zoom = usePdfZoom(
    root,
    basis,
    // Any zoom (the menu, the keys, a wheel or a pinch) is the person moving
    // the view: a page scrolled to before it no longer holds the place.
    () => {
      hold.current = null;
    },
    // The pages have settled at their new size: which page is under the view is to be read again.
    () => {
      rows.current = null;
      scheduleTrack();
    },
    PAGE,
  );
  usePdfTouchPan(root);

  /** A position to come back to once a change of layout (a new width, a page's real size) is drawn. */
  const kept = useRef<number | null>(null);
  const onPageChangeNow = useRef(onPageChange);
  onPageChangeNow.current = onPageChange;
  const textLayerNow = useRef(textLayerRef);
  textLayerNow.current = textLayerRef;
  const renderedNow = useRef(onPageRendered);
  renderedNow.current = onPageRendered;
  const visibleNow = useRef(onVisiblePages);
  visibleNow.current = onVisiblePages;
  const asideNow = useRef(aside);
  asideNow.current = aside;
  /** The pages last reported through `onVisiblePages`, joined. */
  const visibleReported = useRef("");

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

  const scrollToPage = (
    target: number,
    offset = 0,
    options?: { follow?: boolean },
  ) => {
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
    // A jump is made to what is on the page: its text is laid out now, not once the view is still.
    if (!options?.follow) watcher.force(number);
    report(number);
  };

  const move = (value: number) => {
    const index = clamp(Math.floor(value), 0, doc.numPages - 1);
    place(index + 1, value - index);
  };

  /**
   * Called before a change that moves the pages under the view, so the view can
   * follow. A page scrolled to is held, unless the view has moved since (by
   * something scrolled into view, say a quote, before the scroll was heard):
   * then it is where the view is now that is kept.
   */
  const keep = () => {
    const held = hold.current;
    const scroller = root.current;
    if (held && scroller && Math.abs(scroller.scrollTop - held.top) > 2)
      hold.current = null;
    if (kept.current === null && !hold.current && !zoom.zooming.current)
      kept.current = position();
  };

  /** The pages in view and one either side, the current one first, to `onVisiblePages` when they change. */
  const reportVisible = (current: number) => {
    const callback = visibleNow.current;
    const scroller = root.current;
    if (!callback || !scroller) return;
    const all = metrics();
    if (!all.length) return;
    const top = scroller.scrollTop;
    const first = rowAt(all, top);
    const last = rowAt(all, top + Math.max(0, scroller.clientHeight - 1));
    const pages: number[] = [];
    const end = Math.min(all.length - 1, last + 1);
    for (let index = Math.max(0, first - 1); index <= end; index++)
      pages.push(index + 1);
    // Nearest the current page first; of two as near, the one after it (where the reading goes).
    pages.sort(
      (a, b) =>
        Math.abs(a - current) - Math.abs(b - current) ||
        Number(a < current) - Number(b < current),
    );
    const key = pages.join(",");
    if (key === visibleReported.current) return;
    visibleReported.current = key;
    callback(pages);
  };

  const track = () => {
    const scroller = root.current;
    if (!scroller || zoom.zooming.current) return;
    const held = hold.current;
    if (held) {
      if (Math.abs(scroller.scrollTop - held.top) <= 2) {
        reportVisible(held.page);
        return;
      }
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
    reportVisible(low + 1);
  };
  trackNow.current = track;

  /**
   * While a sidebar or the panel is dragged the pages follow the card live, and
   * cheaply: the pages already drawn are scaled to the width they will have
   * (the same scale the zoom of a pinch uses), and the reading stays on the
   * point that was at the middle of the view. They are drawn at that width once,
   * after the pointer is let go.
   */
  const liveAnchor = useRef<{ index: number; fraction: number } | null>(null);
  const liveFactor = useRef(1);
  const liveFit = useRef<(room: number) => number>(() => 1);
  const previewNow = useRef(1);
  const follows = () => {
    const scroller = root.current;
    const pages = list.current;
    if (!scroller || !pages || !widthNow.current) return;
    const factor = liveFit.current(roomOf(scroller, pages));
    if (!liveAnchor.current) {
      const all = metrics();
      if (!all.length) return;
      const middle = scroller.scrollTop + scroller.clientHeight / 2;
      const index = rowAt(all, middle);
      liveAnchor.current = {
        index,
        fraction: clamp((middle - all[index].top) / all[index].height, 0, 1),
      };
    }
    if (Math.abs(factor - liveFactor.current) < 0.0005) return;
    liveFactor.current = factor;
    pages.style.zoom = String(previewNow.current * factor);
    rows.current = null;
    const row = metrics()[liveAnchor.current.index];
    if (row)
      scroller.scrollTop =
        row.top +
        liveAnchor.current.fraction * row.height -
        scroller.clientHeight / 2;
  };
  const followsNow = useRef(follows);
  followsNow.current = follows;
  /** Back to the pages' own size (the pinch's preview, if any, stays). */
  const unfollow = () => {
    liveAnchor.current = null;
    liveFactor.current = 1;
    if (list.current) list.current.style.zoom = String(previewNow.current);
  };
  const unfollowNow = useRef(unfollow);
  unfollowNow.current = unfollow;

  // The room the pages have: the scroller's width less the padding around them.
  useLayoutEffect(() => {
    const scroller = root.current!;
    const pages = list.current!;
    const measure = () => {
      const style = getComputedStyle(pages);
      inset.current = parseFloat(style.paddingTop) || 0;
      setAsideGap(parseFloat(style.getPropertyValue("--aside-gap")) || 0);
      const room = roomOf(scroller, pages);
      if (room === widthNow.current) {
        // Dragged back to where it began: the pages are as they were drawn.
        if (liveAnchor.current) {
          const index = liveAnchor.current.index;
          const fraction = liveAnchor.current.fraction;
          unfollowNow.current();
          rows.current = null;
          const row = metrics()[index];
          if (row)
            scroller.scrollTop =
              row.top + fraction * row.height - scroller.clientHeight / 2;
        }
        return;
      }
      if (widthNow.current) keepNow.current();
      widthNow.current = room;
      setWidth(room);
    };
    measure();
    // A card that is being resized by hand (a sidebar or the panel dragged) is followed live, the pages
    // scaled as they are. Any other change (a window dragged) is fitted once it has stopped, not at every
    // size on the way: each fit draws every page near the view again.
    let settle = 0;
    const observer = new ResizeObserver(() => {
      if (document.documentElement.hasAttribute(RESIZING_ATTRIBUTE))
        followsNow.current();
      window.clearTimeout(settle);
      settle = window.setTimeout(function fit() {
        // A panel being dragged by hand holds the fit until it is let go.
        if (document.documentElement.hasAttribute(RESIZING_ATTRIBUTE))
          settle = window.setTimeout(fit, RESIZE_SETTLE_MS);
        else measure();
      }, RESIZE_SETTLE_MS);
    });
    observer.observe(scroller);
    return () => {
      window.clearTimeout(settle);
      observer.disconnect();
    };
  }, []);

  // The pages are drawn at their new width: the preview that stood in for it goes, in the same frame.
  useLayoutEffect(() => {
    unfollowNow.current();
  }, [width]);

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

  // The column beside the pages comes or goes: the pages are about to change their size. Where the
  // reading is is read now, from the layout still on screen, to come back to once the new one is drawn.
  const asideWas = useRef(aside);
  if (asideWas.current !== aside) {
    asideWas.current = aside;
    if (widthNow.current) keep();
  }
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

  /** Back to the page scrolled to, or to the position kept before a change of layout. */
  const follow = () => {
    const held = hold.current;
    if (held) {
      const top = place(held.page, held.offset);
      if (top !== null) held.top = top;
    } else if (kept.current !== null) move(kept.current);
    kept.current = null;
  };
  const followNow = useRef(follow);
  followNow.current = follow;
  const zooming = zoom.zooming;

  // Any change in the pages' sizes moves them: measure again, and see which page is under the view.
  // With columns beside the pages, a column that grows (a translation coming in) moves the pages
  // under it too: the position is read from the rows as they were, and kept in the new ones.
  useEffect(() => {
    const observer = new ResizeObserver(() => {
      if (
        asideNow.current &&
        rows.current &&
        widthNow.current &&
        !zooming.current
      ) {
        keepNow.current();
        rows.current = null;
        followNow.current();
      }
      rows.current = null;
      scheduleTrack();
    });
    observer.observe(list.current!);
    return () => observer.disconnect();
  }, [scheduleTrack, zooming]);

  const ready = width > 0 && first !== null;

  // After a new width (or a column beside the pages, come or gone) or a page's real size: stay on
  // what was being read.
  useLayoutEffect(() => {
    rows.current = null;
    if (!ready || zoom.zooming.current) return;
    follow();
    // `place` and `move` read the layout of this render.
  }, [ready, width, measured, basis, aside]);

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
  previewNow.current = zoom.preview;
  // The scale the first page would have in a room this wide, against the one it has: how much to scale the pages by.
  liveFit.current = (room) => {
    const native = (sizes.current[0] ?? first)?.width;
    if (!native || typeof zoomValue === "number") return 1;
    const scaleIn = (space: number) => {
      const wide = columns
        ? Math.max(MIN_WIDTH, (space - asideGap) * PAGE_SHARE)
        : space;
      return zoomValue === "auto" && !columns
        ? Math.min(1, wide / native)
        : wide / native;
    };
    return scaleIn(room) / scaleIn(widthNow.current);
  };
  const fitScale = first ? basis / (sizes.current[0] ?? first).width : 0;
  useImperativeHandle(
    controllerRef,
    () => ({
      scrollToPage: (target, offset, options) =>
        actions.current.scrollToPage(target, offset, options),
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
      fit: fitScale,
      get root() {
        return root.current;
      },
    }),
    [zoomValue, percent, fitScale],
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
      // Beside a column the page fills its share, as in the old reader's 对照.
      const scale =
        zoomValue === "auto" && !columns
          ? Math.min(1, basis / native.width)
          : zoomValue === "fit" || zoomValue === "auto"
            ? basis / native.width
            : zoomValue;
      const view = (
        <PdfPageView
          key={number}
          doc={doc}
          page={number}
          width={native.width * scale}
          height={native.height * scale}
          scale={scale}
          nativeWidth={native.width}
          watcher={watcher}
          lazy={Boolean(lazyText) && !engaged}
          retention={retention}
          onSize={onSize}
          overlays={pageOverlays}
          onText={onText}
          onRendered={onRendered}
        />
      );
      pages.push(
        pageAside ? (
          <div key={number} className={styles.row}>
            {view}
            <div className={styles.aside} style={{ width: asideWidth }}>
              {pageAside(number)}
            </div>
          </div>
        ) : (
          view
        ),
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
      onPointerEnter={lazyText && !engaged ? () => setEngaged(true) : undefined}
      onPointerDown={lazyText && !engaged ? () => setEngaged(true) : undefined}
    >
      {/* During a pinch the pages are scaled as they are; they are drawn anew once it ends. */}
      <div
        ref={list}
        className={styles.pages}
        data-aside={aside ? (columns ? "beside" : "under") : undefined}
        style={{ zoom: zoom.preview }}
      >
        {pages}
      </div>
    </div>
  );
}
