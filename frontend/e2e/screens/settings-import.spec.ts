import { expect, test, type Page } from "@playwright/test";
import { signIn } from "../reader/fixtures";

test.use({ locale: "zh-CN" });

// Not a real key: the provider is never reached, its answers are mocked.
const KEY = "sk-import-not-a-real-key";

type Row = Record<string, any>;

async function mockService(page: Page) {
  let rows: Row[] = [];
  let active = "";
  let next = 1;
  const added: Row[] = [];
  const tested: string[] = [];
  const settings = () => ({
    active_id: active,
    configured: !!active,
    // The service never returns a key.
    models: rows.map(({ api_key: _key, ...row }) => row),
    allowed_hosts: ["api.openai.com", "api.deepseek.com", "openrouter.ai"],
  });
  await page.route("**/api/v1/translation-settings**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace("/api/v1/translation-settings", "");
    const method = request.method();
    if (path === "" && method === "GET")
      return route.fulfill({ json: settings() });
    if (path === "/models")
      return route.fulfill({
        json: {
          models: [
            "deepseek-chat",
            "deepseek-reasoner",
            "gpt-4.1",
            "gpt-4.1-mini",
          ],
        },
      });
    if (path === "/configs" && method === "POST") {
      const body = request.postDataJSON() as Row;
      added.push(body);
      if (body.id) {
        rows = rows.map((row) =>
          row.id === body.id ? { ...row, name: body.name } : row,
        );
      } else {
        const id = `imp-${next++}`;
        rows.push({
          id,
          name: body.model,
          model: body.model,
          protocol: body.protocol,
          base_url: body.base_url,
          controls: { thinking_modes: ["default"], effort_levels: ["default"] },
        });
        active ||= id;
      }
      return route.fulfill({ json: settings() });
    }
    if (path.endsWith("/test")) {
      tested.push(path.split("/")[2]);
      return route.fulfill({ json: { ok: true } });
    }
    if (path.endsWith("/select")) {
      active = path.split("/")[2];
      return route.fulfill({ json: settings() });
    }
    if (method === "DELETE") {
      const id = path.split("/")[2];
      rows = rows.filter((row) => row.id !== id);
      if (active === id) active = rows[0]?.id ?? "";
      return route.fulfill({ json: settings() });
    }
    return route.continue();
  });
  return { added, tested };
}

test("a provider's models are fetched, several are added in one go, and the key is never shown", async ({
  page,
}) => {
  await signIn(page);
  const { added, tested } = await mockService(page);
  await page.goto("/#settings");
  const section = page.getByRole("region", { name: "模型" });
  await expect(section.getByText("还没有模型。")).toBeVisible();

  await section.getByRole("button", { name: "导入", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "导入模型" });
  await dialog.getByRole("button", { name: /OpenAI/ }).click();
  await page.getByRole("menuitem", { name: "DeepSeek" }).click();
  await expect(dialog.getByLabel("服务地址")).toHaveValue(
    "https://api.deepseek.com/v1",
  );
  await dialog.getByLabel("API 密钥").fill(KEY);
  await dialog.getByRole("button", { name: "获取模型列表" }).click();
  await expect(dialog.getByText("找到 4 个模型。")).toBeVisible();

  // Search narrows the list; the selection is kept across searches.
  await dialog.getByRole("searchbox", { name: "搜索模型" }).fill("deepseek");
  const list = dialog.getByRole("list", { name: "可导入的模型" });
  await expect(list.getByRole("listitem")).toHaveCount(2);
  await dialog.getByRole("button", { name: "全选当前结果" }).click();
  await expect(dialog.getByText("已选 2 个")).toBeVisible();
  await dialog.getByRole("searchbox", { name: "搜索模型" }).fill("");
  await list.getByRole("checkbox", { name: "gpt-4.1-mini" }).check();
  await expect(dialog.getByText("已选 3 个")).toBeVisible();

  await dialog.getByRole("button", { name: "添加 3 个模型" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("已添加 3 个模型。")).toBeVisible();

  expect(added.map((body) => body.model)).toEqual([
    "deepseek-chat",
    "deepseek-reasoner",
    "gpt-4.1-mini",
  ]);
  expect(added.every((body) => body.api_key === KEY)).toBe(true);
  // The first one was tested.
  expect(tested).toEqual(["imp-1"]);

  // Grouped by provider; no key anywhere on the page.
  await expect(
    section.getByRole("heading", { name: "api.deepseek.com 的模型" }),
  ).toBeVisible();
  await expect(section.getByRole("listitem")).toHaveCount(3);
  expect(await page.content()).not.toContain(KEY);
  expect(await page.evaluate(() => document.body.innerText)).not.toContain(KEY);
  const values = await page.evaluate(() =>
    [...document.querySelectorAll("input")].map((input) => input.value),
  );
  expect(values.join(" ")).not.toContain(KEY);

  // Rename and choose the default.
  await section.getByRole("button", { name: "重命名 deepseek-chat" }).click();
  const rename = page.getByRole("dialog", { name: "重命名模型" });
  await rename.getByLabel("显示名称").fill("日常模型");
  await rename.getByRole("button", { name: "保存" }).click();
  await expect(section.getByText("日常模型")).toBeVisible();
  await section.getByRole("button", { name: "使用 deepseek-reasoner" }).click();
  await expect(
    section.getByRole("listitem").filter({ hasText: "deepseek-reasoner" }),
  ).toContainText("当前");
});

test("a first model that does not answer leaves nothing behind", async ({
  page,
}) => {
  await signIn(page);
  await mockService(page);
  await page.route("**/api/v1/translation-settings/configs/*/test", (route) =>
    route.fulfill({ status: 502, json: { detail: "bad" } }),
  );
  await page.goto("/#settings");
  const section = page.getByRole("region", { name: "模型" });
  await section.getByRole("button", { name: "导入", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "导入模型" });
  await dialog.getByLabel("API 密钥").fill(KEY);
  await dialog.getByRole("button", { name: "获取模型列表" }).click();
  await dialog.getByRole("checkbox", { name: "gpt-4.1", exact: true }).check();
  await dialog.getByRole("button", { name: "添加 1 个模型" }).click();
  await expect(dialog.getByRole("alert")).toContainText("第一个模型没有回应");
  await dialog.getByRole("button", { name: "关闭" }).click();
  await expect(section.getByText("还没有模型。")).toBeVisible();
});
