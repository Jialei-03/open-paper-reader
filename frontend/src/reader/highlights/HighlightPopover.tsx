import { Check, NotebookPen, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { annotationColors } from "../../features/PdfAnnotations";
import { useI18n } from "../../i18n/I18nProvider";
import type { MessageKey } from "../../i18n/i18n";
import { Button, Floating, TextArea, type Rect } from "../../ui";
import {
  highlightMarkdown,
  removeHighlight,
  type HighlightStore,
} from "./actions";
import styles from "./HighlightPopover.module.css";

const COLOR_NAMES = ["yellow", "green", "blue", "pink", "red"] as const;

/**
 * Asks the card of a highlight to open (`detail: { id, comment }`): a highlight
 * just made from the selection menu's "comment", opened on its comment field.
 */
export const OPEN_HIGHLIGHT = "opr-open-highlight";

export interface HighlightPopoverProps {
  /** The pages' scroller, where a click on a highlight is listened for. */
  scroller: HTMLElement | null;
  store: HighlightStore;
  paperId: string;
  /** Box mode is on: a press there draws a box, it does not open a highlight. */
  disabled?: boolean;
  /** Keeps a block in the note. */
  onNote(markdown: string): void;
}

const inside = (box: DOMRect, x: number, y: number) =>
  x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;

/** The highlight under a point of the page, if any: the last drawn, as it is on top. */
function highlightAt(sheet: HTMLElement, x: number, y: number) {
  const found = [
    ...sheet.querySelectorAll<HTMLElement>("[data-annotation-id]"),
  ].filter((element) =>
    [...element.querySelectorAll("[data-annotation-rect]")].some((rect) =>
      inside(rect.getBoundingClientRect(), x, y),
    ),
  );
  const element = found.at(-1);
  return element ? placed(element) : null;
}

/** Where a highlight drawn on the page is, as the card's anchor. */
function placed(element: HTMLElement) {
  const boxes = [...element.querySelectorAll("[data-annotation-rect]")].map(
    (rect) => rect.getBoundingClientRect(),
  );
  const left = Math.min(...boxes.map((box) => box.left));
  const top = Math.min(...boxes.map((box) => box.top));
  const anchor: Rect = {
    x: left,
    y: top,
    width: Math.max(...boxes.map((box) => box.right)) - left,
    height: Math.max(...boxes.map((box) => box.bottom)) - top,
  };
  return { id: element.dataset.annotationId ?? "", anchor };
}

/**
 * What a highlight on the page offers once it is clicked: its color, its
 * comment (written or changed here), keeping it in the note, and taking it
 * away (with a way back). A click that ends a selection, or follows a link,
 * is not a click on the highlight.
 */
export function HighlightPopover({
  scroller,
  store,
  paperId,
  disabled = false,
  onNote,
}: HighlightPopoverProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState<{ id: string; anchor: Rect } | null>(null);
  const [comment, setComment] = useState("");
  const field = useRef<HTMLTextAreaElement>(null);
  // Opened to write its comment: the field takes the keyboard.
  const [writing, setWriting] = useState(false);
  const row = open ? store.rows.find((item) => item.id === open.id) : undefined;

  useEffect(() => {
    if (!scroller || disabled) return;
    const click = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const selection = document.getSelection();
      if (selection && !selection.isCollapsed) return;
      const target = event.target as HTMLElement;
      if (target.closest("a, button, input, textarea, [role=menu]")) return;
      const sheet = target.closest<HTMLElement>("[data-page]");
      if (!sheet) return;
      const hit = highlightAt(sheet, event.clientX, event.clientY);
      if (!hit) return;
      setWriting(false);
      setOpen(hit);
    };
    const asked = (event: Event) => {
      const { id, comment } = (
        event as CustomEvent<{ id: string; comment: boolean }>
      ).detail;
      // Once it is drawn on its page.
      requestAnimationFrame(() => {
        const element = scroller.querySelector<HTMLElement>(
          `[data-annotation-id="${CSS.escape(id)}"]`,
        );
        if (!element) return;
        setWriting(comment);
        setOpen(placed(element));
      });
    };
    window.addEventListener(OPEN_HIGHLIGHT, asked);
    // A highlight scrolled away takes its card with it (and what was typed is kept).
    const scroll = () => closeNow.current();
    scroller.addEventListener("click", click);
    scroller.addEventListener("scroll", scroll, { passive: true });
    return () => {
      scroller.removeEventListener("click", click);
      scroller.removeEventListener("scroll", scroll);
      window.removeEventListener(OPEN_HIGHLIGHT, asked);
    };
  }, [scroller, disabled]);

  // The comment field starts from the highlight's own each time one is opened.
  const openId = open?.id;
  useEffect(() => {
    const found = store.rows.find((item) => item.id === openId);
    setComment(found?.comment ?? "");
    // Only when another highlight is opened, not when the list is read again.
  }, [openId]);

  // Gone (taken away here or elsewhere): nothing to show.
  useEffect(() => {
    if (open && !row) setOpen(null);
  }, [open, row]);

  // Opened to write the comment: the field takes the keyboard once the card is placed.
  const shown = !!open && !!row;
  useEffect(() => {
    if (!shown || !writing) return;
    const frame = requestAnimationFrame(() => field.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [shown, writing, openId]);

  const changed = row ? comment.trim() !== row.comment.trim() : false;
  // A comment typed is never lost: closing the card (Escape, a press elsewhere) keeps it.
  const closeNow = useRef(() => {});
  const close = () => {
    if (row && changed) void store.update(row, row.color, comment.trim());
    setOpen(null);
  };
  closeNow.current = close;

  return (
    <Floating
      open={!!open && !!row}
      anchor={open?.anchor ?? null}
      placement={{ side: "bottom", align: "start" }}
      onDismiss={close}
      role="dialog"
      className={styles.card}
    >
      {row && (
        <div className={styles.body}>
          <div
            className={styles.colors}
            role="group"
            aria-label={t("reader.highlight.color")}
          >
            {annotationColors.map((color, index) => {
              const current =
                color.value.toLowerCase() === row.color.toLowerCase();
              return (
                <button
                  key={color.value}
                  type="button"
                  className={styles.swatch}
                  style={{ background: color.value }}
                  aria-pressed={current}
                  aria-label={t(
                    `reader.highlight.color.${COLOR_NAMES[index]}` as MessageKey,
                  )}
                  disabled={store.busy}
                  onClick={() =>
                    !current && void store.update(row, color.value, row.comment)
                  }
                >
                  {current && <Check size={12} aria-hidden="true" />}
                </button>
              );
            })}
          </div>
          <TextArea
            ref={field}
            label={t("reader.highlight.comment")}
            hideLabel
            autoGrow
            maxRows={6}
            placeholder={t("reader.highlight.commentPlaceholder")}
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                (event.metaKey || event.ctrlKey) &&
                changed
              ) {
                event.preventDefault();
                void store.update(row, row.color, comment.trim());
              }
            }}
          />
          <div className={styles.actions}>
            {changed ? (
              <Button
                size="sm"
                variant="primary"
                loading={store.busy}
                onClick={() =>
                  void store.update(row, row.color, comment.trim())
                }
              >
                {t("reader.highlight.saveComment")}
              </Button>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                icon={NotebookPen}
                onClick={() => {
                  onNote(
                    highlightMarkdown(
                      row,
                      paperId,
                      t("reader.notes.source", { page: row.page }),
                    ),
                  );
                  close();
                }}
              >
                {t("reader.highlight.toNotes")}
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              icon={Trash2}
              className={styles.remove}
              disabled={store.busy}
              onClick={() => {
                // Gone with its comment: nothing to keep.
                setOpen(null);
                void removeHighlight(store, row, {
                  removed: t("reader.highlight.removed"),
                  undo: t("reader.highlight.undo"),
                  failed: t("reader.highlight.removeFailed"),
                });
              }}
            >
              {t("reader.highlight.remove")}
            </Button>
          </div>
        </div>
      )}
    </Floating>
  );
}
