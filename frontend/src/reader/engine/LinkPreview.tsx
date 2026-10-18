import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { api } from "../../api";
import type { Link, PdfDestination } from "../../features/PdfLinks";
import { useI18n } from "../../i18n/I18nProvider";
import { Floating, Spinner } from "../../ui";
import {
  CitationCard,
  type Citation,
  type CitationState,
} from "../citations/CitationCard";
import { lookupCitation, type CitedWork } from "../citations/lookup";
import { PreviewPanel } from "../citations/PreviewPanel";
import { useLibraryAdd } from "../citations/useLibraryAdd";
import { destinationPoint, resolveDestination } from "../outline";
import { readerHash } from "../route";
import { isCitation } from "./layers/LinkLayer";
import styles from "./LinkPreview.module.css";

/** How long the pointer rests on a link before its preview opens. */
const HOVER_DELAY_MS = 300;
/** How long a citation's card waits after the pointer left, so the pointer can cross to it. */
const LEAVE_GRACE_MS = 250;
/** How many answers (and entries read from the PDF) a paper's previews remember. */
const REMEMBERED = 64;
/** The most of a reference list's entry that is shown, and asked about. */
const ENTRY_LENGTH = 1200;

type Content =
  /** An entry of the reference list, and what the lookup came to. */
  | { kind: "citation"; citation: Citation }
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
  /** A key went down on a link's box: Tab goes on into the card that describes it. */
  key?(link: Link, event: KeyboardEvent<HTMLElement>): void;
  /** The preview, wherever it is put: it shows in the top layer, by its link. */
  element: ReactNode;
}

/**
 * What a link in the paper leads to, shown beside it when the pointer rests on
 * it (or the keyboard comes to it): for a citation, a card with the work cited
 * (title, authors, year, venue, abstract, citation count and links, which the
 * service looks up from the entry of the reference list), the entry itself, and
 * what to do with the work: preview it beside the paper, add it to the library,
 * go to the entry. The card stays while the pointer is on it. For a web link,
 * the site and the page's title. One at a time; Esc, leaving or scrolling puts
 * it away. What was asked is remembered for the paper; what fails says so, and
 * can be asked again.
 *
 * `follow` is how a link into the paper is followed (the card's "go to the entry").
 */
