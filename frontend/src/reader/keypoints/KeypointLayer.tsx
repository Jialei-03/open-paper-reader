import clsx from "clsx";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type { PdfRect } from "../../features/PdfAnnotations";
import { useI18n } from "../../i18n/I18nProvider";
import { textRange } from "../../lib/reference";
import { Tooltip } from "../../ui";
import { pageBox } from "../engine/layers/AnnotationLayer";
import colors from "./colors.module.css";
import type { Keypoint } from "./keypoints";
import styles from "./KeypointLayer.module.css";

/** How long the pointer rests on a sentence before its category and reason show: as long as for any tooltip. */
const HOVER_DELAY_MS = 400;
/** A little above and below a line also counts as resting on it: an underline is thin. */
const SLACK = 0.004;

type Mark = { item: Keypoint; rects: PdfRect[] };

/** The boxes of a range, one to a line, in fractions of the page. */
export function lineRects(range: Range, page: DOMRect): PdfRect[] {
  const boxes = Array.from(range.getClientRects())
    .filter((box) => box.width >= 1 && box.height >= 1)
    .sort((a, b) => a.top - b.top || a.left - b.left);
  const lines: { left: number; right: number; top: number; bottom: number }[] =
    [];
  for (const box of boxes) {
    const line = lines.find(
      (candidate) =>
        Math.abs(candidate.bottom - box.bottom) < box.height * 0.5 &&
        box.left <= candidate.right + 6 &&
        box.right >= candidate.left - 6,
    );
    if (line) {
      line.left = Math.min(line.left, box.left);
      line.right = Math.max(line.right, box.right);
      line.top = Math.min(line.top, box.top);
      line.bottom = Math.max(line.bottom, box.bottom);
    } else
      lines.push({
        left: box.left,
        right: box.right,
        top: box.top,
        bottom: box.bottom,
      });
  }
  return lines.map((line) => ({
    x: (line.left - page.left) / page.width,
    y: (line.top - page.top) / page.height,
    w: (line.right - line.left) / page.width,
    h: (line.bottom - line.top) / page.height,
  }));
}

const contains = (rect: PdfRect, x: number, y: number) =>
  x >= rect.x &&
  x <= rect.x + rect.w &&
  y >= rect.y - SLACK &&
  y <= rect.y + rect.h + SLACK;

export interface KeypointLayerProps {
  /** The key sentences of the categories that are shown; those of other pages are left out here. */
  items: readonly Keypoint[];
  page: number;
}

/**
 * Each key sentence of the page is found in the page's own text by its words
 * (the service only keeps sentences that are in the paper); one that is not
 * found on this page is not marked anywhere else.
 */
export function KeypointLayer({ items, page }: KeypointLayerProps) {
  const { t } = useI18n();
  const layer = useRef<HTMLDivElement>(null);
  const mine = useMemo(
    () => items.filter((item) => item.page === page),
    [items, page],
  );
  const [marks, setMarks] = useState<Mark[]>([]);
  const [active, setActive] = useState<{ id: string; line: number } | null>(
    null,
  );
  const marksNow = useRef(marks);
  marksNow.current = marks;

  // Where the sentences are, whenever the page's text is drawn (again).
  useEffect(() => {
    const host = layer.current?.parentElement;
    if (!host || mine.length === 0) {
      setMarks([]);
      return;
    }
    let frame = 0;
    const locate = () => {
      const text = host.querySelector<HTMLElement>(".textLayer");
      if (!text || host.dataset.rendered !== "true") return setMarks([]);
      const bounds = host.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return setMarks([]);
      const found: Mark[] = [];
      for (const item of mine) {
        const range = textRange(text, item.quote);
        if (!range) continue;
        const rects = lineRects(range, bounds);
        if (rects.length) found.push({ item, rects });
      }
      setMarks(found);
    };
    const later = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(locate);
    };
    locate();
    const observer = new MutationObserver(later);
    observer.observe(host, {
      attributes: true,
      attributeFilter: ["data-rendered", "data-scale"],
    });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [mine]);

  // Resting the pointer on a sentence shows what it is and why.
  const any = marks.length > 0;
  useEffect(() => {
    const host = layer.current?.parentElement;
    if (!any || !host) return;
    let timer = 0;
    let under = "";
    const rest = (next: { id: string; line: number } | null) => {
      const key = next ? `${next.id}:${next.line}` : "";
      if (key === under) return;
      under = key;
      window.clearTimeout(timer);
      setActive(null);
      if (next)
        timer = window.setTimeout(() => setActive(next), HOVER_DELAY_MS);
    };
    const move = (event: PointerEvent) => {
      if (event.pointerType === "touch" || event.buttons) return rest(null);
      const bounds = host.getBoundingClientRect();
      const x = (event.clientX - bounds.left) / bounds.width;
      const y = (event.clientY - bounds.top) / bounds.height;
      for (const { item, rects } of marksNow.current) {
        const line = rects.findIndex((rect) => contains(rect, x, y));
        if (line >= 0) return rest({ id: item.id, line });
      }
      rest(null);
    };
    const leave = () => rest(null);
    host.addEventListener("pointermove", move);
    host.addEventListener("pointerleave", leave);
    host.addEventListener("pointerdown", leave);
    return () => {
      window.clearTimeout(timer);
      host.removeEventListener("pointermove", move);
      host.removeEventListener("pointerleave", leave);
      host.removeEventListener("pointerdown", leave);
      setActive(null);
    };
  }, [any]);

  return (
    <div ref={layer} className={styles.layer} aria-hidden="true">
      {marks.map(({ item, rects }) => {
        const label = t(`reader.keypoints.${item.category}`);
        const tip = item.reason ? `${label} · ${item.reason}` : label;
        return rects.map((rect, line) => {
          const on = active?.id === item.id;
          const mark = (
            <span
              className={clsx(styles.mark, colors[item.category])}
              style={pageBox(rect) as CSSProperties}
              data-keypoint={item.category}
              data-active={on || undefined}
            />
          );
          return (
            <Tooltip
              key={`${item.id}:${line}`}
              content={tip}
              open={active?.id === item.id && active.line === line}
              placement={{ side: "top", align: "center" }}
            >
              {mark}
            </Tooltip>
          );
        });
      })}
    </div>
  );
}
