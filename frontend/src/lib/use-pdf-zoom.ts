import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

type Anchor = {
  page: HTMLElement;
  x: number;
  y: number;
  viewportX: number;
  viewportY: number;
};
const clamp = (scale: number) => Math.max(0.1, Math.min(8, scale));

// Scale the existing canvases during the gesture, then render once at the final
// resolution. Keep the same point of the paper underneath the pointer.
// `pageSelector` finds the pages inside the sheet; each carries `data-scale` and
// `data-native-width`.
export function usePdfZoom(
  sheet: RefObject<HTMLDivElement | null>,
  width: number,
  onZoom?: (value: number | "fit" | "auto") => void,
  onGeometry?: () => void,
  pageSelector = ".pdf-page",
) {
  const geometry = useRef(onGeometry);
  geometry.current = onGeometry;
  const notify = useRef(onZoom);
  notify.current = onZoom;
  const [zoom, setZoom] = useState("auto");
  const [preview, setPreview] = useState(1);
  const [percent, setPercent] = useState("100");
  const zooming = useRef(false);
  const anchor = useRef<Anchor | null>(null);
  const target = useRef(1);
  const originScale = useRef(1);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const settle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const currentZoom = useRef(zoom);
  currentZoom.current = zoom;
  function scale() {
    if (!["fit", "auto"].includes(currentZoom.current))
      return Number(currentZoom.current);
    const node = sheet.current?.querySelector<HTMLElement>(
      `${pageSelector}[data-scale]`,
    );
    return Number(node?.dataset.scale || 1);
  }
  function capture(clientX?: number, clientY?: number) {
    const root = sheet.current;
    if (!root) return;
    const bounds = root.getBoundingClientRect();
    const x = clientX ?? bounds.left + root.clientWidth / 2;
    const y = clientY ?? bounds.top + Math.min(root.clientHeight / 2, 250);
    const pages = [...root.querySelectorAll<HTMLElement>(pageSelector)];
    const page =
      pages.find((p) => {
        const r = p.getBoundingClientRect();
        return y >= r.top && y <= r.bottom;
      }) || pages[0];
    if (!page) return;
    const r = page.getBoundingClientRect();
    anchor.current = {
      page,
      x: (x - r.left) / r.width,
      y: (y - r.top) / r.height,
      viewportX: x - bounds.left,
      viewportY: y - bounds.top,
    };
  }
  function restore() {
    const root = sheet.current,
      a = anchor.current;
    if (!root || !a || !a.page.isConnected) return;
    const r = a.page.getBoundingClientRect(),
      bounds = root.getBoundingClientRect();
    root.scrollLeft += r.left + r.width * a.x - bounds.left - a.viewportX;
    root.scrollTop += r.top + r.height * a.y - bounds.top - a.viewportY;
  }
  function finish(next: number | "fit" | "auto", broadcast = true) {
    clearTimeout(timer.current);
    timer.current = undefined;
    clearTimeout(settle.current);
    currentZoom.current = String(next);
    zooming.current = true;
    setZoom(String(next));
    setPreview(1);
    if (broadcast) notify.current?.(next);
    settle.current = setTimeout(() => {
      restore();
      zooming.current = false;
      if (["fit", "auto"].includes(currentZoom.current))
        setPercent(String(Math.round(scale() * 1000) / 10));
      anchor.current = null;
      geometry.current?.();
    }, 300);
  }
  function apply(value: string) {
    const parsed = Number(value.replace("%", "").trim());
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setPercent(String(Math.round(scale() * 1000) / 10));
      return;
    }
    capture();
    const next = clamp(parsed / 100);
    setPercent(String(Math.round(next * 1000) / 10));
    finish(next);
  }
  function fit() {
    capture();
    finish("fit");
  }
  useLayoutEffect(() => {
    const frame = requestAnimationFrame(restore);
    return () => cancelAnimationFrame(frame);
  }, [zoom, preview, width]);
  useEffect(() => {
    const root = sheet.current;
    if (!root) return;
    const observer = new ResizeObserver(() => {
      geometry.current?.();
      if (zooming.current) restore();
      if (!zooming.current && ["fit", "auto"].includes(currentZoom.current))
        setPercent(String(Math.round(scale() * 1000) / 10));
    });
    const watch = () =>
      root
        .querySelectorAll(pageSelector)
        .forEach((page) => observer.observe(page));
    watch();
    const mutation = new MutationObserver(watch);
    mutation.observe(root, { childList: true, subtree: true });
    let gestureStart = 1;
    function gesture(next: number, x?: number, y?: number) {
      if (!zooming.current || !timer.current) {
        originScale.current = scale();
        target.current = originScale.current;
        capture(x, y);
      }
      clearTimeout(settle.current);
      clearTimeout(timer.current);
      zooming.current = true;
      target.current = clamp(next);
      setPreview(target.current / originScale.current);
      setPercent(String(Math.round(target.current * 1000) / 10));
      timer.current = setTimeout(() => finish(target.current), 140);
    }
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey) {
        beginPan();
        return;
      }
      e.preventDefault();
      gesture(
        (timer.current ? target.current : scale()) *
          Math.exp(-e.deltaY * 0.008),
        e.clientX,
        e.clientY,
      );
    };
    const start = (e: Event) => {
      e.preventDefault();
      gestureStart = scale();
      capture((e as any).clientX, (e as any).clientY);
    };
    const change = (e: Event) => {
      e.preventDefault();
      gesture(
        gestureStart * ((e as any).scale || 1),
        (e as any).clientX,
        (e as any).clientY,
      );
    };
    const beginPan = () => {
      // A new touch/drag takes ownership of the viewport. A delayed zoom
      // anchor must not pull it sideways after the user starts scrolling.
      if (timer.current) return;
      clearTimeout(settle.current);
      anchor.current = null;
      zooming.current = false;
    };
    root.addEventListener("pointerdown", beginPan, { passive: true });
    root.addEventListener("touchstart", beginPan, { passive: true });
    root.addEventListener("wheel", wheel, { passive: false });
    root.addEventListener("gesturestart", start, { passive: false });
    root.addEventListener("gesturechange", change, { passive: false });
    return () => {
      observer.disconnect();
      mutation.disconnect();
      clearTimeout(timer.current);
      clearTimeout(settle.current);
      root.removeEventListener("pointerdown", beginPan);
      root.removeEventListener("touchstart", beginPan);
      root.removeEventListener("wheel", wheel);
      root.removeEventListener("gesturestart", start);
      root.removeEventListener("gesturechange", change);
    };
  }, [sheet, pageSelector]);
  useEffect(() => {
    if (!["fit", "auto"].includes(zoom))
      setPercent(String(Math.round(Number(zoom) * 1000) / 10));
  }, [zoom]);
  function receive(next: number | "fit" | "auto") {
    if (String(next) === currentZoom.current) return;
    capture();
    finish(next, false);
  }
  function step(direction: number) {
    const percent = Math.round(scale() * 1000) / 10;
    const next =
      direction > 0
        ? (Math.floor(percent / 10) + 1) * 10
        : (Math.ceil(percent / 10) - 1) * 10;
    apply(String(Math.max(10, next)));
  }
  return {
    releaseAnchor: () => {
      anchor.current = null;
    },
    zoom,
    preview,
    percent,
    setPercent,
    apply,
    fit,
    automatic: () => {
      capture();
      finish("auto");
    },
    zooming,
    receive,
    scale,
    step,
    fitScale: () => {
      const node = sheet.current?.querySelector<HTMLElement>(
        `${pageSelector}[data-scale]`,
      );
      const nativeWidth = Number(node?.dataset.nativeWidth || 0);
      return nativeWidth ? clamp(width / nativeWidth) : 0;
    },
  };
}
