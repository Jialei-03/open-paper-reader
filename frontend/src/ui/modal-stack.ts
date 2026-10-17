// The modal dialogs that are open, in the order they opened: the last is on top.
//
// The browser makes everything outside the top modal dialog inert, a layer in
// the top layer above it included. A layer that has to stay usable over a dialog
// (the toasts) has to live inside it, and this is where it finds which one.

interface Modal {
  dialog: HTMLElement;
  /** Puts the focus where the dialog would have it on opening. */
  focusStart(): void;
}

const open: Modal[] = [];
const listeners = new Set<() => void>();

function notify() {
  for (const listener of [...listeners]) listener();
}

/** Records a dialog that has just been shown modally; the returned function takes it off again. */
export function enterModal(
  dialog: HTMLElement,
  focusStart: () => void,
): () => void {
  const modal = { dialog, focusStart };
  open.push(modal);
  notify();
  return () => {
    const index = open.indexOf(modal);
    if (index < 0) return;
    open.splice(index, 1);
    notify();
  };
}

/** The dialog that is on top, or null when none is open. */
export function topModal(): HTMLElement | null {
  return open.at(-1)?.dialog ?? null;
}

/** Brings the focus back into an open dialog, to where it starts: for a layer in it that took the focus with it. */
export function focusStart(dialog: HTMLElement): void {
  open.find((modal) => modal.dialog === dialog)?.focusStart();
}

export function subscribeModals(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
