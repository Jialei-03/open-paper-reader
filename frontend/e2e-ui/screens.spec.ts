import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { openKit } from "./helpers";

// Pictures of the sample window, for people to look at (and for the PR). They are
// attached to the report, not compared: what the test asserts is that the page
// draws itself without a console error or an uncaught exception.

/** Collects what the page reports as wrong; `check()` fails the test if there is any. */
function watchErrors(page: Page) {
  const problems: string[] = [];
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error")
      problems.push(`console.error: ${message.text()}`);
  });
  return () => expect(problems).toEqual([]);
}

/** The picture is taken once the fonts are in, and with the motion at its end (a spinner at rest). */
async function attach(page: Page, testInfo: TestInfo, name: string) {
  await page.evaluate(() => document.fonts.ready);
  await testInfo.attach(name, {
    body: await page.screenshot({ fullPage: true, animations: "disabled" }),
    contentType: "image/png",
  });
}

for (const theme of ["light", "dark"] as const) {
  for (const locale of ["zh", "en"] as const) {
    test(`the sample window in ${theme}, ${locale}`, async ({
      page,
    }, testInfo) => {
      const check = watchErrors(page);
      await openKit(page, { theme, locale });
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expect(
        page.getByRole("navigation", { name: "Workspace" }),
      ).toBeVisible();
      await expect(page.getByRole("main")).toBeVisible();
      await attach(page, testInfo, `${theme}-${locale}`);
      check();
    });
  }
}

test("a menu is open", async ({ page }, testInfo) => {
  const check = watchErrors(page);
  await openKit(page, { theme: "light", locale: "en" });
  await page
    .getByRole("region", { name: "Menu", exact: true })
    .getByRole("button", { name: "More" })
    .click();
  await expect(page.getByRole("menu", { name: "Item actions" })).toBeVisible();
  await attach(page, testInfo, "menu-light-en");
  check();
});

test("a dialog is open", async ({ page }, testInfo) => {
  const check = watchErrors(page);
  await openKit(page, { theme: "dark", locale: "en" });
  await page.getByRole("button", { name: "Open dialog" }).click();
  await expect(
    page.getByRole("dialog", { name: "Rename paper" }),
  ).toBeVisible();
  await attach(page, testInfo, "dialog-dark-en");
  check();
});

test("an error toast is showing", async ({ page }, testInfo) => {
  const check = watchErrors(page);
  await openKit(page, { theme: "dark", locale: "zh" });
  await page.getByRole("button", { name: "Show error" }).click();
  await expect(page.getByText("Import failed")).toBeVisible();
  await attach(page, testInfo, "toast-dark-zh");
  check();
});
