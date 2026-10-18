import { useLayoutEffect, useState, type RefObject } from "react";

/**
 * The card's width below which two pages cannot stand side by side (each would
 * be narrower than a phone): a switch between them replaces the second pane.
 */
export const COMPARE_MIN_WIDTH = 720;

/** Whether the element is wide enough for two panes, kept current as it is resized. */
export function useWide(
  element: RefObject<HTMLElement | null>,
  minimum = COMPARE_MIN_WIDTH,
): boolean {
  const [wide, setWide] = useState(false);
  useLayoutEffect(() => {
    const target = element.current;
    if (!target) return;
    const measure = () => setWide(target.clientWidth >= minimum);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(target);
    return () => observer.disconnect();
  }, [element, minimum]);
  return wide;
}
