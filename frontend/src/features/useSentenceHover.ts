import { useEffect, useRef, useState } from "react";
import { textRange } from "../lib/reference";
import type { TranslationPreview } from "./ParallelTranslation";

type Pair = { original: string; translation: string };
let previewOwner: symbol | null = null;

type Box = { left: number; top: number; right: number; bottom: number };

// The PDF remains the only text renderer. Cache exact sentence ranges and local
// hit areas, then let the existing reference overlay render the correspondence.
export function useSentenceHover({
  file,
  page,
  pairs,
  enabled,
  onPreview,
}: {
  file: string;
  page: number;
  pairs: Pair[] | undefined;
  enabled: boolean;
  onPreview: (value: TranslationPreview | null) => void;
}) {
  const body = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState(-1);
  const actions = useRef({
    highlight: (_index: number) => {},
    leave: () => {},
  });
  const callback = useRef(onPreview);
  callback.current = onPreview;

  useEffect(() => {
    const owner = Symbol("translation-page");
    let active = -1;
    let fromSource = false;
    let layer: HTMLElement | null = null;
    let cache: { range: Range | null; boxes: Box[] }[] | null = null;
    const leave = () => {
      if (active !== -1 && previewOwner === owner) {
        previewOwner = null;
        callback.current(null);
      }
      active = -1;
      fromSource = false;
      setHovered(-1);
    };
    const invalidate = () => {
      cache = null;
      leave();
    };
    const mutations = new MutationObserver(invalidate);
    let measuredSize = "";
    const resize = new ResizeObserver(() => {
      const bounds = layer?.getBoundingClientRect();
      const size = `${bounds?.width}:${bounds?.height}`;
      if (measuredSize && size !== measuredSize) invalidate();
      measuredSize = size;
    });
    const getLayer = () => {
      const root = body.current?.closest(".parallel-reader-workspace");
      const pdf = [
        ...(root?.querySelectorAll<HTMLElement>(
          ".pdf-view[data-source-file]",
        ) || []),
      ].find((element) => element.dataset.sourceFile === file);
      return (
        pdf?.querySelector<HTMLElement>(
          `[data-pdf-page="${page}"] .textLayer`,
        ) || null
      );
    };
    const entries = () => {
      const next = getLayer();
      if (next !== layer) {
        mutations.disconnect();
        resize.disconnect();
        layer = next;
        cache = null;
        if (layer) {
          mutations.observe(layer, {
            childList: true,
            characterData: true,
            subtree: true,
            attributes: true,
            attributeFilter: ["style", "class", "data-main-rotation"],
          });
          resize.observe(layer);
        }
      }
      if (!layer) return [];
      if (!cache) {
        const origin = layer.getBoundingClientRect();
        cache = (pairs || []).map((pair) => {
          const range = textRange(layer!, pair.original);
          const boxes = Array.from(range?.getClientRects() || [])
            .filter((rect) => rect.width > 0 && rect.height > 0)
            .map((rect) => ({
              left: rect.left - origin.left,
              right: rect.right - origin.left,
              top: rect.top - origin.top,
              bottom: rect.bottom - origin.top,
            }));
          return { range, boxes };
        });
      }
      return cache;
    };
    const highlight = (index: number, source = false) => {
      if (!enabled || !pairs?.[index] || !entries()[index]?.range) {
        leave();
        return;
      }
      if (active === index && previewOwner === owner) return;
      active = index;
      fromSource = source;
      setHovered(index);
      previewOwner = owner;
      callback.current({
        file,
        page,
        quote: pairs[index].original,
        emphasis: "fill",
      });
      if (
        source &&
        !body.current?.closest(".pdf-view[data-paired-translation]")
      ) {
        const viewport = body.current;
        const passage = viewport?.querySelector<HTMLElement>(
          `[data-passage-index="${index}"]`,
        );
        if (viewport && passage) {
          const details = passage.closest("details");
          if (details) details.open = true;
          const bounds = passage.getBoundingClientRect(),
            visible = viewport.getBoundingClientRect();
          if (bounds.top < visible.top || bounds.bottom > visible.bottom) {
            viewport.scrollBy({
              top:
                bounds.top -
                visible.top -
                Math.max(0, (visible.height - bounds.height) / 2),
              behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
                ? "instant"
                : "smooth",
            });
          }
        }
      }
    };
    const move = (event: PointerEvent) => {
      if (
        !enabled ||
        event.pointerType !== "mouse" ||
        event.buttons ||
        !window.getSelection()?.isCollapsed
      ) {
        leave();
        return;
      }
      const target = event.target instanceof Element ? event.target : null;
      if (body.current?.contains(target)) return;
      const pdf = target?.closest<HTMLElement>(".pdf-view");
      if (
        !pdf ||
        pdf.dataset.sourceFile !== file ||
        pdf.dataset.inkTool !== "select" ||
        target?.closest("a, button, .pdf-region-selector")
      ) {
        if (fromSource) leave();
        return;
      }
      if (
        target?.closest<HTMLElement>("[data-pdf-page]")?.dataset.pdfPage !==
        String(page)
      ) {
        if (fromSource) leave();
        return;
      }
      const matches = entries();
      if (!layer || !layer.contains(target)) {
        if (fromSource) leave();
        return;
      }
      const origin = layer.getBoundingClientRect();
      const x = event.clientX - origin.left,
        y = event.clientY - origin.top;
      const index = matches.findIndex(({ boxes }) =>
        boxes.some(
          (box) =>
            x >= box.left && x <= box.right && y >= box.top && y <= box.bottom,
        ),
      );
      if (index < 0) leave();
      else highlight(index, true);
    };
    const exitWindow = (event: PointerEvent) => {
      if (!event.relatedTarget) leave();
    };
    actions.current = { highlight, leave };
    setHovered(-1);
    if (enabled) {
      document.addEventListener("pointermove", move, { passive: true });
      document.addEventListener("pointerdown", leave, { passive: true });
      document.addEventListener("pointerout", exitWindow, { passive: true });
    }
    return () => {
      mutations.disconnect();
      resize.disconnect();
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerdown", leave);
      document.removeEventListener("pointerout", exitWindow);
      leave();
    };
  }, [file, page, pairs, enabled]);

  return {
    body,
    hovered,
    highlight: (index: number) => actions.current.highlight(index),
    leave: () => actions.current.leave(),
  };
}
