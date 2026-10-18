import { expect, test, type Locator, type Page } from "@playwright/test";
import { openReader } from "./fixtures";
import { paperWithTranslation, type Row } from "./translation-fixtures";

// 译文 beside the original: both PDFs whole, scrolled together by the job's
// alignment (else by the pages' proportion). The jobs are mocked; the PDFs are
// real files on the paper (the original of 8 pages, its translation of 4).
test.use({ locale: "zh-CN" });

const PAGES = 8;
const TRANSLATED_PAGES = 4;

const main = (page: Page) => page.getByRole("main");
const mode = (page: Page, name: string) =>
  main(page)
    .getByRole("radiogroup", { name: "阅读方式", exact: true })
    .getByRole("radio", { name, exact: true });
const pane = (page: Page, which: "original" | "translated") =>
  page.locator(`[data-pane="${which}"]`);
const desk = (page: Page, which: "original" | "translated") =>
  pane(page, which).locator(".opr-pdf");
const sheet = (page: Page, which: "original" | "translated", number: number) =>
  pane(page, which).locator(`[data-page="${number}"]`);
const view = (page: Page) =>
  main(page).getByRole("radiogroup", { name: "译文显示方式", exact: true });
const viewChoice = (page: Page, name: string) =>
  view(page).getByRole("radio", { name, exact: true });
const link = (page: Page) =>
  main(page).getByRole("button", { name: "联动滚动", exact: true });
const swap = (page: Page) =>
  main(page).getByRole("button", { name: "交换左右", exact: true });
const pageInput = (page: Page) =>
  main(page).getByRole("textbox", { name: "页码", exact: true });
const selectionMenu = (page: Page) =>
  page.getByRole("menu", { name: "划选的文字", exact: true });

/** A page's top is just under the top of its desk (the desk pads the first page by 20px). */
async function expectAtTop(
  page: Page,
  which: "original" | "translated",
  number: number,
) {
  await expect
    .poll(async () => {
      const [box, area] = await Promise.all([
        sheet(page, which, number).boundingBox(),
        desk(page, which).boundingBox(),
      ]);
      return box && area ? Math.abs(box.y - area.y - 20) : 1e9;
    })
    .toBeLessThan(8);
}

/** How far down its desk a pane has scrolled. */
const scrolled = (locator: Locator) => locator.evaluate((el) => el.scrollTop);

/** Through the page field, as a person does; it scrolls the original. */
async function jumpTo(page: Page, number: number) {
  await pageInput(page).fill(String(number));
  await pageInput(page).press("Enter");
  await expectAtTop(page, "original", number);
}

async function open(
  page: Page,
  options: {
    alignment?: Row[];
    engine?: "latex" | "pdf";
    translatedPages?: number;
  } = {},
) {
  const paper = await paperWithTranslation(page, {
    pages: PAGES,
    ...options,
    translatedPages: options.translatedPages ?? TRANSLATED_PAGES,
  });
  await openReader(page, { paperId: paper.paperId });
  await expect(
    sheet(page, "original", 1).or(page.locator('[data-page="1"]')),
  ).toHaveAttribute("data-rendered", "true");
  await mode(page, "译文").click();
  await expect(desk(page, "translated")).toBeVisible();
  await expect(sheet(page, "translated", 1)).toHaveAttribute(
    "data-rendered",
    "true",
  );
  await expect(sheet(page, "original", 1)).toHaveAttribute(
    "data-rendered",
    "true",
  );
  return paper;
}

/** A unit of the job's alignment: where a passage is in each PDF. */
const unit = (from: number, to: number): Row => ({
  id: `u${from}`,
  source_text: "x",
  translated_text: "y",
  source: { page: from, quote: "x" },
  translated: { page: to, quote: "y" },
});

test("译文 opens beside the original, each a whole PDF", async ({ page }) => {
  const paper = await open(page);
  await expect(viewChoice(page, "并排对照")).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(desk(page, "original")).toHaveAttribute(
    "data-file",
    paper.fileId,
  );
  await expect(desk(page, "translated")).toHaveAttribute(
    "data-file",
    paper.translatedId,
  );
  await expect(pane(page, "original").locator("[data-page]")).toHaveCount(
    PAGES,
  );
  await expect(pane(page, "translated").locator("[data-page]")).toHaveCount(
    TRANSLATED_PAGES,
  );
  const [left, right] = await Promise.all([
    pane(page, "original").boundingBox(),
    pane(page, "translated").boundingBox(),
  ]);
  expect(left!.x).toBeLessThan(right!.x);
  expect(Math.abs(left!.width - right!.width)).toBeLessThan(2);
  await expect(main(page)).toContainText("按页码位置滚动");
});

test("scrolling the original moves the translation by page proportion when nothing is aligned", async ({
  page,
}) => {
  await open(page);
  // Half as many pages: page 5 of 8 is at the top of page 3 of 4.
  await jumpTo(page, 5);
  await expectAtTop(page, "translated", 3);
  await jumpTo(page, 3);
  await expectAtTop(page, "translated", 2);
  await jumpTo(page, 1);
  await expectAtTop(page, "translated", 1);
});

test("the job's alignment decides where the translation goes", async ({
  page,
}) => {
  // Page 3 of the original is on page 4 of the translation (by proportion, of 6 pages, it would be page 3).
  await open(page, {
    engine: "latex",
    translatedPages: 6,
    alignment: [unit(1, 1), unit(3, 4), unit(3, 4), unit(8, 6)],
  });
  await expect(main(page)).toContainText("按原译文对应段落滚动");
  await jumpTo(page, 3);
  await expectAtTop(page, "translated", 4);
  await jumpTo(page, 1);
  await expectAtTop(page, "translated", 1);
});

