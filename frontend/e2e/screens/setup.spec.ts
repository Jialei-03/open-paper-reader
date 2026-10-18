import { expect, test, type Page } from "@playwright/test";
import { signIn } from "../reader/fixtures";

// Home, while there is no model: the app sets one up first.
const SETUP = "/#home";

// Not a real key: the service is never reached, its answers are mocked.
const FAKE_KEY = "sk-test-not-a-real-key";

/** The models alice has, read from the service itself. */
async function models(page: Page): Promise<{ id: string; model: string }[]> {
  const response = await page.request.get("/api/v1/translation-settings");
  expect(response.ok()).toBeTruthy();
  return (await response.json()).models;
}

async function removeAll(page: Page) {
  const csrf = (await page.context().cookies()).find(
    (cookie) => cookie.name === "paper_csrf",
  )!.value;
  for (const row of await models(page))
    await page.request.delete(
      `/api/v1/translation-settings/configs/${row.id}`,
      {
        headers: {
          "X-CSRF-Token": csrf,
          "Idempotency-Key": crypto.randomUUID(),
        },
      },
    );
}

/** The calls that would reach the model's service answer from here. */
async function mockService(page: Page, test: { ok: boolean }) {
  await page.route("**/api/v1/translation-settings/models", (route) =>
    route.fulfill({ json: { models: ["gpt-test-a", "gpt-test-b"] } }),
  );
  await page.route("**/api/v1/translation-settings/configs/*/test", (route) =>
    test.ok
      ? route.fulfill({ json: { ok: true } })
      : route.fulfill({
          status: 502,
          json: { detail: "模型服务返回 401：密钥无效" },
        }),
  );
}

test.beforeEach(async ({ page }) => {
  // The Chinese interface, unless a test (or the page) has chosen otherwise.
  await page.addInitScript(() => {
    if (!localStorage.getItem("paper-locale"))
      localStorage.setItem("paper-locale", "zh");
  });
  await signIn(page);
  await removeAll(page);
});

test.afterEach(async ({ page }) => {
  await removeAll(page);
});

test("a model is kept only once its connection test passes", async ({
  page,
}) => {
  const service = { ok: false };
  await mockService(page, service);
  await page.goto(SETUP);

  await expect(
    page.getByRole("heading", { name: "连接一个模型" }),
  ).toBeVisible();
  await expect(page.getByText("助手需要一个模型来读论文")).toBeVisible();
  const next = page.getByRole("button", { name: "继续" });
  await expect(next).toBeDisabled();
  // Only the local edition offers a model on this computer.
  await expect(page.getByRole("radio", { name: "本机模型" })).toHaveCount(0);

  // Nothing filled in: it says what is missing and sends nothing.
  await page.getByRole("button", { name: "测试连接" }).click();
  await expect(page.getByRole("alert")).toHaveText("请填写服务地址和模型。");

  await page
    .getByLabel("服务地址", { exact: true })
    .fill("https://api.openai.com/v1");
  await page.getByLabel("API 密钥", { exact: true }).fill(FAKE_KEY);
  await page.getByRole("button", { name: "获取模型列表" }).click();
  await expect(page.getByLabel("模型", { exact: true })).toHaveValue(
    "gpt-test-a",
  );
  await expect(page.getByText("找到 2 个模型")).toBeVisible();

  // A model that does not answer is not kept.
  await page.getByRole("button", { name: "测试连接" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "模型服务返回 401：密钥无效",
  );
  await expect(next).toBeDisabled();
  expect(await models(page)).toEqual([]);

  // It answers: the model is kept and chosen, and the way on opens.
  service.ok = true;
  await page.getByLabel("模型", { exact: true }).fill("gpt-test-b");
  await page.getByRole("button", { name: "测试连接" }).click();
  await expect(page.getByRole("status")).toHaveText("已连接 gpt-test-b。");
  await expect(next).toBeEnabled();
  await expect(next).toBeFocused();
  await expect(page.getByLabel("模型", { exact: true })).toBeDisabled();
  const saved = await models(page);
  expect(saved.map((row) => row.model)).toEqual(["gpt-test-b"]);
  const settings = await (
    await page.request.get("/api/v1/translation-settings")
  ).json();
  expect(settings.active_id).toBe(saved[0].id);
  expect(settings.configured).toBe(true);

  // On to home.
  await next.click();
  await expect(page.locator("[data-app-screen]")).toHaveAttribute(
    "data-app-screen",
    "home",
  );
});

test("the local edition offers Ollama and LM Studio at their addresses", async ({
  page,
}) => {
  await page.route("**/api/v1/translation-settings", async (route) => {
    const response = await route.fetch();
    const json = await response.json();
    await route.fulfill({
      response,
      json: { ...json, allowed_hosts: [...json.allowed_hosts, "127.0.0.1"] },
    });
  });
  await page.goto(SETUP);
  // Signing in has shown the setup already: read anew, with the local edition's answer.
  await page.reload();
  await page.getByRole("radio", { name: "本机模型" }).click();
  await expect(page.getByLabel("服务地址", { exact: true })).toHaveValue(
    "http://127.0.0.1:11434/v1",
  );
  // A local app needs no key.
  await expect(page.getByLabel("API 密钥", { exact: true })).toHaveCount(0);
  await page.getByRole("radio", { name: "LM Studio" }).click();
  await expect(page.getByLabel("服务地址", { exact: true })).toHaveValue(
    "http://127.0.0.1:1234/v1",
  );
  await expect(page.getByText("先在这台电脑上打开 LM Studio")).toBeVisible();
});

test("the setup speaks English", async ({ page }) => {
  await mockService(page, { ok: false });
  await page.evaluate(() => localStorage.setItem("paper-locale", "en"));
  // A new address in the same page keeps the language it has: load it anew.
  await page.goto(SETUP);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Connect a model" }),
  ).toBeVisible();
  await page
    .getByLabel("Service address", { exact: true })
    .fill("https://api.openai.com/v1");
  await page.getByLabel("API key", { exact: true }).fill(FAKE_KEY);
  await page.getByLabel("Model", { exact: true }).fill("gpt-test-a");
  await page.getByRole("button", { name: "Test connection" }).click();
  // The service's Chinese reason is not shown in the English interface.
  await expect(page.getByRole("alert")).toHaveText(
    "The model didn't answer. Check the address, the key and the model name.",
  );
  await expect(page.locator("main")).not.toContainText(/[一-鿿]/);
});
