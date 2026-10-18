import { useCallback, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider";

/** How the paper is read: as it is, beside its translation page by page, or as a translated PDF. */
export type ReadingMode = "original" | "parallel" | "translated";

/** The language a paper is translated into. */
export type TranslationLanguage = "zh" | "en";

/** Where the chosen language is kept, for the next paper and the next visit. */
export const LANGUAGE_KEY = "paper-translation-language";

export function isLanguage(value: unknown): value is TranslationLanguage {
  return value === "zh" || value === "en";
}

function readStored(): TranslationLanguage | null {
  try {
    const value = localStorage.getItem(LANGUAGE_KEY);
    return isLanguage(value) ? value : null;
  } catch {
    return null;
  }
}

function writeStored(language: TranslationLanguage): void {
  try {
    localStorage.setItem(LANGUAGE_KEY, language);
  } catch {
    /* Private mode: the choice lasts until the page is left. */
  }
}

/**
 * The language to translate into: the one chosen before (kept in the browser),
 * else the language of the interface.
 */
export function useTranslationLanguage(): [
  TranslationLanguage,
  (language: TranslationLanguage) => void,
] {
  const { locale } = useI18n();
  const [chosen, setChosen] = useState<TranslationLanguage | null>(readStored);
  const choose = useCallback((language: TranslationLanguage) => {
    setChosen(language);
    writeStored(language);
  }, []);
  return [chosen ?? locale, choose];
}
