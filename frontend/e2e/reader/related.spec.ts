import { expect, test, type Page } from "@playwright/test";
import { createPaperWithPdf, openReader, signIn } from "./fixtures";

// The interface follows the browser's language; these specs read it in Chinese.
test.use({ locale: "zh-CN" });

const work = (title: string, extra: Record<string, unknown> = {}) => ({
  title,
  abstract: `Abstract of ${title}`,
  authors: ["Ashish Vaswani", "Noam Shazeer", "Niki Parmar", "Jakob Uszkoreit"],
  year: 2017,
  doi: "",
  arxiv: "",
  s2_id: title,
  venue: "NeurIPS",
  citation_count: 1234,
  ...extra,
});

const ATTENTION = work("Attention Is All You Need", {
  arxiv: "1706.03762",
  citation_count: 123456,
});
const BERT = work("BERT: Pre-training of Deep Bidirectional Transformers", {
  arxiv: "1810.04805",
  year: 2018,
  venue: "NAACL",
  authors: ["Jacob Devlin"],
});
const BOOK = work("A Printed Book Without Any Open Version", { year: 1999 });
const LATE = work("Layer Normalization", { arxiv: "1607.06450", year: 2016 });
const CITER = work("A Later Paper That Cites This One", {
  arxiv: "2401.00001",
  year: 2024,
});

const panel = (page: Page) => page.getByRole("tabpanel", { name: "相关" });

/** A library paper that is the same work as ATTENTION, so the row says it is there already. */
async function addToLibrary(page: Page) {
  const csrf = (await page.context().cookies()).find(
    (c) => c.name === "paper_csrf",
  )!.value;
  const response = await page.request.post("/api/v1/papers", {
    headers: { "X-CSRF-Token": csrf, "Idempotency-Key": crypto.randomUUID() },
    data: {
      title: "Attention Is All You Need",
      external_id: "arxiv:1706.03762v7",
      authors: "",
      tags: [],
      abstract: "",
    },
  });
  expect(response.ok()).toBeTruthy();
  return (await response.json()).id as string;
}

async function open(page: Page) {
  await signIn(page);
  const library = await addToLibrary(page);
  const paper = await createPaperWithPdf(page, { pages: 2 });
  const asked: string[] = [];
  await page.route("**/api/v1/papers/*/citations?**", (route) => {
    const url = new URL(route.request().url());
    const relation = url.searchParams.get("relation");
    const offset = url.searchParams.get("offset");
    asked.push(`${relation}:${offset}`);
    if (relation === "citations")
      return route.fulfill({ json: { items: [CITER], next: null } });
    return offset === "0"
      ? route.fulfill({
          json: { items: [ATTENTION, BERT, BOOK], next: 50 },
        })
      : route.fulfill({ json: { items: [LATE], next: null } });
  });
  await openReader(page, { paperId: paper.paperId });
  await expect(page.locator('[data-page="1"]')).toHaveAttribute(
    "data-rendered",
    "true",
  );
  return { asked, library, paper };
}

