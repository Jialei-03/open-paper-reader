import { expect, test } from "@playwright/test";
import { signIn } from "../reader/fixtures";

// The screens follow the browser's language; these specs read them in Chinese.
test.use({ locale: "zh-CN" });

// The test server is the hosted edition: research is the local edition's.
test.beforeEach(async ({ page }) => {
  await page.route("**/api/v1/translation-settings", (route) =>
    route.fulfill({
      json: {
        active_id: "model-1",
        configured: true,
        models: [{ id: "model-1" }],
      },
    }),
  );
});

test("the hosted site sends research to the local edition", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/#projects");
  const notice = page.getByTestId("research-local-only");
  await expect(notice).toBeVisible();
  await expect(notice.getByRole("heading")).toHaveText("在本机版研究");
  await expect(notice.locator("pre")).toHaveCount(0);
  await expect(notice.getByRole("button")).toBeVisible();
  await expect(page.getByTestId("home-research")).toHaveCount(0);

  await page.goto("/#settings/environments");
  const settings = page.getByRole("dialog", { name: "设置" });
  await expect(settings).toBeVisible();
  await expect(settings.getByText("研究环境", { exact: true })).toHaveCount(0);
});
