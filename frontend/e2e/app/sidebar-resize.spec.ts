import { expect, test, type Page } from "@playwright/test";
import { createPaperWithPdf, openReader, signIn } from "../reader/fixtures";

test.use({ locale: "zh-CN" });

const sidebar = (page: Page) => page.getByRole("navigation", { name: "侧栏" });
const handle = (page: Page) =>
  page.getByRole("separator", { name: "调整侧栏宽度" });
const widthOf = async (page: Page) =>
  (await sidebar(page).boundingBox())?.width ?? 0;
const pdfPage = (page: Page) => page.locator('[data-page="1"]');

/** The settings name a model that is set up, so home does not ask for one first. */
async function withModel(page: Page) {
  await page.route("**/api/v1/translation-settings", (route) =>
    route.fulfill({
      json: {
        active_id: "model-1",
        configured: true,
        models: [{ id: "model-1" }],
      },
    }),
  );
}

async function openHome(page: Page, size = { width: 1400, height: 900 }) {
  await withModel(page);
  await page.setViewportSize(size);
  await signIn(page);
  await expect(sidebar(page)).toBeVisible();
}

/** Drags the handle by `dx` pixels (positive: right, wider sidebar), optionally stopping before release. */
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

test("dragging the handle widens and narrows the sidebar within 180 to 360", async ({
  page,
}) => {
  await openHome(page);
  expect(Math.round(await widthOf(page))).toBe(220);
  await expect(handle(page)).toHaveAttribute("aria-valuenow", "220");
  await expect(handle(page)).toHaveAttribute("aria-valuemin", "180");
  await expect(handle(page)).toHaveAttribute("aria-valuemax", "360");

  await drag(page, 70);
  await expect.poll(() => widthOf(page)).toBeCloseTo(290, 0);
  await expect(handle(page)).toHaveAttribute("aria-valuenow", "290");
  await drag(page, 1000);
  await expect.poll(() => widthOf(page)).toBeCloseTo(360, 0);
  await drag(page, -1000);
  await expect.poll(() => widthOf(page)).toBeCloseTo(180, 0);
});

test("the width is kept across a reload and screens, and a double click resets it", async ({
  page,
}) => {
  await openHome(page);
  await drag(page, 80);
  await expect.poll(() => widthOf(page)).toBeCloseTo(300, 0);
  await page.reload();
  await expect(sidebar(page)).toBeVisible();
  expect(Math.round(await widthOf(page))).toBe(300);

  for (const hash of ["library", "discover", "settings"]) {
    await sidebar(page)
      .getByRole("link", {
        name: { library: "文库", discover: "发现", settings: "设置" }[hash]!,
        exact: true,
      })
      .click();
    await expect(page).toHaveURL(new RegExp(`#${hash}$`));
    await expect(handle(page)).toBeVisible();
    await expect.poll(() => widthOf(page)).toBeCloseTo(300, 0);
  }

  await handle(page).dblclick();
  await expect.poll(() => widthOf(page)).toBeCloseTo(220, 0);
});

test("the arrow keys, Shift, Home and End change the width", async ({
  page,
}) => {
  await openHome(page);
  await handle(page).focus();
  await page.keyboard.press("ArrowRight");
  await expect(handle(page)).toHaveAttribute("aria-valuenow", "244");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await expect(handle(page)).toHaveAttribute("aria-valuenow", "196");
  await page.keyboard.press("Shift+ArrowRight");
  await expect(handle(page)).toHaveAttribute("aria-valuenow", "268");
  await page.keyboard.press("End");
  await expect(handle(page)).toHaveAttribute("aria-valuenow", "360");
  await page.keyboard.press("Home");
  await expect(handle(page)).toHaveAttribute("aria-valuenow", "180");
  expect(Math.round(await widthOf(page))).toBe(180);
});

test("collapsing hides the handle and expanding brings the same width back", async ({
  page,
}) => {
  await openHome(page);
  await drag(page, 60);
  await expect.poll(() => widthOf(page)).toBeCloseTo(280, 0);
  await page.getByRole("button", { name: "收起侧栏" }).click();
  await expect(handle(page)).toHaveCount(0);
  await expect.poll(() => widthOf(page)).toBeCloseTo(56, 0);
  await page.getByRole("button", { name: "展开侧栏" }).click();
  await expect(handle(page)).toBeVisible();
  await expect.poll(() => widthOf(page)).toBeCloseTo(280, 0);
});

test("a narrow window has no handle, open or not", async ({ page }) => {
  await openHome(page, { width: 800, height: 800 });
  await expect(handle(page)).toHaveCount(0);
  await page.getByRole("button", { name: "展开侧栏" }).click();
  await expect(handle(page)).toHaveCount(0);
});

test("home's cards follow the pointer while the handle is held", async ({
  page,
}) => {
  await openHome(page);
  const cards = page.locator("[data-app-screen] main").first();
  const before = (await cards.boundingBox())!.width;
  await drag(page, 100, false);
  expect((await cards.boundingBox())!.width).toBeCloseTo(before - 100, 0);
  await page.mouse.up();
  expect((await cards.boundingBox())!.width).toBeCloseTo(before - 100, 0);
});

test("in the reader the paper card and the pages follow the drag, and are drawn crisp after it", async ({
  page,
}) => {
  await withModel(page);
  await signIn(page);
  const paper = await createPaperWithPdf(page, { pages: 6 });
  await page.setViewportSize({ width: 1200, height: 900 });
  await openReader(page, { paperId: paper.paperId });
  await expect(pdfPage(page)).toHaveAttribute("data-rendered", "true");
  const card = page.getByRole("main", { name: "论文" });
  const cardBefore = (await card.boundingBox())!.width;
  const pageBefore = (await pdfPage(page).boundingBox())!.width;

  await drag(page, 120, false);
  // Held: no wait for the fit, the card and the page it holds have already moved.
  const cardNow = (await card.boundingBox())!.width;
  expect(cardNow).toBeCloseTo(cardBefore - 120, 0);
  const pageNow = (await pdfPage(page).boundingBox())!.width;
  expect(pageNow).toBeLessThan(pageBefore - 50);
  // Still the pages of before, scaled: not drawn at the new width yet.
  expect(await canvasWidth(page)).toBeGreaterThan(pageNow);

  await page.mouse.up();
  await expect
    .poll(async () => {
      const shown = (await pdfPage(page).boundingBox())!.width;
      const canvas = await canvasWidth(page);
      const ratio = await page.evaluate(() => window.devicePixelRatio);
      return Math.abs(canvas - shown * ratio) < 2;
    })
    .toBe(true);
  expect((await pdfPage(page).boundingBox())!.width).toBeLessThan(
    pageBefore - 50,
  );
});

async function canvasWidth(page: Page) {
  return page.evaluate(
    () =>
      document.querySelector<HTMLCanvasElement>('[data-page="1"] canvas')
        ?.width ?? 0,
  );
}
