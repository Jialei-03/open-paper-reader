import { useRef } from "react";
type Bounds = { x: number; y: number; w: number; h: number };
/** Adjust the crop, never the PDF's printed contents. */
export function PdfRegionAdjustment({
  bounds,
  onChange,
}: {
  bounds: Bounds;
  onChange: (bounds: Bounds, anchor: { x: number; y: number }) => void;
}) {
  const drag = useRef<{
    x: number;
    y: number;
    width: number;
    height: number;
    handle: string;
    result: Bounds;
    element: HTMLElement;
  } | null>(null);
  return (
    <div
      className="pdf-region-adjustment"
      aria-label="调整选区"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        const element = event.currentTarget.parentElement!;
        const page = element.parentElement!.getBoundingClientRect();
        drag.current = {
          x: event.clientX,
          y: event.clientY,
          width: page.width,
          height: page.height,
          handle: (event.target as HTMLElement).dataset.handle || "move",
          result: bounds,
          element,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const value = drag.current;
        if (!value) return;
        const dx = (event.clientX - value.x) / value.width,
          dy = (event.clientY - value.y) / value.height;
        const clamp = (n: number, min: number, max: number) =>
          Math.max(min, Math.min(max, n));
        let { x, y, w, h } = bounds;
        if (value.handle === "move") {
          x = clamp(x + dx, 0, 1 - w);
          y = clamp(y + dy, 0, 1 - h);
        } else {
          if (value.handle.includes("w")) {
            x = clamp(x + dx, 0, bounds.x + w - 0.015);
            w = bounds.x + bounds.w - x;
          }
          if (value.handle.includes("e")) w = clamp(w + dx, 0.015, 1 - x);
          if (value.handle.includes("n")) {
            y = clamp(y + dy, 0, bounds.y + h - 0.015);
            h = bounds.y + bounds.h - y;
          }
          if (value.handle.includes("s")) h = clamp(h + dy, 0.015, 1 - y);
        }
        value.result = { x, y, w, h };
        Object.assign(value.element.style, {
          left: `${x * 100}%`,
          top: `${y * 100}%`,
          width: `${w * 100}%`,
          height: `${h * 100}%`,
        });
      }}
      onPointerUp={(event) => {
        const value = drag.current;
        drag.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
        if (value)
          onChange(value.result, { x: event.clientX, y: event.clientY });
      }}
      onPointerCancel={() => {
        if (drag.current)
          Object.assign(drag.current.element.style, {
            left: `${bounds.x * 100}%`,
            top: `${bounds.y * 100}%`,
            width: `${bounds.w * 100}%`,
            height: `${bounds.h * 100}%`,
          });
        drag.current = null;
      }}
    >
      {["nw", "ne", "sw", "se"].map((handle) => (
        <span
          key={handle}
          data-handle={handle}
          className={`pdf-region-handle ${handle}`}
        />
      ))}
    </div>
  );
}
