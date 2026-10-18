import { expect, test, type Page } from "@playwright/test";
import { createPaperWithPdf, signIn } from "../reader/fixtures";

test.use({ locale: "zh-CN" });

const sidebar = (page: Page) => page.getByRole("navigation");
const screen = (page: Page) => page.locator("[data-app-screen]");

/** The settings name a model that is set up, so the app does not ask for one first. */
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

test("without a model the app sets one up first, and the rest stays reachable", async ({
  page,
}) => {
  await page.route("**/api/v1/translation-settings", (route) =>
    route.fulfill({ json: { active_id: "", configured: false, models: [] } }),
  );
  await signIn(page);
  await expect(page).toHaveURL(/#home$/);
  await expect(screen(page)).toHaveAttribute("data-app-screen", "setup");
  await expect(sidebar(page)).toHaveCount(0);

  // The settings and the library are not held back by it.
  await page.goto("/#library");
  await expect(screen(page)).toHaveAttribute("data-app-screen", "library");
  await page.goto("/#home");
  await expect(screen(page)).toHaveAttribute("data-app-screen", "setup");

  await page.getByRole("button", { name: "稍后" }).click();
  await expect(screen(page)).toHaveAttribute("data-app-screen", "home");
  await expect(
    sidebar(page).getByRole("link", { name: "首页" }),
  ).toHaveAttribute("aria-current", "page");
});

test("the sidebar goes to each screen and marks where it is", async ({
  page,
}) => {
  await withModel(page);
  await signIn(page);
  await expect(screen(page)).toHaveAttribute("data-app-screen", "home");

  for (const [name, hash] of [
    ["文库", "library"],
    ["设置", "settings"],
    ["首页", "home"],
  ]) {
    await sidebar(page).getByRole("link", { name, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`#${hash}$`));
    await expect(screen(page)).toHaveAttribute("data-app-screen", hash);
    await expect(
      sidebar(page).getByRole("link", { name, exact: true }),
    ).toHaveAttribute("aria-current", "page");
  }
});

test("the addresses of what was taken out go home", async ({ page }) => {
  await withModel(page);
  await signIn(page);
  for (const old of [
    "dashboard",
    "knowledge",
    "discover",
    "directions",
    "collections/abc",
    "tokens",
    "graph",
    "recommendations",
    "item/abc",
  ]) {
    await page.goto(`/#${old}`);
    await expect(page).toHaveURL(/#home$/);
    await expect(screen(page)).toHaveAttribute("data-app-screen", "home");
  }
});

test("a paper read is listed in the sidebar on every screen", async ({
  page,
}) => {
  await withModel(page);
  await signIn(page);
  const { paperId, title } = await createPaperWithPdf(page);
  await page.goto(`/#read/${paperId}`);
  await expect(
    page.getByRole("main").getByRole("heading", { level: 1, name: title }),
  ).toBeVisible();

  await sidebar(page).getByRole("link", { name: "首页" }).click();
  const reading = sidebar(page).getByRole("group", { name: "正在读" });
  await expect(reading.getByRole("link", { name: title })).toBeVisible();
  await reading.getByRole("link", { name: title }).click();
  await expect(page).toHaveURL(new RegExp(`#read/${paperId}$`));
});

test("quick open finds a paper by its title and opens it", async ({ page }) => {
  await withModel(page);
  await signIn(page);
  const { paperId, title } = await createPaperWithPdf(page, {
    title: `Quick Open Paper ${Date.now().toString(36)}`,
  });
  await page.goto("/#library");
  await expect(screen(page)).toHaveAttribute("data-app-screen", "library");

  await page.keyboard.press("ControlOrMeta+k");
  const dialog = page.getByRole("dialog", { name: "打开论文" });
  await expect(dialog).toBeVisible();
  const field = dialog.getByRole("combobox", { name: "搜索论文" });
  await expect(field).toBeFocused();
  await field.fill("nothing like this at all");
  await expect(dialog.getByRole("status")).toHaveText("没有匹配的论文。");
  await field.fill(title.toLowerCase());
  await expect(dialog.getByRole("option").first()).toContainText(title);
  await field.press("Enter");
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`#read/${paperId}$`));
  await expect(
    page.getByRole("main").getByRole("heading", { level: 1, name: title }),
  ).toBeVisible();

  // From the reader too, and from its sidebar.
  await page.keyboard.press("ControlOrMeta+k");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await sidebar(page)
    .getByRole("button", { name: /打开论文/ })
    .click();
  await expect(dialog).toBeVisible();
});

test("signing out goes back to the sign-in form", async ({ page }) => {
  await withModel(page);
  await signIn(page);
  await page.goto("/#library");
  await sidebar(page).getByRole("button", { name: "退出登录" }).click();
  await expect(
    page.getByRole("button", { name: "登录空间", exact: true }),
  ).toBeVisible();
  const me = await page.request.get("/api/v1/auth/me");
  expect(me.status()).toBe(401);
});

test("in English", async ({ browser }) => {
  const context = await browser.newContext({ locale: "en-US" });
  const page = await context.newPage();
  await withModel(page);
  await signIn(page);
  for (const name of ["Home", "Library", "Settings", "Sign out"])
    await expect(sidebar(page).getByText(name, { exact: true })).toBeVisible();
  await context.close();
});
