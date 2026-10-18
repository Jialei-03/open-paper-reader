import { useSyncExternalStore } from "react";
import { api } from "../../api";

/** A model the person has set up, as the settings list it. */
export interface TranslationModel {
  id: string;
  name: string;
  model: string;
}

export interface TranslationSettings {
  models: TranslationModel[];
  /** The model the settings have chosen; empty when there is none. */
  activeId: string;
  /** The service can translate a PDF with its layout kept (`pdf_layout_enabled`). */
  layoutEnabled: boolean;
  /** The first answer (or the first failure) has come. */
  loaded: boolean;
}

type Answer = {
  models?: TranslationModel[];
  active_id?: string;
  configured?: boolean;
  pdf_layout_enabled?: boolean;
};

const NOTHING: TranslationSettings = {
  models: [],
  activeId: "",
  layoutEnabled: false,
  loaded: false,
};

/** The model a task is run with: the one asked for if the settings still have it, else the settings' own. */
export function resolveModel(
  settings: Pick<TranslationSettings, "models" | "activeId">,
  asked: string | null,
): string {
  if (asked && settings.models.some((model) => model.id === asked))
    return asked;
  return settings.activeId;
}

// The parts of the reader that ask (the menu, the translation, the strip's fold) share one reading of the
// settings: it is made while any of them is on the screen, and again when a model is added or changed.
let current = NOTHING;
const listeners = new Set<() => void>();
let reading: AbortController | null = null;

function read() {
  reading?.abort();
  const controller = (reading = new AbortController());
  api<Answer>("/translation-settings", { signal: controller.signal }).then(
    (answer) => {
      const models = answer.models ?? [];
      const active = models.find((model) => model.id === answer.active_id);
      current = {
        models,
        // A service with no usable key says so (`configured`): then no model is in use.
        activeId: answer.configured === false ? "" : (active?.id ?? ""),
        layoutEnabled: answer.pdf_layout_enabled === true,
        loaded: true,
      };
      listeners.forEach((listener) => listener());
    },
    () => {
      if (controller.signal.aborted) return;
      current = { ...current, loaded: true };
      listeners.forEach((listener) => listener());
    },
  );
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    // What was read before the last one left may be out of date: it is read again.
    current = { ...current, loaded: false };
    read();
    window.addEventListener("model-settings-updated", read);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      reading?.abort();
      reading = null;
      window.removeEventListener("model-settings-updated", read);
    }
  };
}

/**
 * What the settings say about translating: the models there are, which one is
 * in use, and whether the layout translation is switched on. Read when the
 * first part that needs it appears, and again when a model is added or changed
 * in the settings.
 */
export function useTranslationSettings(): TranslationSettings {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => NOTHING,
  );
}
