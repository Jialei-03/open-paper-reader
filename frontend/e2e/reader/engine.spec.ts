import { expect, test, type Locator, type Page } from "@playwright/test";
import { createPaperWithPdf, openReader, signIn } from "./fixtures";

// The interface follows the browser's language; these specs read it in Chinese.
test.use({ locale: "zh-CN" });

const PAGES = 40;

const scroller = (page: Page) =>
  page.getByRole("region", { name: "论文页面", exact: true });
const pdfPage = (page: Page, number: number) =>
  page.locator(`[data-page="${number}"]`);
const pageStatus = (page: Page) =>
  page.getByRole("main").locator('[aria-live="polite"]');

/** Sign in and open a paper of 40 pages, each saying which page it is; wait for the first page. */
async function openLongPaper(page: Page) {
  await signIn(page);
  const paper = await createPaperWithPdf(page, { pages: PAGES });
  await openReader(page, { paperId: paper.paperId });
  await expect(pdfPage(page, 1)).toHaveAttribute("data-rendered", "true");
  return paper;
}

/** Whether anything dark was drawn on the canvas (the paper itself is white). */
const inked = (canvas: Locator) =>
  canvas.evaluate((element: HTMLCanvasElement) => {
    const { data } = element
      .getContext("2d")!
      .getImageData(0, 0, element.width, element.height);
    for (let i = 0; i < data.length; i += 4)
      if (data[i] < 160 && data[i + 1] < 160 && data[i + 2] < 160) return true;
    return false;
  });

/** The text layer covers exactly the drawn page: same place, same size, to the pixel. */
async function expectAligned(pageElement: Locator) {
  const [text, canvas] = await Promise.all([
    pageElement.locator(".textLayer").boundingBox(),
    pageElement.locator("canvas").boundingBox(),
  ]);
  expect(text && canvas).toBeTruthy();
  for (const side of ["x", "y", "width", "height"] as const)
    expect(Math.abs(text![side] - canvas![side]), side).toBeLessThanOrEqual(1);
}

test("first page renders and text is selectable", async ({ page }) => {
  await openLongPaper(page);
  const first = pdfPage(page, 1);

  const canvas = first.locator("canvas");
  await expect(canvas).toHaveCount(1);
  expect(await inked(canvas)).toBe(true);

  const text = first.locator(".textLayer");
  await expect(text).toContainText("Page 1 of 40");
  const line = text.locator("span", { hasText: "Page 1 of 40" });
  const box = (await line.boundingBox())!;
  await page.mouse.move(box.x + 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2, {
    steps: 8,
  });
  await page.mouse.up();
  const selected = await page.evaluate(
    () => window.getSelection()?.toString() ?? "",
  );
  expect(selected.trim().length).toBeGreaterThan(3);
  expect("Page 1 of 40").toContain(selected.trim());
});

test("scrolling updates the page number", async ({ page }) => {
  await openLongPaper(page);
  await expect(pageStatus(page)).toHaveText("第 1 页 / 共 40 页");

  await pdfPage(page, 20).evaluate((element) =>
    element.scrollIntoView({ block: "center" }),
  );
  await expect(pageStatus(page)).toHaveText("第 20 页 / 共 40 页");

  // As a person scrolls: three pages further down with the wheel.
  const height = await pdfPage(page, 20).evaluate((element) => {
    const next = element.nextElementSibling!.getBoundingClientRect();
    return next.top - element.getBoundingClientRect().top;
  });
  await scroller(page).hover();
  await page.mouse.wheel(0, height * 3);
  await expect(pageStatus(page)).toHaveText("第 23 页 / 共 40 页");

  // The number that scrolling set does not scroll the paper again.
  const top = await scroller(page).evaluate((element) => element.scrollTop);
  await page.waitForTimeout(400);
  expect(await scroller(page).evaluate((element) => element.scrollTop)).toBe(
    top,
  );
});

test("only nearby pages keep a rendered canvas", async ({ page }) => {
  await openLongPaper(page);

  // Read through the paper, a few pages at a time, as far as page 30.
  for (const number of [5, 10, 15, 20, 25, 30]) {
    await pdfPage(page, number).evaluate((element) => element.scrollIntoView());
    await expect(pdfPage(page, number)).toHaveAttribute(
      "data-rendered",
      "true",
    );
  }

  const drawn = await page
    .locator("[data-page] canvas[width]")
    .evaluateAll(
      (canvases) =>
        canvases.filter((canvas) => (canvas as HTMLCanvasElement).width > 0)
          .length,
    );
  expect(drawn).toBeGreaterThan(0);
  expect(drawn).toBeLessThanOrEqual(8);
  // The pages read on the way are released, text and all.
  await expect(pdfPage(page, 10).locator("canvas")).toHaveCount(0);
  await expect(pdfPage(page, 10).locator(".textLayer span")).toHaveCount(0);
  // Every page still holds its place, so the paper is as long as it was.
  await expect(page.locator("[data-page]")).toHaveCount(PAGES);
});

