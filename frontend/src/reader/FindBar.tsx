import { ChevronDown, ChevronUp, X } from "lucide-react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { usePdfSearch, usePdfSearchHighlight } from "../features/PdfNavigation";
import { useI18n } from "../i18n/I18nProvider";
import { IconButton, TextField } from "../ui";
import type { PdfController } from "./engine/PdfPages";
import styles from "./FindBar.module.css";

/** Finding in the paper: what the bar shows and what the paper's card does with it. */
export interface Find {
  open: boolean;
  /** Opens the bar; where it is already open, takes the keyboard back to its field. */
  show(): void;
  /** Closes the bar and puts the reading back where it was when the bar opened. */
  close(): void;
  toggle(): void;
  search: ReturnType<typeof usePdfSearch>;
  /** The match `delta` further on; past the last is the first, before the first the last. */
  step(delta: number): void;
  /** For the pages' `textLayerRef`: the match is marked on its page as soon as the page's text is there. */
  onTextLayer(
    page: number,
    element: HTMLDivElement | null,
    rendered: boolean,
  ): void;
  field: RefObject<HTMLInputElement | null>;
}

/**
 * Searching the whole paper for a phrase. The first match (and each one stepped
 * to) is shown: its page is scrolled to if it is not drawn yet, and once its
 * text is there the match is marked and brought to the middle of the view.
 * Closing goes back to where the reading was before the search began.
 */
export function useFind(
  doc: PDFDocumentProxy | null,
  controller: PdfController | null,
): Find {
  const search = usePdfSearch(doc);
  const [open, setOpen] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  /** Where the reading was when the bar opened: the page under the top, and how far down it. */
  const origin = useRef<number | null>(null);
  const controllerNow = useRef(controller);
  controllerNow.current = controller;

  // The text layers that are drawn, by page; the match is marked on its own.
  const layers = useRef(new Map<number, HTMLDivElement>());
  const matchPage = useRef<number | null>(null);
  const target = useRef<HTMLDivElement | null>(null);
  const [ready, setReady] = useState(false);
  const match = open ? search.matches[search.index] : undefined;

  const onTextLayer = useCallback(
    (page: number, element: HTMLDivElement | null, rendered: boolean) => {
      if (rendered && element) layers.current.set(page, element);
      else layers.current.delete(page);
      if (page !== matchPage.current) return;
      target.current = rendered ? element : null;
      setReady(rendered);
    },
    [],
  );

  // The PDF went (it is being opened again): there is nothing to search, and the bar goes with it.
  useEffect(() => {
    if (doc) return;
    origin.current = null;
    setOpen(false);
  }, [doc]);

  // The match moved to another page: its text may already be drawn.
  const page = match?.page;
  useEffect(() => {
    matchPage.current = page ?? null;
    const layer =
      page === undefined ? null : (layers.current.get(page) ?? null);
    target.current = layer;
    setReady(layer !== null);
  }, [page]);
  usePdfSearchHighlight(target, match, ready);

  /** Shows a match: its page is scrolled to unless it is drawn already, when marking it brings it to the middle. */
  const reveal = (found: { page: number } | undefined) => {
    if (found && !layers.current.has(found.page))
      controllerNow.current?.scrollToPage(found.page);
  };

  // A new search found its matches: the first is shown.
  const matches = search.matches;
  useEffect(() => {
    // Only a new result is news; the bar opening or closing is not.
    if (open) reveal(matches[0]);
  }, [matches]);

  const focusField = () => {
    field.current?.focus();
    field.current?.select();
  };

  const show = () => {
    if (open) return focusField();
    origin.current = controllerNow.current?.position() ?? null;
    setOpen(true);
  };

  const close = () => {
    if (!open) return;
    setOpen(false);
    search.setQuery("");
    const at = origin.current;
    origin.current = null;
    const paper = controllerNow.current;
    if (paper && at !== null) {
      const index = Math.floor(at);
      paper.scrollToPage(index + 1, at - index);
    }
    // The keyboard goes back to the paper, so that its keys work again.
    paper?.root?.focus({ preventScroll: true });
  };

  const step = (delta: number) => {
    const total = matches.length;
    if (!total) return;
    const next = (search.index + delta + total) % total;
    search.setIndex(next);
    reveal(matches[next]);
  };

  return {
    open,
    show,
    close,
    toggle: () => (open ? close() : show()),
    search,
    step,
    onTextLayer,
    field,
  };
}

/**
 * The bar under the card's header: the phrase, how many matches and which one
 * is shown, the buttons to step through them, and to close. Enter is the next
 * match and Shift+Enter the one before; Esc closes it (the card hears that).
 */
export function FindBar({ find }: { find: Find }) {
  const { t } = useI18n();
  const { search, field } = find;
  const total = search.matches.length;

  // As it opens, the phrase is typed at once; a phrase left in the field is selected, to be typed over.
  useEffect(() => {
    field.current?.focus();
    field.current?.select();
  }, [field]);

  const status = search.error
    ? t("reader.find.error")
    : search.busy
      ? t("reader.find.searching")
      : !search.query
        ? ""
        : total
          ? t("reader.find.count", { current: search.index + 1, total })
          : t("reader.find.none");

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // Enter that ends a composition (Chinese, Japanese) is not "next match".
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    find.step(event.shiftKey ? -1 : 1);
  };

  return (
    <div
      className={styles.bar}
      role="search"
      aria-label={t("reader.find.region")}
    >
      <div className={styles.field}>
        <TextField
          ref={field}
          hideLabel
          label={t("reader.find.label")}
          placeholder={t("reader.find.placeholder")}
          value={search.query}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => search.setQuery(event.target.value)}
          onKeyDown={onKeyDown}
        />
      </div>
      <span className={styles.count} role="status">
        {status}
      </span>
      <IconButton
        icon={ChevronUp}
        label={t("reader.find.previous")}
        shortcut="shift+enter"
        size="sm"
        disabled={total === 0}
        onClick={() => find.step(-1)}
      />
      <IconButton
        icon={ChevronDown}
        label={t("reader.find.next")}
        shortcut="enter"
        size="sm"
        disabled={total === 0}
        onClick={() => find.step(1)}
      />
      <IconButton
        icon={X}
        label={t("reader.find.close")}
        shortcut="escape"
        size="sm"
        onClick={find.close}
      />
    </div>
  );
}
