import { useCallback, useEffect, useRef, useState } from "react";
import type { Paper, SourceFile } from "../../api";
import {
  annotationColors,
  type PdfSelection,
  type usePdfAnnotations,
} from "../../features/PdfAnnotations";
import { useI18n } from "../../i18n/I18nProvider";
import { readPdfSelection } from "../../lib/pdf-selection";
import {
  Floating,
  MenuList,
  currentPlatformIsMac,
  matchesShortcut,
  toast,
  type MenuEntry,
  type Rect,
} from "../../ui";
import { serviceWords } from "../service-error";
import type { AskRequest, ReaderAction } from "../types";
import { outOfView, selectionSpot, spotRect, type PageSpot } from "./anchor";
import { TranslatePopover } from "./TranslatePopover";

/** What is kept in the note: the selection, and its translation when it comes from the translation. */
export type SelectionNote = AskRequest & { translation?: string };

export interface SelectionMenuProps {
  /** The pages' scroller (`PdfController.root`), where text is selected. */
  scroller: HTMLElement | null;
  paper: Paper;
  file: SourceFile;
  /** The paper's highlights: the same store the pages draw them from. */
  annotations: ReturnType<typeof usePdfAnnotations>;
  /** Explain (`action: "explain"`) or ask about (`action: "ask"`) the selection. */
  onAsk(request: AskRequest): void;
  onNote(request: SelectionNote): void;
  /**
   * Why text cannot be highlighted here (the translated PDF: a highlight would
   * not be on the paper's own file). The action is shown unavailable, with this
   * as its hint, and its key says it.
   */
  noHighlight?: string;
}

/** The backend takes the boxes of at most this many lines with a selection. */
const MAX_RECTS = 64;

const placement = { side: "bottom", align: "center" } as const;

/** Whether the keyboard is in a field that takes text, where letters are for typing. */
function typing(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.tagName === "SELECT")
  );
}

type Action = "explain" | "translate" | "highlight" | "note" | "ask";

const shortcuts: [Action, string][] = [
  ["explain", "e"],
  ["translate", "t"],
  ["highlight", "h"],
  ["note", "n"],
  ["ask", "enter"],
];

/**
 * The row of actions over text selected in the paper: explain, translate,
 * highlight, keep in the note, ask the assistant, each with its key. It comes
 * when a selection is made (by the pointer, by the keyboard, or with a right
 * click) and goes when the selection does, on Escape, on a press outside it,
 * or once the selection has scrolled out of view. It never takes the keyboard
 * or the selection from the page: the keys work from the page, and a press on
 * the row does not move the focus.
 */
