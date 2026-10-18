import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  createPaperWithPdf,
  openReader,
  pdfWithPages,
  signIn,
} from "./fixtures";

// The interface follows the browser's language; these specs read it in Chinese.
test.use({ locale: "zh-CN" });

const pdfPage = (page: Page, number: number) =>
  page.locator(`[data-page="${number}"]`);
const pageInput = (page: Page) =>
  page.getByRole("main").getByRole("textbox", { name: "页码", exact: true });
const backButton = (page: Page) =>
  page
    .getByRole("main")
    .getByRole("button", { name: "返回跳转前的位置", exact: true });
const card = (page: Page) => page.getByRole("dialog", { name: "被引文献" });
const panel = (page: Page) =>
  page.getByRole("complementary", { name: "被引论文预览" });

const ENTRY = "A. Vaswani et al. Attention is all you need. NeurIPS 2017.";
const WORK = {
  title: "Attention Is All You Need",
  authors: ["Ashish Vaswani", "Noam Shazeer", "Niki Parmar", "Jakob Uszkoreit"],
  year: 2017,
  venue: "NeurIPS",
  abstract:
    "The dominant sequence transduction models are based on recurrent networks.",
  citation_count: 123456,
  reference_count: 40,
  doi: "10.5555/3295222.3295349",
  arxiv: "1706.03762",
  url: "https://www.semanticscholar.org/paper/x",
};

/** Where the middle of an element is, as the mouse takes it (the link boxes let the pointer through). */
async function centre(element: Locator) {
  const box = (await element.boundingBox())!;
  return {
    x: Math.round(box.x + box.width / 2),
    y: Math.round(box.y + box.height / 2),
  };
}

/** A paper with one citation in its first page; the external services are all answered here. */
async function open(
  page: Page,
  lookup: (
    asked: string[],
  ) => Parameters<Parameters<Page["route"]>[1]>[0] extends infer R
    ? (route: R) => unknown
    : never,
) {
  await signIn(page);
  const paper = await createPaperWithPdf(page, {
    pages: 3,
    citations: [{ from: 1, to: 3, key: "vaswani2017", entry: ENTRY }],
  });
  const asked: string[] = [];
  await page.route("**/api/v1/citations/lookup?**", (route) => {
    asked.push(new URL(route.request().url()).searchParams.get("entry") ?? "");
    return (lookup(asked) as (route: unknown) => unknown)(route);
  });
  await openReader(page, { paperId: paper.paperId });
  const first = pdfPage(page, 1);
  await expect(first).toHaveAttribute("data-rendered", "true");
  const link = first.getByRole("button", { name: "跳到所引文献", exact: true });
  return { asked, link, spot: await centre(link) };
}

test("hovering a citation opens a card with the cited work", async ({
  page,
}) => {
  const { asked, spot } = await open(
    page,
    () => (route: any) => route.fulfill({ json: { item: WORK } }),
  );
  await page.mouse.move(spot.x, spot.y);
  // Not at once: the pointer may only be passing.
  await page.waitForTimeout(120);
  await expect(card(page)).toHaveCount(0);
  await expect(card(page)).toBeVisible();
  await expect(card(page)).toContainText("Attention Is All You Need");
  await expect(card(page)).toContainText(
    "Ashish Vaswani, Noam Shazeer, Niki Parmar 等",
  );
  await expect(card(page)).toContainText("NeurIPS");
  await expect(card(page)).toContainText("2017");
  await expect(card(page)).toContainText("被引 123,456 次");
  await expect(card(page)).toContainText("参考文献 40 篇");
  await expect(card(page)).toContainText("The dominant sequence transduction");
  // The entry as the paper prints it, and the links out.
  await expect(card(page)).toContainText(
    "Attention is all you need. NeurIPS 2017.",
  );
  await expect(
    card(page).getByRole("link", { name: "arXiv:1706.03762" }),
  ).toHaveAttribute("href", "https://arxiv.org/abs/1706.03762");
  await expect(card(page).getByRole("link", { name: "DOI" })).toHaveAttribute(
    "href",
    "https://doi.org/10.5555/3295222.3295349",
  );
  expect(asked).toHaveLength(1);
  expect(asked[0]).toContain("Attention is all you need");

  // The pointer can cross to the card, which stays while it is on it.
  const box = (await card(page).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 12, { steps: 6 });
  await page.waitForTimeout(500);
  await expect(card(page)).toBeVisible();
  // Away from both: it goes. Again: the answer is remembered.
  await page.mouse.move(5, 5);
  await expect(card(page)).toBeHidden();
  await page.mouse.move(spot.x, spot.y);
  await expect(card(page)).toBeVisible();
  expect(asked).toHaveLength(1);
  await page.keyboard.press("Escape");
  await expect(card(page)).toBeHidden();

  // Esc put it away until the pointer comes to the link again.
  await page.mouse.move(5, 5);
  // "Go to reference" goes to the entry, with a way back.
  await page.mouse.move(spot.x + 2, spot.y + 1);
  await expect(card(page)).toBeVisible();
  await card(page).getByRole("button", { name: "跳到参考文献" }).click();
  await expect(pageInput(page)).toHaveValue("3");
  await expect(backButton(page)).toBeVisible();
  await expect(card(page)).toBeHidden();
});

