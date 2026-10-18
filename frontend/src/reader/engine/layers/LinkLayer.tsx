import type { PDFDocumentProxy } from "pdfjs-dist";
import { useEffect, useRef, useState, type FocusEvent } from "react";
import {
  safePdfUrl,
  usePdfLinks,
  type Link,
  type PdfDestination,
} from "../../../features/PdfLinks";
import { useI18n } from "../../../i18n/I18nProvider";
import { pageBox } from "./AnnotationLayer";
import styles from "./layers.module.css";

/** A press that moves further than this (px) before it is let go was a drag (a selection), not a click. */
const DRAG_PX = 4;
/**
 * A click on a link is acted on this long after it (ms), unless a second press
 * comes first: a double click selects a word of the link's text, and must not
 * also follow it.
 */
const DOUBLE_CLICK_MS = 300;

/**
 * Whether a link leads to an entry of the paper's reference list: LaTeX's
 * hyperref names those destinations `cite.<key>`, some tools `bib.<key>`.
 */
export function isCitation(link: Pick<Link, "dest">): boolean {
  return typeof link.dest === "string" && /^(cite|bib)[.:]/i.test(link.dest);
}

/** Whether the person has text selected (then a click or a rest on a link is about the text). */
const selecting = () => window.getSelection()?.isCollapsed === false;

export interface LinkLayerProps {
  /** The page's links, their boxes in fractions of the page (`usePdfLinks`). */
  links: Link[];
  /** A link to a place in the PDF was clicked. */
  onInternal(dest: PdfDestination): void;
  /** A link to an address was clicked: it opens in a new tab. */
  onExternal(url: string): void;
  /** The pointer (or the keyboard) came to a link, which is `element`; or left it (`null`). */
  onPreview?(link: Link | null, element?: HTMLElement): void;
  /** What describes a link while it is described (its preview), by id. */
  describedBy?(link: Link): string | undefined;
}

/**
 * The PDF's links. Each has a clear box over it, for the keyboard (Tab reaches
 * it, Enter follows it) and to be tinted while the pointer is on it. A link
 * into the paper is a button; a link out is a real link, opening in a new tab,
 * and only to an address that is safe to open (`safePdfUrl`: the web and
 * e-mail); anything else has no box and is not followed.
 *
 * The boxes let the pointer through, to the text beneath: a selection may start
 * on a link, cross it, or take a word of it. The page itself works out which
 * link the pointer is on: a click there follows it, unless it was a drag, a
 * double click, a pen, or text is selected.
 */
