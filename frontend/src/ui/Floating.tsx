import clsx from "clsx";
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type ReactNode,
  type Ref,
} from "react";
import styles from "./Floating.module.css";
import { placeFloating, type Placement, type Rect } from "./position";

export type DismissReason = "escape" | "outside";

export interface FloatingProps {
  open: boolean;
  /** An element, or a rectangle in window coordinates (a text selection, say). */
  anchor: HTMLElement | Rect | null;
  placement?: Placement;
  /** The gap between the anchor and the layer, in px. */
  offset?: number;
  /** Escape was pressed while this was the topmost layer, or the pointer went down outside it. */
  onDismiss?: (reason: DismissReason) => void;
  /** An element that counts as inside for outside presses: the control that opens the layer. */
  ignore?: HTMLElement | null;
  role?: string;
  id?: string;
  /** For a layer that only repeats what the page already says (a tooltip). */
  "aria-hidden"?: boolean;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
  ref?: Ref<HTMLDivElement>;
}

const defaultPlacement: Placement = { side: "bottom", align: "start" };

/**
 * One open layer: what Escape is handed to. The last one to open is on top, and
 * only it reacts, so Escape closes one thing at a time, innermost first.
 */
interface Entry {
  /** Whether it took the Escape: a layer with no `onDismiss` leaves it alone. */
  escape(): boolean;
}
const openLayers: Entry[] = [];

/** In the capture phase of the document, so it comes before anything the page does with Escape. */
function handleEscape(event: KeyboardEvent) {
  if (event.key !== "Escape" || event.isComposing) return;
  if (!openLayers.at(-1)?.escape()) return;
  // An enclosing <dialog> would close on the same Escape if it got there.
  event.preventDefault();
  event.stopPropagation();
}

function register(entry: Entry): () => void {
  openLayers.push(entry);
  if (openLayers.length === 1)
    document.addEventListener("keydown", handleEscape, true);
  return () => {
    openLayers.splice(openLayers.indexOf(entry), 1);
    if (openLayers.length === 0)
      document.removeEventListener("keydown", handleEscape, true);
  };
}

/**
 * A layer above the page, placed against an anchor. It is a manual popover, so
 * it lives in the browser's top layer: it needs no portal and no z-index, and
 * sits above an open <dialog> too. It does not manage focus or dismissal by
 * itself beyond reporting Escape and outside presses through `onDismiss`.
 */
export function Floating({
  open,
  anchor,
  placement = defaultPlacement,
  offset = 6,
  onDismiss,
  ignore,
  role,
  id,
  "aria-hidden": ariaHidden,
  className,
  style,
  children,
  ref,
}: FloatingProps) {
  const element = useRef<HTMLDivElement>(null);
  useImperativeHandle(ref, () => element.current as HTMLDivElement, []);

  const { side, align } = placement;
  // What the listeners and the frame callback read, kept current on every commit.
  const latest = useRef({ anchor, side, align, offset, onDismiss, ignore });
  useLayoutEffect(() => {
    latest.current = { anchor, side, align, offset, onDismiss, ignore };
  });
  // Where the anchor was last seen: an anchor that is taken out of the page leaves the layer where it was.
  const lastRect = useRef<Rect | null>(null);

  const place = useCallback(() => {
    const layer = element.current;
    const { anchor, side, align, offset } = latest.current;
    if (!layer || !anchor) return;
    if (anchor instanceof Element) {
      if (anchor.isConnected) {
        const { x, y, width, height } = anchor.getBoundingClientRect();
        lastRect.current = { x, y, width, height };
      }
    } else {
      lastRect.current = anchor;
    }
    if (!lastRect.current) return;
    const { width, height } = layer.getBoundingClientRect();
    const root = document.documentElement;
    const { x, y } = placeFloating(
      lastRect.current,
      { width, height },
      { width: root.clientWidth, height: root.clientHeight },
      { side, align },
      offset,
    );
    layer.style.left = `${Math.round(x)}px`;
    layer.style.top = `${Math.round(y)}px`;
  }, []);

  // Shown before it is measured and placed, all before the first paint.
  useLayoutEffect(() => {
    const layer = element.current;
    if (!open || !layer) return;
    if (!layer.matches(":popover-open")) layer.showPopover();
    const unregister = register({
      escape() {
        const dismiss = latest.current.onDismiss;
        dismiss?.("escape");
        return dismiss != null;
      },
    });
    return () => {
      unregister();
      if (layer.matches(":popover-open")) layer.hidePopover();
    };
  }, [open]);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, anchor, side, align, offset, place]);

  useEffect(() => {
    const layer = element.current;
    if (!open || !layer) return;
    // Resize, scroll anywhere and the layer's own growth come in bursts: one placement per frame.
    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        place();
      });
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (layer.contains(target) || latest.current.ignore?.contains(target))
        return;
      latest.current.onDismiss?.("outside");
    };
    window.addEventListener("resize", schedule);
    // Scroll does not bubble; capturing at the window hears every scroller.
    window.addEventListener("scroll", schedule, {
      capture: true,
      passive: true,
    });
    document.addEventListener("pointerdown", onPointerDown, true);
    const observer = new ResizeObserver(schedule);
    observer.observe(layer);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, { capture: true });
      document.removeEventListener("pointerdown", onPointerDown, true);
      observer.disconnect();
    };
  }, [open, place]);

  return (
    <div
      ref={element}
      popover="manual"
      role={role}
      id={id}
      aria-hidden={ariaHidden}
      className={clsx(styles.floating, className)}
      style={style}
    >
      {open ? children : null}
    </div>
  );
}
