import { useCallback, useEffect, useRef, useState } from "react";

/** Where the question box is: in the panel's foot, or floating over the paper. */
export type DockMode = "docked" | "floating";

/**
 * Where the floating box rests: its middle as a share of the card's width, and
 * how far its foot is above the card's foot (px). Null is the default, the
 * middle of the card's foot.
 */
export interface Place {
  x: number;
  y: number;
}

/** The question typed and not yet sent. It lives here, not in the box, so moving the box does not lose it. */
export interface ComposerDraft {
  text: string;
  setText(next: string | ((text: string) => string)): void;
  /** The text in the box is a question that was not sent: trying again sends it from here. */
  unsent: boolean;
  setUnsent(unsent: boolean): void;
}

export function useComposerDraft(): ComposerDraft {
  const [text, setText] = useState("");
  const [unsent, setUnsent] = useState(false);
  return { text, setText, unsent, setUnsent };
}

/** How far the pointer must be from where it was pressed, and outside the panel, before the box comes away. */
const DETACH_DISTANCE = 24;
/** The floating box keeps this far from the card's edges, and below its header strip. */
const EDGE = 8;
const HEADER = 60;

const storageKey = (owner: string) => `paper-composer:${owner}`;

interface Stored {
  mode: DockMode;
  place: Place | null;
}

function read(owner: string): Stored {
  try {
    const raw = JSON.parse(localStorage.getItem(storageKey(owner)) ?? "null");
    if (raw && (raw.mode === "docked" || raw.mode === "floating")) {
      const p = raw.place;
      const place =
        p && Number.isFinite(p.x) && Number.isFinite(p.y)
          ? { x: Number(p.x), y: Number(p.y) }
          : null;
      return { mode: raw.mode, place };
    }
  } catch {
    // Storage that is blocked or holds something else: the default.
  }
  return { mode: "docked", place: null };
}

/** Plays a short move from where the box was to where it is now (a change of place is followed by eye). */
function glide(element: HTMLElement, from: DOMRect) {
  if (typeof element.animate !== "function") return;
  const style = getComputedStyle(element);
  const duration = parseFloat(style.getPropertyValue("--ui-dur-2"));
  // Reduced motion shortens the token to nothing: the box is simply there.
  if (!(duration >= 1)) return;
  const to = element.getBoundingClientRect();
  const dx = from.left + from.width / 2 - (to.left + to.width / 2);
  const dy = from.top + from.height / 2 - (to.top + to.height / 2);
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
  element.animate(
    [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }],
    {
      duration,
      easing: style.getPropertyValue("--composer-spring").trim() || "ease-out",
    },
  );
}

export interface ComposerDock {
  mode: DockMode;
  place: Place | null;
  /** A drag is under way (the box is lifted, the panel shows where it would land). */
  dragging: boolean;
  /** The pointer is over the panel while dragging the floating box: letting go docks it. */
  over: boolean;
  /** Floating is possible (a window wide enough for the panel to sit beside the paper). */
  canDetach: boolean;
  /** Set on the box's element each time it is made (and with null when it goes). */
  attach(element: HTMLDivElement | null): void;
  /** A press on the box's grip. */
  grip(event: React.PointerEvent): void;
  /** The same change of place the drag makes, for a button. */
  toggle(): void;
}

/**
 * Where the question box lives, and how it moves between the panel's foot and
 * the paper. The box is mounted in one place at a time; what has to survive the
 * move (the draft, the focus, the animation's start) is kept here. While a drag
 * is under way the box's place is written straight to its element, so the screen
 * does not render at every pointer move; it is committed (and kept in
 * `localStorage`, per user) when the pointer is let go.
 */