test("text layer stays aligned with the canvas after zooming", async ({
  page,
}) => {
  await openLongPaper(page);
  const first = pdfPage(page, 1);
  await expectAligned(first);

  // The shortcuts work wherever the keyboard is in the paper's card.
  await scroller(page).focus();
  for (let step = 0; step < 10; step++)
    await page.keyboard.press("ControlOrMeta+=");
  await expect(first).toHaveAttribute("data-scale", "2");
  await expect(first).toHaveAttribute("data-rendered", "true");
  const zoomed = (await first.boundingBox())!;
  expect(Math.abs(zoomed.width - 612 * 2)).toBeLessThanOrEqual(1);
  await expectAligned(first);

  // Fit to width: the page takes the width the paper's card gives it.
  await page.keyboard.press("ControlOrMeta+0");
  await expect(first).not.toHaveAttribute("data-scale", "2");
  await expect(first).toHaveAttribute("data-rendered", "true");
  const fitted = (await first.boundingBox())!;
  const room = await scroller(page).evaluate((element) => {
    const pages = element.firstElementChild!;
    const style = getComputedStyle(pages);
    return (
      element.clientWidth -
      parseFloat(style.paddingLeft) -
      parseFloat(style.paddingRight)
    );
  });
  expect(Math.abs(fitted.width - room)).toBeLessThanOrEqual(1);
  await expectAligned(first);

  // And smaller again with the other shortcut.
  await page.keyboard.press("ControlOrMeta+-");
  await expect
    .poll(async () => (await first.boundingBox())!.width)
    .toBeLessThan(fitted.width - 1);
  await expect(first).toHaveAttribute("data-rendered", "true");
  await expectAligned(first);
});

test("the paper looks the same in light and dark", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await openLongPaper(page);
  const filter = () =>
    pdfPage(page, 1).evaluate((element) => getComputedStyle(element).filter);
  expect(await filter()).toBe("none");

  // The interface around it turns dark; the pages are not dimmed or tinted.
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await filter()).toBe("none");

  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  expect(await filter()).toBe("none");
});

test("a PDF that fails to load explains and retries", async ({ page }) => {
  await signIn(page);
  const { paperId, fileId } = await createPaperWithPdf(page, { pages: 3 });
  const content = `**/api/v1/files/${fileId}/content`;
  // Slow, then refused: first the card says it is loading, then why it stopped.
  await page.route(content, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await route.fulfill({ status: 500, body: "boom" });
  });
  await openReader(page, { paperId });

  const paper = page.getByRole("main");
  await expect(paper.getByRole("status")).toContainText("PDF");
  const alert = paper.getByRole("alert");
  await expect(alert).toContainText("没能下载这份 PDF");
  // The rest of the card is still there.
  await expect(paper.getByRole("heading", { level: 1 })).toBeVisible();

  await page.unroute(content);
  await paper.getByRole("button", { name: "重试" }).click();
  await expect(pdfPage(page, 1)).toHaveAttribute("data-rendered", "true");
  await expect(paper.getByRole("alert")).toHaveCount(0);
  await expect(pageStatus(page)).toHaveText("第 1 页 / 共 3 页");
});

test("the side panel floats above the paper's layers", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 800 });
  await openLongPaper(page);
  await page.getByRole("button", { name: "展开右侧面板" }).click();
  const panel = page.getByRole("complementary");
  await expect(panel.getByRole("tablist")).toBeVisible();
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  );

  // A point of the panel that lies over the first page (its text layer included).
  const [panelBox, pageBox] = await Promise.all([
    panel.boundingBox(),
    pdfPage(page, 1).boundingBox(),
  ]);
  const x = Math.max(panelBox!.x, pageBox!.x) + 40;
  const y = Math.max(panelBox!.y, pageBox!.y) + 40;
  expect(x).toBeLessThan(
    Math.min(panelBox!.x + panelBox!.width, pageBox!.x + pageBox!.width),
  );
  expect(
    await page.evaluate(
      ([px, py]) => !!document.elementFromPoint(px, py)?.closest("aside"),
      [x, y],
    ),
  ).toBe(true);
});

test.describe("in English", () => {
  test.use({ locale: "en-US" });

  test("the page number speaks English", async ({ page }) => {
    await signIn(page);
    const { paperId } = await createPaperWithPdf(page, { pages: 3 });
    await openReader(page, { paperId });
    await expect(pdfPage(page, 1)).toHaveAttribute("data-rendered", "true");
    await expect(pageStatus(page)).toHaveText("Page 1 of 3");
    await expect(
      page.getByRole("region", { name: "Paper pages", exact: true }),
    ).toBeVisible();
  });
});
