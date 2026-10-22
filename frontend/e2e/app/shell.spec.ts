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
  // The settings open as a window over home, the setup not in their way.
  await page.goto("/#settings");
  await expect(page.getByRole("dialog", { name: "设置" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/#home$/);
  await expect(screen(page)).toHaveAttribute("data-app-screen", "setup");

  await expect(page.getByRole("button", { name: "继续" })).toBeDisabled();
});

test("the sidebar goes to each screen and marks where it is", async ({
  page,
}) => {
  await withModel(page);
  await signIn(page);
  await expect(screen(page)).toHaveAttribute("data-app-screen", "home");

  // From home the library is one link; inside it, its own list takes over.
  await sidebar(page).getByRole("link", { name: "文库", exact: true }).click();
  await expect(page).toHaveURL(/#library$/);
  await expect(screen(page)).toHaveAttribute("data-app-screen", "library");
  for (const [name, hash] of [
    ["全部", "library"],
    ["发现", "discover"],
    ["首页", "home"],
  ]) {
    await sidebar(page).getByRole("link", { name, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`#${hash}$`));
    await expect(screen(page)).toHaveAttribute("data-app-screen", hash);
    if (hash !== "home")
      await expect(
        sidebar(page).getByRole("link", { name, exact: true }),
      ).toHaveAttribute("aria-current", "page");
  }
  // The settings are a window over the page, which stays as it was under them.
  await sidebar(page).getByRole("link", { name: "设置", exact: true }).click();
  await expect(page).toHaveURL(/#settings$/);
  await expect(page.getByRole("dialog", { name: "设置" })).toBeVisible();
  await expect(screen(page)).toHaveAttribute("data-app-screen", "home");
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/#home$/);
});

test("the addresses of what was taken out go home", async ({ page }) => {
  await withModel(page);
  await signIn(page);
  for (const old of [
    "dashboard",
    "knowledge",
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

  await page.goto("/#library");
  const reading = sidebar(page).getByRole("group", { name: "最近阅读" });
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
  const dialog = page.getByRole("dialog", { name: "搜索论文" });
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
    .getByRole("button", { name: /搜索论文/ })
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

test("the sidebar's search entry opens quick open and can search the library", async ({
  page,
}) => {
  await withModel(page);
  await signIn(page);
  const { title } = await createPaperWithPdf(page, {
    title: `Sidebar Search ${Date.now().toString(36)}`,
  });
  await page.goto("/#home");
  const entry = sidebar(page).getByRole("button", { name: /搜索论文/ });
  // It looks like a field: the prompt and the shortcut are in it.
  await expect(entry).toContainText("搜索论文");
  await expect(entry.locator("kbd")).toBeVisible();
  await entry.click();
  const dialog = page.getByRole("dialog", { name: "搜索论文" });
  const field = dialog.getByRole("combobox", { name: "搜索论文" });
  await expect(field).toBeFocused();

  // Titles and authors are searched; the last choice carries the words to the library.
  await field.fill("Author");
  await expect(dialog.getByRole("option").first()).toBeVisible();
  const word = title.split(" ").slice(-1)[0];
  await field.fill(word);
  const toLibrary = dialog.getByRole("option", {
    name: `在文库中搜索“${word}”`,
  });
  await expect(toLibrary).toBeVisible();
  await toLibrary.click();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/#library\?q=/);
  await expect(screen(page)).toHaveAttribute("data-app-screen", "library");
  await expect(
    page.getByRole("main").getByRole("searchbox", { name: "搜索文库" }),
  ).toHaveValue(word);
  await expect(
    page.getByRole("main").getByRole("link", { name: title }),
  ).toBeVisible();
});

test("on this machine's own server there is no sign out", async ({ page }) => {
  await withModel(page);
  await page.route("**/api/v1/health", (route) =>
    route.fulfill({ json: { status: "ok", version: "test", mode: "local" } }),
  );
  await signIn(page);
  await expect(sidebar(page).getByRole("link", { name: "设置" })).toBeVisible();
  await expect(
    sidebar(page).getByRole("button", { name: "退出登录" }),
  ).toHaveCount(0);
});
