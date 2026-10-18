import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { api } from "../../api";
import type { Link } from "../../features/PdfLinks";
import { useI18n } from "../../i18n/I18nProvider";
import { Floating, Spinner } from "../../ui";
import { destinationPoint, resolveDestination } from "../outline";
import { isCitation } from "./layers/LinkLayer";
import styles from "./LinkPreview.module.css";

/** How long the pointer rests on a link before its preview opens: as for a tooltip. */
const HOVER_DELAY_MS = 400;
/** How many answers (and entries read from the PDF) a paper's previews remember. */
const REMEMBERED = 64;
/** The most of a reference list's entry that is shown, and asked about. */
const ENTRY_LENGTH = 1200;
/** More authors than this are cut short: the first ones, then "et al.". */
const AUTHORS = 3;

/** A work the service found for an entry of the reference list. */
type Reference = { title: string; authors?: string[]; year?: number };

type Content =
  /** The entry is being looked up. */
  | { kind: "looking" }
  | { kind: "reference"; reference: Reference }
  /** No work could be found for the entry: the entry itself, as the paper prints it. */
  | { kind: "entry"; text: string }
  /** `title` is `null` while it is being fetched, and empty when there is none. */
  | { kind: "web"; host: string; title: string | null };

/** Whether hovering the link has anything to show: an entry of the reference list, or a web page. */
function previewed(link: Link): boolean {
  return isCitation(link) || /^https?:/i.test(link.url ?? "");
}

const destinations = new WeakMap<
  PDFDocumentProxy,
  Promise<Record<string, unknown>>
>();

/** Every named destination of the document, read once. */
function namedDestinations(doc: PDFDocumentProxy) {
  let all = destinations.get(doc);
  if (!all) {
    all = doc.getDestinations().catch(() => ({}));
    destinations.set(doc, all);
  }
  return all;
}

const refKey = (value: unknown) =>
  typeof value === "number" ? String(value) : JSON.stringify(value);

/**
 * The entry of the reference list a citation leads to, as the PDF prints it:
 * the text from the destination down to where the next entry in the same
 * column starts (the next `cite.…` destination below it on the page), or to the
 * page's foot. Empty when the destination leads nowhere or the page cannot be read.
 */
