import { expect, test, type Page } from "@playwright/test";
import { openKit } from "./helpers";

const stored = (page: Page) =>
  page.evaluate(() => localStorage.getItem("paper-appearance"));

test("a chosen theme is applied, stored and kept after a reload", async ({
  page,
}) => {
  await openKit(page, { theme: "dark" });
  const html = page.locator("html");
  await expect(html).toHaveAttribute("data-theme", "dark");
  await expect(html).toHaveClass(/\bdark\b/);
  await expect(html).toHaveCSS("color-scheme", "dark");
  expect(await stored(page)).toBe("dark");

  await page.reload();
  await expect(page.getByLabel("Kit theme")).toHaveValue("dark");
  await expect(html).toHaveAttribute("data-theme", "dark");

  await page.getByLabel("Kit theme").selectOption("light");
  await expect(html).toHaveAttribute("data-theme", "light");
  await expect(html).not.toHaveClass(/\bdark\b/);
  await expect(html).toHaveCSS("color-scheme", "light");
  expect(await stored(page)).toBe("light");
});

test("the kit shows a stored system mode and does not overwrite it", async ({
  page,
}) => {
  await page.goto("/ui-kit.html");
  await page.evaluate(() => localStorage.setItem("paper-appearance", "system"));
  await page.reload();
  await expect(page.getByLabel("Kit theme")).toHaveValue("system");
  expect(await stored(page)).toBe("system");
});

test("a mode that is not valid falls back to following the system", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/ui-kit.html");
  await page.evaluate(() => localStorage.setItem("paper-appearance", "sepia"));
  await page.reload();
  await expect(page.getByLabel("Kit theme")).toHaveValue("system");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});
