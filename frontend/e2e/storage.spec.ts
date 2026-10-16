import { test, expect } from "@playwright/test";

test("Storage: inspect and confirm unused attachment cleanup", async ({
  page,
}) => {
  await page.goto("/#dashboard");
  // Storage cleanup correctly refuses while this owner has active jobs. Give
  // this scenario its own owner instead of inheriting other tests' agent runs.
  await page.getByRole("button", { name: "创建账户", exact: true }).click();
  await page
    .getByLabel("用户名", { exact: true })
    .fill("storage_" + crypto.randomUUID().replaceAll("-", "").slice(0, 12));
  await page
    .getByLabel("密码", { exact: true })
    .fill(process.env.E2E_TEST_PASSWORD!);
  await page
    .getByRole("button", { name: "注册并进入空间", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "打开研究助手" }),
  ).toBeVisible();
  const csrf = (await page.context().cookies()).find(
    (c) => c.name === "paper_csrf",
  )!.value;
  const upload = await page.request.post("/api/v1/agent/attachments", {
    headers: { "X-CSRF-Token": csrf },
    multipart: {
      file: {
        name: "cleanup-draft.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("temporary draft"),
      },
    },
  });
  expect(upload.ok()).toBeTruthy();
  const file = await upload.json();
  await page.goto("/#settings");
  await expect(page.getByText("模型用量", { exact: true })).toBeVisible();
  await expect(page.getByText("0 次请求 · 已知用量 0 tokens")).toBeVisible();
  await page.getByText("模型用量", { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "../test-results/model-usage.png",
    animations: "disabled",
  });
  // Synthetic accounting fixture exercises enabled-budget presentation only.
  await page.route("**/api/v1/model-usage", (route) =>
    route.fulfill({
      json: {
        requests: 2,
        total_tokens: 150,
        unknown_requests: 1,
        budgets: [
          {
            scope: "shared",
            limit_tokens: 200,
            charged_tokens: 250,
            request_reserve_tokens: 100,
            over_reservation_requests: 1,
          },
        ],
      },
    }),
  );
  await page.reload();
  await expect(page.getByText("平台模型预算：250 / 200 tokens")).toBeVisible();
  await expect(page.getByText(/次请求的实际用量超过预留/)).toBeVisible();
  await page.getByText("模型用量", { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "../test-results/model-budget.png",
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByText("模型用量", { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "../test-results/model-budget-mobile.png",
    animations: "disabled",
  });
  await page.unroute("**/api/v1/model-usage");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("tab", { name: "数据与存储", exact: true }).click();
  await page.getByRole("button", { name: "管理附件", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByText("cleanup-draft.txt", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "../test-results/storage-files.png",
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    dialog.getByRole("button", { name: "清理 cleanup-draft.txt", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: "../test-results/storage-files-mobile.png" });
  await dialog
    .getByRole("button", { name: "清理 cleanup-draft.txt", exact: true })
    .click();
  await expect(dialog.getByText(/确认删除「cleanup-draft.txt」/)).toBeVisible();
  const removed = page.waitForResponse(
    (response) =>
      response.request().method() === "DELETE" &&
      response.url().includes(file.id),
  );
  await dialog.getByRole("button", { name: "确认删除", exact: true }).click();
  expect((await removed).ok()).toBeTruthy();
  await expect(dialog.getByText(/确认删除「cleanup-draft.txt」/)).toHaveCount(
    0,
  );
  await expect(
    dialog.getByText("cleanup-draft.txt", { exact: true }),
  ).toHaveCount(0);
  const inventory = await (
    await page.request.get("/api/v1/storage-files")
  ).json();
  expect(
    inventory.items.some((row: { id: string }) => row.id === file.id),
  ).toBe(false);
});
