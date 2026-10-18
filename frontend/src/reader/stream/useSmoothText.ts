import { useEffect, useMemo, useRef, useState } from "react";
import { advance, constructSpans, holdBack, reveal } from "./smooth";

/** Whether the system asks for less motion; then streamed text is simply shown. */
function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export interface SmoothText {
  /** The part of the target that has been revealed: render this. */
  text: string;
  /** Still flowing in, or the stream is still going: new text may come. */
  flowing: boolean;
}

/**
 * Shows streamed text at an even pace. The target grows in bursts (a poll
 * brings a sentence at once); the hook releases the characters frame by frame,
 * faster the further it is behind, flushes what is left within a fraction of a
 * second once `done`, and holds back a citation, formula or code span that is
 * still being written. Text that is already complete when first seen is shown
 * at once, and so is everything when the system asks for less motion.
 */
export function useSmoothText(
  target: string,
  { done, enabled = true }: { done: boolean; enabled?: boolean },
): SmoothText {
  const instant = !enabled || prefersReducedMotion();
  const [shown, setShown] = useState(() =>
    done || instant ? target.length : 0,
  );
  const cursor = useRef(shown);
  const spans = useMemo(() => constructSpans(target), [target]);
  const latest = useRef({ target, done, spans });
  latest.current = { target, done, spans };

  useEffect(() => {
    if (instant) {
      cursor.current = target.length;
      setShown(target.length);
      return;
    }
    let frame = 0;
    let last = 0;
    let carry = 0;
    const tick = (now: number) => {
      const { target, done, spans } = latest.current;
      const dt = last ? Math.min(now - last, 100) : 16;
      last = now;
      if (cursor.current > target.length) cursor.current = target.length;
      const limit = holdBack(target, done);
      if (cursor.current >= limit) return;
      const step = advance(carry, limit - cursor.current, dt, done);
      carry = step.carry;
      const next = reveal(target, spans, cursor.current, step.whole, limit);
      if (next !== cursor.current) {
        cursor.current = next;
        setShown(next);
      }
      if (next < limit) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, done, instant]);

  const end = Math.min(shown, target.length);
  return {
    text: target.slice(0, end),
    flowing: !done || end < target.length,
  };
}
