import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider, useI18n } from "./I18nProvider";

// The words a component renders, from `useI18n`, with or without a Provider above it.
function Probe() {
  const { t, tn } = useI18n();
  return createElement(
    "p",
    null,
    `${t("common.close")} / ${tn("kit.sample.pages", 3)}`,
  );
}
const render = (locale?: "zh" | "en") =>
  renderToString(
    locale
      ? createElement(I18nProvider, { locale, children: createElement(Probe) })
      : createElement(Probe),
  ).replace(/<[^>]+>/g, "");

// Nothing stored, unless a test says otherwise (Node's own localStorage warns when touched).
beforeEach(() => vi.stubGlobal("localStorage", { getItem: () => null }));
afterEach(() => vi.unstubAllGlobals());

describe("useI18n", () => {
  it("uses the Provider's language", () => {
    vi.stubGlobal("navigator", { languages: ["en"] });
    expect(render("zh")).toBe("关闭 / 读了 3 页");
    expect(render("en")).toBe("Close / Read 3 pages");
  });
  it("without a Provider, follows the browser language", () => {
    vi.stubGlobal("navigator", { languages: ["zh-CN", "en"] });
    expect(render()).toBe("关闭 / 读了 3 页");
    vi.stubGlobal("navigator", { languages: ["fr", "en-GB"] });
    expect(render()).toBe("Close / Read 3 pages");
  });
  it("without a Provider, a stored choice beats the browser", () => {
    vi.stubGlobal("navigator", { languages: ["zh-CN"] });
    vi.stubGlobal("localStorage", { getItem: () => "en" });
    expect(render()).toBe("Close / Read 3 pages");
  });
  it("without a Provider, unreadable storage does not throw", () => {
    vi.stubGlobal("navigator", { languages: ["zh-CN"] });
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("denied");
      },
    });
    expect(render()).toBe("关闭 / 读了 3 页");
  });
});
