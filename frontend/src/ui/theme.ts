import { useSyncExternalStore } from "react";

export type Appearance = "system" | "light" | "dark";
export type Theme = "light" | "dark";

// The same key the old interface has always used, so a stored choice carries over.
export const APPEARANCE_KEY = "paper-appearance";

export function resolveTheme(mode: Appearance, systemDark: boolean): Theme {
  if (mode === "system") return systemDark ? "dark" : "light";
  return mode;
}

export function parseAppearance(value: string | null): Appearance {
  return value === "light" || value === "dark" ? value : "system";
}

export function applyTheme(
  theme: Theme,
  root: HTMLElement = document.documentElement,
): void {
  root.setAttribute("data-theme", theme);
  // The old stylesheets key off `.dark`; keep it in step until they are retired.
  root.classList.toggle("dark", theme === "dark");
  root.style.colorScheme = theme;
}

function readStored(): Appearance {
  try {
    return parseAppearance(localStorage.getItem(APPEARANCE_KEY));
  } catch {
    return "system";
  }
}

interface State {
  mode: Appearance;
  theme: Theme;
}

const listeners = new Set<() => void>();
let systemDark = false;
let state: State = { mode: "system", theme: "light" };

function publish(mode: Appearance): void {
  const theme = resolveTheme(mode, systemDark);
  applyTheme(theme);
  if (mode === state.mode && theme === state.theme) return;
  // A new object only when something changed: useSyncExternalStore compares by identity.
  state = { mode, theme };
  listeners.forEach((listener) => listener());
}

// Module scripts and unit tests without a DOM import this file too.
if (typeof window !== "undefined" && typeof document !== "undefined") {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  systemDark = media.matches;
  publish(readStored());
  // Following the system means switching the moment the OS does.
  media.addEventListener("change", (event) => {
    systemDark = event.matches;
    publish(state.mode);
  });
  // Another tab changed the choice (a null key means storage was cleared).
  window.addEventListener("storage", (event) => {
    if (event.key === APPEARANCE_KEY || event.key === null)
      publish(readStored());
  });
}

export function getAppearance(): Appearance {
  return state.mode;
}

export function setAppearance(mode: Appearance): void {
  try {
    localStorage.setItem(APPEARANCE_KEY, mode);
  } catch {
    /* Stay usable without storage (private mode). */
  }
  publish(mode);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useAppearance(): {
  mode: Appearance;
  theme: Theme;
  setMode(mode: Appearance): void;
} {
  const { mode, theme } = useSyncExternalStore(subscribe, () => state);
  return { mode, theme, setMode: setAppearance };
}
