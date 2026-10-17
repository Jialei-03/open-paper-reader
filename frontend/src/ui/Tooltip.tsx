import { useEffect, useRef, useState, type ReactElement } from "react";
import { Floating } from "./Floating";
import { Kbd } from "./Kbd";
import type { Placement } from "./position";
import styles from "./Tooltip.module.css";

/** How long the pointer rests on the control before its tooltip shows. */
const HOVER_DELAY_MS = 400;

const defaultPlacement: Placement = { side: "bottom", align: "center" };

export interface TooltipProps {
  /** What the control is called. The control keeps its own accessible name: the tooltip is hidden from assistive technology. */
  content: string;
  /** The shortcut that does the same, written as for `formatShortcut`. */
  shortcut?: string;
  placement?: Placement;
  /** One element, which the tooltip is placed against. It must name itself (an `aria-label`, say). */
  children: ReactElement;
}

/**
 * A short name for a control, shown beside it when the pointer rests on it, or
 * at once when it gets keyboard focus. Hovering needs no wrapper element of its
 * own in the layout (it is `display: contents`); the events of the child bubble
 * up to it.
 */
export function Tooltip({
  content,
  shortcut,
  placement = defaultPlacement,
  children,
}: TooltipProps) {
  const wrapper = useRef<HTMLSpanElement>(null);
  const timer = useRef(0);
  // The control the tooltip is against while it is shown; null while it is not.
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);

  const anchorOf = () => {
    const child = wrapper.current?.firstElementChild;
    return child instanceof HTMLElement ? child : null;
  };
  const inside = (node: EventTarget | null) =>
    node instanceof Node && !!anchorOf()?.contains(node);
  const cancel = () => {
    window.clearTimeout(timer.current);
    timer.current = 0;
  };
  const show = () => {
    cancel();
    setAnchor(anchorOf());
  };
  const hide = () => {
    cancel();
    setAnchor(null);
  };
  useEffect(() => cancel, []);

  return (
    <span
      ref={wrapper}
      className={styles.root}
      onPointerOver={(event) => {
        // A finger has no hover; and moving between parts of the control is not arriving.
        if (event.pointerType === "touch" || timer.current) return;
        if (!inside(event.target) || inside(event.relatedTarget)) return;
        timer.current = window.setTimeout(show, HOVER_DELAY_MS);
      }}
      onPointerOut={(event) => {
        if (inside(event.target) && !inside(event.relatedTarget)) hide();
      }}
      onFocus={(event) => {
        // Only focus that came by keyboard: a click focuses too, and must not pop one up.
        if (event.target.matches(":focus-visible")) show();
      }}
      onBlur={hide}
    >
      {children}
      {anchor && (
        <Floating
          open
          anchor={anchor}
          placement={placement}
          role="tooltip"
          aria-hidden
          className={styles.tip}
          onDismiss={hide}
        >
          {content}
          {shortcut && <Kbd shortcut={shortcut} />}
        </Floating>
      )}
    </span>
  );
}