test("scrolling the translation moves the original: whichever is scrolled leads", async ({
  page,
}) => {
  await open(page);
  const top = (await sheet(page, "translated", 3).boundingBox())!;
  const area = (await desk(page, "translated").boundingBox())!;
  const target =
    (await scrolled(desk(page, "translated"))) + (top.y - area.y - 20);
  await desk(page, "translated").evaluate((el, to) => {
    el.scrollTop = to;
  }, target);
  await expectAtTop(page, "original", 5);
});

test("unlinking stops one following the other, linking again brings them together", async ({
  page,
}) => {
  await open(page);
  await expect(link(page)).toHaveAttribute("aria-pressed", "true");
  await link(page).click();
  await expect(link(page)).toHaveAttribute("aria-pressed", "false");

  await jumpTo(page, 5);
  await page.waitForTimeout(500);
  expect(await scrolled(desk(page, "translated"))).toBe(0);

  await link(page).click();
  await expect(link(page)).toHaveAttribute("aria-pressed", "true");
  // The translation goes to where the original is.
  await expectAtTop(page, "translated", 3);
});

test("swapping puts the translation on the left, and they still keep step", async ({
  page,
}) => {
  await open(page);
  await swap(page).click();
  const [left, right] = await Promise.all([
    pane(page, "original").boundingBox(),
    pane(page, "translated").boundingBox(),
  ]);
  expect(left!.x).toBeGreaterThan(right!.x);
  await jumpTo(page, 3);
  await expectAtTop(page, "translated", 2);
});

test("the zoom applies to both panes", async ({ page }) => {
  await open(page);
  const width = (which: "original" | "translated") =>
    sheet(page, which, 1).evaluate((el) => el.getBoundingClientRect().width);
  const before = [await width("original"), await width("translated")];
  await main(page)
    .getByRole("button", { name: /^缩放 / })
    .click();
  await page.getByRole("menuitem", { name: "放大", exact: true }).click();
  await expect
    .poll(async () => (await width("original")) / before[0])
    .toBeGreaterThan(1.05);
  await expect
    .poll(async () => (await width("translated")) / before[1])
    .toBeGreaterThan(1.05);
  const [a, b] = [await width("original"), await width("translated")];
  expect(Math.abs(a - b)).toBeLessThan(3);
});

test("text is selected in either pane for the menu; the original's highlights", async ({
  page,
}) => {
  await open(page);
  for (const [which, text, highlight] of [
    ["original", "Page 1 of", true],
    ["translated", "Translated copy", false],
  ] as const) {
    const line = sheet(page, which, 1).locator(".textLayer span", {
      hasText: text,
    });
    const from = (await line.boundingBox())!;
    await page.mouse.move(
      Math.round(from.x + 2),
      Math.round(from.y + from.height / 2),
    );
    await page.mouse.down();
    await page.mouse.move(
      Math.round(from.x + from.width - 2),
      Math.round(from.y + from.height / 2),
      { steps: 12 },
    );
    await page.mouse.up();
    await expect(selectionMenu(page)).toHaveCount(1);
    const item = selectionMenu(page).getByRole("menuitem", {
      name: "高亮",
      exact: true,
    });
    if (highlight) await expect(item).not.toHaveAttribute("aria-disabled");
    else await expect(item).toHaveAttribute("aria-disabled", "true");
    await page.keyboard.press("Escape");
  }
});

test("the choice between the translation alone and beside the original is kept", async ({
  page,
}) => {
  const paper = await open(page);
  await viewChoice(page, "仅译文").click();
  await expect(pane(page, "original")).toHaveCount(0);
  await expect(page.locator(".opr-pdf")).toHaveCount(1);
  await expect(page.locator(".opr-pdf")).toHaveAttribute(
    "data-file",
    paper.translatedId,
  );
  await expect(link(page)).toHaveCount(0);

  await page.reload();
  await mode(page, "译文").click();
  await expect(viewChoice(page, "仅译文")).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(page.locator(".opr-pdf")).toHaveCount(1);
  await viewChoice(page, "并排对照").click();
  await expect(desk(page, "translated")).toBeVisible();
});

test("a narrow window shows one at a time, with a switch", async ({ page }) => {
  await page.setViewportSize({ width: 950, height: 900 });
  const paper = await paperWithTranslation(page, {
    pages: PAGES,
    translatedPages: TRANSLATED_PAGES,
  });
  await openReader(page, { paperId: paper.paperId });
  await expect(page.locator('[data-page="1"]')).toHaveAttribute(
    "data-rendered",
    "true",
  );
  await mode(page, "译文").click();
  const switcher = main(page).getByRole("radiogroup", {
    name: "显示哪一份",
    exact: true,
  });
  await expect(switcher.getByRole("radio")).toHaveText(["原文", "译文"]);
  await expect(page.locator(".opr-pdf")).toHaveCount(1);
  await expect(page.locator(".opr-pdf")).toHaveAttribute(
    "data-file",
    paper.translatedId,
  );
  await expect(view(page)).toHaveCount(0);
  await switcher.getByRole("radio", { name: "原文", exact: true }).click();
  await expect(page.locator(".opr-pdf")).toHaveAttribute(
    "data-file",
    paper.fileId,
  );
  await expect(page.locator(".opr-pdf")).toHaveCount(1);
});
