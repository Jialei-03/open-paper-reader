import { useEffect, useRef, useState, type RefObject } from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { Input } from "@/components/ui/input";
import { ReaderButton } from "../components/ReaderControls";
import { ChevronUp, ChevronDown, X } from "lucide-react";
import "./pdf-navigation.css";

export type PdfMatch = { page: number; start: number; length: number };
// PDF text items and rendered spans share order. Ignore layout whitespace,
// retaining normalized character positions across item boundaries.
export const searchText = (value: string) =>
  value.replace(/\s/g, "").toLowerCase();
export function usePdfSearch(doc: PDFDocumentProxy | null) {
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<PdfMatch[]>([]);
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const cache = useRef(new Map<number, string>());
  useEffect(() => {
    cache.current = new Map();
    setQuery("");
    setMatches([]);
  }, [doc]);
  useEffect(() => {
    let cancelled = false;
    const wanted = searchText(query);
    setMatches([]);
    setIndex(0);
    setError("");
    if (!doc || !wanted) {
      setBusy(false);
      return;
    }
    setBusy(true);
    const timer = window.setTimeout(async () => {
      const found: PdfMatch[] = [];
      try {
        for (let page = 1; page <= doc.numPages; page++) {
          if (cancelled) return;
          let value = cache.current.get(page);
          if (value === undefined) {
            const content = await (await doc.getPage(page)).getTextContent();
            if (cancelled) return;
            value = searchText(
              content.items
                .map((item) => ("str" in item ? item.str : ""))
                .join(""),
            );
            cache.current.set(page, value);
          }
          let start = value.indexOf(wanted);
          while (start !== -1) {
            found.push({ page, start, length: wanted.length });
            start = value.indexOf(wanted, start + wanted.length);
          }
        }
        if (!cancelled) setMatches(found);
      } catch {
        if (!cancelled) setError("无法读取部分页面的文字，请重试。");
      } finally {
        if (!cancelled) setBusy(false);
      }
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [doc, query]);
  return { query, setQuery, matches, index, setIndex, busy, error };
}

export function PdfSearchBar({
  search,
  close,
  choose,
}: {
  search: ReturnType<typeof usePdfSearch>;
  close: () => void;
  choose: (index: number) => void;
}) {
  const next = (delta: number) => {
    if (search.matches.length)
      choose(
        (search.index + delta + search.matches.length) % search.matches.length,
      );
  };
  return (
    <div className="pdf-search-bar" role="search" aria-label="论文全文查找">
      <Input
        autoFocus
        aria-label="查找论文内容"
        value={search.query}
        placeholder="查找论文内容…"
        onChange={(event) => search.setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            next(event.shiftKey ? -1 : 1);
          }
          if (event.key === "Escape") {
            event.preventDefault();
            close();
          }
        }}
      />
      <span role="status">
        {search.busy
          ? "查找中…"
          : search.error ||
            (search.query
              ? search.matches.length
                ? `${search.index + 1} / ${search.matches.length}`
                : "无匹配文字"
              : "输入关键词")}
      </span>
      <ReaderButton
        size="icon"
        variant="ghost"
        aria-label="上一个查找结果"
        disabled={!search.matches.length}
        onClick={() => next(-1)}
      >
        <ChevronUp />
      </ReaderButton>
      <ReaderButton
        size="icon"
        variant="ghost"
        aria-label="下一个查找结果"
        disabled={!search.matches.length}
        onClick={() => next(1)}
      >
        <ChevronDown />
      </ReaderButton>
      <ReaderButton
        size="icon"
        variant="ghost"
        aria-label="关闭论文查找"
        onClick={close}
      >
        <X />
      </ReaderButton>
    </div>
  );
}

export function usePdfSearchHighlight(
  root: RefObject<HTMLDivElement | null>,
  match: PdfMatch | undefined,
  ready: boolean,
) {
  useEffect(() => {
    if (!root.current || !ready || !match) return;
    const element = root.current;
    const points: { node: Text; offset: number }[] = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      for (let offset = 0; offset < node.length; offset++) {
        if (/\s/.test(node.data[offset])) continue;
        for (let i = 0; i < node.data[offset].toLowerCase().length; i++)
          points.push({ node, offset });
      }
    }
    const start = points[match.start],
      end = points[match.start + match.length - 1];
    if (!start || !end) return;
    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset + 1);
    const overlay = document.createElement("div");
    overlay.className = "pdf-search-highlight";
    overlay.dataset.testid = "pdf-search-highlight";
    overlay.setAttribute("aria-hidden", "true");
    element.parentElement?.append(overlay);
    const draw = () => {
      const geometry = element.parentElement || element;
      const bounds = geometry.getBoundingClientRect();
      const scaleX = bounds.width / geometry.offsetWidth || 1;
      const scaleY = bounds.height / geometry.offsetHeight || 1;
      overlay.replaceChildren();
      for (const rect of Array.from(range.getClientRects())) {
        if (rect.width < 1 || rect.height < 1) continue;
        const mark = document.createElement("span");
        Object.assign(mark.style, {
          left: `${(rect.left - bounds.left) / scaleX}px`,
          top: `${(rect.top - bounds.top) / scaleY}px`,
          width: `${rect.width / scaleX}px`,
          height: `${rect.height / scaleY}px`,
        });
        overlay.append(mark);
      }
    };
    draw();
    overlay.firstElementChild?.scrollIntoView({
      block: "center",
      inline: "nearest",
      behavior: "instant",
    });
    const observer = new ResizeObserver(draw);
    observer.observe(element);
    return () => {
      observer.disconnect();
      overlay.remove();
    };
  }, [root, match, ready]);
}

