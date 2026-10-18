import type {
  PDFDocumentProxy,
  PDFPageProxy,
  PageViewport,
  RenderTask,
  TextLayer,
} from "pdfjs-dist";
import {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useI18n } from "../../i18n/I18nProvider";
import type { PdfRenderRetention } from "../../lib/pdf-render-retention";
import styles from "./PdfPages.module.css";

/** A page's size in CSS pixels. */
export type PageSize = { width: number; height: number };

/**
 * Where a page is drawn: its size on screen, the scale from the PDF's units,
 * and the rotation the reader adds to the page's own (always 0: the new reader
 * does not turn pages).
 */
export type PageGeometry = {
  width: number;
  height: number;
  scale: number;
  rotation: number;
};

/** A page is drawn while it is this close to the view, as in the old reader. */
const NEAR = "800px";

/** At most this many device pixels per page (about 4000 × 4000): a high zoom sharpens no further. */
const MAX_PIXELS = 16_000_000;

/**
 * One IntersectionObserver for all the pages of a document: it tells each page
 * whether it is near enough the view to be drawn. Pages may start watching
 * before the scroller is connected; they are observed once it is.
 */
export class PageWatcher {
  private callbacks = new Map<Element, (near: boolean) => void>();
  private observer: IntersectionObserver | null = null;

  connect(root: Element) {
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries)
          this.callbacks.get(entry.target)?.(entry.isIntersecting);
      },
      { root, rootMargin: NEAR },
    );
    for (const element of this.callbacks.keys()) this.observer.observe(element);
  }

  disconnect() {
    this.observer?.disconnect();
    this.observer = null;
  }

  watch(element: Element, onChange: (near: boolean) => void): () => void {
    this.callbacks.set(element, onChange);
    this.observer?.observe(element);
    return () => {
      this.callbacks.delete(element);
      this.observer?.unobserve(element);
    };
  }
}

/** Gives a canvas's memory back at once (Safari holds on to it otherwise) and takes it off the page. */
function release(element: Element) {
  if (element instanceof HTMLCanvasElement) element.width = element.height = 0;
  element.remove();
}

/** What pdf.js throws when a render or a text layer was stopped on purpose. */
function stopped(error: unknown) {
  return (
    error instanceof Error &&
    (error.name === "RenderingCancelledException" ||
      error.name === "AbortException")
  );
}

/**
 * The text layer is as big as the page before the page's own rotation; the
 * stylesheet turns it (`data-main-rotation`). pdf.js sizes it with CSS
 * variables of its viewer, which this engine does not have: give it pixels.
 */
function sizeText(container: HTMLElement, viewport: PageViewport) {
  const turned = viewport.rotation % 180 !== 0;
  container.style.width = `${turned ? viewport.height : viewport.width}px`;
  container.style.height = `${turned ? viewport.width : viewport.height}px`;
}

export interface PdfPageViewProps {
  doc: PDFDocumentProxy;
  /** The page number, from 1. */
  page: number;
  /** The page's size on screen, and the scale that gives it. */
  width: number;
  height: number;
  scale: number;
  /** The page's width at scale 1 (what "fit to width" divides by). */
  nativeWidth: number;
  watcher: PageWatcher;
  retention: PdfRenderRetention;
  /** The page's own size at scale 1, once it is known (the list guessed it from the first page until then). */
  onSize(page: number, size: PageSize): void;
  overlays?: (page: number, geometry: PageGeometry) => ReactNode;
  onText(page: number, element: HTMLDivElement | null, rendered: boolean): void;
  onRendered(page: number): void;
}

/**
 * One page of the PDF. It always holds its place (its size, on the paper's
 * color); near the view it is drawn: a canvas, and over it pdf.js's text layer,
 * so the text can be selected. Moving away, it keeps its drawing while it is
 * one of the few pages left most recently (`retention`), then lets it go.
 */
