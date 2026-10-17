import clsx from "clsx";
import { Check, CircleAlert, X, type LucideIcon } from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type MouseEvent,
} from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../i18n/I18nProvider";
import { Button } from "./Button";
import { IconButton } from "./IconButton";
import { focusStart, subscribeModals, topModal } from "./modal-stack";
import styles from "./Toaster.module.css";
import {
  createToastStore,
  type ToastItem,
  type ToastOptions,
} from "./toast-store";

const store = createToastStore();

/** Where notifications are raised from, anywhere in the app: the one `<Toaster />` shows them. */
export const toast = {
  show: (options: ToastOptions): string => store.add(options),
  dismiss: (id: string): void => store.dismiss(id),
};

/** The size of the tone icon; the stylesheet's `--toast-icon-size` is the same number. */
const ICON_SIZE = 16;

const icons: Partial<Record<ToastItem["tone"], LucideIcon>> = {
  error: CircleAlert,
  success: Check,
};

/** The time a toast has left, and the timer that will end it while it is running. */
interface Countdown {
  remaining: number;
  startedAt: number;
  timer: number;
}

/**
 * One countdown per toast that has a duration. Pausing stops them all and keeps
 * what each had left; resuming goes on from there. Time is read from `Date.now()`,
 * so a test that fakes the clock moves them.
 */
function useCountdowns(items: ToastItem[], paused: boolean) {
  const countdowns = useRef(new Map<string, Countdown>());

  useEffect(() => {
    const all = countdowns.current;
    const present = new Set(items.map((item) => item.id));
    for (const [id, countdown] of all) {
      if (present.has(id)) continue;
      window.clearTimeout(countdown.timer);
      all.delete(id);
    }
    for (const { id, duration } of items) {
      if (duration == null) continue;
      let countdown = all.get(id);
      if (!countdown) {
        countdown = { remaining: duration, startedAt: 0, timer: 0 };
        all.set(id, countdown);
      }
      if (paused && countdown.timer) {
        window.clearTimeout(countdown.timer);
        countdown.timer = 0;
        countdown.remaining -= Date.now() - countdown.startedAt;
      } else if (!paused && !countdown.timer) {
        countdown.startedAt = Date.now();
        countdown.timer = window.setTimeout(
          () => store.dismiss(id),
          Math.max(0, countdown.remaining),
        );
      }
    }
  }, [items, paused]);

  // Gone with the Toaster; one that mounts again starts every countdown over.
  useEffect(() => {
    const all = countdowns.current;
    return () => {
      for (const countdown of all.values())
        window.clearTimeout(countdown.timer);
      all.clear();
    };
  }, []);
}

function Toast({
  item,
  onKeyboardDone,
}: {
  item: ToastItem;
  /** The toast was dismissed, or its action chosen, by the keyboard: its button had the focus. */
  onKeyboardDone: (id: string) => void;
}) {
  const { t } = useI18n();
  const Icon = icons[item.tone];
  const { action } = item;
  // A press of Enter or Space on a button is a click with no detail; a pointer's has at least one.
  const done = (event: MouseEvent) => {
    if (event.detail === 0) onKeyboardDone(item.id);
    store.dismiss(item.id);
  };
  return (
    <div
      className={clsx(styles.toast, item.description && styles.detailed)}
      role={item.tone === "error" ? "alert" : "status"}
    >
      {Icon && (
        <Icon
          size={ICON_SIZE}
          aria-hidden="true"
          className={clsx(styles.icon, styles[item.tone])}
        />
      )}
      <div className={styles.text}>
        <p className={styles.message}>{item.message}</p>
        {item.description && (
          <p className={styles.description}>{item.description}</p>
        )}
      </div>
      <div className={styles.buttons}>
        {action && (
          <Button
            size="sm"
            variant="secondary"
            onClick={(event) => {
              action.onClick();
              done(event);
            }}
          >
            {action.label}
          </Button>
        )}
        <IconButton
          icon={X}
          label={t("common.dismiss")}
          size="sm"
          onClick={done}
        />
      </div>
    </div>
  );
}

/**
 * Shows what `toast.show` raises, at the bottom of the window. Mount one for the
 * whole app. It is a manual popover, shown only while there is a toast, and
 * raised again by each new one so that it is above whatever opened since. Pointing
 * at it, or having the focus in it, holds every countdown.
 *
 * Above a modal dialog it is not enough to be in the top layer: the browser makes
 * everything outside the dialog inert, so while one is open the toasts are carried
 * inside it (the top one, when dialogs stack), and come back out when it closes.
 */
export function Toaster() {
  const { t } = useI18n();
  const items = useSyncExternalStore(store.subscribe, store.list, store.list);
  const host = useSyncExternalStore(subscribeModals, topModal, () => null);
  const container = useRef<HTMLDivElement>(null);
  // The ids on show at the last commit, in order; and the toast that was just dismissed from the keyboard.
  const shown = useRef<string[]>([]);
  const keyboardDone = useRef<string | null>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);

  useCountdowns(items, hovered || focused);

  // A stack in a new place has nothing pointed at it and no focus in it, and no event says so.
  useLayoutEffect(() => {
    setHovered(false);
    setFocused(false);
  }, [host]);

  useLayoutEffect(() => {
    const element = container.current;
    if (!element) return;
    const ids = items.map((item) => item.id);
    const before = shown.current;
    shown.current = ids;
    const open = element.matches(":popover-open");
    if (ids.length === 0) {
      if (open) element.hidePopover();
      setHovered(false);
    } else if (!open) {
      element.showPopover();
    } else if (ids.some((id) => !before.includes(id))) {
      // Hiding and showing again puts it last in the top layer: above anything shown since.
      const active = document.activeElement;
      element.hidePopover();
      element.showPopover();
      if (active instanceof HTMLElement && element.contains(active))
        active.focus({ preventScroll: true });
    }

    // The button that was pressed went with its toast, and the focus with it: it goes on to the
    // toast after that one (the one before it, if it was the last), else back into the dialog the
    // stack is in. Anywhere else the focus is left alone: that is where the browser puts it, or
    // where the action sent it.
    const done = keyboardDone.current;
    keyboardDone.current = null;
    const active = document.activeElement;
    if (done && !ids.includes(done) && (!active || active === document.body)) {
      const at = before.indexOf(done);
      const next =
        before.slice(at + 1).find((id) => ids.includes(id)) ??
        before
          .slice(0, at)
          .reverse()
          .find((id) => ids.includes(id));
      const button =
        next !== undefined
          ? element.children[ids.indexOf(next)]?.querySelector("button")
          : null;
      if (button) button.focus();
      else if (host) focusStart(host);
    }
    // A button that is gone takes the focus away, and not every browser says so with a blur.
    setFocused(element.contains(document.activeElement));
  }, [items, host]);

  const stack = (
    <div
      ref={container}
      popover="manual"
      role="region"
      aria-label={t("toast.region")}
      data-toaster=""
      className={styles.toaster}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          setFocused(false);
      }}
    >
      {items.map((item) => (
        <Toast
          key={item.id}
          item={item}
          onKeyboardDone={(id) => (keyboardDone.current = id)}
        />
      ))}
    </div>
  );
  return host ? createPortal(stack, host) : stack;
}
