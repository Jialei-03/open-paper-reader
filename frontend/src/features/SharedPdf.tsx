import { PdfLoadProgress, type PdfLoadBytes } from "./PdfLoadProgress";
import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, RenderTask, TextLayer } from "pdfjs-dist";
import { Button } from "../components/ui/button";

function PublicPage({
  doc,
  number,
  width,
}: {
  doc: PDFDocumentProxy;
  number: number;
  width: number;
}) {
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const text = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [aspect, setAspect] = useState(1.414);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { rootMargin: "700px" },
    );
    if (host.current) observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible || !canvas.current || !text.current) return;
    const target = canvas.current;
    const container = text.current;
    let cancelled = false;
    let render: RenderTask | undefined;
    let layer: TextLayer | undefined;
    void doc
      .getPage(number)
      .then(async (page) => {
        if (cancelled) return;
        const natural = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: width / natural.width });
        setAspect(viewport.height / viewport.width);
        setError("");
        const element = target;
        // Bound raster memory independently from CSS size/text precision.
        const ratio = Math.min(
          devicePixelRatio || 1,
          2,
          Math.sqrt(16_000_000 / (viewport.width * viewport.height)),
        );
        element.width = Math.floor(viewport.width * ratio);
        element.height = Math.floor(viewport.height * ratio);
        element.style.width = `${width}px`;
        element.style.height = `${viewport.height}px`;
        render = page.render({
          canvas: element,
          viewport,
          transform: [ratio, 0, 0, ratio, 0, 0],
        });
        await render.promise;
        if (cancelled) return;
        setReady(true);
        const { TextLayer: Layer } = await import("pdfjs-dist");
        if (cancelled || !text.current) return;
        text.current.replaceChildren();
        text.current.style.setProperty(
          "--total-scale-factor",
          String(viewport.scale),
        );
        layer = new Layer({
          textContentSource: page.streamTextContent(),
          container: text.current,
          viewport,
        });
        await layer.render();
      })
      .catch((e) => {
        if (!cancelled && e.name !== "RenderingCancelledException")
          setError("此页暂时无法预览");
      });
    return () => {
      cancelled = true;
      render?.cancel();
      layer?.cancel();
      // An offscreen page keeps geometry only, never its large bitmap or text DOM.
      setReady(false);
      target.width = 0;
      target.height = 0;
      container.replaceChildren();
    };
  }, [doc, number, width, visible]);
  return (
    <div
      ref={host}
      className="pdf-page relative mx-auto my-4 bg-white shadow-sm"
      style={{ width, minHeight: width * aspect }}
      aria-label={`第 ${number} 页`}
    >
      {error && <p role="alert">{error}</p>}
      {!ready && !error && (
        <div className="shared-page-skeleton" aria-hidden="true" />
      )}
      {visible && (
        <>
          <canvas ref={canvas} aria-label={`PDF 第 ${number} 页`} />
          <div ref={text} className="textLayer absolute inset-0" />
        </>
      )}
    </div>
  );
}

export function SharedPdf({ url, title }: { url: string; title: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [loadProgress, setLoadProgress] = useState<PdfLoadBytes>({
    loaded: 0,
    total: 0,
  });
  const [width, setWidth] = useState(600);
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState("");
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.max(240, entry.contentRect.width - 32)),
    );
    if (host.current) observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let cancelled = false;
    let task: ReturnType<typeof import("pdfjs-dist").getDocument> | undefined;
    setError("");
    setDoc(null);
    setLoadProgress({ loaded: 0, total: 0 });
    void import("pdfjs-dist")
      .then(async (pdf) => {
        if (cancelled) return;
        pdf.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.min.mjs",
          import.meta.url,
        ).toString();
        task = pdf.getDocument({
          url,
          isEvalSupported: false,
          disableAutoFetch: true,
          cMapUrl: "/assets/pdfjs/cmaps/",
          cMapPacked: true,
          standardFontDataUrl: "/assets/pdfjs/standard_fonts/",
          wasmUrl: "/assets/pdfjs/wasm/",
        });
        task.onProgress = (progress: PdfLoadBytes) => {
          if (!cancelled) setLoadProgress(progress);
        };
        const result = await task.promise;
        if (!cancelled) setDoc(result);
      })
      .catch(() => {
        if (!cancelled) setError("PDF 无法载入，分享可能已失效。");
      });
    return () => {
      cancelled = true;
      void task?.destroy();
    };
  }, [url]);
  return (
    <section
      ref={host}
      className="flex min-h-[50vh] min-w-0 flex-1 flex-col overflow-hidden"
      aria-label="分享 PDF"
    >
      <div className="shared-toolbar">
        <Button
          variant="ghost"
          size="sm"
          aria-label="缩小 PDF"
          disabled={zoom <= 0.5}
          onClick={() => setZoom((v) => Math.max(0.5, v - 0.25))}
        >
          −
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setZoom(1)}>
          {zoom === 1 ? "适合宽度" : `${Math.round(zoom * 100)}%`}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          aria-label="放大 PDF"
          disabled={zoom >= 3}
          onClick={() => setZoom((v) => Math.min(3, v + 0.25))}
        >
          ＋
        </Button>
        <a className="text-sm underline" href={url} download={title}>
          下载 PDF
        </a>
      </div>
      <div className="shared-desk min-h-0 flex-1 overflow-auto">
        {error ? (
          <p className="p-5" role="alert">
            {error}
          </p>
        ) : doc ? (
          Array.from({ length: doc.numPages }, (_, i) => (
            <PublicPage
              key={i}
              doc={doc}
              number={i + 1}
              width={Math.min(width, 1000) * zoom}
            />
          ))
        ) : (
          <PdfLoadProgress progress={loadProgress} />
        )}
      </div>
    </section>
  );
}
