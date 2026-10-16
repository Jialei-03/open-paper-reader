import { useEffect, type RefObject } from "react";
import { textRange } from "../lib/reference";
import "./pdf-suggested-highlights.css";

export type SuggestedHighlight = {
  page: number;
  quote: string;
  category: "novelty" | "method" | "results";
};
export function usePdfSuggestedHighlights(
  text: RefObject<HTMLDivElement | null>,
  viewport: RefObject<HTMLDivElement | null>,
  highlights: SuggestedHighlight[] | undefined,
  page: number,
  ready: boolean,
) {
  useEffect(() => {
    const element = text.current;
    if (!element || !ready || !highlights?.length) return;
    const entries = highlights.filter((item) => item.page === page);
    if (!entries.length) return;
    const overlay = document.createElement("div");
    overlay.className = "pdf-suggested-highlights";
    overlay.dataset.testid = "pdf-suggested-highlights";
    overlay.setAttribute("aria-hidden", "true");
    let visible = false;
    const draw = () => {
      overlay.replaceChildren();
      if (!visible) {
        overlay.remove();
        return;
      }
      const geometry = element.parentElement || element;
      const bounds = geometry.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      const scaleX = bounds.width / geometry.offsetWidth || 1;
      const scaleY = bounds.height / geometry.offsetHeight || 1;
      for (const entry of entries) {
        const range = textRange(element, entry.quote);
        if (!range) continue; // No approximate/fallback highlight.
        for (const rect of Array.from(range.getClientRects())) {
          if (rect.width < 1 || rect.height < 1) continue;
          const mark = document.createElement("span");
          mark.dataset.category = entry.category;
          Object.assign(mark.style, {
            left: `${(rect.left - bounds.left) / scaleX}px`,
            top: `${(rect.top - bounds.top) / scaleY}px`,
            width: `${rect.width / scaleX}px`,
            height: `${rect.height / scaleY}px`,
          });
          overlay.append(mark);
        }
      }
      if (overlay.childElementCount) element.parentElement?.append(overlay);
      else overlay.remove();
    };
    const intersection = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting;
        draw();
      },
      { root: viewport.current },
    );
    intersection.observe(element);
    const resize = new ResizeObserver(draw);
    resize.observe(element);
    return () => {
      intersection.disconnect();
      resize.disconnect();
      overlay.remove();
    };
  }, [text, viewport, highlights, page, ready]);
}
