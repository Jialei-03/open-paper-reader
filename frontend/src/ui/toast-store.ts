// The list of notifications and the rules for it. It knows nothing of React or
// of timers: the Toaster draws it and runs the countdowns, so the rules can be
// tested on their own.

export type ToastTone = "info" | "success" | "error";

export interface ToastOptions {
  message: string;
  description?: string;
  tone?: ToastTone;
  action?: { label: string; onClick: () => void };
  /** How long it stays, in ms. Info and success last 5 seconds; an error stays until it is dismissed. */
  duration?: number;
}

export interface ToastItem
  extends Required<Pick<ToastOptions, "message" | "tone">> {
  id: string;
  description?: string;
  action?: ToastOptions["action"];
  /** In ms; null when it stays until it is dismissed. */
  duration: number | null;
}

export interface ToastStore {
  /** Adds a toast and returns its id; the id of the one already showing when this is a repeat of it. */
  add(options: ToastOptions): string;
  dismiss(id: string): void;
  /** Oldest first. It is the same array until something changes. */
  list(): ToastItem[];
  subscribe(listener: () => void): () => void;
}

const MAX_TOASTS = 3;
const DEFAULT_DURATION_MS = 5000;

export function createToastStore(): ToastStore {
  let items: ToastItem[] = [];
  let count = 0;
  const listeners = new Set<() => void>();

  const set = (next: ToastItem[]) => {
    items = next;
    for (const listener of [...listeners]) listener();
  };

  return {
    add({ message, description, tone = "info", action, duration }) {
      const repeat = items.find(
        (item) => item.message === message && item.tone === tone,
      );
      if (repeat) return repeat.id;

      const lasts = duration ?? (tone === "error" ? null : DEFAULT_DURATION_MS);
      const item: ToastItem = {
        id: `toast-${++count}`,
        message,
        description,
        tone,
        action,
        // A timer given Infinity would fire at once: no expiry is null.
        duration: lasts != null && Number.isFinite(lasts) ? lasts : null,
      };

      let next = [...items, item];
      if (next.length > MAX_TOASTS) {
        // Errors are kept: the oldest toast that is not one goes, and that can be the newcomer
        // itself. Only a list of nothing but errors loses its oldest.
        const dropped = next.find((i) => i.tone !== "error") ?? next[0];
        // The newcomer was the one to go: nothing changes, and there is nothing to tell.
        if (dropped === item) return item.id;
        next = next.filter((i) => i !== dropped);
      }
      set(next);
      return item.id;
    },

    dismiss(id) {
      if (!items.some((item) => item.id === id)) return;
      set(items.filter((item) => item.id !== id));
    },

    list: () => items,

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