export function LinkLayer({
  links,
  onInternal,
  onExternal,
  onPreview,
  describedBy,
}: LinkLayerProps) {
  const { t } = useI18n();
  const layer = useRef<HTMLDivElement>(null);
  const boxes = useRef(new Map<string, HTMLElement>());
  /** The link the pointer is on (tinted), by id. */
  const [pointed, setPointed] = useState<string | null>(null);
  const live = useRef({ links, onInternal, onExternal, onPreview });
  live.current = { links, onInternal, onExternal, onPreview };
  const any = links.length > 0;

  useEffect(() => {
    const own = layer.current;
    const host = own?.parentElement;
    if (!any || !own || !host) return;
    /** Where the last press on the page went down, and whether by pen. */
    let press: { x: number; y: number; pen: boolean } | null = null;
    /** A click on a link waiting to see whether it is the first of a double click. */
    let pending = 0;
    /** The link whose preview was asked for. */
    let previewed: Link | null = null;

    /** The link (one that has a box) under the point of `event`, if any. */
    const under = (event: MouseEvent): Link | null => {
      const bounds = host.getBoundingClientRect();
      const x = (event.clientX - bounds.left) / bounds.width;
      const y = (event.clientY - bounds.top) / bounds.height;
      return (
        live.current.links.find((link) => {
          const [left, top, width, height] = link.rect;
          return (
            (safePdfUrl(link.url) !== undefined || link.dest !== undefined) &&
            x >= left &&
            x <= left + width &&
            y >= top &&
            y <= top + height
          );
        }) ?? null
      );
    };
    const point = (link: Link | null) => {
      // The hand over the link, over its text too (the engine's stylesheet).
      host.toggleAttribute("data-link-under-pointer", link !== null);
      setPointed(link?.id ?? null);
    };
    const preview = (link: Link | null) => {
      if (link === previewed) return;
      previewed = link;
      live.current.onPreview?.(
        link,
        link ? boxes.current.get(link.id) : undefined,
      );
    };
    const follow = (link: Link) => {
      const url = safePdfUrl(link.url);
      if (url) {
        window.open(url, "_blank", "noopener,noreferrer");
        live.current.onExternal(url);
      } else if (link.dest !== undefined) live.current.onInternal(link.dest);
    };

    const move = (event: PointerEvent) => {
      // A finger has no hover; a held button is selecting (or scrolling), not pointing.
      const link =
        event.pointerType === "touch" || event.buttons ? null : under(event);
      point(link);
      // Text selected is being read: no preview over it.
      preview(event.pointerType === "mouse" && !selecting() ? link : null);
    };
    const leave = () => {
      point(null);
      preview(null);
    };
    const down = (event: PointerEvent) => {
      window.clearTimeout(pending);
      press = {
        x: event.clientX,
        y: event.clientY,
        pen: event.pointerType === "pen",
      };
      preview(null);
    };
    const click = (event: MouseEvent) => {
      const started = press;
      press = null;
      // Enter on a box clicks the box: it follows its own link.
      if (event.target instanceof Node && own.contains(event.target)) return;
      if (
        event.button !== 0 ||
        event.defaultPrevented ||
        // The second click of a double one, or a click without a press (the keyboard).
        event.detail !== 1 ||
        !started ||
        started.pen ||
        Math.hypot(event.clientX - started.x, event.clientY - started.y) >
          DRAG_PX ||
        selecting()
      )
        return;
      const link = under(event);
      if (link)
        pending = window.setTimeout(() => {
          if (!selecting()) follow(link);
        }, DOUBLE_CLICK_MS);
    };
    host.addEventListener("pointermove", move);
    host.addEventListener("pointerleave", leave);
    host.addEventListener("pointerdown", down);
    host.addEventListener("click", click);
    return () => {
      window.clearTimeout(pending);
      host.removeEventListener("pointermove", move);
      host.removeEventListener("pointerleave", leave);
      host.removeEventListener("pointerdown", down);
      host.removeEventListener("click", click);
      host.removeAttribute("data-link-under-pointer");
      if (previewed) live.current.onPreview?.(null);
      setPointed(null);
    };
  }, [any]);

  if (!any) return null;
  return (
    <div ref={layer} className={styles.links}>
      {links.map((link) => {
        const keep = (element: HTMLElement | null) => {
          if (element) boxes.current.set(link.id, element);
          else boxes.current.delete(link.id);
        };
        const focus = {
          onFocus: (event: FocusEvent<HTMLElement>) => {
            // Only the keyboard arriving is asking to see it.
            if (event.currentTarget.matches(":focus-visible"))
              onPreview?.(link, event.currentTarget);
          },
          onBlur: () => onPreview?.(null),
        };
        const shared = {
          className: styles.link,
          style: pageBox(boxOf(link)),
          "data-pointed": pointed === link.id || undefined,
          "aria-describedby": describedBy?.(link),
        };
        const url = safePdfUrl(link.url);
        if (url)
          return (
            <a
              key={link.id}
              ref={keep}
              {...shared}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              draggable={false}
              aria-label={t("reader.link.external", { url })}
              onClick={() => onExternal(url)}
              {...focus}
            />
          );
        if (link.dest === undefined) return null;
        const dest = link.dest;
        return (
          <button
            key={link.id}
            ref={keep}
            {...shared}
            type="button"
            aria-label={t(
              isCitation(link)
                ? "reader.link.citation"
                : "reader.link.internal",
            )}
            onClick={() => onInternal(dest)}
            {...focus}
          />
        );
      })}
    </div>
  );
}

const boxOf = ({ rect: [x, y, w, h] }: Link) => ({ x, y, w, h });

/** The links of one page of `doc`, read from the page, laid out as `LinkLayer`. */
export function PageLinkLayer({
  doc,
  page,
  ...props
}: Omit<LinkLayerProps, "links"> & { doc: PDFDocumentProxy; page: number }) {
  const links = usePdfLinks(doc, page);
  return <LinkLayer links={links} {...props} />;
}
