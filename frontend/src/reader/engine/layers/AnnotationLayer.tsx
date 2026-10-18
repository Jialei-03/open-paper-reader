import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type { PdfAnnotation, PdfRect } from "../../../features/PdfAnnotations";
import { rotateRect } from "../../../lib/pdf-rotation";
import { Tooltip } from "../../../ui";
import styles from "./layers.module.css";

/** How long the pointer rests on a highlight before its comment shows: as long as for any tooltip. */
const HOVER_DELAY_MS = 400;

/** A rectangle given in fractions of the page, as a box placed in percentages of it. */
export function pageBox(rect: PdfRect): CSSProperties {
  return {
    left: `${rect.x * 100}%`,
    top: `${rect.y * 100}%`,
    width: `${rect.w * 100}%`,
    height: `${rect.h * 100}%`,
  };
}

const contains = (rect: PdfRect, x: number, y: number) =>
  x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;

export interface AnnotationLayerProps {
  /** The paper's highlights; those of other pages are left out here. */
  annotations: PdfAnnotation[];
  page: number;
  /** The turn the reader adds to the page (always 0 in this reader). */
  rotation: number;
}

/**
 * The highlights saved on a page: each box of each one in the highlight's color,
 * thinned (more in the dark theme), and a dot at the top right of those that
 * have a comment. Resting the pointer on such a highlight shows the comment.
 *
 * The page's text lies over this layer (so it can be selected through it), so
 * the pointer never reaches it: where it is resting is worked out from where it
 * is on the page.
 */
export function AnnotationLayer({
  annotations,
  page,
  rotation,
}: AnnotationLayerProps) {
  const rows = useMemo(
    () =>
      annotations
        .filter((row) => row.page === page && row.rects.length > 0)
        .map((row) => ({
          row,
          rects: row.rects.map((rect) => rotateRect(rect, rotation)),
        })),
    [annotations, page, rotation],
  );
  const layer = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<string | null>(null);
  const commented = rows.filter(({ row }) => row.comment);
  const commentedNow = useRef(commented);
  commentedNow.current = commented;
  const anyComment = commented.length > 0;

  useEffect(() => {
    const host = layer.current?.parentElement;
    if (!anyComment || !host) return;
    let timer = 0;
    /** The highlight the pointer is resting on, shown or about to be. */
    let under: string | null = null;
    const rest = (id: string | null) => {
      if (id === under) return;
      under = id;
      window.clearTimeout(timer);
      setActive(null);
      if (id) timer = window.setTimeout(() => setActive(id), HOVER_DELAY_MS);
    };
    const move = (event: PointerEvent) => {
      // A finger has no hover; and a pressed button is selecting or scrolling, not resting.
      if (event.pointerType === "touch" || event.buttons) return rest(null);
      const bounds = host.getBoundingClientRect();
      const x = (event.clientX - bounds.left) / bounds.width;
      const y = (event.clientY - bounds.top) / bounds.height;
      const hit = commentedNow.current.find(({ rects }) =>
        rects.some((rect) => contains(rect, x, y)),
      );
      rest(hit?.row.id ?? null);
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
  }, [anyComment]);

  if (!rows.length) return null;
  return (
    <div ref={layer} className={styles.annotations} aria-hidden="true">
      {rows.map(({ row, rects }) => {
        const corner = rects[0];
        const shown = active === row.id;
        return (
          <div
            key={row.id}
            className={styles.annotation}
            data-annotation-id={row.id}
            data-active={shown || undefined}
            style={{ "--annotation-color": row.color } as CSSProperties}
          >
            {rects.map((rect, index) => (
              <span
                key={index}
                className={styles.rect}
                style={pageBox(rect)}
                data-annotation-rect
              />
            ))}
            {row.comment && (
              <Tooltip
                content={row.comment}
                open={shown}
                placement={{ side: "top", align: "center" }}
              >
                <span
                  className={styles.dot}
                  style={{
                    left: `${(corner.x + corner.w) * 100}%`,
                    top: `${corner.y * 100}%`,
                  }}
                  data-annotation-comment
                />
              </Tooltip>
            )}
          </div>
        );
      })}
    </div>
  );
}