export async function referenceEntry(
  doc: PDFDocumentProxy,
  name: string,
): Promise<string> {
  try {
    const resolved = await resolveDestination(doc, name);
    if (!resolved) return "";
    const page = await doc.getPage(resolved.page);
    const point = destinationPoint(resolved.target);
    const top = point.top ?? page.view[3];
    const left = point.left ?? page.view[0];
    const ref = refKey(resolved.target[0]);
    const below = Object.entries(await namedDestinations(doc)).flatMap(
      ([other, dest]) => {
        if (!isCitation({ dest: other }) || !Array.isArray(dest)) return [];
        if (refKey(dest[0]) !== ref) return [];
        const next = destinationPoint(dest);
        return next.top !== null &&
          next.left !== null &&
          Math.abs(next.left - left) < 24 &&
          next.top < top - 2
          ? [next.top]
          : [];
      },
    );
    const bottom = below.length ? Math.max(...below) : page.view[1];
    const content = await page.getTextContent();
    return content.items
      .flatMap((item) =>
        "str" in item &&
        item.transform[5] <= top + 2 &&
        item.transform[5] > bottom + 2 &&
        item.transform[4] >= left - 12
          ? [item.str]
          : [],
      )
      .join(" ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, ENTRY_LENGTH);
  } catch {
    return "";
  }
}

export interface LinkPreview {
  /** The pointer (or the keyboard) came to a link, which is `element`: its preview opens after a moment. `null`: it left. */
  hover(link: Link | null, element?: HTMLElement): void;
  /** Put the preview away now (the link was followed, say). */
  close(): void;
  /** The preview's id while it describes `link`. */
  describedBy(link: Link): string | undefined;
  /** The preview, wherever it is put: it shows in the top layer, by its link. */
  element: ReactNode;
}

/**
 * What a link in the paper leads to, shown beside it when the pointer rests on
 * it: for a citation, the work cited (its title, authors and year, which the
 * service looks up from the entry of the reference list), or the entry itself
 * when no work is found; for a web link, the site and the page's title. One at
 * a time; Esc, leaving the link or scrolling puts it away. What was asked is
 * remembered for the paper; what fails shows nothing of the failure.
 */
export function useLinkPreview(
  paperId: string,
  doc: PDFDocumentProxy | null,
): LinkPreview {
  const id = useId();
  const [shown, setShown] = useState<{
    link: Link;
    anchor: HTMLElement;
  } | null>(null);
  const [content, setContent] = useState<Content | null>(null);
  const timer = useRef(0);
  /** The link the pointer is on: shown, or about to be. */
  const resting = useRef<Link | null>(null);
  const remembered = useRef(new Map<string, Promise<unknown>>());
  const leaving = useRef<AbortController | null>(null);

  // Leaving the paper stops what is still being asked.
  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
      leaving.current?.abort();
    },
    [],
  );
  // Another PDF of the paper has other links and another reference list: what was read is forgotten.
  useEffect(() => {
    remembered.current.clear();
  }, [doc]);

  /** One answer per question for the paper: asked once, kept unless it failed. */
  const remember = <T,>(key: string, ask: () => Promise<T>): Promise<T> => {
    const all = remembered.current;
    const known = all.get(key) as Promise<T> | undefined;
    if (known) {
      all.delete(key);
      all.set(key, known);
      return known;
    }
    const asked = ask();
    all.set(key, asked);
    asked.catch(() => {
      if (all.get(key) === asked) all.delete(key);
    });
    while (all.size > REMEMBERED) all.delete(all.keys().next().value!);
    return asked;
  };

  const ask = <T,>(path: string) => {
    leaving.current ??= new AbortController();
    return api<T>(path, { signal: leaving.current.signal });
  };

  // The same functions from render to render, so the pages they are handed to need not be drawn again.
  const close = useCallback(() => {
    window.clearTimeout(timer.current);
    resting.current = null;
    setShown(null);
  }, []);

  const hover = useCallback(
    (link: Link | null, element?: HTMLElement) => {
      if (link && link === resting.current) return;
      close();
      if (!link || !element || !previewed(link)) return;
      resting.current = link;
      timer.current = window.setTimeout(
        () => setShown({ link, anchor: element }),
        HOVER_DELAY_MS,
      );
    },
    [close],
  );

  useEffect(() => {
    setContent(null);
    if (!shown) return;
    let live = true;
    const { link } = shown;
    const path = `/papers/${encodeURIComponent(paperId)}`;
    if (link.url) {
      const url = link.url;
      const host = new URL(url).hostname.replace(/^www\./, "");
      setContent({ kind: "web", host, title: null });
      remember(`web\n${url}`, () =>
        ask<{ title?: string }>(
          `${path}/link-preview?url=${encodeURIComponent(url)}`,
        ),
      ).then(
        (answer) => {
          const title = (answer.title ?? "").trim();
          // The service names a page without a title by its host, which is shown already.
          const own = title.replace(/^www\./, "") === host ? "" : title;
          if (live) setContent({ kind: "web", host, title: own });
        },
        () => {
          if (live) setContent({ kind: "web", host, title: "" });
        },
      );
    } else if (doc && typeof link.dest === "string") {
      const name = link.dest;
      setContent({ kind: "looking" });
      void (async () => {
        const text = await remember(`entry\n${name}`, () =>
          referenceEntry(doc, name),
        );
        if (!live) return;
        // Nothing printed there to go by: nothing to show.
        if (!text) return close();
        try {
          const answer = await remember(`cite\n${text}`, () =>
            ask<{ items?: Reference[] }>(
              `${path}/citation-preview?excerpt=${encodeURIComponent(text)}`,
            ),
          );
          const found = answer.items?.find((item) => item?.title);
          if (live)
            setContent(
              found
                ? { kind: "reference", reference: found }
                : { kind: "entry", text },
            );
        } catch {
          if (live) setContent({ kind: "entry", text });
        }
      })();
    }
    return () => {
      live = false;
    };
  }, [shown, doc, paperId]);

  // Scrolling moves the link from under the pointer: the preview goes, rather than float over another line.
  useEffect(() => {
    if (!shown) return;
    const away = () => close();
    window.addEventListener("scroll", away, { capture: true, passive: true });
    window.addEventListener("resize", away);
    return () => {
      window.removeEventListener("scroll", away, { capture: true });
      window.removeEventListener("resize", away);
    };
  }, [shown]);

  const open = shown !== null && content !== null;
  const described = open ? shown.link : null;
  const describedBy = useCallback(
    (link: Link) => (link === described ? id : undefined),
    [described, id],
  );
  return {
    hover,
    close,
    describedBy,
    // Only there while it is open, as a tooltip is: a closed one is nothing to find on the page.
    element: open && (
      <Floating
        open
        anchor={shown.anchor}
        placement={{ side: "top", align: "start" }}
        onDismiss={close}
        role="tooltip"
        id={id}
        className={styles.preview}
      >
        <PreviewBody content={content} />
      </Floating>
    ),
  };
}

function PreviewBody({ content }: { content: Content }) {
  const { t } = useI18n();
  switch (content.kind) {
    case "looking":
      return (
        <p className={styles.status} aria-busy="true">
          <Spinner size={14} />
          {t("reader.link.looking")}
        </p>
      );
    case "reference": {
      const { title, authors = [], year } = content.reference;
      const names =
        authors.length > AUTHORS
          ? t("reader.link.etAl", {
              authors: authors.slice(0, AUTHORS).join(", "),
            })
          : authors.join(", ");
      const byline = [names, year].filter(Boolean).join(" · ");
      return (
        <>
          <p className={styles.title}>{title}</p>
          {byline && <p className={styles.meta}>{byline}</p>}
        </>
      );
    }
    case "entry":
      return <p className={styles.entry}>{content.text}</p>;
    case "web":
      return (
        <>
          <p className={styles.meta}>
            {content.host}
            {content.title === null && <Spinner size={14} />}
          </p>
          {content.title && <p className={styles.title}>{content.title}</p>}
        </>
      );
  }
}
