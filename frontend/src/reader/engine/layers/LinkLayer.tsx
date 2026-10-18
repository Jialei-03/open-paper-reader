import type { PDFDocumentProxy } from "pdfjs-dist";
import type { FocusEvent, PointerEvent } from "react";
import {
  safePdfUrl,
  usePdfLinks,
  type Link,
  type PdfDestination,
} from "../../../features/PdfLinks";
import { useI18n } from "../../../i18n/I18nProvider";
import { pageBox } from "./AnnotationLayer";
import styles from "./layers.module.css";

/**
 * Whether a link leads to an entry of the paper's reference list: LaTeX's
 * hyperref names those destinations `cite.<key>`, some tools `bib.<key>`.
 */
export function isCitation(link: Pick<Link, "dest">): boolean {
  return typeof link.dest === "string" && /^(cite|bib)[.:]/i.test(link.dest);
}

export interface LinkLayerProps {
  /** The page's links, their boxes in fractions of the page (`usePdfLinks`). */
  links: Link[];
  /** A link to a place in the PDF was clicked. */
  onInternal(dest: PdfDestination): void;
  /** A link to an address was clicked: the browser opens it in a new tab. */
  onExternal(url: string): void;
  /** The pointer (or the keyboard) came to a link, which is `element`; or left it (`null`). */
  onPreview?(link: Link | null, element?: HTMLElement): void;
  /** What describes a link while it is described (its preview), by id. */
  describedBy?(link: Link): string | undefined;
}

/**
 * Where the PDF's links can be clicked: a clear box over each, tinted while the
 * pointer is on it. A link into the paper is a button; a link out is a real
 * link that opens in a new tab, and only to an address that is safe to open
 * (`safePdfUrl`: the web and e-mail); anything else gets no box at all.
 */
export function LinkLayer({
  links,
  onInternal,
  onExternal,
  onPreview,
  describedBy,
}: LinkLayerProps) {
  const { t } = useI18n();
  if (!links.length) return null;
  return (
    <div className={styles.links}>
      {links.map((link) => {
        const hover = {
          onPointerEnter: (event: PointerEvent<HTMLElement>) => {
            if (event.pointerType === "mouse")
              onPreview?.(link, event.currentTarget);
          },
          onPointerLeave: () => onPreview?.(null),
          onFocus: (event: FocusEvent<HTMLElement>) => {
            // A click focuses too; only the keyboard arriving is asking to see it.
            if (event.currentTarget.matches(":focus-visible"))
              onPreview?.(link, event.currentTarget);
          },
          onBlur: () => onPreview?.(null),
        };
        const url = safePdfUrl(link.url);
        if (url)
          return (
            <a
              key={link.id}
              className={styles.link}
              style={pageBox(boxOf(link))}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              draggable={false}
              aria-label={t("reader.link.external", { url })}
              aria-describedby={describedBy?.(link)}
              onClick={() => onExternal(url)}
              {...hover}
            />
          );
        if (link.dest === undefined) return null;
        const dest = link.dest;
        return (
          <button
            key={link.id}
            type="button"
            className={styles.link}
            style={pageBox(boxOf(link))}
            aria-label={t(
              isCitation(link)
                ? "reader.link.citation"
                : "reader.link.internal",
            )}
            aria-describedby={describedBy?.(link)}
            onClick={() => onInternal(dest)}
            {...hover}
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
