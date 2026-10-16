import { useLayoutEffect, useRef, useState } from "react";
import { Markdown } from "./shared";

export function StreamingMarkdown({
  body,
  active,
}: {
  body: string;
  active: boolean;
}) {
  const [shown, setShown] = useState(active ? "" : body);
  const visible = useRef(shown);
  const wasActive = useRef(active);
  const [reducedMotion, setReducedMotion] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useLayoutEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useLayoutEffect(() => {
    const animate = active || wasActive.current;
    wasActive.current = active;
    const publish = (text: string) => {
      visible.current = text;
      setShown(text);
    };
    if (!animate || reducedMotion) {
      publish(body);
      return;
    }
    // A retry or replacement starts a new answer, never splices old text into it.
    const prefix = body.startsWith(visible.current) ? visible.current : "";
    publish(prefix);
    const suffix = Array.from(body.slice(prefix.length));
    if (!suffix.length) return;
    // Small chunks reveal character by character. Large chunks catch up within
    // one polling interval, rather than accumulating seconds of animation lag.
    const duration = Math.min(
      active ? 650 : 450,
      Math.max(100, suffix.length * 18),
    );
    const start = performance.now();
    let frame = 0;
    const tick = (time: number) => {
      const count = Math.min(
        suffix.length,
        Math.max(1, Math.floor(((time - start) / duration) * suffix.length)),
      );
      publish(prefix + suffix.slice(0, count).join(""));
      if (count < suffix.length) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [body, active, reducedMotion]);

  return (
    <div
      className="streaming-markdown"
      aria-busy={active}
      data-typing={active || shown !== body}
    >
      <Markdown body={body.startsWith(shown) ? shown : ""} />
      {active && (
        <span className="streaming-status" role="status">
          正在生成…
        </span>
      )}
    </div>
  );
}
