import { expect, test, type Page } from "@playwright/test";
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

/** Wait for every running transition, so that rectangles are the settled ones. */
const settled = (page: Page) =>
  page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation instanceof CSSTransition)
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  );

const sidebar = (page: Page) => page.getByRole("navigation");
const panelTabs = (page: Page) => page.getByRole("tablist");

test("opens a paper in the new reader", async ({ page }) => {
  await signIn(page);
  const { paperId, title } = await createPaperWithPdf(page);
  const errors = watchErrors(page);

  await openReader(page, { paperId });

  const paper = page.getByRole("main");
  await expect(
    paper.getByRole("heading", { level: 1, name: title, exact: true }),
  ).toBeVisible();
  await expect(sidebar(page).getByRole("link", { name: "文库" })).toBeVisible();
  // The paper being read is in the list of what is being read, and marked.
  await expect(
    sidebar(page).getByRole("link", { name: title, exact: true }),
  ).toHaveAttribute("aria-current", "page");
  for (const name of ["导读", "助手", "笔记"])
    await expect(panelTabs(page).getByRole("tab", { name })).toBeVisible();
  await expect(
    panelTabs(page).getByRole("tab", { name: "导读" }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel")).toContainText("导读");

  // None of the old interface is around it, and the wide window needs no toggle.
  await expect(page.locator("#main-content")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "打开研究助手" })).toHaveCount(
    0,
  );
  await expect(page.getByRole("button", { name: /右侧面板/ })).toHaveCount(0);
  // The window is the shell's: it is the cards that scroll, never the page.
  expect(
    await page.evaluate(
      () => document.documentElement.scrollHeight <= window.innerHeight,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("the tabs of the side panel switch its text", async ({ page }) => {
  await signIn(page);
  const { paperId } = await createPaperWithPdf(page);
  await openReader(page, { paperId });

  await panelTabs(page).getByRole("tab", { name: "笔记" }).click();
  await expect(
    panelTabs(page).getByRole("tab", { name: "笔记" }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel")).toContainText("笔记");
  await panelTabs(page).getByRole("tab", { name: "笔记" }).press("ArrowLeft");
  await expect(
    panelTabs(page).getByRole("tab", { name: "助手" }),
  ).toBeFocused();
  await expect(page.getByRole("tabpanel")).toContainText("对话");
});

test("an unknown paper explains and links back", async ({ page }) => {
  await signIn(page);
  await openReader(page, { paperId: "does-not-exist" });

  const paper = page.getByRole("main");
  await expect(paper).toContainText("找不到这篇论文");
  const back = paper.getByRole("link", { name: "回到文库" });
  await expect(back).toBeVisible();
  // The rest of the screen is there: this is a paper that is missing, not a screen that broke.
  await expect(sidebar(page).getByRole("link", { name: "文库" })).toBeVisible();
  await expect(panelTabs(page)).toBeVisible();

  await back.click();
  await expect(page).toHaveURL(/#library/);
});

test("a failing region shows a retry instead of a blank screen", async ({
  page,
}) => {
  await signIn(page);
  const { paperId, title } = await createPaperWithPdf(page);
  // An answer that cannot be read: the card throws rather than explains.
  await page.route(`**/api/v1/papers/${paperId}/files`, (route) =>
    route.fulfill({ status: 200, body: "not json" }),
  );
  await openReader(page, { paperId });

  const paper = page.getByRole("main");
  const alert = paper.getByRole("alert");
  await expect(alert).toBeVisible();
  await expect(alert).toContainText("论文出了问题");
  await expect(alert.getByRole("button", { name: "重试" })).toBeVisible();
  // The other regions carry on.
  await expect(sidebar(page).getByRole("link", { name: "文库" })).toBeVisible();
  await expect(
    panelTabs(page).getByRole("tab", { name: "导读" }),
  ).toBeVisible();

  await page.unroute(`**/api/v1/papers/${paperId}/files`);
  await alert.getByRole("button", { name: "重试" }).click();
  await expect(
    paper.getByRole("heading", { level: 1, name: title, exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("a paper the service refuses is explained, with a retry", async ({
  page,
}) => {
  await signIn(page);
  const { paperId, title } = await createPaperWithPdf(page);
  let refuse = true;
  await page.route(`**/api/v1/papers/${paperId}`, (route) =>
    refuse
      ? route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ detail: "服务暂时不可用" }),
        })
      : route.continue(),
  );
  await openReader(page, { paperId });

  const paper = page.getByRole("main");
  await expect(paper.getByRole("alert")).toContainText("服务暂时不可用");
  refuse = false;
  await paper.getByRole("button", { name: "重试" }).click();
  await expect(
    paper.getByRole("heading", { level: 1, name: title, exact: true }),
  ).toBeVisible();
});

test("the sidebar lists what was read last and goes there", async ({
  page,
}) => {
  await signIn(page);
  const first = await createPaperWithPdf(page);
  const second = await createPaperWithPdf(page);

  await openReader(page, { paperId: first.paperId });
  await expect(page.getByRole("main")).toContainText(first.title);
  await openReader(page, { paperId: second.paperId });
  await expect(page.getByRole("main")).toContainText(second.title);

  const reading = sidebar(page).getByRole("group", { name: "正在读" });
  await expect(
    reading.getByRole("link", { name: second.title }),
  ).toHaveAttribute("aria-current", "page");
  const other = reading.getByRole("link", { name: first.title });
  await expect(other).not.toHaveAttribute("aria-current", "page");

  await other.click();
  await expect(page).toHaveURL(new RegExp(`#read/${first.paperId}$`));
  await expect(page.getByRole("main")).toContainText(first.title);
  await expect(
    reading.getByRole("link", { name: first.title }),
  ).toHaveAttribute("aria-current", "page");
});

test("the sidebar collapses to its icons", async ({ page }) => {
  await signIn(page);
  const { paperId } = await createPaperWithPdf(page);
  await openReader(page, { paperId });

  await sidebar(page).getByRole("button", { name: "收起侧栏" }).click();
  // Collapsed, an item is named by its label although the label is not drawn.
  await expect(sidebar(page).getByRole("link", { name: "文库" })).toBeVisible();
  await expect(
    sidebar(page).getByRole("button", { name: "展开侧栏" }),
  ).toBeVisible();
});

test("the old reader is untouched", async ({ page }) => {
  await signIn(page);
  const { paperId } = await createPaperWithPdf(page);

  await page.goto(`/#paper/${paperId}`);
  await expect(page.locator(".reader-page")).toBeVisible();
  await expect(page.locator("#main-content")).toBeVisible();
});

test("the right panel folds away on a narrow window", async ({ page }) => {
  await signIn(page);
  const { paperId } = await createPaperWithPdf(page);
  await openReader(page, { paperId });
  await expect(panelTabs(page)).toBeVisible();

  await page.setViewportSize({ width: 1000, height: 800 });
  await expect(panelTabs(page)).toBeHidden();
  const show = page.getByRole("button", { name: "展开右侧面板" });
  await expect(show).toBeVisible();
  await expect(show).toHaveAttribute("aria-expanded", "false");

  // Open: it floats over the paper, below the header, so the toggle stays in reach.
  await show.click();
  await expect(panelTabs(page)).toBeVisible();
  await expect(
    panelTabs(page).getByRole("tab", { name: "导读" }),
  ).toBeFocused();
  const hide = page.getByRole("button", { name: "收起右侧面板" });
  await expect(hide).toHaveAttribute("aria-expanded", "true");
  await settled(page);
  const panel = page.getByRole("complementary");
  const [panelBox, toggleBox, viewport] = await Promise.all([
    panel.boundingBox(),
    hide.boundingBox(),
    page.viewportSize(),
  ]);
  expect(panelBox!.x + panelBox!.width).toBeLessThanOrEqual(viewport!.width);
  expect(panelBox!.y).toBeGreaterThanOrEqual(toggleBox!.y + toggleBox!.height);
  // It is not squeezed into the paper: the paper keeps the whole width.
  const paperBox = await page.getByRole("main").boundingBox();
  expect(paperBox!.x + paperBox!.width).toBeGreaterThan(panelBox!.x);

  // Esc folds it again and hands the keyboard back to the toggle.
  await page.keyboard.press("Escape");
  await expect(panelTabs(page)).toBeHidden();
  await expect(show).toBeFocused();

  // The toggle opens and closes it too.
  await show.click();
  await expect(panelTabs(page)).toBeVisible();
  await hide.click();
  await expect(panelTabs(page)).toBeHidden();
  await expect(show).toBeFocused();

  // Wide again: docked, no toggle; narrow again: still folded.
  await show.click();
  await expect(panelTabs(page)).toBeVisible();
  await page.setViewportSize({ width: 1400, height: 900 });
  await expect(panelTabs(page)).toBeVisible();
  await expect(page.getByRole("button", { name: /右侧面板/ })).toHaveCount(0);
  await page.setViewportSize({ width: 1000, height: 800 });
  await expect(panelTabs(page)).toBeHidden();
});

test.describe("in English", () => {
  test.use({ locale: "en-US" });

  test("the screen speaks English", async ({ page }) => {
    await signIn(page);
    const { paperId, title } = await createPaperWithPdf(page);
    await openReader(page, { paperId });

    await expect(
      page.getByRole("main").getByRole("heading", { level: 1, name: title }),
    ).toBeVisible();
    await expect(
      sidebar(page).getByRole("link", { name: "Library" }),
    ).toBeVisible();
    for (const name of ["Guide", "Assistant", "Notes"])
      await expect(panelTabs(page).getByRole("tab", { name })).toBeVisible();

    await openReader(page, { paperId: "does-not-exist" });
    await expect(page.getByRole("main")).toContainText("can't be found");
    await expect(
      page.getByRole("main").getByRole("link", { name: "Back to library" }),
    ).toBeVisible();
  });
});
