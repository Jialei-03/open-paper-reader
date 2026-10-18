import { useSyncExternalStore } from "react";
import { api } from "../api";

/** The model the reader asks with (the assistant, the translation, the guide). */
export interface ModelChoice {
  /** Its id; empty when there is none to ask with. */
  id: string;
  /** The settings have been read (or could not be). */
  known: boolean;
}

/** What the reader reads of `GET /translation-settings`. */
export type ModelSettings = {
  active_id?: string;
  /** Whether the active model has what it needs to answer (an address and a key). */
  configured?: boolean;
  models?: { id: string }[];
};

/**
 * The model chosen in the settings: the active one if it is listed, else the
 * first listed one. None when the active one is known not to be set up.
 */
export function chosenModel(settings: ModelSettings): string {
  const models = settings.models ?? [];
  const active = models.find((row) => row.id === settings.active_id)?.id;
  if (active) return settings.configured === false ? "" : active;
  return models[0]?.id ?? "";
}

const UNKNOWN: ModelChoice = { id: "", known: false };

/**
 * One reading of the settings for the whole screen, however many parts ask:
 * read when the first part asks, again when the settings change, and forgotten
 * when the last part has gone (the next screen reads them anew).
 */
let choice = UNKNOWN;
let users = 0;
let reading: AbortController | null = null;
const listeners = new Set<() => void>();

function settle(next: ModelChoice) {
  if (next.id === choice.id && next.known === choice.known) return;
  choice = next;
  for (const listener of [...listeners]) listener();
}

function read() {
  reading?.abort();
  const controller = new AbortController();
  reading = controller;
  api<ModelSettings>("/translation-settings", {
    signal: controller.signal,
  }).then(
    (settings) => {
      if (reading !== controller) return;
      reading = null;
      settle({ id: chosenModel(settings), known: true });
    },
    () => {
      if (reading !== controller) return;
      reading = null;
      settle({ id: "", known: true });
    },
  );
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (users++ === 0) {
    read();
    // The settings announce a model added or changed.
    window.addEventListener("model-settings-updated", read);
  }
  return () => {
    listeners.delete(listener);
    if (--users > 0) return;
    window.removeEventListener("model-settings-updated", read);
    reading?.abort();
    reading = null;
    choice = UNKNOWN;
  };
}

const snapshot = () => choice;

/** The model chosen in the settings, shared by every part of the reader that asks a model. */
export function useModel(): ModelChoice {
  return useSyncExternalStore(subscribe, snapshot);
}
