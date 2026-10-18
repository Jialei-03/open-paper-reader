import { expect, test, type Page, type Route } from "@playwright/test";
import { createPaperWithPdf, signIn } from "../reader/fixtures";

// The screens follow the browser's language; these specs read them in Chinese.
test.use({ locale: "zh-CN" });

const rec = (
  key: string,
  title: string,
  extra: Record<string, unknown> = {},
) => ({
  key,
  title,
  authors: ["Ada Lovelace", "Alan Turing", "Grace Hopper", "Edsger Dijkstra"],
  year: 2024,
  venue: "ICML",
  abstract: `Abstract for ${title}. It goes on for a while so the card has a body to show.`,
  citation_count: 321,
  doi: "",
  arxiv: "",
  url: "",
  why: [],
  ...extra,
});

/** Answers `/recommendations` (and the dismissals) from `state`; the calls are kept for the asserts. */
async function serve(
  page: Page,
  answer: (call: number, refresh: boolean) => unknown,
) {
  const log = {
    gets: [] as string[],
    dismissed: [] as string[],
    restored: [] as string[],
  };
  await page.route("**/api/v1/discover/**", (route: Route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (url.pathname.endsWith("/dismissed")) {
      if (method === "POST")
        log.dismissed.push(route.request().postDataJSON().key);
      else log.restored.push(url.searchParams.get("key")!);
      return route.fulfill({ json: { ok: true } });
    }
    log.gets.push(url.search);
    return route.fulfill({
      json: answer(log.gets.length, url.searchParams.get("refresh") === "true"),
    });
  });
  return log;
}

async function setup(page: Page) {
  await page.route("**/api/v1/translation-settings", (route) =>
    route.fulfill({
      json: {
        active_id: "model-1",
        configured: true,
        models: [{ id: "model-1" }],
      },
    }),
  );
  await signIn(page);
  return createPaperWithPdf(page, { pages: 1, title: "Memory for Agents" });
}

test("recommendations show why, and can be previewed, added or dismissed", async ({
  page,
}) => {
  const seed = await setup(page);
  const items = [
    rec("arxiv:2402.00002", "Long-term Memory in Language Agents", {
      arxiv: "2402.00002",
      why: [{ paper_id: seed.paperId, title: "Memory for Agents" }],
    }),
    rec("doi:10.1234/book", "A Book Chapter Without arXiv", {
      doi: "10.1234/book",
      why: [{ paper_id: seed.paperId, title: "Memory for Agents" }],
    }),
  ];
  const log = await serve(page, () => ({
    state: "ok",
    items,
    source: "Semantic Scholar",
    fetched_at: "2026-10-19T08:30:00+00:00",
  }));
  let imported = "";
  await page.route("**/api/v1/import/arxiv/progress/**", (route) =>
    route.fulfill({ status: 404, json: { detail: "none" } }),
  );
  await page.route("**/api/v1/import/arxiv", (route) => {
    imported = route.request().postDataJSON().url;
    return route.fulfill({ json: { id: "added-1", title: "x" } });
  });

  // The sidebar leads there.
  await page.getByRole("link", { name: "发现", exact: true }).click();
  await expect(page).toHaveURL(/#discover$/);
  const cards = page
    .getByRole("list", { name: "推荐的论文" })
    .getByRole("listitem");
  await expect(cards).toHaveCount(2);
  await expect(cards.first()).toContainText(
    "Long-term Memory in Language Agents",
  );
  await expect(cards.first()).toContainText(
    "Ada Lovelace, Alan Turing, Grace Hopper",
  );
  await expect(cards.first()).toContainText("被引 321 次");
  await expect(cards.first()).toContainText("相关的文库论文");
  await expect(
    cards.first().getByRole("link", { name: "Memory for Agents" }),
  ).toHaveAttribute("href", new RegExp(`#read/${seed.paperId}`));
  await expect(page.getByRole("main")).toContainText("来源：Semantic Scholar");
  expect(log.gets[0]).toContain("limit=30");

  // Not addable without arXiv, and it says why.
  await expect(
    cards.nth(1).getByRole("button", { name: /加入文库/ }),
  ).toBeDisabled();
  await expect(cards.nth(1)).toContainText("没有 arXiv 版本，无法一键加入。");

  // Preview beside, from the abstract.
  await cards.first().getByRole("button", { name: /预览/ }).click();
  const side = page.getByRole("complementary", { name: "被引论文预览" });
  await expect(side).toContainText("Abstract for Long-term Memory");
  await page.keyboard.press("Escape");
  await expect(side).toBeHidden();

  // Add: through the arXiv import.
  await cards
    .first()
    .getByRole("button", { name: /加入文库/ })
    .click();
  await expect.poll(() => imported).toBe("2402.00002");
  await expect(
    cards.first().getByRole("link", { name: /已在文库/ }),
  ).toBeVisible();

  // Not interested: gone at once, kept by the server, and undone from the toast.
  await cards
    .nth(1)
    .getByRole("button", { name: /不感兴趣/ })
    .click();
  await expect(cards).toHaveCount(1);
  expect(log.dismissed).toEqual(["doi:10.1234/book"]);
  await page.getByRole("button", { name: "撤销" }).click();
  await expect(cards).toHaveCount(2);
  expect(log.restored).toEqual(["doi:10.1234/book"]);
  await expect(cards.nth(1)).toContainText("A Book Chapter Without arXiv");

  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.screenshot({
      path: `../test-results/m5-discover-${scheme}.png`,
    });
  }
});

