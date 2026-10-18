import { test, expect } from "@playwright/test";
import { en } from "../src/i18n/messages/en";
import { zh } from "../src/i18n/messages/zh";

for (const [locale, words] of [
  ["zh-CN", zh],
  ["en-US", en],
] as const) {
  test.describe(`sign-in in ${locale}`, () => {
    test.use({ locale });

    test("a wrong password says so; the right one gets in", async ({
      page,
    }) => {
      await page.goto("/#dashboard");
      await expect(
        page.getByRole("heading", { level: 1, name: words["login.title"] }),
      ).toBeVisible();
      await page
        .getByLabel(words["login.username"], { exact: true })
        .fill("alice");
      await page
        .getByLabel(words["login.password"], { exact: true })
        .fill("not-the-password");
      await page
        .getByRole("button", { name: words["login.submit"], exact: true })
        .click();
      await expect(page.getByRole("alert")).toBeVisible();
      await page
        .getByLabel(words["login.password"], { exact: true })
        .fill(process.env.E2E_TEST_PASSWORD!);
      await page
        .getByRole("button", { name: words["login.submit"], exact: true })
        .click();
      await expect(
        page.getByLabel(words["login.username"], { exact: true }),
      ).toBeHidden();
    });

    test("create-account mode and the recovery page", async ({ page }) => {
      await page.goto("/#dashboard");
      await page
        .getByRole("button", { name: words["login.toRegister"], exact: true })
        .click();
      await expect(
        page.getByRole("heading", {
          level: 1,
          name: words["login.title.register"],
        }),
      ).toBeVisible();
      await expect(
        page.getByLabel(words["login.invitation"], { exact: true }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: words["login.toLogin"], exact: true })
        .click();
      await page.getByRole("link", { name: words["login.forgot"] }).click();
      await expect(
        page.getByRole("heading", {
          level: 1,
          name: words["recovery.title.request"],
        }),
      ).toBeVisible();
      await expect(
        page.getByLabel(words["recovery.email"], { exact: true }),
      ).toBeVisible();
      await page.screenshot({ path: `../test-results/recovery-${locale}.png` });
    });
  });
}
