import { useEffect, useRef } from "react";
import type { PdfController, PdfZoom } from "../../engine/PdfPages";
import type { ScrollMap } from "./scroll-map";

/** How long a scroll of a pane that was moved by the other is told from one of the person's. */
const ECHO_MS = 200;
/** After a zoom the panes lay themselves out again; their own scrolls then are not the person's. */
const SETTLE_MS = 450;

const sameZoom = (a: PdfZoom, b: PdfZoom) =>
  typeof a === "number" && typeof b === "number"
    ? Math.abs(a - b) < 0.001
    : a === b;

interface Panes {
  original: PdfController | null;
  translated: PdfController | null;
  map: ScrollMap;
  /** The pages of each, to keep a position inside the document. */
  pages: { original: number; translated: number };
  /** Scrolling one moves the other. */
  linked: boolean;
}

/**
 * Keeps two panes of one paper in step: the zoom is the same in both (whichever
 * one is zoomed, the other follows), and, while `linked`, so is the place read:
 * whichever pane the person scrolls leads, and the other is moved to the same
 * place of the paper by `map`. A scroll that only comes of the other having
 * been moved is not taken for the person's, so the two never chase each other.
 */
export function useLinkedPanes({
  original,
  translated,
  map,
  pages,
  linked,
}: Panes) {
  const now = useRef({ original, translated, map, pages });
  now.current = { original, translated, map, pages };
  /** The pane the person scrolled last. */
  const leader = useRef<"original" | "translated">("original");
  /** Scrolls that are due to our own moving of a pane: where it went, until when. */
  const echoes = useRef(new Map<HTMLElement, { top: number; until: number }>());
  const quietUntil = useRef(0);

  /** Moves the other pane to where `from` is reading. */
  const follow = useRef((from: "original" | "translated") => {
    const { original, translated, map, pages } = now.current;
    const source = from === "original" ? original : translated;
    const target = from === "original" ? translated : original;
    if (!source || !target || !source.root || !target.root) return;
    const position = (from === "original" ? map.forward : map.backward)(
      source.position(),
    );
    const count = from === "original" ? pages.translated : pages.original;
    if (count < 1) return;
    const index = Math.min(count - 1, Math.max(0, Math.floor(position)));
    target.scrollToPage(index + 1, position - index);
    echoes.current.set(target.root, {
      top: target.root.scrollTop,
      until: performance.now() + ECHO_MS,
    });
  }).current;

  const originalRoot = original?.root ?? null;
  const translatedRoot = translated?.root ?? null;
  useEffect(() => {
    if (!linked || !originalRoot || !translatedRoot) return;
    const entries: ["original" | "translated", HTMLElement][] = [
      ["original", originalRoot],
      ["translated", translatedRoot],
    ];
    const listeners = entries.map(([side, root]) => {
      const onScroll = () => {
        const now_ = performance.now();
        const echo = echoes.current.get(root);
        if (echo) {
          echoes.current.delete(root);
          if (now_ < echo.until && Math.abs(root.scrollTop - echo.top) <= 2)
            return;
        }
        if (now_ < quietUntil.current) return;
        leader.current = side;
        follow(side);
      };
      root.addEventListener("scroll", onScroll, { passive: true });
      return () => root.removeEventListener("scroll", onScroll);
    });
    // Linked now (or the panes have just come): the translation goes to where the original is read.
    follow(leader.current);
    return () => listeners.forEach((off) => off());
  }, [linked, originalRoot, translatedRoot, follow]);

  // The same zoom in both: the one that changed is followed by the other.
  const zooms = useRef<{ original?: PdfZoom; translated?: PdfZoom }>({});
  /** Once the panes have settled at the new zoom, the follower is put back where the leader is. */
  const resync = useRef(0);
  useEffect(() => () => window.clearTimeout(resync.current), []);
  useEffect(() => {
    if (!original || !translated) {
      zooms.current = {};
      return;
    }
    const before = zooms.current;
    zooms.current = { original: original.zoom, translated: translated.zoom };
    if (sameZoom(original.zoom, translated.zoom)) return;
    const originalMoved =
      before.original === undefined ||
      !sameZoom(original.zoom, before.original);
    if (originalMoved) translated.setZoom(original.zoom);
    else original.setZoom(translated.zoom);
    quietUntil.current = performance.now() + SETTLE_MS;
    if (linked) {
      const side = leader.current;
      window.clearTimeout(resync.current);
      resync.current = window.setTimeout(() => follow(side), SETTLE_MS);
    }
  }, [original?.zoom, translated?.zoom, original, translated, linked, follow]);
}
