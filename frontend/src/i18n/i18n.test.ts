import { describe, expect, it } from "vitest";
import { createTranslator, detectLocale } from "./i18n";
import { en } from "./messages/en";
import { zh } from "./messages/zh";

describe("detectLocale", () => {
  it("prefers the stored choice, then the browser, then English", () => {
    expect(detectLocale("en", ["zh-CN"])).toBe("en");
    expect(detectLocale(null, ["zh-TW", "en"])).toBe("zh");
    expect(detectLocale("fr", ["de-DE", "en-GB"])).toBe("en");
    expect(detectLocale(null, ["ja"])).toBe("en");
  });
});
describe("translator", () => {
  it("interpolates and pluralizes per locale", () => {
    const e = createTranslator("en"),
      z = createTranslator("zh");
    expect(e.tn("kit.sample.pages", 1)).toBe("Read 1 page");
    expect(e.tn("kit.sample.pages", 3)).toBe("Read 3 pages");
    expect(z.tn("kit.sample.pages", 1)).toBe("读了 1 页");
    expect(e.t("common.close")).toBe("Close");
  });
  it("leaves a missing parameter visible", () => {
    expect(createTranslator("en").t("kit.sample.pages#other")).toBe(
      "Read {count} pages",
    );
  });
});
describe("catalogs", () => {
  const holes = (s: string) =>
    [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  it("zh has every key, non-empty, with the same placeholders as en", () => {
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(zh[key], key).toBeTruthy();
      expect(holes(zh[key]), key).toEqual(holes(en[key]));
    }
  });
});

describe("translator details", () => {
  it("fills named parameters, and only those", () => {
    const e = createTranslator("en");
    expect(e.t("kit.sample.pages#other", { count: 5 })).toBe("Read 5 pages");
    // A name that happens to exist on every object is still a missing parameter.
    expect(e.t("kit.sample.pages#other", { toString: "x" })).toBe(
      "Read {count} pages",
    );
  });
  it("falls back to English where the Chinese text is empty", () => {
    const catalog: Record<string, string> = zh;
    const saved = catalog["common.close"];
    catalog["common.close"] = "";
    try {
      expect(createTranslator("zh").t("common.close")).toBe("Close");
    } finally {
      catalog["common.close"] = saved;
    }
  });
});
// Compile-time checks: `tsc` (npm run check) is what enforces the @ts-expect-error lines.
describe("catalog types", () => {
  it("do not compile with a missing or an extra Chinese key", () => {
    const { "common.close": omitted, ...rest } = zh;
    // @ts-expect-error a key that English has is missing
    const missing: typeof zh = rest;
    // @ts-expect-error a key that English does not have
    const extra: typeof zh = { ...zh, "no.such.key": "x" };
    expect([omitted, missing, extra]).toBeTruthy();
  });
  it("only let tn read a message that has a plural pair", () => {
    // @ts-expect-error "common.close" has no #one / #other pair
    const read = () => createTranslator("en").tn("common.close", 1);
    expect(read).toBeTypeOf("function");
  });
});
