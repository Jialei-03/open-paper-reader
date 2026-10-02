import { test, expect } from "@playwright/test";
import { testPdf } from "./fixtures/pdf";
import { cancelActiveRuns } from "./helpers";

test("Platform conversations remain usable across documents and home", async ({
  page,
}) => {
  await page.goto("/#dashboard");
  await page.getByLabel("用户名", { exact: true }).fill("alice");
  await page
    .getByLabel("密码", { exact: true })
    .fill(process.env.E2E_TEST_PASSWORD!);
  await page.getByRole("button", { name: "登录空间", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "最近", exact: true }),
  ).toBeVisible();
  await cancelActiveRuns(page);
  const csrf = (await page.context().cookies()).find(
    (c) => c.name === "paper_csrf",
  )!.value;
  const headers = { "X-CSRF-Token": csrf };
  const post = async (path: string, data: unknown) => {
    const r = await page.request.post("/api/v1" + path, {
      headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
      data,
    });
    expect(r.ok(), await r.text()).toBeTruthy();
    return r.json();
  };
  const session = await post("/agent/sessions", {
    title: "平台管理与论文推荐",
  });
  const other = await post("/agent/sessions", { title: "另一个可切换的会话" });
  const model = await post("/translation-settings/configs", {
    name: "Shared session fixture",
    model: "MiniMax-M3",
    base_url: "https://api.minimax.cn/v1",
    protocol: "openai",
    api_key: "synthetic-test-key",
  });
  await post(`/agent/sessions/${session.id}/runs`, {
    prompt: "推荐论文并帮我导入",
    model_config_id: model.active_id,
    writable: true,
  });
  await cancelActiveRuns(page);
  const paper = await post("/papers", {
    title: "Shared session reading fixture",
  });
  const second = await post("/papers", {
    title: "Another shared session paper",
  });
  const upload = await page.request.post(`/api/v1/papers/${paper.id}/files`, {
    headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
    multipart: {
      version_id: paper.current_version,
      file: {
        name: "shared.pdf",
        mimeType: "application/pdf",
        buffer: testPdf(),
      },
    },
  });
  expect(upload.ok()).toBeTruthy();
  await page.getByRole("button", { name: "打开研究助手", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "研究助手" });
  const choice = panel.getByLabel("Agent 会话", { exact: true });
  const select = async (title: string) => {
    await choice.click();
    await page.getByRole("option", { name: title, exact: true }).click();
    await expect(choice).toContainText(title);
  };
  await select(session.title);
  await expect(
    panel.getByText("推荐论文并帮我导入", { exact: true }),
  ).toBeVisible();
  await panel.getByLabel("给 Agent 的消息").fill("继续为我推荐并导入论文");
  await page.goto(`/#paper/${paper.id}`);
  await expect(page.getByTestId("pdf-text-layer").first()).toContainText(
    "Evidence stays connected",
  );
  await expect(choice).toContainText(session.title);
  await expect(
    panel.getByText("推荐论文并帮我导入", { exact: true }),
  ).toBeVisible();
  await expect(panel.getByLabel("给 Agent 的消息")).toHaveValue(
    "继续为我推荐并导入论文",
  );
  await select(other.title);
  await select(session.title);
  await expect(panel.getByLabel("给 Agent 的消息")).toHaveValue(
    "继续为我推荐并导入论文",
  );
  const sent = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      r.url().endsWith(`/agent/sessions/${session.id}/runs`),
  );
  await panel.getByRole("button", { name: "发送", exact: true }).click();
  const response = await sent;
  expect(response.ok()).toBeTruthy();
  expect(response.request().postDataJSON()).toMatchObject({
    prompt: "继续为我推荐并导入论文",
    writable: true,
  });
  await cancelActiveRuns(page);
  await panel.getByLabel("给 Agent 的消息").fill("跨文档保留的草稿");
  await page.goto(`/#paper/${second.id}`);
  await expect(choice).toContainText(session.title);
  await expect(panel.getByLabel("给 Agent 的消息")).toHaveValue(
    "跨文档保留的草稿",
  );
  await page
    .locator('[data-slot="sidebar-inner"]')
    .getByRole("button", { name: "我的文库", exact: true })
    .click();
  await expect(choice).toContainText(session.title);
  await expect(panel.getByLabel("给 Agent 的消息")).toHaveValue(
    "跨文档保留的草稿",
  );
  await page.reload();
  await page.getByRole("button", { name: "打开研究助手", exact: true }).click();
  await expect(choice).toContainText(session.title);
  await expect(
    panel.getByText("继续为我推荐并导入论文", { exact: true }),
  ).toBeVisible();
});
