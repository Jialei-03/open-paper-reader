import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  LOCALE_KEY,
  createTranslator,
  detectLocale,
  type Locale,
  type Translator,
} from "./i18n";

export type I18n = Translator & { setLocale(locale: Locale): void };

const HTML_LANG: Record<Locale, string> = { zh: "zh-CN", en: "en" };

function readStored(): string | null {
  try {
    return localStorage.getItem(LOCALE_KEY);
  } catch {
    return null;
  }
}

function writeStored(locale: Locale): void {
  try {
    localStorage.setItem(LOCALE_KEY, locale);
  } catch {
    /* Stay usable without storage (private mode). */
  }
}

function detectBrowserLocale(): Locale {
  return detectLocale(readStored(), navigator.languages);
}

const I18nContext = createContext<I18n | null>(null);

// What a component gets when no Provider is above it (the old interface, which
// has none): one shared value per locale, so its identity is stable across renders.
const fallbacks = new Map<Locale, I18n>();

function fallbackFor(locale: Locale): I18n {
  let value = fallbacks.get(locale);
  if (!value) {
    // Nothing can change the language here, so `setLocale` does nothing.
    value = { ...createTranslator(locale), setLocale() {} };
    fallbacks.set(locale, value);
  }
  return value;
}

/**
 * Owns the interface language. Without a `locale` it starts from the stored
 * choice, else the browser's language; a given `locale` is only the starting
 * point (for tests and the kit). Detection is not stored: only a choice made
 * with `setLocale` is, so a first visit keeps following the browser.
 */
export function I18nProvider({
  children,
  locale: initial,
}: {
  children: ReactNode;
  locale?: Locale;
}) {
  const [locale, setCurrent] = useState<Locale>(
    () => initial ?? detectBrowserLocale(),
  );
  useEffect(() => {
    document.documentElement.lang = HTML_LANG[locale];
  }, [locale]);
  const setLocale = useCallback((next: Locale) => {
    writeStored(next);
    setCurrent(next);
  }, []);
  const value = useMemo<I18n>(
    () => ({ ...createTranslator(locale), setLocale }),
    [locale, setLocale],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const provided = useContext(I18nContext);
  // Without a Provider, detect once per component instance rather than on every
  // render, since detection reads storage.
  return useMemo(
    () => provided ?? fallbackFor(detectBrowserLocale()),
    [provided],
  );
}
