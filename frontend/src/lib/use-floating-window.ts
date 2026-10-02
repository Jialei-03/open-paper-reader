import {
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type KeyboardEvent,
} from "react";
type Rect = { x: number; y: number; width: number; height: number };
export function useFloatingWindow(key: string) {
  const defaults = () => ({
    x: Math.max(8, innerWidth - 556),
    y: Math.max(8, Math.min(80, innerHeight - 708)),
    width: 540,
    height: 700,
  });
  const clamp = (r: Rect): Rect => {
    const width = Math.max(
      Math.min(360, innerWidth - 16),
      Math.min(r.width, innerWidth - 16),
    );
    const height = Math.max(
      Math.min(400, innerHeight - 16),
      Math.min(r.height, innerHeight - 16),
    );
    return {
      width,
      height,
      x: Math.max(8, Math.min(r.x, innerWidth - width - 8)),
      y: Math.max(8, Math.min(r.y, innerHeight - height - 8)),
    };
  };
  const [rect, setRect] = useState<Rect>(() => {
    try {
      const r = JSON.parse(localStorage.getItem(key) || "null");
      if (
        r &&
        ["x", "y", "width", "height"].every((k) => Number.isFinite(r[k]))
      )
        return clamp(r);
    } catch {}
    return clamp(defaults());
  });
  const [compact, setCompact] = useState(() => {
    try {
      return localStorage.getItem(key + ":compact") === "true";
    } catch {
      return false;
    }
  });
  const regular = useRef<Rect | null>(null);
  useEffect(() => {
    try {
      const saved = JSON.parse(
        localStorage.getItem(key + ":regular") || "null",
      );
      if (
        saved &&
        ["x", "y", "width", "height"].every((field) =>
          Number.isFinite(saved[field]),
        )
      )
        regular.current = saved;
    } catch {}
  }, [key]);
  const toggleCompact = () => {
    if (compact) setRect(clamp(regular.current || defaults()));
    else {
      regular.current = { ...rect };
      setRect(
        clamp({
          ...rect,
          x: rect.x + rect.width - 380,
          width: 380,
          height: 480,
        }),
      );
    }
    setCompact(!compact);
  };
  const latest = useRef(rect);
  latest.current = rect;
  const drag = useRef<{
    rect: Rect;
    x: number;
    y: number;
    edge: string;
  } | null>(null);
  useEffect(() => {
    const resize = () => setRect((r) => clamp(r));
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(rect));
      localStorage.setItem(key + ":compact", String(compact));
      if (regular.current)
        localStorage.setItem(key + ":regular", JSON.stringify(regular.current));
    } catch {}
  }, [key, rect, compact]);
  const start = (e: PointerEvent<HTMLElement>, edge = "move") => {
    if (
      e.button !== 0 ||
      (edge === "move" &&
        (e.target as HTMLElement).closest("button,input,select,a"))
    )
      return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { rect: latest.current, x: e.clientX, y: e.clientY, edge };
  };
  const move = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x,
      dy = e.clientY - d.y,
      r = { ...d.rect };
    if (d.edge === "move") {
      r.x += dx;
      r.y += dy;
    } else {
      if (d.edge.includes("e")) r.width += dx;
      if (d.edge.includes("s")) r.height += dy;
      if (d.edge.includes("w")) {
        r.width -= dx;
        r.x += dx;
      }
      if (d.edge.includes("n")) {
        r.height -= dy;
        r.y += dy;
      }
    }
    setRect(clamp(r));
  };
  const end = () => {
    drag.current = null;
  };
  const keyboard = (e: KeyboardEvent<HTMLElement>, resize = false) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key))
      return;
    if (e.target !== e.currentTarget) return;
    e.preventDefault();
    const step = e.shiftKey ? 40 : 10;
    const dx =
        e.key === "ArrowRight" ? step : e.key === "ArrowLeft" ? -step : 0,
      dy = e.key === "ArrowDown" ? step : e.key === "ArrowUp" ? -step : 0;
    setRect((r) =>
      clamp(
        resize
          ? { ...r, width: r.width + dx, height: r.height + dy }
          : { ...r, x: r.x + dx, y: r.y + dy },
      ),
    );
  };
  return {
    rect,
    compact,
    toggleCompact,
    start,
    move,
    end,
    keyboard,
    reset: () => {
      setCompact(false);
      setRect(clamp(defaults()));
    },
  };
}
