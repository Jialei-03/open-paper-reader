import { ApiError } from "../api";
import type { MessageKey, Translator } from "../i18n/i18n";

/** What a status says in any language, when the service's own words are not shown. */
function statusKey(status: number): MessageKey | null {
  if (status === 401) return "reader.error.signedOut";
  if (status === 403) return "reader.error.forbidden";
  if (status === 404) return "reader.error.missing";
  if (status === 413) return "reader.error.tooLarge";
  if (status === 429) return "reader.error.busy";
  if (status >= 500) return "reader.error.server";
  return null;
}

/**
 * Why something asked of the service did not happen, in the interface's
 * language. The service gives its reasons in Chinese: the Chinese interface
 * shows them as they are, the English one says what the status means (else
 * `fallback`, else that the service refused, with the status). No answer at
 * all is the connection (`offline`, else the catalog's word for it).
 */
export function serviceReason(
  reason: unknown,
  { t, locale }: Pick<Translator, "t" | "locale">,
  options: { fallback?: MessageKey; offline?: MessageKey } = {},
): string {
  if (!(reason instanceof ApiError))
    return t(options.offline ?? "reader.error.offline");
  if (locale === "zh" && reason.message) return reason.message;
  const status = reason.status;
  const key = statusKey(status) ?? options.fallback ?? "reader.error.service";
  return t(key, { status });
}

/** The service's own words (a failed run's or artifact's reason) where the interface may show them: in Chinese only. */
export const serviceWords = (
  text: string | undefined | null,
  { locale }: Pick<Translator, "locale">,
): string => (locale === "zh" ? (text ?? "") : "");
