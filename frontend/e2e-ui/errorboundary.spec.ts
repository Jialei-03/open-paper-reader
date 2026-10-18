import { expect, test, type Page } from "@playwright/test";
import { contrast, openKit } from "./helpers";

const section = (page: Page) =>
  page.getByRole("region", { name: "ErrorBoundary", exact: true });
const breaker = (page: Page) =>
  section(page).getByRole("button", { name: "Make the preview throw" });
const fine = (page: Page) =>
  section(page).getByText("The preview is fine.", { exact: true });
const failure = (page: Page) => section(page).getByRole("alert");
const message = (page: Page) => failure(page).locator("p");
const retry = (page: Page) =>
  failure(page).getByRole("button", { name: "Retry" });
const counter = (page: Page, count: number) =>
  section(page).getByRole("button", { name: `Count: ${count}`, exact: true });
const resets = (page: Page) => section(page).locator("output");

test.beforeEach(async ({ page }) => {
  await openKit(page, { locale: "en" });
});

test("shows what is below it while nothing throws", async ({ page }) => {
  await expect(fine(page)).toBeVisible();
  await expect(failure(page)).toHaveCount(0);
});

test("a child that throws gives a message and a retry, and the page carries on", async ({
  page,
}) => {
  await breaker(page).click();

  await expect(failure(page)).toBeVisible();
  await expect(message(page)).toHaveText("Preview ran into a problem");
  await expect(retry(page)).toBeVisible();
  await expect(fine(page)).toHaveCount(0);
  // The rest of the page, inside and outside the section, is still there.
  await expect(breaker(page)).toBeVisible();
  await expect(
    section(page).getByText("The rest of the page is outside the boundary"),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Workspace" }),
  ).toBeVisible();
  await expect(page.getByRole("tablist", { name: "Side panel" })).toBeVisible();
});

test("retry mounts the children again and tells onReset", async ({ page }) => {
  await expect(resets(page)).toHaveText("0");
  await counter(page, 0).click();
  await counter(page, 1).click();
  await breaker(page).click();
  await retry(page).click();

  await expect(fine(page)).toBeVisible();
  // A fresh child: what it had in its state is gone.
  await expect(counter(page, 0)).toBeVisible();
  await expect(failure(page)).toHaveCount(0);
  await expect(resets(page)).toHaveText("1");

  // And it can fail again, and be retried again.
  await breaker(page).click();
  await expect(failure(page)).toBeVisible();
  await retry(page).click();
  await expect(fine(page)).toBeVisible();
  await expect(resets(page)).toHaveText("2");
});

test("retry is reachable and works from the keyboard", async ({ page }) => {
  await breaker(page).click();
  await retry(page).focus();
  await page.keyboard.press("Enter");
  await expect(fine(page)).toBeVisible();
});

test("writes the error to the console once", async ({ page }) => {
  const logged: string[] = [];
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      message.text().startsWith("ErrorBoundary (Preview)")
    )
      logged.push(message.text());
  });
  await breaker(page).click();
  await expect(failure(page)).toBeVisible();
  expect(logged).toHaveLength(1);
  expect(logged[0]).toContain("The preview failed as it drew");
});

test("speaks the language of the page", async ({ page }) => {
  await openKit(page, { locale: "zh" });
  await breaker(page).click();
  await expect(message(page)).toHaveText("预览出了问题");
  await expect(
    failure(page).getByRole("button", { name: "重试" }),
  ).toBeVisible();
});

for (const theme of ["light", "dark"] as const) {
  test(`its message and mark are readable in ${theme}`, async ({ page }) => {
    await openKit(page, { theme, locale: "en" });
    await breaker(page).click();
    await expect(failure(page)).toBeVisible();
    // What is really painted: the card's surface, the message, the mark.
    const painted = await failure(page).evaluate((card) => ({
      surface: getComputedStyle(card).backgroundColor,
      message: getComputedStyle(card.querySelector("p")!).color,
      mark: getComputedStyle(card.querySelector("svg")!).color,
    }));
    expect(
      await contrast(page, painted.message, painted.surface),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      await contrast(page, painted.mark, painted.surface),
    ).toBeGreaterThanOrEqual(4.5);
  });
}
