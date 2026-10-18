import { expect, test, type Locator, type Page } from "@playwright/test";
import { createPaperWithPdf, openReader, signIn } from "./fixtures";

// The interface follows the browser's language; these specs read it in Chinese.
test.use({ locale: "zh-CN" });

/** Whatever the page logs as an error or throws, from here on. */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

/** The sidebar's two widths, and the 8px the shell leaves round and between its cards. */
const RAIL = 56;
const OPEN = 220;
const INSET = 8;

const sidebar = (page: Page) => page.getByRole("navigation");
const card = (page: Page) => page.getByRole("main");
const scroller = (page: Page) =>
  page.getByRole("region", { name: "论文页面", exact: true });
const pdfPage = (page: Page, number: number) =>
  page.locator(`[data-page="${number}"]`);
const pageInput = (page: Page) =>
  card(page).getByRole("textbox", { name: "页码", exact: true });
const expand = (page: Page) =>
  sidebar(page).getByRole("button", { name: "展开侧栏" });
const collapse = (page: Page) =>
  sidebar(page).getByRole("button", { name: "收起侧栏" });

/** Wait for every transition and entrance that is running (not the ones that go on for ever), so that rectangles are the settled ones. */
const settled = (page: Page) =>
  page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter(
          (animation) =>
            animation.effect?.getComputedTiming().iterations !== Infinity,
        )
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  );

const widthOf = async (locator: Locator) =>
  (await locator.boundingBox())!.width;
/** Whether the page itself scrolls sideways (it must never: the cards scroll). */
const pageScrollsSideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);

/** The page's top is just under the top of the desk (the desk pads the first page by 20px). */
async function expectAtTop(page: Page, number: number) {
  await expect
    .poll(async () => {
      const [sheet, desk] = await Promise.all([
        pdfPage(page, number).boundingBox(),
        scroller(page).boundingBox(),
      ]);
      return Math.abs(sheet!.y - desk!.y - 20);
    })
    .toBeLessThan(6);
}

/**
 * Opens a paper of twelve pages in a window of this size (signed in at the
 * usual size first); `errors` is what the page logs as an error from the
 * sign-in on.
 */
async function openIn(page: Page, width: number, height: number) {
  await signIn(page);
  const paper = await createPaperWithPdf(page, { pages: 12 });
  await page.setViewportSize({ width, height });
  const errors = watchErrors(page);
  await openReader(page, { paperId: paper.paperId });
  await expect(pdfPage(page, 1)).toHaveAttribute("data-rendered", "true");
  return { ...paper, errors };
}

for (const [width, height] of [
  [600, 800],
  [560, 900],
] as const) {
  test(`the reader is usable in a ${width}x${height} window`, async ({
    page,
  }) => {
    const { title, errors } = await openIn(page, width, height);

    // The sidebar starts as a rail of icons ...
    await expect(expand(page)).toBeVisible();
    await expect(collapse(page)).toHaveCount(0);
    expect(await widthOf(sidebar(page))).toBe(RAIL);
    // ... and the paper's card takes all the room that is left.
    expect(await widthOf(card(page))).toBeGreaterThanOrEqual(
      width - RAIL - 3 * INSET - 1,
    );
    expect(await pageScrollsSideways(page)).toBe(false);

    // The header is whole: the title (cut, with the rest a hover away), the page field, the contents.
    const heading = card(page).getByRole("heading", {
      level: 1,
      name: title,
      exact: true,
    });
    await expect(heading).toBeVisible();
    expect(await widthOf(heading)).toBeGreaterThan(60);
    await expect(
      card(page).getByRole("button", { name: "目录与页面" }),
    ).toBeVisible();

    // Zoom and find no longer fit beside the title: they are in the more menu.
    await expect(
      card(page).getByRole("button", { name: /^缩放 \d+%$/ }),
    ).toHaveCount(0);
    await card(page).getByRole("button", { name: "更多" }).click();
    for (const name of ["查找论文", "适合宽度", "放大", "缩小"])
      await expect(page.getByRole("menuitem", { name })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);

    // The page field works.
    await pageInput(page).fill("5");
    await pageInput(page).press("Enter");
    await expect(pageInput(page)).toHaveValue("5");
    await expectAtTop(page, 5);
    await expect(pdfPage(page, 5)).toHaveAttribute("data-rendered", "true");

    // Opened, the sidebar floats over the card; the card does not move or narrow.
    const before = await card(page).boundingBox();
    await expand(page).click();
    await expect(collapse(page)).toBeVisible();
    await expect.poll(() => widthOf(sidebar(page))).toBe(OPEN);
    await settled(page);
    expect(await card(page).boundingBox()).toEqual(before);
    const over = await sidebar(page).boundingBox();
    expect(over!.x).toBe(INSET);
    expect(over!.x + over!.width).toBeGreaterThan(before!.x);
    expect(over!.height).toBe(height - 2 * INSET);
    await expect(
      sidebar(page).getByRole("link", { name: title, exact: true }),
    ).toBeVisible();
    expect(await pageScrollsSideways(page)).toBe(false);

    // Esc closes it, and the keyboard stays on the button that opened it.
    await page.keyboard.press("Escape");
    await expect.poll(() => widthOf(sidebar(page))).toBe(RAIL);
    await expect(expand(page)).toBeFocused();
    expect(await card(page).boundingBox()).toEqual(before);

    // So does a click anywhere else.
    await expand(page).click();
    await expect.poll(() => widthOf(sidebar(page))).toBe(OPEN);
    await page.mouse.click(width - 40, height / 2);
    await expect.poll(() => widthOf(sidebar(page))).toBe(RAIL);

    // And choosing an item (here the paper being read).
    await expand(page).click();
    await expect.poll(() => widthOf(sidebar(page))).toBe(OPEN);
    await sidebar(page).getByRole("link", { name: title, exact: true }).click();
    await expect.poll(() => widthOf(sidebar(page))).toBe(RAIL);

    // Its toggle is not "outside": it opens and shuts it.
    await expand(page).click();
    await expect.poll(() => widthOf(sidebar(page))).toBe(OPEN);
    await collapse(page).click();
    await expect.poll(() => widthOf(sidebar(page))).toBe(RAIL);

    // The side panel floats over the paper too, and still folds away.
    const show = card(page).getByRole("button", { name: "展开右侧面板" });
    await show.click();
    await expect(page.getByRole("tablist")).toBeVisible();
    await settled(page);
    const panel = await page.getByRole("complementary").boundingBox();
    expect(panel!.x).toBeGreaterThanOrEqual(0);
    expect(panel!.x + panel!.width).toBeLessThanOrEqual(width);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("tablist")).toBeHidden();

    expect(await pageScrollsSideways(page)).toBe(false);
    expect(errors).toEqual([]);
  });
}

