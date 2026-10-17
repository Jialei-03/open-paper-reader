import clsx from "clsx";
import { X } from "lucide-react";
import {
  useId,
  useLayoutEffect,
  useRef,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { useI18n } from "../i18n/I18nProvider";
import styles from "./Dialog.module.css";
import { IconButton } from "./IconButton";

export interface DialogProps {
  open: boolean;
  /** Asked for by Escape, a press on the backdrop or the close button; never when `dismissible` is false. */
  onClose: () => void;
  /** The accessible name, and the heading. */
  title: string;
  /** What the dialog is for, in a sentence; it is the dialog's accessible description. */
  description?: string;
  children?: ReactNode;
  /** The buttons, at the bottom right. */
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
  /**
   * Whether Escape, the backdrop and the close button may close it. A dialog that
   * is not dismissible has no close button: only its own buttons close it.
   */
  dismissible?: boolean;
  /**
   * The element that gets the focus when it opens. Otherwise the first one marked
   * `data-autofocus`, else the first that can be focused in the body, then in the
   * footer; the close button only when there is nothing else.
   */
  initialFocus?: RefObject<HTMLElement | null>;
}

/**
 * How many dialogs are open, and what the page's `overflow` was before the first
 * one: the page is locked while any is, and gets its own value back after the last.
 */
let lockCount = 0;
let overflowBefore = "";

function lockPageScroll(): () => void {
  const root = document.documentElement;
  if (lockCount++ === 0) {
    overflowBefore = root.style.overflow;
    root.style.overflow = "hidden";
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--lockCount === 0) root.style.overflow = overflowBefore;
  };
}

/** Whether a pointer event on the dialog element itself is outside its box: that is the backdrop. */
function onBackdrop(
  dialog: HTMLDialogElement,
  event: PointerEvent | MouseEvent,
) {
  if (event.target !== dialog) return false;
  const { left, right, top, bottom } = dialog.getBoundingClientRect();
  return (
    event.clientX < left ||
    event.clientX > right ||
    event.clientY < top ||
    event.clientY > bottom
  );
}

const TABBABLE =
  'a[href], area[href], button, input, select, textarea, summary, audio[controls], video[controls], [contenteditable]:not([contenteditable="false"]), [tabindex]';

/** What Tab reaches inside `root`, in order: the visible, enabled elements that take the focus. */
function tabbables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(TABBABLE)].filter(
    (element) =>
      element.tabIndex >= 0 &&
      !element.matches(":disabled") &&
      !(element instanceof HTMLInputElement && element.type === "hidden") &&
      !element.closest("[inert]") &&
      element.getClientRects().length > 0 &&
      getComputedStyle(element).visibility !== "hidden",
  );
}

/**
 * The browser keeps the focus off the page behind a modal, but from the last
 * element Tab goes on to its own interface (or to nothing): here it comes round
 * to the first, and Shift+Tab from the first goes to the last.
 */
function keepTabInside(event: KeyboardEvent<HTMLDialogElement>) {
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  const dialog = event.currentTarget;
  const items = tabbables(dialog);
  const first = items.at(0);
  const last = items.at(-1);
  const active = document.activeElement;
  if (!first || !last) {
    event.preventDefault();
  } else if (event.shiftKey && (active === first || active === dialog)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

/**
 * A modal window, on the browser's own `<dialog>`: it is in the top layer, the
 * page behind it cannot be reached, and the focus stays inside. The focus goes
 * to the dialog when it opens and back to what had it when it closes. The
 * element stays in the page while closed, so that it can fade out.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
  dismissible = true,
  initialFocus,
}: DialogProps) {
  const { t } = useI18n();
  const element = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const body = useRef<HTMLDivElement>(null);
  const footerElement = useRef<HTMLDivElement>(null);

  // What the listeners read, kept current on every commit. It comes before the effect that opens.
  const latest = useRef({ open, onClose, dismissible, initialFocus });
  useLayoutEffect(() => {
    latest.current = { open, onClose, dismissible, initialFocus };
  });
  // Whether the press that is in progress began on the backdrop, so a drag that only ends there does not count.
  const pressedBackdrop = useRef(false);

  // The cleanup runs when it closes and when it goes away while open.
  useLayoutEffect(() => {
    const dialog = element.current;
    if (!open || !dialog) return;
    const opener = document.activeElement;
    // The browser's own choice is the first thing that can be focused, the close button: it is only
    // the last resort here, and a keyboard focus on it would also show its tooltip, which takes the first Escape.
    if (!dialog.open) dialog.showModal();
    (
      latest.current.initialFocus?.current ??
      dialog.querySelector<HTMLElement>("[data-autofocus]") ??
      (body.current && tabbables(body.current)[0]) ??
      (footerElement.current && tabbables(footerElement.current)[0])
    )?.focus();
    const unlock = lockPageScroll();

    // On the document and ahead of any layer that opens inside the dialog, so it sees the press
    // before a menu closes on it: that press is for the menu, not for the backdrop. A tooltip is not
    // such a layer: it only names a control, and a press that dismisses it still means the backdrop.
    const onPointerDown = (event: PointerEvent) => {
      pressedBackdrop.current =
        onBackdrop(dialog, event) &&
        !dialog.querySelector(':popover-open:not([role="tooltip"])');
    };
    document.addEventListener("pointerdown", onPointerDown, true);

    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      unlock();
      if (dialog.open) dialog.close();
      if (
        opener instanceof HTMLElement &&
        opener !== document.body &&
        opener.isConnected
      )
        opener.focus();
    };
  }, [open]);

  const requestClose = () => {
    if (latest.current.dismissible) latest.current.onClose();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Tab") {
      keepTabInside(event);
      return;
    }
    if (event.key !== "Escape" || event.defaultPrevented) return;
    // Taken here rather than left to the browser, which may close a dialog that
    // refused a cancel on the next Escape; and a dialog around this one does not get it.
    event.preventDefault();
    event.stopPropagation();
    requestClose();
  };

  return (
    <dialog
      ref={element}
      className={clsx(styles.dialog, styles[size])}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onKeyDown={onKeyDown}
      onCancel={(event) => {
        // A request to close from the browser (a back gesture, say): it is ours to answer, not its to carry out.
        event.preventDefault();
        requestClose();
      }}
      onClose={() => {
        const dialog = element.current;
        // Closed by the browser, not by us: the prop still says open.
        if (!dialog || dialog.open || !latest.current.open) return;
        if (latest.current.dismissible) latest.current.onClose();
        else dialog.showModal();
      }}
      onClick={(event) => {
        const dialog = event.currentTarget;
        const began = pressedBackdrop.current;
        pressedBackdrop.current = false;
        if (began && onBackdrop(dialog, event.nativeEvent)) requestClose();
      }}
    >
      <div className={styles.header}>
        <div className={styles.heading}>
          <h2 id={titleId} className={styles.title}>
            {title}
          </h2>
          {description && (
            <p id={descriptionId} className={styles.description}>
              {description}
            </p>
          )}
        </div>
        {dismissible && (
          <IconButton
            icon={X}
            label={t("common.close")}
            size="sm"
            className={styles.close}
            onClick={requestClose}
          />
        )}
      </div>
      {children != null && (
        <div ref={body} className={styles.body}>
          {children}
        </div>
      )}
      {footer != null && (
        <div ref={footerElement} className={styles.footer}>
          {footer}
        </div>
      )}
    </dialog>
  );
}