export function SelectionMenu({
  scroller,
  paper,
  file,
  annotations,
  onAsk,
  onNote,
  noHighlight,
}: SelectionMenuProps) {
  const i18n = useI18n();
  const { t } = i18n;
  const [selection, setSelection] = useState<PdfSelection | null>(null);
  /** Where the row is pinned, and that place in the window as the page is now. */
  const [spot, setSpot] = useState<PageSpot | null>(null);
  const [anchor, setAnchor] = useState<Rect | null>(null);
  const [translating, setTranslating] = useState<{
    request: AskRequest;
    spot: PageSpot;
    anchor: Rect;
  } | null>(null);
  const [highlightFailed, setHighlightFailed] = useState(false);
  // Highlights asked for while one is still being saved wait their turn (the store takes one at a time).
  const highlights = useRef<PdfSelection[]>([]);
  const highlighting = useRef(false);
  const [turn, setTurn] = useState(0);
  const layer = useRef<HTMLDivElement>(null);
  const open = selection !== null && anchor !== null;

  const close = useCallback(() => {
    // The keyboard was on the row (the pointer rested on it): back to the page rather than nowhere.
    if (layer.current?.contains(document.activeElement))
      scroller?.focus({ preventScroll: true });
    setSelection(null);
    setSpot(null);
    setAnchor(null);
  }, [scroller]);

  const capture = useCallback(
    (at?: { x: number; y: number }) => {
      if (!scroller) return;
      const value = readPdfSelection(scroller, 0, at);
      const where = value?.text.trim() && selectionSpot(scroller, value, at);
      const rect = where ? spotRect(scroller, where) : null;
      if (!value || !where || !rect) return;
      setSelection(value);
      setSpot(where);
      setAnchor(rect);
    },
    [scroller],
  );

  // A selection is read once it is made: the pointer let go (a drag can end anywhere), the keyboard
  // extending it, or a right click on it, which then shows the row at the pointer, not the browser's menu.
  useEffect(() => {
    if (!scroller) return;
    let pressed = false;
    let timer = 0;
    // After the press's own work: a click inside a selection clears it only as it ends.
    const later = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => capture(), 0);
    };
    const down = (event: PointerEvent) => {
      pressed = event.button === 0;
    };
    const up = () => {
      if (!pressed) return;
      pressed = false;
      later();
    };
    const keyup = (event: KeyboardEvent) => {
      const all =
        (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a";
      if (event.shiftKey || event.key === "Shift" || all) later();
    };
    const context = (event: MouseEvent) => {
      const at = { x: event.clientX, y: event.clientY };
      if (!readPdfSelection(scroller, 0, at)) return;
      event.preventDefault();
      capture(at);
    };
    scroller.addEventListener("pointerdown", down);
    window.addEventListener("pointerup", up);
    scroller.addEventListener("keyup", keyup);
    scroller.addEventListener("contextmenu", context);
    return () => {
      window.clearTimeout(timer);
      scroller.removeEventListener("pointerdown", down);
      window.removeEventListener("pointerup", up);
      scroller.removeEventListener("keyup", keyup);
      scroller.removeEventListener("contextmenu", context);
    };
  }, [scroller, capture]);

  // The row goes with the selection.
  useEffect(() => {
    if (!open || !scroller) return;
    const changed = () => {
      const current = window.getSelection();
      if (
        !current ||
        current.isCollapsed ||
        !current.rangeCount ||
        !scroller.contains(current.getRangeAt(0).commonAncestorContainer)
      )
        close();
    };
    document.addEventListener("selectionchange", changed);
    return () => document.removeEventListener("selectionchange", changed);
  }, [open, scroller, close]);

  // The layers follow their place on the page as it scrolls (a box in the window would stay behind),
  // and go once it has left the view.
  useEffect(() => {
    if (!scroller || (!spot && !translating)) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      if (spot) {
        const rect = spotRect(scroller, spot);
        if (!rect || outOfView(scroller, rect)) close();
        else setAnchor(rect);
      }
      if (translating) {
        const rect = spotRect(scroller, translating.spot);
        if (!rect || outOfView(scroller, rect)) setTranslating(null);
        else
          setTranslating((current) =>
            current ? { ...current, anchor: rect } : current,
          );
      }
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    scroller.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      scroller.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
    // The translation's own anchor changes here; following it would start over at every frame.
  }, [scroller, spot, translating?.spot, close]);

  useEffect(() => {
    if (!highlightFailed) return;
    setHighlightFailed(false);
    toast.show({
      message:
        serviceWords(annotations.error, i18n) ||
        t("reader.selection.highlightFailed"),
      tone: "error",
    });
  }, [highlightFailed, annotations.error, i18n, t]);

  // The next highlight waiting, once the store has let go of the last (and is drawn with that).
  useEffect(() => {
    if (highlighting.current || annotations.busy) return;
    const value = highlights.current.shift();
    if (!value) return;
    highlighting.current = true;
    void annotations
      .add(value, annotationColors[0].value, "")
      .then((saved) => {
        if (saved)
          toast.show({
            message: t("reader.selection.highlighted"),
            tone: "success",
            duration: 2000,
          });
        else setHighlightFailed(true);
      })
      .finally(() => {
        highlighting.current = false;
        setTurn((count) => count + 1);
      });
  }, [turn, annotations, t]);

  const request = (action: ReaderAction): AskRequest | null =>
    selection && {
      paperId: paper.id,
      fileId: file.id,
      versionId: file.version_id,
      page: selection.page,
      source: "selection",
      action,
      quote: selection.text,
      prefix: selection.prefix,
      rects: selection.rects.slice(0, MAX_RECTS),
    };

  const run = (action: Action) => {
    const value = selection;
    const where = spot;
    const rect = anchor;
    if (!value || !where || !rect) return;
    if (action === "highlight" && noHighlight) {
      toast.show({ message: noHighlight });
      return;
    }
    close();
    if (action === "highlight") {
      // The service keeps the lines of at most 64 per page: said before asking, and the selection stays to be cut.
      if (
        (value.parts ?? [value]).some((part) => part.rects.length > MAX_RECTS)
      ) {
        toast.show({
          message: t("reader.selection.tooManyLines"),
          tone: "error",
        });
        return;
      }
      // The selection gives way to the highlight drawn in its place.
      window.getSelection()?.removeAllRanges();
      highlights.current.push(value);
      setTurn((count) => count + 1);
      return;
    }
    const asked = request(action === "explain" ? "explain" : "ask");
    if (!asked) return;
    if (action === "translate")
      setTranslating({
        request: { ...asked, action: "translate" },
        spot: where,
        anchor: rect,
      });
    else if (action === "note") onNote(asked);
    else onAsk(asked);
  };
  const runNow = useRef(run);
  runNow.current = run;

  // The keys work while the row is there and the keyboard is with the paper: on the pages, on the row,
  // or nowhere in particular. A button or field elsewhere keeps its own keys (Enter on a button presses it).
  useEffect(() => {
    if (!open) return;
    const mac = currentPlatformIsMac();
    const withPaper = (target: EventTarget | null) =>
      !(target instanceof Node) ||
      target === document.body ||
      target === document.documentElement ||
      scroller?.contains(target) ||
      layer.current?.contains(target);
    const onKey = (event: KeyboardEvent) => {
      if (
        event.isComposing ||
        event.defaultPrevented ||
        typing(event.target) ||
        !withPaper(event.target)
      )
        return;
      const hit = shortcuts.find(([, spec]) =>
        matchesShortcut(event, spec, mac),
      );
      if (!hit) return;
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) runNow.current(hit[0]);
    };
    // Before the row's own keys (its letters would jump between its items).
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, scroller]);

  const labels: Record<Action, string> = {
    explain: t("reader.selection.explain"),
    translate: t("reader.selection.translate"),
    highlight: t("reader.selection.highlight"),
    note: t("reader.selection.note"),
    ask: t("reader.selection.ask"),
  };
  const items: MenuEntry[] = shortcuts.map(([action, shortcut]) => ({
    id: action,
    label: labels[action],
    shortcut,
    ...(action === "highlight" && noHighlight
      ? { disabled: true, hint: noHighlight }
      : {}),
    onSelect: () => run(action),
  }));

  return (
    <>
      <Floating
        ref={layer}
        open={open}
        anchor={anchor}
        placement={placement}
        onDismiss={close}
      >
        {/* A press on the row must not take the focus, nor clear the selection it acts on. */}
        <div onMouseDown={(event) => event.preventDefault()}>
          <MenuList
            label={t("reader.selection.menu")}
            items={items}
            orientation="horizontal"
            autoFocus="none"
            onClose={close}
          />
        </div>
      </Floating>
      {translating && (
        <TranslatePopover
          request={translating.request}
          anchor={translating.anchor}
          onClose={() => setTranslating(null)}
          onNote={(translation) => {
            onNote({ ...translating.request, translation });
            setTranslating(null);
          }}
          onAsk={() => {
            onAsk({ ...translating.request, action: "ask" });
            setTranslating(null);
          }}
        />
      )}
    </>
  );
}