test("each state of the screen says what it is", async ({ page }) => {
  await setup(page);
  let mode = "no_seeds";
  const log = await serve(page, (_call, refresh) => {
    if (mode === "ok")
      return {
        state: "ok",
        items: [],
        source: "OpenAlex",
        fetched_at: "2026-10-19T08:30:00+00:00",
      };
    if (mode === "refreshed")
      return {
        state: "ok",
        items: [
          rec("arxiv:2402.00002", "After a refresh", { arxiv: "2402.00002" }),
        ],
        stale: refresh ? null : "unavailable",
        fetched_at: "2026-10-19T08:30:00+00:00",
      };
    return { state: mode, items: [] };
  });
  const main = page.getByRole("main");
  const show = async (next: string) => {
    mode = next;
    await page.goto("/#discover");
    await page.reload();
  };
  await show("no_seeds");
  await expect(main).toContainText("还没有可以用来推荐的论文");
  await expect(main).toContainText("DOI 或 arXiv 标识");
  await main.getByRole("button", { name: "去文库" }).click();
  await expect(page).toHaveURL(/#library$/);

  await show("offline");
  await expect(main).toContainText("离线模式");
  await show("unavailable");
  await expect(main).toContainText("连不上论文服务");
  await expect(main).toContainText("Semantic Scholar 和 OpenAlex 都没有回应");
  await show("ok");
  await expect(main).toContainText("暂时没有新的推荐");
  // Refresh asks the service to look again.
  mode = "refreshed";
  await main.getByRole("button", { name: "刷新" }).click();
  await expect(main.getByRole("listitem")).toContainText("After a refresh");
  expect(log.gets.at(-1)).toContain("refresh=true");
});

test("home shows three suggestions that lead to the screen, or nothing", async ({
  page,
}) => {
  await setup(page);
  const many = Array.from({ length: 5 }, (_, i) =>
    rec(`arxiv:2402.0000${i}`, `Suggested paper number ${i}`, {
      arxiv: `2402.0000${i}`,
    }),
  );
  await serve(page, (_call) => ({
    state: "ok",
    items: many,
    fetched_at: "2026-10-19T08:30:00+00:00",
  }));
  await page.goto("/#home");
  await page.reload();
  const strip = page.getByTestId("home-recommend");
  await expect(strip.getByRole("heading", { name: "为你推荐" })).toBeVisible();
  await expect(strip.getByRole("listitem")).toHaveCount(3);
  await strip.getByRole("link", { name: "查看全部" }).click();
  await expect(page).toHaveURL(/#discover$/);

  // Offline (or nothing to suggest): home is as it was.
  await page.unroute("**/api/v1/discover/**");
  await serve(page, () => ({ state: "offline", items: [] }));
  await page.goto("/#home");
  await page.reload();
  await expect(page.getByRole("heading", { name: "最近导入" })).toBeVisible();
  await expect(page.getByTestId("home-recommend")).toHaveCount(0);
});
