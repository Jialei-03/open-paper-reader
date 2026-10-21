import { expect, test, type Page } from "@playwright/test";
import { createPaperWithPdf, signIn } from "../reader/fixtures";

// The settings are a window over the page, one kind of settings at a time.
const SETTINGS = (category: string) => `/#settings/${category}`;

// Not a real key: the service is never reached, its answers are mocked.
const FAKE_KEY = "sk-test-not-a-real-key";

async function headers(page: Page) {
  const csrf = (await page.context().cookies()).find(
    (cookie) => cookie.name === "paper_csrf",
  )!.value;
  return { "X-CSRF-Token": csrf, "Idempotency-Key": crypto.randomUUID() };
}

async function settings(page: Page) {
  const response = await page.request.get("/api/v1/translation-settings");
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function removeModels(page: Page) {
  for (const row of (await settings(page)).models)
    await page.request.delete(
      `/api/v1/translation-settings/configs/${row.id}`,
      { headers: await headers(page) },
    );
}

/** Adds a model through the dialog, its connection test answered from here. */
async function addModel(page: Page, model: string) {
  await page.getByRole("button", { name: "添加模型" }).click();
  const dialog = page.getByRole("dialog", { name: "添加模型" });
  await dialog
    .getByLabel("服务地址", { exact: true })
    .fill("https://api.openai.com/v1");
  await dialog.getByLabel("API 密钥", { exact: true }).fill(FAKE_KEY);
  await dialog.getByLabel("模型", { exact: true }).fill(model);
  await dialog.getByRole("button", { name: "测试连接" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(`已添加 ${model}。`)).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  // The Chinese interface, unless a test (or the page) has chosen otherwise.
  await page.addInitScript(() => {
    if (!localStorage.getItem("paper-locale"))
      localStorage.setItem("paper-locale", "zh");
  });
  await signIn(page);
  await removeModels(page);
  await page.route("**/api/v1/translation-settings/configs/*/test", (route) =>
    route.fulfill({ json: { ok: true } }),
  );
});

test.afterEach(async ({ page }) => {
  await removeModels(page);
});

test("models are added, chosen, tested and removed", async ({ page }) => {
  await page.goto(SETTINGS("models"));
  await expect(page.getByRole("dialog", { name: "设置" })).toBeVisible();
  const section = page.getByRole("region", { name: "模型" });
  await expect(section.getByText("还没有模型。")).toBeVisible();

  await addModel(page, "gpt-test-first");
  const list = section.getByRole("list", { name: "模型" });
  await expect(list.getByRole("listitem")).toHaveCount(1);
  await expect(list.getByRole("listitem").first()).toContainText("当前");

  // The newest model becomes the current one.
  await addModel(page, "gpt-test-second");
  const first = list
    .getByRole("listitem")
    .filter({ hasText: "gpt-test-first" });
  const second = list
    .getByRole("listitem")
    .filter({ hasText: "gpt-test-second" });
  await expect(second).toContainText("当前");
  await expect(first).not.toContainText("当前");

  await first.getByRole("button", { name: "使用 gpt-test-first" }).click();
  await expect(first).toContainText("当前");
  await expect(second).not.toContainText("当前");
  const ids = (await settings(page)).models.map(
    (row: { id: string; model: string }) => row,
  );
  expect((await settings(page)).active_id).toBe(
    ids.find((row: { model: string }) => row.model === "gpt-test-first").id,
  );

  await second.getByRole("button", { name: "测试 gpt-test-second" }).click();
  await expect(page.getByText("gpt-test-second 连接正常。")).toBeVisible();

  await second.getByRole("button", { name: "移除 gpt-test-second" }).click();
  const confirm = page.getByRole("dialog", { name: "移除这个模型？" });
  await expect(confirm).toContainText("gpt-test-second 和它的密钥");
  await confirm.getByRole("button", { name: "移除" }).click();
  await expect(confirm).toBeHidden();
  await expect(list.getByRole("listitem")).toHaveCount(1);
  expect(
    (await settings(page)).models.map((row: { model: string }) => row.model),
  ).toEqual(["gpt-test-first"]);
});

test("the theme and the language change at once", async ({ page }) => {
  await page.goto(SETTINGS("general"));
  await page.getByRole("radio", { name: "深色" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("radio", { name: "浅色" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("radio", { name: "跟随系统" }).click();
  expect(
    await page.evaluate(() => localStorage.getItem("paper-appearance")),
  ).toBe("system");

  await page.getByRole("radio", { name: "English" }).click();
  const window = page.getByRole("dialog", { name: "Settings" });
  await expect(window).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  // Only the name of the other language is in Chinese.
  const text = await window.innerText();
  expect(text.replace("中文", "")).not.toMatch(/[一-鿿]/);
  await page.goto(SETTINGS("usage"));
  await expect(page.getByRole("region", { name: "Usage" })).toBeVisible();
  await page.goto(SETTINGS("general"));
  await page.reload();
  await expect(window).toBeVisible();
  await page.getByRole("radio", { name: "中文" }).click();
  await expect(page.getByRole("dialog", { name: "设置" })).toBeVisible();
});

test("the data, its use and the export are shown", async ({ page }) => {
  await createPaperWithPdf(page);
  await page.goto(SETTINGS("data"));
  const data = page.getByRole("region", { name: "数据" });
  await expect(data.getByText(/^已用 .+ \/ .+$/)).toBeVisible();
  await expect(data.getByRole("meter", { name: "存储用量" })).toBeVisible();
  await expect(data.getByText("论文", { exact: true })).toBeVisible();
  await expect(data.getByRole("button", { name: "下载 ZIP" })).toBeVisible();
  await page.goto(SETTINGS("usage"));
  const usage = page.getByRole("region", { name: "用量" });
  await expect(usage.getByText("请求", { exact: true })).toBeVisible();
  await expect(usage.getByText("Tokens", { exact: true })).toBeVisible();
});

test("share links and credentials can only be revoked", async ({ page }) => {
  const paper = await createPaperWithPdf(page);
  const share = await page.request.post(
    `/api/v1/papers/${paper.paperId}/shares`,
    {
      headers: await headers(page),
      data: { file_id: paper.fileId, expires_days: 7 },
    },
  );
  expect(share.ok()).toBeTruthy();
  const tokenName = `Test agent ${Date.now().toString(36)}`;
  const token = await page.request.post("/api/v1/tokens", {
    headers: await headers(page),
    data: { name: tokenName, scopes: ["read"], days: 30 },
  });
  expect(token.ok()).toBeTruthy();

  await page.goto(SETTINGS("access"));
  const access = page.getByRole("region", { name: "分享链接和凭据" });
  const shares = access.getByRole("list", { name: "分享链接" });
  const shareRow = shares
    .getByRole("listitem")
    .filter({ hasText: paper.title });
  await expect(shareRow).toContainText("paper.pdf");
  // There is nothing to make here: only revoking.
  await expect(access.getByRole("button", { name: /创建|新建/ })).toHaveCount(
    0,
  );

  await shareRow
    .getByRole("button", { name: `撤销《${paper.title}》的分享链接` })
    .click();
  const confirmShare = page.getByRole("dialog", { name: "撤销这个分享链接？" });
  await confirmShare.getByRole("button", { name: "撤销" }).click();
  await expect(confirmShare).toBeHidden();
  await expect(shareRow).toHaveCount(0);
  const left = await (
    await page.request.get(`/api/v1/papers/${paper.paperId}/shares`)
  ).json();
  expect(left[0].revoked_at).toBeTruthy();

  const tokens = access.getByRole("list", { name: "Agent 凭据" });
  const tokenRow = tokens.getByRole("listitem").filter({ hasText: tokenName });
  await expect(tokenRow).toContainText("只读");
  await tokenRow.getByRole("button", { name: `撤销 ${tokenName}` }).click();
  const confirmToken = page.getByRole("dialog", { name: "撤销这个凭据？" });
  await confirmToken.getByRole("button", { name: "撤销" }).click();
  await expect(tokenRow).toHaveCount(0);
  const rows = await (await page.request.get("/api/v1/tokens")).json();
  expect(
    rows.find((row: { name: string }) => row.name === tokenName).revoked,
  ).toBe(true);

  await page.reload();
  await expect(access.getByText("没有正在使用的分享链接。")).toBeVisible();
});
