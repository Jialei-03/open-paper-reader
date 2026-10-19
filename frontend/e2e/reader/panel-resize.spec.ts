import { expect, test, type Page } from "@playwright/test";
import { createPaperWithPdf, openReader, signIn } from "./fixtures";

test.use({ locale: "zh-CN" });

const panel = (page: Page) =>
  page.getByRole("complementary", { name: "右侧面板" });
const handle = (page: Page) =>
  page.getByRole("separator", { name: "调整右侧面板宽度" });
const pdfPage = (page: Page) => page.locator('[data-page="1"]');
const widthOf = async (page: Page) => (await panel(page).boundingBox())!.width;
const pageWidth = async (page: Page) =>
  (await pdfPage(page).boundingBox())!.width;

async function open(page: Page, size = { width: 1400, height: 900 }) {
  await signIn(page);
  const paper = await createPaperWithPdf(page, { pages: 4 });
  await page.setViewportSize(size);
  await openReader(page, { paperId: paper.paperId });
  await expect(pdfPage(page)).toHaveAttribute("data-rendered", "true");
  return paper;
}

/** Drags the handle by `dx` pixels (negative: left, wider panel), optionally stopping before release. */
async function drag(page: Page, dx: number, release = true) {
  const box = (await handle(page).boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y, { steps: 5 });
  await page.mouse.move(x + dx, y, { steps: 5 });
  if (release) await page.mouse.up();
}

test("dragging the handle widens and narrows the panel within its limits", async ({
  page,
}) => {
  await open(page);
  expect(Math.round(await widthOf(page))).toBe(400);
  await expect(handle(page)).toHaveAttribute("aria-valuenow", "400");
  await expect(handle(page)).toHaveAttribute("aria-valuemin", "300");
  await expect(handle(page)).toHaveAttribute("aria-valuemax", "700");

  await drag(page, -100);
  await expect.poll(() => widthOf(page)).toBeCloseTo(500, 0);
  await expect(handle(page)).toHaveAttribute("aria-valuenow", "500");

  await drag(page, 1000);
  await expect.poll(() => widthOf(page)).toBeCloseTo(300, 0);
  await drag(page, -2000);
  await expect.poll(() => widthOf(page)).toBeCloseTo(700, 0);
});

test("the width is kept across a reload, and a double click resets it", async ({
  page,
}) => {
  const paper = await open(page);
  await drag(page, -150);
  await expect.poll(() => widthOf(page)).toBeCloseTo(550, 0);
  await page.reload();
  await openReader(page, { paperId: paper.paperId });
  await expect(panel(page)).toBeVisible();
  expect(Math.round(await widthOf(page))).toBe(550);

  await handle(page).dblclick();
  await expect.poll(() => widthOf(page)).toBeCloseTo(400, 0);
});

test("the arrow keys, Home and End change the width", async ({ page }) => {
  await open(page);
  await handle(page).focus();
  await page.keyboard.press("ArrowLeft");
  await expect(handle(page)).toHaveAttribute("aria-valuenow", "424");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(handle(page)).toHaveAttribute("aria-valuenow", "376");
  await page.keyboard.press("Shift+ArrowRight");
  await expect(handle(page)).toHaveAttribute("aria-valuenow", "304");
  await page.keyboard.press("End");
  await expect(handle(page)).toHaveAttribute("aria-valuenow", "700");
  await page.keyboard.press("Home");
  await expect(handle(page)).toHaveAttribute("aria-valuenow", "300");
  expect(Math.round(await widthOf(page))).toBe(300);
});

test("collapsing hides the handle and expanding brings the same width back", async ({
  page,
}) => {
  await open(page);
  await drag(page, -120);
  await expect.poll(() => widthOf(page)).toBeCloseTo(520, 0);
  await page.getByRole("button", { name: "收起右侧面板" }).click();
  await expect(handle(page)).toHaveCount(0);
  await page.getByRole("button", { name: "展开右侧面板" }).click();
  await expect(handle(page)).toBeVisible();
  await expect.poll(() => widthOf(page)).toBeCloseTo(520, 0);
});

test("a narrow window has no handle", async ({ page }) => {
  await open(page, { width: 900, height: 800 });
  await expect(handle(page)).toHaveCount(0);
});

test("the window shrinking clamps the panel to half of it", async ({
  page,
}) => {
  await open(page);
  await handle(page).focus();
  await page.keyboard.press("End");
  await page.setViewportSize({ width: 1200, height: 900 });
  await expect.poll(() => widthOf(page)).toBeCloseTo(600, 0);
});

test("the pages follow the drag live, and are drawn crisp once it is over", async ({
  page,
}) => {
  await open(page, { width: 1200, height: 900 });
  const before = await pageWidth(page);
  await drag(page, -120, false);
  // Held, with no wait for the settle: the pages are already scaled to the card.
  const during = await pageWidth(page);
  expect(during).toBeLessThan(before - 40);
  const crisp = (await canvasWidth(page)) / (await ratio(page));
  expect(crisp).toBeGreaterThan(during + 10);
  await page.mouse.up();
  await expect
    .poll(async () =>
      Math.abs(
        (await canvasWidth(page)) / (await ratio(page)) -
          (await pageWidth(page)),
      ),
    )
    .toBeLessThan(2);
  expect(await pageWidth(page)).toBeCloseTo(during, -1);
});

test("a drag keeps the page under the middle of the view in place", async ({
  page,
}) => {
  await signIn(page);
  const paper = await createPaperWithPdf(page, { pages: 8 });
  await page.setViewportSize({ width: 1200, height: 900 });
  await openReader(page, { paperId: paper.paperId, page: 5 });
  await expect(page.locator('[data-page="5"]')).toHaveAttribute(
    "data-rendered",
    "true",
  );
  const middle = async () => {
    const scroller = page.locator(".opr-pdf");
    const box = (await scroller.boundingBox())!;
    const target = page.locator('[data-page="5"]');
    const rect = (await target.boundingBox())!;
    return (box.y + box.height / 2 - rect.y) / rect.height;
  };
  const start = await middle();
  await drag(page, -150, false);
  expect(Math.abs((await middle()) - start)).toBeLessThan(0.03);
  await page.mouse.up();
  await page.waitForTimeout(800);
  expect(Math.abs((await middle()) - start)).toBeLessThan(0.04);
});

async function canvasWidth(page: Page) {
  return page.evaluate(
    () =>
      document.querySelector<HTMLCanvasElement>('[data-page="1"] canvas')
        ?.width ?? 0,
  );
}
const ratio = (page: Page) => page.evaluate(() => window.devicePixelRatio);