export function useComposerDock({
  owner,
  narrow,
  root,
  dock,
}: {
  owner: string;
  narrow: boolean;
  /** The reader's element: the paper's card (`main`) is found in it. */
  root: React.RefObject<HTMLElement | null>;
  /** The panel's foot, where the box is docked; the panel is the element around it. */
  dock: React.RefObject<HTMLElement | null>;
}): ComposerDock {
  const [stored, setStored] = useState(() => read(owner));
  const [dragging, setDragging] = useState(false);
  const [over, setOver] = useState(false);
  const mode: DockMode = narrow ? "docked" : stored.mode;

  const box = useRef<HTMLDivElement | null>(null);
  // The box's rectangle before it moved, for the glide, and whether the keyboard was in it.
  const from = useRef<DOMRect | null>(null);
  const focused = useRef(false);
  type Drag = {
    pointer: number;
    /** Where the box is held: a share of its width, and px down from its top. */
    fx: number;
    fy: number;
    x0: number;
    y0: number;
    /** Floating already (it came away, or started so). */
    floating: boolean;
    last: Place | null;
    event: PointerEvent | null;
  };
  const drag = useRef<Drag | null>(null);
  const cleanup = useRef<(() => void) | null>(null);
  const storedNow = useRef(stored);
  storedNow.current = stored;

  useEffect(() => {
    try {
      localStorage.setItem(storageKey(owner), JSON.stringify(stored));
    } catch {
      // Not remembered, then.
    }
  }, [owner, stored]);

  const card = () => root.current?.querySelector("main") ?? null;
  const panel = () => dock.current?.closest("aside") ?? null;

  const keep = () => {
    const element = box.current;
    from.current = element?.getBoundingClientRect() ?? null;
    focused.current = !!element?.contains(document.activeElement);
  };

  /** Puts the floating box where the pointer holds it, unless the pointer is over the panel. */
  const follow = (d: Drag, event: PointerEvent) => {
    const element = box.current;
    const area = card()?.getBoundingClientRect();
    const side = panel()?.getBoundingClientRect();
    if (!element || !area) return;
    const inside =
      !!side &&
      event.clientX >= side.left &&
      event.clientX <= side.right &&
      event.clientY >= side.top &&
      event.clientY <= side.bottom;
    setOver(inside);
    if (inside) return;
    const w = element.offsetWidth;
    const h = element.offsetHeight;
    const left = Math.min(
      Math.max(event.clientX - d.fx * w, area.left + EDGE),
      area.right - EDGE - w,
    );
    const top = Math.min(
      Math.max(event.clientY - d.fy, area.top + HEADER),
      area.bottom - EDGE - h,
    );
    const place = {
      x: (left + w / 2 - area.left) / area.width,
      y: area.bottom - (top + h),
    };
    d.last = place;
    element.style.setProperty("--composer-x", String(place.x));
    element.style.setProperty("--composer-y", `${place.y}px`);
  };

  const attach = useCallback((element: HTMLDivElement | null) => {
    box.current = element;
    if (!element) return;
    const d = drag.current;
    // Coming away under the pointer: it is put where the pointer is before it is shown.
    if (d?.event && d.floating) followRef.current(d, d.event);
    if (from.current) glide(element, from.current);
    from.current = null;
    if (focused.current) {
      focused.current = false;
      const field = element.querySelector("textarea");
      if (field) {
        field.focus({ preventScroll: true });
        field.setSelectionRange(field.value.length, field.value.length);
      }
    }
  }, []);
  const followRef = useRef(follow);
  followRef.current = follow;

  const toggle = () => {
    keep();
    setStored((now) => ({
      ...now,
      mode: now.mode === "docked" ? "floating" : "docked",
    }));
  };

  const grip = (event: React.PointerEvent) => {
    if (event.button !== 0 || narrow || !box.current) return;
    event.preventDefault();
    const rect = box.current.getBoundingClientRect();
    const d: Drag = {
      pointer: event.pointerId,
      fx: (event.clientX - rect.left) / rect.width,
      fy: event.clientY - rect.top,
      x0: event.clientX,
      y0: event.clientY,
      floating: mode === "floating",
      last: null,
      event: null,
    };
    drag.current = d;
    if (d.floating) setDragging(true);
    const body = document.body.style;
    const selecting = body.userSelect;
    body.userSelect = "none";

    const move = (e: PointerEvent) => {
      if (e.pointerId !== d.pointer) return;
      d.event = e;
      if (!d.floating) {
        const side = panel()?.getBoundingClientRect();
        const outside =
          !side ||
          e.clientX < side.left ||
          e.clientX > side.right ||
          e.clientY < side.top ||
          e.clientY > side.bottom;
        if (
          !outside ||
          Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < DETACH_DISTANCE
        )
          return;
        // Out of the panel: the box comes away and follows from here on.
        d.floating = true;
        keep();
        setDragging(true);
        setStored((now) => ({ ...now, mode: "floating" }));
        return;
      }
      follow(d, e);
    };
    const finish = (e: PointerEvent, cancelled: boolean) => {
      if (e.pointerId !== d.pointer) return;
      stop();
      drag.current = null;
      setDragging(false);
      const wasOver = !cancelled && d.floating && overNow.current;
      setOver(false);
      if (wasOver) {
        keep();
        setStored((now) => ({
          mode: "docked",
          place: d.last ?? now.place,
        }));
      } else if (d.floating) {
        const place = d.last ?? storedNow.current.place;
        setStored((now) => ({ ...now, mode: "floating", place }));
      }
    };
    const up = (e: PointerEvent) => finish(e, false);
    const abort = (e: PointerEvent) => finish(e, true);
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", abort);
      body.userSelect = selecting;
      cleanup.current = null;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", abort);
    cleanup.current = stop;
  };
  const overNow = useRef(over);
  overNow.current = over;

  // Leaving mid-drag lets go of the window's listeners.
  useEffect(() => () => cleanup.current?.(), []);

  // A window made shorter keeps the floating box under the card's header.
  useEffect(() => {
    if (mode !== "floating") return;
    const onResize = () => {
      const element = box.current;
      const area = card()?.getBoundingClientRect();
      if (!element || !area || drag.current) return;
      const y = parseFloat(element.style.getPropertyValue("--composer-y"));
      const most = area.height - HEADER - EDGE - element.offsetHeight;
      if (Number.isFinite(y) && y > most)
        element.style.setProperty("--composer-y", `${Math.max(most, EDGE)}px`);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  return {
    mode,
    place: stored.place,
    dragging,
    over,
    canDetach: !narrow,
    attach,
    grip,
    toggle,
  };
}
