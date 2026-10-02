import { rotatePoint } from "../lib/pdf-rotation";
import { useEffect, useRef, useState } from "react";
import { api, send } from "../api";
export type InkTool = "select" | "pen" | "eraser" | "region";
type Point = [number, number, number];
export type Stroke = {
  id: string;
  page: number;
  data: { page: number; color: string; width: number; points: Point[] };
};
type Operation =
  | { type: "add"; stroke: Stroke }
  | { type: "remove"; id: string };
export function usePdfInk(fileId: string) {
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [state, setState] = useState("loading");
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [history, setHistory] = useState({ undo: false, redo: false });
  const control = useRef<{
    queue: (op: Operation) => void;
    retry: () => void;
    undo: () => void;
    redo: () => void;
  } | null>(null);
  useEffect(() => {
    let alive = true,
      busy = false;
    const key = "paper-ink-pending:" + fileId;
    let pending: Operation[] = [];
    let current: Stroke[] = [];
    const undo: Operation[] = [],
      redo: Operation[] = [];
    setHistory({ undo: false, redo: false });
    setStrokes([]);
    setState("loading");
    setError("");
    const publish = () => {
      if (alive) setStrokes([...current]);
    };
    const apply = (op: Operation) => {
      current =
        op.type === "remove"
          ? current.filter((s) => s.id !== op.id)
          : [...current.filter((s) => s.id !== op.stroke.id), op.stroke];
    };
    const persist = () => {
      try {
        if (pending.length) localStorage.setItem(key, JSON.stringify(pending));
        else localStorage.removeItem(key);
      } catch {
        /* In-memory queue and unload warning still protect an active page. */
      }
    };
    const flush = async () => {
      if (busy) return;
      busy = true;
      if (alive) {
        setError("");
        setState("saving");
      }
      try {
        while (pending.length) {
          const op = pending[0];
          const id = op.type === "add" ? op.stroke.id : op.id;
          const result = await send(
            "/files/" + fileId + "/ink/" + id,
            op.type === "add" ? op.stroke.data : undefined,
            op.type === "add" ? "PUT" : "DELETE",
          );
          // A previous deletion wins over delayed/replayed additions.
          if (op.type === "add" && result.deleted) {
            current = current.filter((s) => s.id !== id);
            publish();
          }
          pending.shift();
          persist();
        }
        if (alive) setState("saved");
      } catch (e) {
        if (alive) {
          setError(e instanceof Error ? e.message : "保存失败");
          setState("error");
        }
      } finally {
        busy = false;
      }
    };
    const guard = (e: BeforeUnloadEvent) => {
      if (pending.length) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", guard);
    api<Stroke[]>("/files/" + fileId + "/ink")
      .then((rows) => {
        if (!alive) return;
        current = rows;
        // Only restore drafts after the server confirms access to this file.
        try {
          pending = JSON.parse(localStorage.getItem(key) || "[]");
        } catch {
          pending = [];
        }
        pending.forEach(apply);
        publish();
        const queue = (
          op: Operation,
          source: "new" | "undo" | "redo" = "new",
        ) => {
          const old =
            op.type === "remove" ? current.find((s) => s.id === op.id) : null;
          if (op.type === "remove" && !old) return;
          const inverse: Operation =
            op.type === "add"
              ? { type: "remove", id: op.stroke.id }
              : { type: "add", stroke: { ...old!, id: crypto.randomUUID() } };
          if (source === "undo") redo.push(inverse);
          else {
            undo.push(inverse);
            if (source === "new") redo.length = 0;
          }
          if (undo.length > 100) undo.shift();
          setHistory({ undo: !!undo.length, redo: !!redo.length });
          apply(op);
          pending.push(op);
          persist();
          publish();
          void flush();
        };
        control.current = {
          queue,
          undo: () => {
            const op = undo.pop();
            if (op) queue(op, "undo");
          },
          redo: () => {
            const op = redo.pop();
            if (op) queue(op, "redo");
          },
          retry: () => void flush(),
        };
        if (pending.length) void flush();
        else setState("saved");
      })
      .catch((e) => {
        if (alive) {
          setState("error");
          setError(e.message);
        }
      });
    return () => {
      alive = false;
      control.current = null;
      window.removeEventListener("beforeunload", guard);
    };
  }, [fileId, reload]);
  return {
    strokes,
    state,
    error,
    add: (stroke: Stroke) => control.current?.queue({ type: "add", stroke }),
    remove: (id: string) => control.current?.queue({ type: "remove", id }),
    retry: () =>
      control.current ? control.current.retry() : setReload((n) => n + 1),
    undo: () => control.current?.undo(),
    redo: () => control.current?.redo(),
    canUndo: history.undo,
    canRedo: history.redo,
    ready: state !== "loading" && !!control.current,
  };
}
export function InkLayer({
  rotation = 0,
  page,
  aspect,
  nativeWidth,
  tool,
  color,
  width,
  strokes,
  ready,
  add,
  remove,
}: {
  rotation?: number;
  page: number;
  aspect: number;
  nativeWidth: number;
  tool: InkTool;
  color: string;
  width: number;
  strokes: Stroke[];
  ready: boolean;
  add: (s: Stroke) => void;
  remove: (id: string) => void;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const [draft, setDraft] = useState<Point[]>([]);
  const live = useRef({ tool, color, width, strokes, ready, add, remove });
  live.current = { tool, color, width, strokes, ready, add, remove };
  useEffect(() => {
    const parent = svg.current?.parentElement;
    if (!parent) return;
    let pointer: number | null = null,
      points: Point[] = [],
      erasing = false;
    let strokeColor = "",
      strokeWidth = 2;
    const point = (e: PointerEvent): Point => {
      const r = parent.getBoundingClientRect();
      const [x, y] = rotatePoint(
        (e.clientX - r.left) / r.width,
        (e.clientY - r.top) / r.height,
        -rotation,
      );
      return [
        Number(Math.max(0, Math.min(1, x)).toFixed(5)),
        Number(Math.max(0, Math.min(1, y)).toFixed(5)),
        Number(Math.max(0.15, e.pressure || 0.5).toFixed(3)),
      ];
    };
    const erase = (p: Point) => {
      const r = parent.getBoundingClientRect();
      const originalWidth = rotation % 180 ? r.height : r.width;
      const originalHeight = rotation % 180 ? r.width : r.height;
      for (const s of live.current.strokes) {
        if (s.page !== page) continue;
        // Distance to line segments catches fast crossings, not only sampled dots.
        for (let i = 0; i < s.data.points.length; i++) {
          const a = s.data.points[Math.max(0, i - 1)],
            b = s.data.points[i];
          const dx = (b[0] - a[0]) * originalWidth,
            dy = (b[1] - a[1]) * originalHeight;
          const x = (p[0] - a[0]) * originalWidth,
            y = (p[1] - a[1]) * originalHeight;
          const t = Math.max(
            0,
            Math.min(1, (x * dx + y * dy) / (dx * dx + dy * dy || 1)),
          );
          if (Math.hypot(x - t * dx, y - t * dy) < 12) {
            live.current.remove(s.id);
            break;
          }
        }
      }
    };
    const down = (e: PointerEvent) => {
      const t = live.current.tool;
      if (
        !live.current.ready ||
        pointer !== null ||
        e.pointerType === "touch" ||
        t === "region" ||
        (e.pointerType !== "pen" && (t === "select" || e.button !== 0))
      )
        return;
      e.preventDefault();
      e.stopPropagation();
      pointer = e.pointerId;
      erasing = t === "eraser" || e.button === 5 || (e.buttons & 32) !== 0;
      strokeColor = live.current.color;
      strokeWidth = live.current.width;
      parent.setPointerCapture(pointer);
      points = [point(e)];
      if (erasing) erase(points[0]);
      else setDraft([...points]);
    };
    const move = (e: PointerEvent) => {
      if (e.pointerId !== pointer) return;
      e.preventDefault();
      e.stopPropagation();
      for (const sample of e.getCoalescedEvents?.().length
        ? e.getCoalescedEvents()
        : [e]) {
        const p = point(sample);
        if (erasing) erase(p);
        else {
          if (points.length === 4096) {
            live.current.add({
              id: crypto.randomUUID(),
              page,
              data: {
                page,
                color: strokeColor,
                width: strokeWidth,
                points: [...points],
              },
            });
            points = [points[points.length - 1]];
          }
          points.push(p);
        }
      }
      if (!erasing) setDraft([...points]);
    };
    const finish = (e: PointerEvent) => {
      if (e.pointerId !== pointer) return;
      e.preventDefault();
      e.stopPropagation();
      // Keep the ink already drawn even if the browser cancels a gesture.
      if (!erasing && points.length)
        live.current.add({
          id: crypto.randomUUID(),
          page,
          data: {
            page,
            color: strokeColor,
            width: strokeWidth,
            points: [...points],
          },
        });
      pointer = null;
      points = [];
      setDraft([]);
      if (parent.hasPointerCapture(e.pointerId))
        parent.releasePointerCapture(e.pointerId);
    };
    const touch = (e: TouchEvent) => {
      // Safari exposes stylus touchType. Cancel only pencil/palm touches,
      // leaving ordinary finger scrolling and pinch zoom native.
      if (
        pointer !== null ||
        [...e.changedTouches].some(
          (t) => (t as Touch & { touchType?: string }).touchType === "stylus",
        )
      )
        e.preventDefault();
    };
    parent.addEventListener("pointerdown", down, true);
    parent.addEventListener("pointermove", move, true);
    parent.addEventListener("pointerup", finish, true);
    parent.addEventListener("pointercancel", finish, true);
    parent.addEventListener("touchstart", touch, {
      passive: false,
      capture: true,
    });
    parent.addEventListener("touchmove", touch, {
      passive: false,
      capture: true,
    });
    return () => {
      parent.removeEventListener("pointerdown", down, true);
      parent.removeEventListener("pointermove", move, true);
      parent.removeEventListener("pointerup", finish, true);
      parent.removeEventListener("pointercancel", finish, true);
      parent.removeEventListener("touchstart", touch, true);
      parent.removeEventListener("touchmove", touch, true);
    };
  }, [page, rotation]);
  const path = (points: Point[]) =>
    points
      .map((p, i) => {
        const [x, y] = rotatePoint(p[0], p[1], rotation);
        return (i ? "L" : "M") + x * 1000 + " " + y * 1000 * aspect;
      })
      .join(" ");
  // Coordinates and line width scale with the PDF, independent of device pixels.
  return (
    <svg
      ref={svg}
      className="pdf-ink-layer"
      data-testid="pdf-ink-layer"
      viewBox={"0 0 1000 " + 1000 * aspect}
      preserveAspectRatio="none"
      aria-label="手写批注"
      data-tool={tool}
    >
      {strokes
        .filter((s) => s.page === page)
        .map((s) => (
          <path
            key={s.id}
            data-stroke={s.id}
            d={
              path(s.data.points) +
              (s.data.points.length === 1 ? " l .01 .01" : "")
            }
            stroke={s.data.color}
            strokeWidth={(s.data.width * 1000) / (nativeWidth || 612)}
          />
        ))}
      {!!draft.length && (
        <path
          d={path(draft) + " l .01 .01"}
          stroke={color}
          strokeWidth={(width * 1000) / (nativeWidth || 612)}
        />
      )}
    </svg>
  );
}
