import { api } from "../api";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "../components/ui/popover";
import { Button } from "../components/ui/button";
import { Spinner } from "../components/ui/spinner";
import type { PdfDestination } from "./PdfLinks";
type Link = { id: string; rect: number[]; url?: string; dest?: PdfDestination };
export function usePdfLinkPreview(
  paperId: string,
  doc: PDFDocumentProxy,
  links: Link[],
  enabled: boolean,
  jump: (dest: PdfDestination) => void,
  explainUrl?: (url: string) => void,
) {
  const [target, setTarget] = useState<Link | null>(null),
    [page, setPage] = useState(0),
    [error, setError] = useState(""),
    [excerpt, setExcerpt] = useState("");
  const [citation, setCitation] = useState<{
    items: {
      title: string;
      authors: string[];
      abstract?: string;
      year?: number;
    }[];
    message?: string;
  } | null>(null);
  const [automatic, setAutomatic] = useState(false);
  const [excerptSource, setExcerptSource] = useState<Link | null>(null);
  const [citationLoading, setCitationLoading] = useState(false);
  const citationTarget = useRef<Link | null>(null);
  citationTarget.current = target;
  useEffect(() => {
    setCitation(null);
    setCitationLoading(false);
  }, [target]);
  async function lookupCitation() {
    const selected = target;
    setCitationLoading(true);
    try {
      const result = await api<{
        items: {
          title: string;
          authors: string[];
          abstract?: string;
          year?: number;
        }[];
        message?: string;
      }>(
        `/papers/${paperId}/citation-preview?excerpt=${encodeURIComponent(excerpt)}`,
      );
      if (citationTarget.current === selected) setCitation(result);
    } catch (error) {
      if (citationTarget.current === selected)
        setCitation({ items: [], message: (error as Error).message });
    } finally {
      if (citationTarget.current === selected) setCitationLoading(false);
    }
  }
  useEffect(() => {
    if (automatic && excerpt && excerptSource === target) {
      setAutomatic(false);
      void lookupCitation();
    }
  }, [automatic, excerpt, excerptSource, target]);
  const [metadata, setMetadata] = useState<{
    title: string;
    description: string;
    author?: string;
    date?: string;
  } | null>(null);
  useEffect(() => {
    let live = true;
    setMetadata(null);
    if (target?.url?.startsWith("http"))
      void api<{
        title: string;
        description: string;
        author?: string;
        date?: string;
      }>(
        `/papers/${paperId}/link-preview?url=${encodeURIComponent(target.url)}`,
      )
        .then((r) => {
          if (live) setMetadata(r);
        })
        .catch(() => {
          if (live)
            setMetadata({
              title: "",
              description: "暂时无法预览，可打开来源查看。",
            });
        });
    return () => {
      live = false;
    };
  }, [target?.url, paperId]);
  const anchor = useRef({ getBoundingClientRect: () => new DOMRect() }),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    candidate = useRef<string | null>(null),
    canvas = useRef<HTMLCanvasElement>(null);
  function clearTimer() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }
  function close() {
    clearTimer();
    candidate.current = null;
    setTarget(null);
    setAutomatic(false);
  }
  useEffect(() => {
    const dismiss = (event: Event) => {
      if (
        !(event.target instanceof Element) ||
        !event.target.closest('[aria-label="论文链接预览"]')
      )
        close();
    };
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    return () => {
      clearTimer();
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
    };
  }, []);
  useEffect(() => {
    if (!enabled) close();
  }, [enabled]);
  useEffect(() => {
    let live = true,
      task: RenderTask | undefined;
    setPage(0);
    setError("");
    setExcerpt("");
    setExcerptSource(null);
    if (target?.dest)
      void (async () => {
        try {
          const dest =
            typeof target.dest === "string"
              ? await doc.getDestination(target.dest)
              : target.dest;
          if (!dest) throw new Error("无法解析引用位置");
          const ref = dest[0];
          const index =
            typeof ref === "number"
              ? ref
              : await doc.getPageIndex(ref as { num: number; gen: number });
          const pdf = await doc.getPage(index + 1);
          if (!live || !canvas.current) return;
          const viewport = pdf.getViewport({ scale: 1 });
          const scale = 600 / viewport.width;
          const view = pdf.getViewport({ scale });
          const kind = (dest[1] as { name?: string })?.name;
          const targetY =
            kind === "XYZ"
              ? dest[3]
              : kind === "FitH" || kind === "FitBH"
                ? dest[2]
                : kind === "FitR"
                  ? dest[5]
                  : null;
          const y =
            typeof targetY === "number"
              ? view.convertToViewportPoint(0, targetY)[1]
              : 0;
          const top = Math.max(0, Math.min(y - 32, view.height - 360));
          const node = canvas.current;
          node.width = 600;
          node.height = Math.min(400, view.height);
          task = pdf.render({
            canvas: node,
            viewport: view,
            transform: [1, 0, 0, 1, 0, -top],
          });
          await task.promise;
          if (live) setPage(index + 1);
          const content = await pdf.getTextContent();
          const destinationX =
            kind === "XYZ" && typeof dest[2] === "number" ? dest[2] : 0;
          const sourceTop =
            typeof targetY === "number" ? targetY : viewport.height;
          let sourceBottom = sourceTop - 100;
          if (
            typeof target.dest === "string" &&
            /^(cite[.:]|bib[.:])/i.test(target.dest)
          ) {
            const destinations = await doc.getDestinations();
            const refKey = (value: unknown) =>
              typeof value === "number" ? String(value) : JSON.stringify(value);
            const next = Object.entries(destinations)
              .filter(
                ([name, destination]) =>
                  /^(cite[.:]|bib[.:])/i.test(name) &&
                  refKey(destination[0]) === refKey(ref) &&
                  destination[1]?.name === "XYZ" &&
                  typeof destination[2] === "number" &&
                  Math.abs(destination[2] - destinationX) < 24 &&
                  typeof destination[3] === "number" &&
                  destination[3] < sourceTop - 2,
              )
              .map(([, destination]) => destination[3] as number);
            // Stop at the next bibliography entry; do not mingle adjacent sources.
            sourceBottom = next.length ? Math.max(...next) : 0;
          }
          const fragments = content.items.filter(
            (item) =>
              "str" in item &&
              item.transform[5] <= sourceTop + 2 &&
              item.transform[5] > sourceBottom + 2 &&
              item.transform[4] >= destinationX - 12,
          );
          if (live) {
            setExcerptSource(target);
            setExcerpt(
              fragments
                .map((item) => ("str" in item ? item.str : ""))
                .join(" ")
                .slice(0, 1200),
            );
          }
        } catch (e) {
          if (live) setError((e as Error).message);
        }
      })();
    return () => {
      live = false;
      task?.cancel();
    };
  }, [target, doc]);
  function move(event: PointerEvent<HTMLDivElement>) {
    if (
      !enabled ||
      event.pointerType !== "mouse" ||
      event.buttons ||
      window.getSelection()?.isCollapsed === false
    ) {
      close();
      return;
    }
    const b = event.currentTarget.getBoundingClientRect(),
      x = (event.clientX - b.left) / b.width,
      y = (event.clientY - b.top) / b.height;
    const hit = links.find(
      ({ rect: [l, t, w, h] }) => x >= l && x <= l + w && y >= t && y <= t + h,
    );
    if (!hit) {
      clearTimer();
      candidate.current = null;
      return;
    }
    if (candidate.current === hit.id) return;
    clearTimer();
    candidate.current = hit.id;
    timer.current = setTimeout(() => {
      anchor.current = {
        getBoundingClientRect: () =>
          new DOMRect(
            b.left + hit.rect[0] * b.width,
            b.top + hit.rect[1] * b.height,
            hit.rect[2] * b.width,
            hit.rect[3] * b.height,
          ),
      };
      setAutomatic(false);
      setTarget(hit);
    }, 450);
  }
  return {
    openCitation: (link: Link, bounds: DOMRect) => {
      if (
        !enabled ||
        typeof link.dest !== "string" ||
        !/^(cite[.:]|bib[.:])/i.test(link.dest)
      )
        return false;
      clearTimer();
      candidate.current = link.id;
      anchor.current = { getBoundingClientRect: () => bounds };
      setTarget(link);
      setAutomatic(true);
      return true;
    },
    onPointerMove: move,
    onPointerLeave: clearTimer,
    onPointerDown: close,
    preview: (
      <Popover
        open={!!target}
        onOpenChange={(v) => {
          if (!v) close();
        }}
      >
        <PopoverAnchor virtualRef={anchor} />
        <PopoverContent
          aria-label="论文链接预览"
          onPointerDown={(e) => e.stopPropagation()}
          onPointerMove={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          className="max-h-[85dvh] w-[min(28rem,calc(100vw-2rem))] overflow-y-auto p-3"
          side="top"
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          {target?.url ? (
            <>
              <p className="mb-2 text-xs text-muted-foreground">外部链接</p>
              {metadata ? (
                <>
                  <h3 className="mb-2 text-sm font-medium">{metadata.title}</h3>
                  <p className="mb-2 text-xs text-muted-foreground">
                    {metadata.author} {metadata.date}
                  </p>
                  <p className="mb-3 max-h-48 overflow-auto text-sm">
                    {metadata.description}
                  </p>
                </>
              ) : target.url.startsWith("http") ? (
                <Spinner />
              ) : null}
              <p className="mb-3 truncate text-xs text-muted-foreground">
                {target.url}
              </p>
              {explainUrl && target.url.startsWith("http") && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    explainUrl(target.url!);
                    close();
                  }}
                >
                  解释链接与本文的关系
                </Button>
              )}
              <Button size="sm" variant="outline" asChild>
                <a href={target.url} target="_blank" rel="noopener noreferrer">
                  打开来源
                </a>
              </Button>
            </>
          ) : (
            <>
              <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
                <span>引用与章节预览 {page ? `· 第 ${page} 页` : ""}</span>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => {
                    if (target?.dest) jump(target.dest);
                    close();
                  }}
                >
                  跳转
                </Button>
              </div>
              {!page && !error && <Spinner />}
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <canvas
                ref={canvas}
                className="h-auto w-full rounded border bg-white"
                aria-label="引用位置原文截图"
              />
              {excerpt && (
                <p className="mt-3 max-h-40 overflow-auto text-xs leading-relaxed text-muted-foreground">
                  {excerpt}
                </p>
              )}
              {excerpt && (
                <Button
                  className="mt-2"
                  size="sm"
                  variant="outline"
                  disabled={citationLoading}
                  onClick={() => void lookupCitation()}
                >
                  {citationLoading && <Spinner />}{" "}
                  {citation ? "重新查询引用详情" : "查看引用详情"}
                </Button>
              )}
              {citation && (
                <div
                  className="mt-3 max-h-72 overflow-auto text-sm"
                  aria-label="引用详情"
                >
                  {citation.message && <p role="status">{citation.message}</p>}
                  {citation.items.map((item) => (
                    <article
                      key={item.title}
                      className="mb-3 flex flex-col gap-2"
                    >
                      <h3 className="font-medium">{item.title}</h3>
                      <p className="text-xs text-muted-foreground">
                        {item.authors.join("; ")} {item.year || ""}
                      </p>
                      <p className="whitespace-pre-wrap">
                        {item.abstract || "来源未提供摘要"}
                      </p>
                    </article>
                  ))}
                  <p className="mt-2 text-xs text-muted-foreground">
                    来源：Semantic Scholar · 按此处原文中的完整标题匹配
                  </p>
                </div>
              )}
            </>
          )}
        </PopoverContent>
      </Popover>
    ),
  };
}
