import { expect, test, type Page } from "@playwright/test";
import { openKit } from "./helpers";

const stored = (page: Page) =>
  page.evaluate(() => localStorage.getItem("paper-locale"));

async function expectEnglish(page: Page) {
  await expect(page.getByText("Read 1 page", { exact: true })).toBeVisible();
  await expect(page.getByText("Read 3 pages", { exact: true })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByLabel("Kit locale")).toHaveValue("en");
}

async function expectChinese(page: Page) {
  await expect(page.getByText("读了 1 页", { exact: true })).toBeVisible();
  await expect(page.getByText("读了 3 页", { exact: true })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect(page.getByLabel("Kit locale")).toHaveValue("zh");
}

// Chromium reports English by default, so a Chinese choice that survives a
// reload can only have come from storage.
test("a chosen language is applied, stored and kept after a reload", async ({
  page,
}) => {
  await openKit(page, { locale: "zh" });
  await expectChinese(page);
  expect(await stored(page)).toBe("zh");

  await page.reload();
  await expectChinese(page);

  await page.getByLabel("Kit locale").selectOption("en");
  await expectEnglish(page);
  expect(await stored(page)).toBe("en");

  await page.reload();
  await expectEnglish(page);
});

test.describe("in a browser that prefers Chinese", () => {
  test.use({ locale: "zh-CN" });

  test("with nothing stored, the page follows the browser and stores nothing", async ({
    page,
  }) => {
    await openKit(page);
    await expectChinese(page);
    expect(await stored(page)).toBeNull();
  });

  test("a stored English choice beats the browser's language", async ({
    page,
  }) => {
    await openKit(page, { locale: "en" });
    await expectEnglish(page);
    await page.reload();
    await expectEnglish(page);
  });
});

test("an English browser gets English", async ({ page }) => {
  await openKit(page);
  await expectEnglish(page);
});

test("a browser without usable storage still switches language", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new DOMException("denied", "SecurityError");
      },
    });
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openKit(page, { locale: "zh" });
  // The premise: reading storage really does throw here.
  expect(
    await page.evaluate(() => {
      try {
        return localStorage.length;
      } catch {
        return "throws";
      }
    }),
  ).toBe("throws");
  await expectChinese(page);
  await page.getByLabel("Kit locale").selectOption("en");
  await expectEnglish(page);
  expect(errors).toEqual([]);
});
