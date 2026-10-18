import { useMemo, useSyncExternalStore } from "react";
import { CATEGORIES, type Category } from "./keypoints";

const ENABLED = "paper-keypoints";
const HIDDEN = "paper-keypoints-hidden";
const CHANGED = "keypoints-preference";

const read = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const write = (key: string, value: string | null) => {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Kept for this window only, below.
  }
  memory[key] = value;
  window.dispatchEvent(new Event(CHANGED));
};

/** What could not be stored (private windows, blocked storage) is still kept while the window is open. */
const memory: Record<string, string | null | undefined> = {};
const get = (key: string) =>
  memory[key] !== undefined ? memory[key]! : read(key);

const subscribe = (listener: () => void) => {
  window.addEventListener(CHANGED, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(CHANGED, listener);
    window.removeEventListener("storage", listener);
  };
};

/** Whether key sentences are looked for and marked on opening a paper: on unless the settings turn it off. */
export function useKeypointsEnabled(): [boolean, (on: boolean) => void] {
  const value = useSyncExternalStore(subscribe, () => get(ENABLED));
  return [value !== "off", (on) => write(ENABLED, on ? null : "off")];
}

const parse = (value: string | null): string => value ?? "";

/** The categories the reader has hidden (kept for every paper), and the way to hide or show one. */
export function useHiddenCategories(): [
  ReadonlySet<Category>,
  (category: Category) => void,
] {
  const raw = parse(useSyncExternalStore(subscribe, () => get(HIDDEN)));
  const hidden = useMemo(
    () =>
      new Set(
        raw
          .split(",")
          .filter((name): name is Category =>
            (CATEGORIES as readonly string[]).includes(name),
          ),
      ),
    [raw],
  );
  const toggle = (category: Category) => {
    const next = new Set(hidden);
    if (!next.delete(category)) next.add(category);
    write(HIDDEN, next.size ? [...next].join(",") : null);
  };
  return [hidden, toggle];
}
