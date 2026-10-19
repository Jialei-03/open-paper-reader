import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import styles from "./Resizer.module.css";

/** Set on the page while a sidebar or panel is being dragged: the PDF panes follow it live, and are drawn anew once it is let go. */
export const RESIZING_ATTRIBUTE = "data-panel-resizing";

const STEP = 24;
const STEP_BIG = 72;

export interface ResizableWidth {
  /** The width now: what was chosen, held inside the limits of the window. */
  width: number;
  /** The most it can be in this window. */
  max: number;
  /** Keeps a new width (held inside the limits) for this person on this device. */
  choose(width: number): void;
}

export interface ResizableOptions {
  /** Where the width is kept (`localStorage`). */
  key: string;
  /** Where it starts, and where a double click puts it back. */
  fallback: number;
  min: number;
  /** The most it can be in a window this wide. */
  maxFor(windowWidth: number): number;
}

function read(key: string, fallback: number): number {
  try {
    const stored = Number(localStorage.getItem(key));
    return Number.isFinite(stored) && stored > 0 ? stored : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, width: number) {
  try {
    localStorage.setItem(key, String(width));
  } catch {
    /* Storage may be unavailable; the width lasts until the page is left. */
  }
}

/**
 * A width the person can change, kept per key on this device. What was chosen
 * is kept as it was; a window too small for it shows it narrower, and a larger
 * one gives it back.
 */
export function useResizableWidth({
  key,
  fallback,
  min,
  maxFor,
}: ResizableOptions): ResizableWidth {
  const [chosen, setChosen] = useState(() => read(key, fallback));
  const [windowWidth, setWindowWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    setChosen(read(key, fallback));
  }, [key, fallback]);
  useEffect(() => {
    const onResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const fit = (value: number, at: number) =>
    Math.round(Math.min(Math.max(min, maxFor(at)), Math.max(min, value)));
  const choose = useCallback(
    (next: number) => {
      const value = fit(next, window.innerWidth);
      setChosen(value);
      write(key, value);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, min, maxFor],
  );
  return {
    width: fit(chosen, windowWidth),
    max: Math.max(min, maxFor(windowWidth)),
    choose,
  };
}

export interface ResizerProps {
  /** Which neighbour the handle sizes: the one before it (a sidebar, dragged right to widen) or after it (a panel, dragged left). */
  sizes: "previous" | "next";
  width: number;
  min: number;
  max: number;
  /** Where a double click puts the width. */
  fallback: number;
  /** The most the width can be in the window now (read at each move of a drag). */
  maxNow(): number;
  /** The custom property of the neighbour that holds its width. */
  property: string;
  label: string;
  onChange(width: number): void;
}

/**
 * The handle between two boxes of the shell, for the width of one of them.
 * It takes no room of its own: it sits in the shell's 8px gap, over the cards'
 * edges. Dragging it (mouse, pen or touch), or the arrow keys (24px, 72px with
 * Shift; Home and End go to the ends), changes the width; a double click puts
 * it back. During a drag the neighbour is resized directly, once a frame and
 * without a render, and the page says so (`RESIZING_ATTRIBUTE`); the width is
 * kept when the pointer is let go.
 */
export function Resizer({
  sizes,
  width,
  min,
  max,
  fallback,
  maxNow,
  property,
  label,
  onChange,
}: ResizerProps) {
  const handle = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; width: number; live: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  // Toward the end of the row widens what is before the handle; toward its start, what is after it.
  const sign = sizes === "previous" ? 1 : -1;

  const show = (value: number) => {
    const el = handle.current;
    const slot = el?.parentElement;
    const neighbour = (
      sizes === "previous"
        ? slot?.previousElementSibling
        : slot?.nextElementSibling
    ) as HTMLElement | null;
    neighbour?.style.setProperty(property, `${value}px`);
    el?.setAttribute("aria-valuenow", String(value));
  };

  const clear = () => {
    document.documentElement.removeAttribute(RESIZING_ATTRIBUTE);
    document.body.style.removeProperty("cursor");
    document.body.style.removeProperty("user-select");
  };
  const finish = useCallback(() => {
    const current = drag.current;
    drag.current = null;
    clear();
    setDragging(false);
    if (current) onChange(current.live);
  }, [onChange]);
  useEffect(() => clear, []);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.focus({ preventScroll: true });
    drag.current = { x: event.clientX, width, live: width };
    document.documentElement.setAttribute(RESIZING_ATTRIBUTE, "true");
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    setDragging(true);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current) return;
    const next = Math.round(
      Math.min(
        Math.max(min, maxNow()),
        Math.max(min, current.width + sign * (event.clientX - current.x)),
      ),
    );
    if (next === current.live) return;
    current.live = next;
    show(next);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? STEP_BIG : STEP;
    const toward =
      event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    const next = toward
      ? width + sign * toward * step
      : event.key === "Home"
        ? min
        : event.key === "End"
          ? max
          : null;
    if (next === null) return;
    event.preventDefault();
    onChange(next);
  };

  return (
    <div className={styles.slot}>
      <div
        ref={handle}
        className={styles.handle}
        role="separator"
        aria-orientation="vertical"
        aria-label={label}
        aria-valuenow={width}
        aria-valuemin={min}
        aria-valuemax={max}
        tabIndex={0}
        data-dragging={dragging || undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finish}
        onPointerCancel={finish}
        onLostPointerCapture={() => drag.current && finish()}
        onDoubleClick={() => onChange(fallback)}
        onKeyDown={onKeyDown}
      />
    </div>
  );
}