test("a wide window keeps the sidebar open and pushing the card", async ({
  page,
}) => {
  await openIn(page, 1440, 900);

  await expect(collapse(page)).toBeVisible();
  expect(await widthOf(sidebar(page))).toBe(OPEN);
  const box = await card(page).boundingBox();
  expect(box!.x).toBe(INSET + OPEN + INSET);
  // Esc is not the sidebar's here, and the page does not scroll sideways.
  await page.keyboard.press("Escape");
  expect(await widthOf(sidebar(page))).toBe(OPEN);
  expect(await pageScrollsSideways(page)).toBe(false);

  // Collapsed by hand it is the same rail, and the card takes the room.
  await collapse(page).click();
  await expect.poll(() => widthOf(sidebar(page))).toBe(RAIL);
  await expect
    .poll(async () => (await card(page).boundingBox())!.x)
    .toBe(INSET + RAIL + INSET);
});

test("the sidebar follows the window as it is resized", async ({ page }) => {
  await openIn(page, 1440, 900);
  expect(await widthOf(sidebar(page))).toBe(OPEN);

  // Narrowed, it is a rail; opened, it floats; widened again it is docked and open.
  await page.setViewportSize({ width: 800, height: 900 });
  await expect.poll(() => widthOf(sidebar(page))).toBe(RAIL);
  await expand(page).click();
  await expect.poll(() => widthOf(sidebar(page))).toBe(OPEN);
  await page.setViewportSize({ width: 1200, height: 900 });
  await expect(collapse(page)).toBeVisible();
  expect(await widthOf(sidebar(page))).toBe(OPEN);
  await expect
    .poll(async () => (await card(page).boundingBox())!.x)
    .toBe(INSET + OPEN + INSET);

  // What was chosen on a wide window is kept: closed there, it is a rail on the way back.
  await collapse(page).click();
  await expect.poll(() => widthOf(sidebar(page))).toBe(RAIL);
  await page.setViewportSize({ width: 800, height: 900 });
  expect(await widthOf(sidebar(page))).toBe(RAIL);
  await expand(page).click();
  await expect.poll(() => widthOf(sidebar(page))).toBe(OPEN);
  await page.setViewportSize({ width: 1200, height: 900 });
  await expect.poll(() => widthOf(sidebar(page))).toBe(RAIL);
  await expect(expand(page)).toBeVisible();
});

for (const width of [480, 375]) {
  test(`nothing overlaps or sticks out of a ${width}px window`, async ({
    page,
  }) => {
    await openIn(page, width, 800);
    expect(await pageScrollsSideways(page)).toBe(false);

    // Every control in the card's header is inside the card, and none sits on another.
    const header = card(page).locator("header");
    const controls = await header
      .locator("button:visible, input:visible")
      .evaluateAll((elements) =>
        elements.map((element) => {
          const { left, right, top, bottom } = element.getBoundingClientRect();
          return {
            name: element.getAttribute("aria-label") ?? element.textContent,
            left,
            right,
            top,
            bottom,
          };
        }),
      );
    const bounds = (await card(page).boundingBox())!;
    expect(controls.length).toBeGreaterThan(3);
    for (const control of controls) {
      expect(control.left, control.name ?? "").toBeGreaterThanOrEqual(bounds.x);
      expect(control.right, control.name ?? "").toBeLessThanOrEqual(
        bounds.x + bounds.width,
      );
    }
    for (const [index, a] of controls.entries())
      for (const b of controls.slice(index + 1))
        expect(
          a.left < b.right - 0.5 &&
            b.left < a.right - 0.5 &&
            a.top < b.bottom - 0.5 &&
            b.top < a.bottom - 0.5,
          `${a.name} overlaps ${b.name}`,
        ).toBe(false);
  });
}
