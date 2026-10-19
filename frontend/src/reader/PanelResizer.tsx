import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { useI18n } from "../i18n/I18nProvider";
import styles from "./PanelResizer.module.css";

/** The docked panel's width: where it starts, and the least and most it can be. */
export const PANEL_DEFAULT = 400;
export const PANEL_MIN = 300;
const PANEL_MAX = 720;
const STEP = 24;
const STEP_BIG = 72;

/** Set on the page while the panel is being dragged: the PDF panes hold their re-fit until it is gone. */
export const PANEL_RESIZING_ATTRIBUTE = "data-panel-resizing";

/** The most the panel can be in a window this wide: the paper's card keeps at least half. */
export const panelMax = (windowWidth: number) =>
  Math.max(PANEL_MIN, Math.min(PANEL_MAX, Math.floor(windowWidth / 2)));

const clamp = (width: number, windowWidth: number) =>
  Math.round(Math.min(panelMax(windowWidth), Math.max(PANEL_MIN, width)));

function read(key: string): number {
  try {
    const stored = Number(localStorage.getItem(key));
    return Number.isFinite(stored) && stored > 0 ? stored : PANEL_DEFAULT;
  } catch {
    return PANEL_DEFAULT;
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
 * The docked panel's width, kept per user on this device. What was chosen is
 * kept as it was; a window too small for it shows it narrower, and a larger one
 * gives it back.
 */
export function usePanelWidth(owner: string) {
  const key = `paper-panel-width:${owner}`;
  const [chosen, setChosen] = useState(() => read(key));
  const [windowWidth, setWindowWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const onResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const width = clamp(chosen, windowWidth);
  const choose = useCallback(
    (next: number) => {
      const value = clamp(next, window.innerWidth);
      setChosen(value);
      write(key, value);
    },
    [key],
  );
  return { width, max: panelMax(windowWidth), choose };
}

/**
 * The handle on the docked panel's left edge, in the gap between the paper's
 * card and the panel. Dragging it (mouse, pen or touch), or the arrow keys,
 * changes the panel's width; a double click puts it back to 400px. During a
 * drag the panel is resized directly (no render per frame) and the page says
 * so, so the PDF panes fit their pages once, after the pointer is released.
 */
export function PanelResizer({
  width,
  max,
  onChange,
}: {
  width: number;
  max: number;
  onChange: (width: number) => void;
}) {
  const { t } = useI18n();
  const handle = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; width: number; live: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  // The panel is the handle's next sibling.
  const show = (value: number) => {
    const el = handle.current;
    (el?.nextElementSibling as HTMLElement | null)?.style.setProperty(
      "--panel-width",
      `${value}px`,
    );
    el?.setAttribute("aria-valuenow", String(value));
  };

  const finish = useCallback(() => {
    const current = drag.current;
    drag.current = null;
    document.documentElement.removeAttribute(PANEL_RESIZING_ATTRIBUTE);
    document.body.style.removeProperty("cursor");
    document.body.style.removeProperty("user-select");
    setDragging(false);
    if (current) onChange(current.live);
  }, [onChange]);
  useEffect(
    () => () => {
      document.documentElement.removeAttribute(PANEL_RESIZING_ATTRIBUTE);
      document.body.style.removeProperty("cursor");
      document.body.style.removeProperty("user-select");
    },
    [],
  );

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.focus({ preventScroll: true });
    drag.current = { x: event.clientX, width, live: width };
    document.documentElement.setAttribute(PANEL_RESIZING_ATTRIBUTE, "true");
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    setDragging(true);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current) return;
    // The panel is on the right: dragging left widens it.
    const next = Math.round(
      Math.min(
        panelMax(window.innerWidth),
        Math.max(PANEL_MIN, current.width + current.x - event.clientX),
      ),
    );
    if (next === current.live) return;
    current.live = next;
    show(next);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? STEP_BIG : STEP;
    const next =
      event.key === "ArrowLeft"
        ? width + step
        : event.key === "ArrowRight"
          ? width - step
          : event.key === "Home"
            ? PANEL_MIN
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
        aria-label={t("reader.panel.resize")}
        aria-valuenow={width}
        aria-valuemin={PANEL_MIN}
        aria-valuemax={max}
        tabIndex={0}
        data-dragging={dragging || undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finish}
        onPointerCancel={finish}
        onLostPointerCapture={() => drag.current && finish()}
        onDoubleClick={() => onChange(PANEL_DEFAULT)}
        onKeyDown={onKeyDown}
      />
    </div>
  );
}
