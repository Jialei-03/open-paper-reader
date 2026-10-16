import { useEffect, useState, type MouseEvent } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";

export type PdfDestination = string | unknown[];
export type Link = {
  id: string;
  rect: number[];
  url?: string;
  dest?: PdfDestination;
};
export function safePdfUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return;
  try {
    const url = new URL(value);
    if (["https:", "http:", "mailto:"].includes(url.protocol)) return url.href;
  } catch {
    /* Malformed or executable links are never followed. */
  }
}
export function usePdfLinks(doc: PDFDocumentProxy, page: number) {
  const [links, setLinks] = useState<Link[]>([]);
  useEffect(() => {
    let live = true;
    setLinks([]);
    void doc
      .getPage(page)
      .then(async (pdf) => {
        const viewport = pdf.getViewport({ scale: 1 });
        const annotations = await pdf.getAnnotations({ intent: "display" });
        const found: Link[] = [];
        for (const annotation of annotations) {
          if (
            annotation.subtype !== "Link" ||
            !Array.isArray(annotation.rect) ||
            annotation.rect.length !== 4
          )
            continue;
          const url = safePdfUrl(annotation.url);
          const dest =
            typeof annotation.dest === "string" ||
            Array.isArray(annotation.dest)
              ? (annotation.dest as PdfDestination)
              : undefined;
          if (!url && !dest) continue;
          const rect = viewport.convertToViewportRectangle(annotation.rect);
          found.push({
            id: String(annotation.id),
            url,
            dest,
            rect: [
              Math.min(rect[0], rect[2]) / viewport.width,
              Math.min(rect[1], rect[3]) / viewport.height,
              Math.abs(rect[2] - rect[0]) / viewport.width,
              Math.abs(rect[3] - rect[1]) / viewport.height,
            ],
          });
        }
        if (live) setLinks(found);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [doc, page]);
  return links;
}
export function followPdfLink(
  event: MouseEvent<HTMLDivElement>,
  links: Link[],
  enabled: boolean,
  jump: (dest: PdfDestination) => void,
  previewCitation?: (link: Link, bounds: DOMRect) => boolean,
) {
  // Use hit testing instead of a pointer-catching annotation layer: drag selection
  // and Pencil strokes still reach their existing text/ink layers unchanged.
  if (
    !enabled ||
    event.defaultPrevented ||
    event.button !== 0 ||
    event.detail === 0 ||
    window.getSelection()?.isCollapsed === false
  )
    return;
  if (
    "pointerType" in event.nativeEvent &&
    event.nativeEvent.pointerType === "pen"
  )
    return;
  const bounds = event.currentTarget.getBoundingClientRect();
  const x = (event.clientX - bounds.left) / bounds.width,
    y = (event.clientY - bounds.top) / bounds.height;
  const link = links.find(
    ({ rect: [left, top, width, height] }) =>
      x >= left && x <= left + width && y >= top && y <= top + height,
  );
  if (!link) return;
  if (
    previewCitation?.(
      link,
      new DOMRect(
        bounds.left + link.rect[0] * bounds.width,
        bounds.top + link.rect[1] * bounds.height,
        link.rect[2] * bounds.width,
        link.rect[3] * bounds.height,
      ),
    )
  )
    return;
  if (link.url) window.open(link.url, "_blank", "noopener,noreferrer");
  else if (link.dest) jump(link.dest);
}
export function PdfLinkTargets({
  links,
  enabled,
  jump,
  previewCitation,
}: {
  links: Link[];
  enabled: boolean;
  jump: (dest: PdfDestination) => void;
  previewCitation?: (link: Link, bounds: DOMRect) => boolean;
}) {
  if (!enabled) return null;
  return (
    <div className="pdf-link-targets">
      {links.map((link) => {
        const style = {
          left: `${link.rect[0] * 100}%`,
          top: `${link.rect[1] * 100}%`,
          width: `${link.rect[2] * 100}%`,
          height: `${link.rect[3] * 100}%`,
        };
        return link.url ? (
          <a
            key={link.id}
            style={style}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`打开论文链接：${link.url}`}
          />
        ) : (
          <button
            key={link.id}
            style={style}
            aria-label="跳转论文引用位置"
            onClick={(event) => {
              event.stopPropagation();
              if (
                previewCitation?.(
                  link,
                  event.currentTarget.getBoundingClientRect(),
                )
              )
                return;
              if (link.dest) jump(link.dest);
            }}
          />
        );
      })}
    </div>
  );
}