export function useLinkPreview(
  paperId: string,
  doc: PDFDocumentProxy | null,
  follow?: RefObject<((dest: PdfDestination) => void) | null>,
): LinkPreview {
  const id = useId();
  const { t } = useI18n();
  const [shown, setShown] = useState<{
    link: Link;
    anchor: HTMLElement;
  } | null>(null);
  const [content, setContent] = useState<Content | null>(null);
  /** The work whose preview is open beside the paper. */
  const [panel, setPanel] = useState<CitedWork | null>(null);
  const [attempt, setAttempt] = useState(0);
  const library = useLibraryAdd();
  const timer = useRef(0);
  const leaveTimer = useRef(0);
  const card = useRef<HTMLDivElement>(null);
  /** The link the pointer is on: shown, or about to be. */
  const resting = useRef<Link | null>(null);
  const remembered = useRef(new Map<string, Promise<unknown>>());
  const leaving = useRef<AbortController | null>(null);

  // Leaving the paper stops what is still being asked.
  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
      window.clearTimeout(leaveTimer.current);
      leaving.current?.abort();
    },
    [],
  );
  // Another PDF of the paper has other links and another reference list: what was read is forgotten.
  useEffect(() => {
    remembered.current.clear();
  }, [doc]);
  // Another paper has its own cited works to preview.
  useEffect(() => setPanel(null), [paperId]);

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
    window.clearTimeout(leaveTimer.current);
    resting.current = null;
    setShown(null);
  }, []);

  const hover = useCallback(
    (link: Link | null, element?: HTMLElement) => {
      // Back on the link it was leaving (or on its card): it stays.
      if (link && link === resting.current) {
        window.clearTimeout(leaveTimer.current);
        return;
      }
      if (!link) {
        // A card that is open is left a moment, for the pointer to cross to it; a hint not yet open is dropped.
        if (resting.current && card.current) {
          window.clearTimeout(leaveTimer.current);
          leaveTimer.current = window.setTimeout(close, LEAVE_GRACE_MS);
          return;
        }
        return close();
      }
      close();
      if (!element || !previewed(link)) return;
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
      void (async () => {
        const entry = await remember(`entry\n${name}`, () =>
          referenceEntry(doc, name),
        );
        if (!live) return;
        // Nothing printed there to go by: nothing to show.
        if (!entry) return close();
        const show = (rest: CitationState) =>
          live &&
          setContent({
            kind: "citation",
            citation: { entry, ...rest } as Citation,
          });
        show({ state: "looking" });
        try {
          const work = await remember(`cite\n${entry}`, async () => {
            leaving.current ??= new AbortController();
            return lookupCitation(entry, leaving.current.signal);
          });
          show(work ? { state: "found", work } : { state: "missing" });
        } catch (error) {
          if (live)
            show({
              state: "failed",
              message: error instanceof Error ? error.message : String(error),
            });
        }
      })();
    }
    return () => {
      live = false;
    };
  }, [shown, doc, paperId, attempt]);

  // Scrolling moves the link from under the pointer: the preview goes, rather than float over another line.
  // (A card that scrolls inside itself is not the page scrolling.)
  useEffect(() => {
    if (!shown) return;
    const away = (event: Event) => {
      if (event.target instanceof Node && card.current?.contains(event.target))
        return;
      close();
    };
    const resized = () => close();
    window.addEventListener("scroll", away, { capture: true, passive: true });
    window.addEventListener("resize", resized);
    return () => {
      window.removeEventListener("scroll", away, { capture: true });
      window.removeEventListener("resize", resized);
    };
  }, [shown]);

  const open = shown !== null && content !== null;
  const described = open ? shown.link : null;
  const describedBy = useCallback(
    (link: Link) => (link === described ? id : undefined),
    [described, id],
  );

  /** Tab on a link whose card is open goes into the card, whose buttons are not otherwise in the way. */
  const key = useCallback((link: Link, event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Tab" || event.shiftKey || link !== resting.current)
      return;
    const first = card.current?.querySelector<HTMLElement>(
      "button:not(:disabled), a[href]",
    );
    if (!first) return;
    event.preventDefault();
    first.focus();
  }, []);

  const cited = open && content.kind === "citation" ? content.citation : null;
  const citation = shown?.link;
  return {
    hover,
    close,
    describedBy,
    key,
    element: (
      <>
        {/* Only there while it is open, as a tooltip is: a closed one is nothing to find on the page. */}
        {open && cited && citation && (
          <Floating
            open
            anchor={shown.anchor}
            placement={{ side: "top", align: "start" }}
            onDismiss={(reason) => {
              const inside = card.current?.contains(document.activeElement);
              close();
              if (reason === "escape" && inside) shown.anchor.focus();
            }}
            id={id}
          >
            <div
              ref={card}
              role="dialog"
              aria-label={t("reader.cite.card")}
              onPointerOver={() => window.clearTimeout(leaveTimer.current)}
              onPointerOut={(event) => {
                // Out of the card (not between two of its parts): a moment to cross back to the link.
                const next = event.relatedTarget;
                if (next instanceof Node && event.currentTarget.contains(next))
                  return;
                window.clearTimeout(leaveTimer.current);
                leaveTimer.current = window.setTimeout(close, LEAVE_GRACE_MS);
              }}
              onFocus={() => window.clearTimeout(leaveTimer.current)}
              onBlur={(event) => {
                const next = event.relatedTarget;
                if (
                  !(next instanceof Node) ||
                  (!event.currentTarget.contains(next) && next !== shown.anchor)
                )
                  close();
              }}
            >
              <CitationCard
                citation={cited}
                add={
                  cited.state === "found"
                    ? library.states[cited.work.arxiv]
                    : undefined
                }
                onRetry={() => setAttempt((count) => count + 1)}
                onPreview={(work) => {
                  close();
                  setPanel(work);
                }}
                onAdd={library.add}
                onOpenPaper={(paper) => {
                  close();
                  window.location.hash = readerHash({ paperId: paper });
                }}
                onJump={() => {
                  const dest = citation.dest;
                  close();
                  if (dest !== undefined) follow?.current?.(dest);
                }}
              />
            </div>
          </Floating>
        )}
        {open && content.kind === "web" && (
          <Floating
            open
            anchor={shown.anchor}
            placement={{ side: "top", align: "start" }}
            onDismiss={close}
            role="tooltip"
            id={id}
            className={styles.preview}
          >
            <WebBody content={content} />
          </Floating>
        )}
        {panel && (
          <PreviewPanel
            work={panel}
            add={library.states[panel.arxiv]}
            onAdd={library.add}
            onOpenPaper={(paper) => {
              setPanel(null);
              window.location.hash = readerHash({ paperId: paper });
            }}
            onClose={() => setPanel(null)}
          />
        )}
      </>
    ),
  };
}

function WebBody({ content }: { content: Extract<Content, { kind: "web" }> }) {
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