export function PdfThumbnails({
  rotation = 0,
  doc,
  page,
  navigate,
}: {
  rotation?: number;
  doc: PDFDocumentProxy;
  page: number;
  navigate: (page: number) => void;
}) {
  return (
    <div className="pdf-thumbnails" aria-label="PDF 页面缩略图">
      {Array.from({ length: doc.numPages }, (_, i) => (
        <Thumbnail
          key={i + 1}
          rotation={rotation}
          doc={doc}
          number={i + 1}
          active={page === i + 1}
          navigate={navigate}
        />
      ))}
    </div>
  );
}
function Thumbnail({
  rotation = 0,
  doc,
  number,
  active,
  navigate,
}: {
  rotation?: number;
  doc: PDFDocumentProxy;
  number: number;
  active: boolean;
  navigate: (page: number) => void;
}) {
  const button = useRef<HTMLButtonElement>(null),
    canvas = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { rootMargin: "180px" },
    );
    if (button.current) observer.observe(button.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible) return;
    let cancelled = false,
      task: RenderTask | undefined;
    void doc
      .getPage(number)
      .then(async (pdf) => {
        if (cancelled || !canvas.current) return;
        const viewport = pdf.getViewport({
          scale:
            136 /
            pdf.getViewport({
              scale: 1,
              rotation: (pdf.rotate + rotation) % 360,
            }).width,
          rotation: (pdf.rotate + rotation) % 360,
        });
        canvas.current.width = Math.ceil(viewport.width);
        canvas.current.height = Math.ceil(viewport.height);
        task = pdf.render({ canvas: canvas.current, viewport });
        await task.promise;
      })
      .catch((error) => {
        if (!cancelled && error.name !== "RenderingCancelledException")
          setFailed(true);
      });
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, number, visible, rotation]);
  return (
    <button
      ref={button}
      className="pdf-thumbnail"
      aria-label={`转到第 ${number} 页`}
      aria-current={active ? "page" : undefined}
      onClick={() => navigate(number)}
    >
      <canvas ref={canvas} aria-hidden="true" />
      {failed && <span>预览不可用</span>}
      <span>{number}</span>
    </button>
  );
}
