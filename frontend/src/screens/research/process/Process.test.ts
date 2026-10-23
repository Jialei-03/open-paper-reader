import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "../../../i18n/I18nProvider";
import { createTranslator } from "../../../i18n/i18n";
import { en } from "../../../i18n/messages/en";
import { zh } from "../../../i18n/messages/zh";
import { LiveCard } from "./Process";
import type { ResearchRun } from "./model";

const run: ResearchRun = {
  id: "run",
  role: "advisor",
  status: "running",
  response: "",
  error: "",
  steps: [],
  runtime: {},
  created_at: "2026-10-23T00:00:00Z",
  updated_at: "2026-10-23T00:00:00Z",
};

describe("research role names and short tool labels", () => {
  for (const locale of ["zh", "en"] as const) {
    const t = createTranslator(locale).t;
    const render = (name?: string) =>
      renderToStaticMarkup(
        createElement(I18nProvider, {
          locale,
          children: createElement(LiveCard, {
            run: {
              ...run,
              steps: name
                ? [
                    {
                      name,
                      label: "Long tool description must never appear",
                      status: "running",
                      arguments: { path: "train.py" },
                    },
                  ]
                : [],
            },
            role: "advisor",
            name: t("research.role.advisor"),
          }),
        }),
      );
    it(`${locale} uses the same advisor name in live status and round titles`, () => {
      const name = locale === "zh" ? "导师" : "Advisor";
      expect(t("research.role.advisor")).toBe(name);
      expect(t("research.role.discussion")).toBe(name);
      expect(t("research.role.review")).toBe(name);
      expect(t("research.work.advisor", { n: 4 })).toContain(name);
      expect(render()).toContain(name);
    });
    it(`${locale} renders short verbs even for old or unknown tool descriptions`, () => {
      for (const name of [
        "project_overview",
        "research_read",
        "unknown_tool",
      ] as const) {
        const html = render(name);
        expect(html).not.toContain("Long tool description");
        expect(html).toContain(
          name === "unknown_tool" ? name : t(`research.tool.${name}`),
        );
      }
    });
  }
  it("keeps all catalogued tool labels short in both languages", () => {
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      if (!key.startsWith("research.tool.")) continue;
      expect(zh[key].length, key).toBeGreaterThanOrEqual(2);
      expect(zh[key].length, key).toBeLessThanOrEqual(6);
      expect(en[key].split(" ").length, key).toBeLessThanOrEqual(3);
    }
  });
});