test("the Related tab lists references and citing papers, a page at a time", async ({
  page,
}) => {
  const { asked, library } = await open(page);
  // Nothing is asked until the tab is chosen.
  expect(asked).toEqual([]);
  await page.getByRole("tab", { name: "相关" }).click();
  const rows = panel(page).getByRole("listitem");
  await expect(rows.first()).toContainText("Attention Is All You Need");
  await expect(rows.first()).toContainText("Ashish Vaswani, Noam Shazeer");
  await expect(rows.first()).toContainText("NeurIPS");
  await expect(rows.first()).toContainText("2017");
  await expect(rows.first()).toContainText("被引 123,456 次");

  // In the library already: marked, and a way to open it.
  await expect(
    rows.first().getByRole("link", { name: /已在文库/ }),
  ).toHaveAttribute("href", new RegExp(`#read/${library}`));
  await expect(
    rows.first().getByRole("button", { name: /加入文库/ }),
  ).toHaveCount(0);
  // Addable from arXiv; not addable without it, and it says why.
  await expect(
    rows.nth(1).getByRole("button", { name: /加入文库/ }),
  ).toBeEnabled();
  const noArxiv = rows.nth(2).getByRole("button", { name: /加入文库/ });
  await expect(noArxiv).toBeDisabled();
  await expect(rows.nth(2)).toContainText("没有 arXiv 版本，无法一键加入。");

  // The end of the list coming into view asks for the next page.
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(3)).toContainText("Layer Normalization");
  expect(asked).toEqual(["references:0", "references:50"]);
  await expect(
    panel(page).getByRole("button", { name: "加载更多" }),
  ).toHaveCount(0);

  // The filter looks at what is loaded.
  await panel(page).getByRole("searchbox").fill("bert");
  await expect(rows).toHaveCount(1);
  await panel(page).getByRole("searchbox").fill("zzzz");
  await expect(panel(page)).toContainText("已加载的论文里没有匹配“zzzz”的");
  await panel(page).getByRole("searchbox").fill("");

  // The other list, with its own state.
  await panel(page).getByRole("radio", { name: "被引用" }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("A Later Paper That Cites This One");
  expect(asked).toEqual(["references:0", "references:50", "citations:0"]);
  await panel(page).getByRole("radio", { name: "参考文献" }).click();
  await expect(rows).toHaveCount(4);
  expect(asked).toHaveLength(3);
});

test("preview opens beside the paper and adding goes through the arXiv import", async ({
  page,
}) => {
  let imported = "";
  await page.route("**/api/v1/import/arxiv/progress/**", (route) =>
    route.fulfill({ status: 404, json: { detail: "none" } }),
  );
  await page.route("**/api/v1/import/arxiv", async (route) => {
    imported = route.request().postDataJSON().url;
    return route.fulfill({ json: { id: "imported-1", title: BERT.title } });
  });
  await open(page);
  await page.getByRole("tab", { name: "相关" }).click();
  const row = panel(page).getByRole("listitem").nth(1);
  await row.getByRole("button", { name: /预览/ }).click();
  const side = page.getByRole("complementary", { name: "被引论文预览" });
  await expect(side).toBeVisible();
  await expect(side).toContainText("BERT: Pre-training");
  await expect(side).toContainText("Abstract of BERT");
  await page.keyboard.press("Escape");
  await expect(side).toBeHidden();

  await row.getByRole("button", { name: /加入文库/ }).click();
  await expect.poll(() => imported).toBe("1810.04805");
  await expect(row.getByRole("link", { name: /已在文库/ })).toBeVisible();
});

test("a paper with no public id, and a service that is down, say what is wrong", async ({
  page,
}) => {
  await signIn(page);
  const paper = await createPaperWithPdf(page, { pages: 1 });
  let calls = 0;
  await page.route("**/api/v1/papers/*/citations?**", (route) => {
    calls += 1;
    return calls === 1
      ? route.fulfill({
          status: 422,
          json: { detail: "请先在论文信息中填写 DOI 或 arXiv 标识" },
        })
      : calls === 2
        ? route.fulfill({
            status: 503,
            json: { detail: "引用服务暂不可用，请稍后重试" },
          })
        : route.fulfill({ json: { items: [BERT], next: null } });
  });
  await openReader(page, { paperId: paper.paperId });
  await page.getByRole("tab", { name: "相关" }).click();
  await expect(panel(page)).toContainText(
    "在论文信息里填上 DOI 或 arXiv 标识后，就能看到相关论文。",
  );
  // Switching away and back asks again (nothing was loaded); a down service can be retried.
  await panel(page).getByRole("radio", { name: "被引用" }).click();
  await expect(panel(page)).toContainText("暂时连不上引用服务。");
  await panel(page).getByRole("button", { name: "重试" }).click();
  await expect(panel(page).getByRole("listitem")).toHaveCount(1);
});

for (const scheme of ["light", "dark"] as const) {
  test(`looks right in ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await open(page);
    await page.getByRole("tab", { name: "相关" }).click();
    await expect(panel(page).getByRole("listitem")).toHaveCount(4);
    await page.screenshot({ path: `../test-results/m5-related-${scheme}.png` });
  });
}
