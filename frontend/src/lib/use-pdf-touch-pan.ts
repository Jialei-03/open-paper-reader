import { useEffect, type RefObject } from "react";

// Let the browser own vertical scrolling (including momentum) and pinch zoom.
// Only an explicitly horizontal one-finger gesture pans the enlarged paper.
export function usePdfTouchPan(ref: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    let gesture: {
      id: number;
      x: number;
      y: number;
      left: number;
      axis: "pending" | "x" | "y";
    } | null = null;
    const reset = () => {
      gesture = null;
    };
    const start = (event: TouchEvent) => {
      reset();
      if (event.defaultPrevented || event.touches.length !== 1) return;
      const touch = event.touches[0];
      if ((touch as Touch & { touchType?: string }).touchType === "stylus")
        return;
      gesture = {
        id: touch.identifier,
        x: touch.clientX,
        y: touch.clientY,
        left: root.scrollLeft,
        axis: "pending",
      };
    };
    const move = (event: TouchEvent) => {
      if (event.defaultPrevented || event.touches.length !== 1) {
        reset();
        return;
      }
      const touch = event.touches[0];
      if (!gesture || touch.identifier !== gesture.id) return;
      const dx = touch.clientX - gesture.x;
      const dy = touch.clientY - gesture.y;
      if (gesture.axis === "pending") {
        if (Math.hypot(dx, dy) < 8) return;
        // Prefer reading vertically, even when the finger travels diagonally.
        gesture.axis = Math.abs(dx) > Math.abs(dy) * 1.5 ? "x" : "y";
      }
      if (gesture.axis === "x" && event.cancelable) {
        event.preventDefault();
        root.scrollLeft = gesture.left - dx;
      }
    };
    root.addEventListener("touchstart", start, { passive: true });
    root.addEventListener("touchmove", move, { passive: false });
    root.addEventListener("touchend", reset);
    root.addEventListener("touchcancel", reset);
    return () => {
      root.removeEventListener("touchstart", start);
      root.removeEventListener("touchmove", move);
      root.removeEventListener("touchend", reset);
      root.removeEventListener("touchcancel", reset);
    };
  }, [ref]);
}
