import { test, expect } from "@playwright/test";
import { testPdf } from "./fixtures/pdf";
import { openLayoutTranslation } from "./helpers";

test("layout progress refreshes promptly without overlapping slow requests and pauses when hidden", async ({
  page,
}) => {
  await page.goto("/#dashboard");
  await page.getByLabel("用户名", { exact: true }).fill("alice");
  await page
    .getByLabel("密码", { exact: true })
    .fill(process.env.E2E_TEST_PASSWORD!);
  await page.getByRole("button", { name: "登录空间", exact: true }).click();
  await expect(page.getByRole("heading", { name: "最近" })).toBeVisible();
  const csrf = (await page.context().cookies()).find(
    (c) => c.name === "paper_csrf",
  )!.value;
  const headers = {
    "X-CSRF-Token": csrf,
    "Idempotency-Key": crypto.randomUUID(),
  };
  const paper = await (
    await page.request.post("/api/v1/papers", {
      headers,
      data: { title: "Translation polling fixture" },
    })
  ).json();
  const file = await (
    await page.request.post(`/api/v1/papers/${paper.id}/files`, {
      headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
      multipart: {
        version_id: paper.current_version,
        file: {
          name: "paper.pdf",
          mimeType: "application/pdf",
          buffer: testPdf(),
        },
      },
    })
  ).json();
  let calls = 0,
    active = 0,
    peak = 0;
  await page.route(
    `**/api/v1/papers/${paper.id}/translations`,
    async (route) => {
      calls++;
      active++;
      peak = Math.max(peak, active);
      // A slow poll must finish before the next one starts.
      if (calls > 2) await new Promise((resolve) => setTimeout(resolve, 2200));
      active--;
      await route.fulfill({
        json: [
          {
            id: "fixture",
            status: "running",
            stage: "正在翻译",
            completed: calls,
            total: 100,
            engine: "pdf",
            source_file: file.id,
            translated_file: "",
            alignment: [],
            error: "",
          },
        ],
      });
    },
  );
  await page.goto(`/#paper/${paper.id}`);
  await openLayoutTranslation(page);
  await expect(page.getByRole("button", { name: "取消翻译" })).toBeVisible();
  await expect.poll(() => calls, { timeout: 9000 }).toBeGreaterThanOrEqual(4);
  expect(peak).toBe(1);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(() => active).toBe(0);
  const pausedCalls = calls;
  await page.waitForTimeout(2500);
  expect(calls).toBe(pausedCalls);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: false,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect
    .poll(() => calls, { timeout: 1500 })
    .toBeGreaterThan(pausedCalls);
  await page.goto("/#dashboard");
  await expect(page.getByRole("heading", { name: "最近" })).toBeVisible();
  await page.waitForTimeout(2500);
  const exitedCalls = calls;
  await page.waitForTimeout(2000);
  expect(calls).toBe(exitedCalls);
});
