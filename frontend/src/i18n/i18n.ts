import { en } from "./messages/en";
import { zh } from "./messages/zh";

export type Locale = "zh" | "en";
export const LOCALES: readonly Locale[] = ["zh", "en"];
export const LOCALE_KEY = "paper-locale";

export type MessageKey = keyof typeof en;
/** `"x.y"` for every pair of keys `"x.y#one"` / `"x.y#other"`: the messages `tn` reads. */
export type PluralBase = {
  [K in MessageKey]: K extends `${infer Base}#other` ? Base : never;
}[MessageKey];
export type Params = Record<string, string | number>;

export interface Translator {
  locale: Locale;
  t(key: MessageKey, params?: Params): string;
  /** The `#one` / `#other` form that `count` selects; `count` is also a parameter. */
  tn(key: PluralBase, count: number, params?: Params): string;
}

const catalogs: Record<Locale, { readonly [K in MessageKey]: string }> = {
  en,
  zh,
};

export function isLocale(value: unknown): value is Locale {
  return LOCALES.some((locale) => locale === value);
}

/** The stored choice if valid; else the first browser language that is Chinese or English; else English. */
export function detectLocale(
  stored: string | null,
  languages: readonly string[],
): Locale {
  if (isLocale(stored)) return stored;
  for (const language of languages) {
    // Match the language subtag, so "zh-TW" counts but "zha" (Zhuang) does not.
    const match = /^(zh|en)(?:[-_]|$)/i.exec(language);
    if (match) return match[1].toLowerCase() as Locale;
  }
  return "en";
}

function fill(template: string, params?: Params): string {
  if (!params) return template;
  // A parameter that was not passed stays as `{name}`, so the gap is easy to spot.
  return template.replace(/\{(\w+)\}/g, (hole, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : hole,
  );
}

export function createTranslator(locale: Locale): Translator {
  const catalog = catalogs[locale];
  const plurals = new Intl.PluralRules(locale);
  const t = (key: MessageKey, params?: Params): string =>
    fill(catalog[key] || en[key], params);
  return {
    locale,
    t,
    tn(key, count, params) {
      const form = `${key}#${plurals.select(count)}`;
      const picked = Object.hasOwn(en, form)
        ? (form as MessageKey)
        : `${key}#other`;
      return t(picked as MessageKey, { count, ...params });
    },
  };
}