export const PdfPageView = memo(function PdfPageView({
  doc,
  page,
  width,
  height,
  scale,
  nativeWidth,
  watcher,
  retention,
  onSize,
  overlays,
  onText,
  onRendered,
}: PdfPageViewProps) {
  const { t } = useI18n();
  const element = useRef<HTMLDivElement>(null);
  const raster = useRef<HTMLDivElement>(null);
  const text = useRef<HTMLDivElement>(null);
  const layer = useRef<TextLayer | null>(null);
  const [near, setNear] = useState(false);
  const [pdfPage, setPdfPage] = useState<PDFPageProxy | null>(null);
  const [textReady, setTextReady] = useState(false);
  /** The scale of the canvas on screen; 0 while there is none. */
  const [drawnAt, setDrawnAt] = useState(0);
  const [failed, setFailed] = useState(false);
  const currentScale = useRef(scale);
  currentScale.current = scale;

  // Near the view, or kept for a while after leaving it.
  useEffect(() => {
    const node = element.current!;
    let drawn = false;
    const stop = watcher.watch(node, (isNear) => {
      if (isNear) {
        drawn = true;
        retention.visible(node);
        setNear(true);
      } else if (drawn)
        retention.retain(node, () => {
          drawn = false;
          setNear(false);
        });
    });
    return () => {
      stop();
      retention.remove(node);
    };
  }, [watcher, retention]);

  // The page itself, the first time it is needed; its real size goes to the list.
  useEffect(() => {
    if (!near || pdfPage) return;
    let cancelled = false;
    doc.getPage(page).then(
      (loaded) => {
        if (cancelled) return;
        const { width, height } = loaded.getViewport({ scale: 1 });
        onSize(page, { width, height });
        setPdfPage(loaded);
      },
      () => {
        if (!cancelled) setFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [near, pdfPage, doc, page, onSize]);

  // The canvas, at the current scale. A new one replaces the old only once it is
  // drawn, so zooming shows the old one stretched for a moment, never a blank.
  useEffect(() => {
    if (!near || !pdfPage) return;
    let cancelled = false;
    const viewport = pdfPage.getViewport({ scale });
    // Bound raster memory at high zoom; CSS geometry and text stay precise.
    const ratio = Math.min(
      window.devicePixelRatio || 1,
      2,
      Math.sqrt(MAX_PIXELS / (viewport.width * viewport.height)),
    );
    const canvas = document.createElement("canvas");
    canvas.className = styles.canvas;
    canvas.width = Math.floor(viewport.width * ratio);
    canvas.height = Math.floor(viewport.height * ratio);
    const task: RenderTask = pdfPage.render({
      canvas,
      canvasContext: canvas.getContext("2d")!,
      viewport,
      transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
    });
    task.promise.then(
      () => {
        const holder = raster.current;
        if (cancelled || !holder) return release(canvas);
        for (const old of [...holder.children]) release(old);
        holder.append(canvas);
        setDrawnAt(scale);
      },
      (error: unknown) => {
        release(canvas);
        if (!cancelled && !stopped(error)) setFailed(true);
      },
    );
    return () => {
      cancelled = true;
      task.cancel();
    };
  }, [near, pdfPage, scale]);

  // Let the drawing go when the page is let go (and when it leaves the page),
  // with what pdf.js kept to draw it (its images and fonts): reading on through
  // a long paper must not keep every page it passed.
  useEffect(() => {
    if (near) return;
    const holder = raster.current;
    if (holder) for (const old of [...holder.children]) release(old);
    setDrawnAt(0);
    // pdf.js puts this off itself while a render of the page is still running.
    pdfPage?.cleanup();
  }, [near, pdfPage]);
  useEffect(() => {
    const holder = raster.current;
    return () => {
      if (holder) for (const old of [...holder.children]) release(old);
    };
  }, []);

  // The text layer, made once while the page is drawn; zooming rescales it in place.
  useEffect(() => {
    if (!near || !pdfPage) return;
    const container = text.current!;
    let cancelled = false;
    let built: TextLayer | undefined;
    (async () => {
      const [{ TextLayer }, content] = await Promise.all([
        import("pdfjs-dist"),
        pdfPage.getTextContent(),
      ]);
      if (cancelled) return;
      const viewport = pdfPage.getViewport({ scale: currentScale.current });
      built = new TextLayer({
        textContentSource: content,
        container,
        viewport,
      });
      layer.current = built;
      sizeText(container, viewport);
      await built.render();
      if (!cancelled) setTextReady(true);
    })().catch((error: unknown) => {
      if (!cancelled && !stopped(error)) setFailed(true);
    });
    return () => {
      cancelled = true;
      built?.cancel();
      layer.current = null;
      container.replaceChildren();
      container.removeAttribute("style");
      setTextReady(false);
    };
  }, [near, pdfPage]);

  // Before the frame is painted, so the text never stands at the old scale over the new page.
  useLayoutEffect(() => {
    const built = layer.current;
    if (!built || !pdfPage || !text.current) return;
    const viewport = pdfPage.getViewport({ scale });
    built.update({ viewport });
    sizeText(text.current, viewport);
  }, [scale, pdfPage]);

  const rendered = near && textReady && drawnAt === scale;

  // Tell whoever lays things over the text when there is text to lay them over.
  const told = useRef(false);
  useEffect(() => {
    if (rendered === told.current) return;
    told.current = rendered;
    onText(page, text.current, rendered);
    if (rendered) onRendered(page);
  }, [rendered, page, onText, onRendered]);
  useEffect(
    () => () => {
      if (told.current) onText(page, null, false);
    },
    [page, onText],
  );

  const geometry = useMemo<PageGeometry>(
    () => ({ width, height, scale, rotation: 0 }),
    [width, height, scale],
  );

  return (
    <div
      ref={element}
      className={styles.page}
      data-page={page}
      data-rendered={rendered}
      data-scale={scale}
      data-native-width={nativeWidth}
      role="group"
      aria-label={t("reader.pdf.page", { page })}
      style={
        {
          width,
          height,
          // What pdf.js sizes the text layer's letters by.
          "--total-scale-factor": scale * (pdfPage?.userUnit ?? 1),
        } as CSSProperties
      }
    >
      <div ref={raster} className={styles.raster} />
      <div ref={text} className="textLayer" />
      {near && overlays?.(page, geometry)}
      {failed && (
        <p className={styles.failure} role="alert">
          {t("reader.pdf.pageFailed", { page })}
        </p>
      )}
    </div>
  );
});
