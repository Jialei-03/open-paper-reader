import { useEffect } from "react";
import { textRange } from "../../../lib/reference";

/**
 * Marks `quote` on a page while it is given: its lines are tinted over the
 * page's text layer (`layer`), as the reference of an address is (the
 * engine's `.pdf-reference-lines`), but the view is not moved: the sentence
 * hovered beside the page is already next to it. A quote not found on the page
 * marks nothing.
 */
export function useQuoteHighlight(layer: HTMLElement | null, quote: string) {
  useEffect(() => {
    const host = layer?.parentElement;
    if (!layer || !host || !quote) return;
    const range = textRange(layer, quote);
    if (!range) return;
    const overlay = document.createElement("div");
    overlay.className = "pdf-reference-lines pdf-reference-fill";
    overlay.dataset.hoverQuote = "";
    overlay.setAttribute("aria-hidden", "true");
    host.append(overlay);
    let drawn = "";
    const draw = () => {
      const origin = host.getBoundingClientRect();
      // During a pinch the pages are scaled as they are: back to the page's own pixels.
      const scaleX = origin.width / host.offsetWidth || 1;
      const scaleY = origin.height / host.offsetHeight || 1;
      const boxes = [...range.getClientRects()]
        .filter((rect) => rect.width >= 1 && rect.height >= 1)
        .map((rect) => [
          (rect.left - origin.left) / scaleX,
          (rect.top - origin.top) / scaleY,
          rect.width / scaleX,
          rect.height / scaleY,
        ]);
      // The same lines in the same places (the observer's first call, say): left as they are.
      const key = JSON.stringify(boxes);
      if (key === drawn) return;
      drawn = key;
      overlay.replaceChildren(
        ...boxes.map(([left, top, width, height]) => {
          const line = document.createElement("div");
          line.className = "pdf-reference-underline";
          line.style.left = `${left}px`;
          line.style.top = `${top}px`;
          line.style.width = `${width}px`;
          line.style.height = `${height}px`;
          return line;
        }),
      );
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(layer);
    return () => {
      observer.disconnect();
      overlay.remove();
    };
  }, [layer, quote]);
}
