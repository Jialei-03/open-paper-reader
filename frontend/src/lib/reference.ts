import { useEffect, useId, useState, useRef, type RefObject } from "react";

const referenceCharacters = (value: string) =>
  value
    .normalize("NFKC")
    .replace(/[\s\u00ad\u200b]/g, "")
    .replace(/[‘’]/g, "\'")
    .replace(/[“”]/g, '"');

// Match across text nodes/PDF spans, ignoring layout-only typography.
export function textRange(root: HTMLElement, quote: string, prefix = "") {
  const points: { node: Text; offset: number }[] = [];
  let text = "";
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    for (let offset = 0; offset < node.length; offset++) {
      for (const char of referenceCharacters(node.data[offset])) {
        text += char;
        points.push({ node, offset });
      }
    }
  }
  const wanted = referenceCharacters(quote);
  const before = referenceCharacters(prefix);
  if (!wanted) return null;
  let start = text.indexOf(wanted);
  while (start >= 0 && before && !text.slice(0, start).endsWith(before))
    start = text.indexOf(wanted, start + 1);
  if (start < 0) return null;
  const a = points[start],
    b = points[start + wanted.length - 1];
  const range = document.createRange();
  range.setStart(a.node, a.offset);
  range.setEnd(b.node, b.offset + 1);
  return range;
}
export function useReferenceHighlight(
  ref: RefObject<HTMLElement | null>,
  quote: string,
  prefix: string,
  version: unknown,
  preview = false,
  rects?: { x: number; y: number; w: number; h: number }[],
  emphasis?: "fill",
) {
  const rectKey = JSON.stringify(rects || []);
  const [navigation, setNavigation] = useState(0);
  const lastScroll = useRef<{ root: HTMLElement; key: string } | null>(null);
  useEffect(() => {
    const repeat = () => setNavigation((n) => n + 1);
    window.addEventListener("reference-navigate", repeat);
    return () => window.removeEventListener("reference-navigate", repeat);
  }, []);
  const name = "reference" + useId().replace(/[^a-zA-Z0-9]/g, "");
  useEffect(() => {
    const root = ref.current;
    if (!root || !quote) {
      if (preview) lastScroll.current = null;
      return;
    }
    const exact =
      rects?.length && root.classList.contains("textLayer") ? rects : null;
    const range = exact ? null : textRange(root, quote, prefix);
    root.dataset.referenceFound = String(!!range || !!exact);
    if (!range && !exact)
      return () => {
        delete root.dataset.referenceFound;
      };
    const scrollKey = JSON.stringify([
      quote,
      prefix,
      navigation,
      rectKey,
      emphasis,
    ]);
    const scrollOnce = (target: Element | null | undefined) => {
      if (
        !target ||
        (lastScroll.current?.root === root &&
          lastScroll.current.key === scrollKey)
      )
        return;
      lastScroll.current = { root, key: scrollKey };
      if (preview) {
        // Paired text shares the PDF's scroller: moving to either counterpart
        // also moves the hovered paragraph, causing a feedback loop.
        if (root.closest(".pdf-view[data-paired-translation]")) return;
        const scroller = root.closest<HTMLElement>(".pdf-sheet");
        const bounds = range
          ? range.getBoundingClientRect()
          : target.getBoundingClientRect();
        const viewport = scroller?.getBoundingClientRect();
        if (
          viewport &&
          bounds.top >= viewport.top + 24 &&
          bounds.bottom <= viewport.bottom - 24
        )
          return;
        if (scroller && viewport) {
          scroller.scrollBy({
            top:
              bounds.top -
              viewport.top -
              Math.max(24, (viewport.height - bounds.height) / 2),
            behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
              ? "instant"
              : "smooth",
          });
          return;
        }
      }
      target.scrollIntoView({
        block: "center",
        behavior:
          preview && !matchMedia("(prefers-reduced-motion: reduce)").matches
            ? "smooth"
            : "instant",
      });
    };
    // PDF glyphs already exist on the canvas. Draw only line geometry;
    // never make the transparent selection text visible again.
    if (root.classList.contains("textLayer")) {
      const overlay = document.createElement("div");
      overlay.className =
        "pdf-reference-lines" +
        (preview ? " pdf-reference-preview" : "") +
        (emphasis === "fill" ? " pdf-reference-fill" : "");
      overlay.setAttribute("aria-hidden", "true");
      root.parentElement?.append(overlay);
      const draw = () => {
        const geometry = root.parentElement || root;
        const origin = geometry.getBoundingClientRect();
        const scaleX = origin.width / geometry.offsetWidth || 1;
        const scaleY = origin.height / geometry.offsetHeight || 1;
        const rotation = Number(root.dataset.mainRotation || 0);
        overlay.replaceChildren();
        if (exact) {
          for (const rect of exact) {
            const line = document.createElement("span");
            line.className = "pdf-reference-underline";
            line.style.left = rect.x * geometry.offsetWidth + "px";
            line.style.top =
              (rect.y + rect.h) * geometry.offsetHeight - 2 + "px";
            line.style.width = rect.w * geometry.offsetWidth + "px";
            line.style.height = "2px";
            overlay.append(line);
          }
          return;
        }
        for (const rect of Array.from(range!.getClientRects())) {
          if (rect.width < 1 || rect.height < 1) continue;
          const line = document.createElement("div");
          line.className = "pdf-reference-underline";
          const vertical = rotation % 180 !== 0;
          line.style.left =
            ((rotation === 270 ? rect.right : rect.left) - origin.left) /
              scaleX +
            "px";
          line.style.top =
            ((rotation === 0 && emphasis !== "fill" ? rect.bottom : rect.top) -
              origin.top) /
              scaleY +
            "px";
          line.style.width =
            vertical && emphasis !== "fill"
              ? "2px"
              : rect.width / scaleX + "px";
          line.style.height =
            vertical || emphasis === "fill"
              ? rect.height / scaleY + "px"
              : "2px";
          overlay.append(line);
        }
      };
      draw();
      scrollOnce(overlay.firstElementChild);
      const observer = new ResizeObserver(draw);
      observer.observe(root);
      return () => {
        observer.disconnect();
        if (
          preview &&
          !matchMedia("(prefers-reduced-motion: reduce)").matches
        ) {
          overlay.classList.add("is-leaving");
          setTimeout(() => overlay.remove(), 180);
        } else overlay.remove();
        delete root.dataset.referenceFound;
      };
    }
    const api = (CSS as any).highlights;
    const Highlight = (window as any).Highlight;
    const style = document.createElement("style");
    const target = range!.startContainer.parentElement;
    if (api && Highlight) {
      style.textContent = `::highlight(${name}) { background: #ffdf70; color: #30230a; }`;
      document.head.append(style);
      api.set(name, new Highlight(range!));
    } else target?.classList.add("reference-target");
    scrollOnce(target);
    return () => {
      api?.delete(name);
      style.remove();
      target?.classList.remove("reference-target");
      delete root.dataset.referenceFound;
    };
  }, [
    ref,
    quote,
    prefix,
    version,
    name,
    navigation,
    preview,
    rectKey,
    emphasis,
  ]);
}
