import { ApiError, api, send } from "../../api";
import type { MessageKey, Translator } from "../../i18n/i18n";

export type Protocol = "openai" | "anthropic";

/** One model of `GET /translation-settings`. */
export type ModelRow = {
  id: string;
  name: string;
  model: string;
  protocol: Protocol;
  base_url: string;
  shared?: boolean;
  badge?: string;
};

export type ModelSettings = {
  active_id: string;
  configured: boolean;
  models: ModelRow[];
  /** The hosts a model address may name. */
  allowed_hosts?: string[];
};

/** What the form sends: the service, the model and its key. */
export type ModelDraft = {
  protocol: Protocol;
  base_url: string;
  model: string;
  api_key: string;
};

/** A model running on this computer, reached at a fixed address. */
export const LOCAL_APPS = {
  ollama: "http://127.0.0.1:11434/v1",
  lmstudio: "http://127.0.0.1:1234/v1",
} as const;
export type LocalApp = keyof typeof LOCAL_APPS;

/**
 * The service needs a key for every model; a model on this computer asks for
 * none, so it gets a stand-in the local app ignores.
 */
export const LOCAL_KEY = "local";

/** Local models are only allowed where the service lets a model live on this computer (the local edition). */
export function allowsLocal(settings: ModelSettings | null): boolean {
  return !!settings?.allowed_hosts?.some(
    (host) => host === "127.0.0.1" || host === "localhost",
  );
}

/** Tells every part of the app that reads the model (`useModel`) to read it again. */
export function announceModels(): void {
  window.dispatchEvent(new Event("model-settings-updated"));
}

export const readModels = (signal?: AbortSignal) =>
  api<ModelSettings>("/translation-settings", { signal });

export async function listModels(draft: ModelDraft): Promise<string[]> {
  const value = await send("/translation-settings/models", {
    protocol: draft.protocol,
    base_url: draft.base_url.trim(),
    api_key: draft.api_key,
  });
  return Array.isArray(value?.models) ? value.models : [];
}

export const testModel = (id: string) =>
  send(`/translation-settings/configs/${id}/test`, {});

export const selectModel = (id: string): Promise<ModelSettings> =>
  send(`/translation-settings/configs/${id}/select`, {});

export const removeModel = (id: string): Promise<ModelSettings> =>
  send(`/translation-settings/configs/${id}`, {}, "DELETE");

/**
 * Adds the model, tests it, and makes it the current one. A model that does not
 * answer is taken off again, so a failed test leaves the settings as they were.
 */
export async function connectModel(draft: ModelDraft): Promise<{
  id: string;
  settings: ModelSettings;
}> {
  const before = await readModels();
  const known = new Set(before.models.map((row) => row.id));
  const added: ModelSettings = await send("/translation-settings/configs", {
    protocol: draft.protocol,
    base_url: draft.base_url.trim(),
    model: draft.model.trim(),
    api_key: draft.api_key,
  });
  const row = [...added.models]
    .reverse()
    .find((model) => !model.shared && !known.has(model.id));
  if (!row) throw new ApiError(500, "");
  try {
    await testModel(row.id);
  } catch (reason) {
    await removeModel(row.id).catch(() => undefined);
    throw reason;
  }
  const settings = await selectModel(row.id);
  announceModels();
  return { id: row.id, settings };
}

/**
 * The reason a request failed. The service explains in Chinese: the Chinese
 * interface shows its words, the English one says `fallback`.
 */
export function failure(
  reason: unknown,
  { t, locale }: Pick<Translator, "t" | "locale">,
  fallback: MessageKey,
): string {
  if (!(reason instanceof ApiError)) return t("reader.error.offline");
  if (locale === "zh" && reason.message) return reason.message;
  if (reason.status === 429) return t("reader.error.busy");
  return t(fallback);
}