test("a lookup that fails says why and can be tried again", async ({
  page,
}) => {
  let tries = 0;
  const { spot } = await open(
    page,
    () => (route: any) =>
      ++tries === 1
        ? route.fulfill({
            status: 503,
            json: { detail: "文献服务暂时连不上，请稍后重试" },
          })
        : route.fulfill({ json: { item: WORK } }),
  );
  await page.mouse.move(spot.x, spot.y);
  await expect(card(page)).toContainText(
    "没能查到这条文献：文献服务暂时连不上，请稍后重试",
  );
  // The entry is there all the same.
  await expect(card(page)).toContainText(
    "Attention is all you need. NeurIPS 2017.",
  );
  await card(page).getByRole("button", { name: "重试" }).click();
  await expect(card(page)).toContainText("Ashish Vaswani");
  expect(tries).toBe(2);
});

test("a work no service knows shows the entry alone", async ({ page }) => {
  const { spot } = await open(
    page,
    () => (route: any) => route.fulfill({ json: { item: null } }),
  );
  await page.mouse.move(spot.x, spot.y);
  await expect(card(page)).toContainText("没有查到这条文献的记录");
  await expect(card(page)).toContainText(
    "Attention is all you need. NeurIPS 2017.",
  );
  await expect(card(page).getByRole("button", { name: "预览" })).toHaveCount(0);
  await expect(
    card(page).getByRole("button", { name: "加入文库" }),
  ).toHaveCount(0);
});

test("the keyboard reaches the card and Esc returns", async ({ page }) => {
  const { link } = await open(
    page,
    () => (route: any) => route.fulfill({ json: { item: WORK } }),
  );
  await link.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(link).toBeFocused();
  await expect(card(page)).toContainText("Ashish Vaswani");
  await page.keyboard.press("Tab");
  await expect(
    card(page).getByRole("link", { name: "arXiv:1706.03762" }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Escape");
  await expect(card(page)).toBeHidden();
  await expect(link).toBeFocused();
});

test("preview opens the cited paper beside the reader, and it can be added", async ({
  page,
}) => {
  let pdfs = 0;
  let imported = "";
  await page.route("**/api/v1/citations/arxiv-pdf?**", (route) => {
    pdfs++;
    return route.fulfill({
      body: pdfWithPages(2),
      contentType: "application/pdf",
    });
  });
  await page.route("**/api/v1/import/arxiv/progress/**", (route) =>
    route.fulfill({ status: 404, json: { detail: "none" } }),
  );
  await page.route("**/api/v1/import/arxiv", async (route) => {
    imported = route.request().postDataJSON().url;
    await new Promise((resolve) => setTimeout(resolve, 300));
    return route.fulfill({ json: { id: "imported-1", title: WORK.title } });
  });
  const { spot } = await open(
    page,
    () => (route: any) => route.fulfill({ json: { item: WORK } }),
  );
  await page.mouse.move(spot.x, spot.y);
  await expect(card(page)).toBeVisible();
  await card(page).getByRole("button", { name: "预览" }).click();
  await expect(card(page)).toBeHidden();
  await expect(panel(page)).toBeVisible();
  await expect(panel(page)).toContainText("Attention Is All You Need");
  await expect(panel(page)).toContainText("The dominant sequence transduction");
  // The abstract first; the PDF is only fetched when asked for.
  expect(pdfs).toBe(0);
  await panel(page).getByRole("radio", { name: "全文" }).click();
  await expect(panel(page).locator('[data-page="2"]')).toBeAttached();
  await expect(panel(page).getByText("来自 arXiv 的只读副本")).toBeVisible();
  expect(pdfs).toBe(1);

  // Adding goes through the arXiv import; then the library's copy can be opened.
  await panel(page).getByRole("button", { name: "加入文库" }).click();
  await expect(
    panel(page).getByRole("button", { name: "在文库中打开" }),
  ).toBeVisible();
  expect(imported).toBe("1706.03762");

  await page.keyboard.press("Escape");
  await expect(panel(page)).toBeHidden();
});

test("a work without an arXiv copy previews as an abstract", async ({
  page,
}) => {
  const { spot } = await open(
    page,
    () => (route: any) =>
      route.fulfill({ json: { item: { ...WORK, arxiv: "" } } }),
  );
  await page.mouse.move(spot.x, spot.y);
  await expect(card(page)).toBeVisible();
  await expect(
    card(page).getByRole("button", { name: "加入文库" }),
  ).toHaveCount(0);
  await card(page).getByRole("button", { name: "预览" }).click();
  await expect(panel(page)).toContainText("The dominant sequence transduction");
  await expect(panel(page)).toContainText("没有找到这篇文献的 arXiv 副本");
  await expect(panel(page).getByRole("radio")).toHaveCount(0);
});

for (const scheme of ["light", "dark"] as const) {
  test(`looks right in ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.route("**/api/v1/citations/arxiv-pdf?**", (route) =>
      route.fulfill({ body: pdfWithPages(2), contentType: "application/pdf" }),
    );
    const { spot } = await open(
      page,
      () => (route: any) => route.fulfill({ json: { item: WORK } }),
    );
    await page.mouse.move(spot.x, spot.y);
    await expect(card(page)).toContainText("Ashish Vaswani");
    await page.screenshot({ path: `../test-results/m1-card-${scheme}.png` });
    await card(page).getByRole("button", { name: "预览" }).click();
    await panel(page).getByRole("radio", { name: "全文" }).click();
    await expect(panel(page).locator('[data-page="1"]')).toHaveAttribute(
      "data-rendered",
      "true",
    );
    await page.screenshot({ path: `../test-results/m1-panel-${scheme}.png` });
  });
}
