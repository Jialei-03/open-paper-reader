import { test, expect } from "@playwright/test";
import { testPdf } from "./fixtures/pdf";
import { cancelActiveRuns } from "./helpers";

test("Reader Agent: selection is passive, explicit actions freeze file context and isolate sessions", async ({
  page,
}) => {
  await page.goto("/#dashboard");
  await page.getByLabel("用户名", { exact: true }).fill("alice");
  await page
    .getByLabel("密码", { exact: true })
    .fill(process.env.E2E_TEST_PASSWORD!);
  await page.getByRole("button", { name: "登录空间", exact: true }).click();
  await expect(page.getByRole("heading", { name: "最近" })).toBeVisible();
  await cancelActiveRuns(page);
  const csrf = (await page.context().cookies()).find(
    (c) => c.name === "paper_csrf",
  )!.value;
  const headers = { "X-CSRF-Token": csrf };
  const post = async (path: string, data: unknown) => {
    const response = await page.request.post("/api/v1" + path, {
      headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
      data,
    });
    expect(response.ok()).toBeTruthy();
    return response.json();
  };
  const paper = await post("/papers", {
    title: "Reader context verification (Agent)",
  });
  const upload = await page.request.post(`/api/v1/papers/${paper.id}/files`, {
    headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
    multipart: {
      version_id: paper.current_version,
      file: {
        name: "context.pdf",
        mimeType: "application/pdf",
        buffer: testPdf(),
      },
    },
  });
  expect(upload.ok()).toBeTruthy();
  const file = await upload.json();
  await post("/translation-settings/configs", {
    base_url: "https://api.minimax.cn/v1",
    model: "MiniMax-M3",
    name: "Context fixture",
    protocol: "openai",
    api_key: "synthetic-e2e-key",
  });
  let submissions = 0;
  page.on("request", (r) => {
    if (
      r.method() === "POST" &&
      /\/agent\/sessions\/[^/]+\/runs$/.test(r.url())
    )
      submissions++;
  });
  await page.goto(`/#paper/${paper.id}`);
  const text = page.getByTestId("pdf-text-layer").first();
  await expect(text).toContainText("Evidence stays connected");
  const line = text
    .locator("span")
    .filter({ hasText: "Evidence stays connected" });
  const bounds = (await line.boundingBox())!;
  const before = await page.locator(".pdf-sheet").boundingBox();
  await page.mouse.move(bounds.x + 1, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    bounds.x + bounds.width - 1,
    bounds.y + bounds.height / 2,
    { steps: 12 },
  );
  await page.mouse.up();
  expect(submissions).toBe(0);
  await expect(page.getByRole("dialog", { name: "研究助手" })).toHaveCount(0);
  expect(await page.locator(".pdf-sheet").boundingBox()).toEqual(before);
  const submitted = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      /\/agent\/sessions\/[^/]+\/runs$/.test(r.url()),
  );
  await page
    .getByRole("dialog", { name: "选中文字操作" })
    .getByRole("button", { name: "解释", exact: true })
    .click();
  const response = await submitted;
  expect(response.ok()).toBeTruthy();
  const run = await response.json();
  expect(submissions).toBe(1);
  expect(run.runtime.reader_context).toMatchObject({
    file_id: file.id,
    paper_id: paper.id,
    page: 1,
    source: "selection",
  });
  expect(run.runtime.reader_context.rects.length).toBeGreaterThan(0);
  expect(run.runtime.reader_context.rects[0].w).toBeGreaterThan(0);
  expect(run.runtime.reader_context.quote).toContain(
    "Evidence stays connected",
  );
  const activity = page.getByLabel("阅读活动记录");
  await expect(activity.getByTestId("reading-activity-card")).toHaveCount(1);
  await activity.getByRole("button", { name: "停止", exact: true }).click();
  await expect(activity.getByText("已停止", { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "解释", exact: true }).click();
  await expect(activity.getByTestId("reading-activity-card")).toHaveCount(1);
  const panel = page.getByRole("dialog", { name: "研究助手" });
  const draw = async () => {
    await page
      .getByRole("radio", { name: "框选图表或公式", exact: true })
      .click();
    const area = (await page.getByTestId("pdf-canvas").first().boundingBox())!;
    await page.mouse.move(area.x + 60, area.y + 65);
    await page.mouse.down();
    await page.mouse.move(area.x + 220, area.y + 120, { steps: 8 });
    await page.mouse.up();
  };
  // The paper's own AI panel is the discussion: it opens beside the PDF and
  // allows explicit switching without creating a chat for every quick action.
  await page.getByRole("button", { name: "AI", exact: true }).click();
  await expect(panel).toBeVisible();
  await expect(panel.getByLabel("Agent 会话", { exact: true })).toBeVisible();
  // Discussing the paper from a region carries a reading context that can be
  // removed again, and its label never exposes the stored file name.
  await draw();
  // The box's own menu opens beside it as soon as it is drawn.
  await page
    .getByRole("dialog", { name: "选区操作" })
    .getByRole("button", { name: "与助手讨论全文", exact: true })
    .click();
  const chip = panel.getByRole("button", { name: "移除阅读上下文" });
  await expect(chip).toBeVisible();
  await expect(panel.getByText("context.pdf")).toHaveCount(0);
  await panel
    .getByRole("button", { name: "添加参考论文", exact: true })
    .click();
  await page.getByLabel("搜索参考论文").fill(paper.title);
  await page.getByRole("button", { name: paper.title, exact: true }).click();
  await page.getByLabel("搜索参考论文").press("Escape");
  await expect(panel.getByText("参考 1 篇论文", { exact: true })).toBeVisible();
  await chip.click();
  await expect(chip).toHaveCount(0);
  // Collapsing and reopening the sidebar keeps the draft's reference.
  await page.getByRole("button", { name: "收起阅读侧栏", exact: true }).click();
  await expect(panel).toHaveCount(0);
  await page.getByRole("button", { name: "AI", exact: true }).click();
  await expect(panel.getByText("参考 1 篇论文", { exact: true })).toBeVisible();
  await expect(panel.getByLabel("Agent 会话", { exact: true })).toBeVisible();
  await panel
    .getByLabel("给 Agent 的消息")
    .fill("Keep this custom reading request");
  const referenceSubmission = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      /\/agent\/sessions\/[^/]+\/runs$/.test(r.url()),
  );
  await panel.getByRole("button", { name: "发送", exact: true }).click();
  const referenceResponse = await referenceSubmission;
  expect(referenceResponse.ok()).toBeTruthy();
  expect(referenceResponse.request().postDataJSON().prompt).toContain(
    `论文 ID: ${paper.id}`,
  );
  const referenceRun = await referenceResponse.json();
  expect(referenceRun.session_id).toBe(run.session_id);
  await page.request.post(`/api/v1/agent/runs/${referenceRun.id}/cancel`, {
    headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
    data: {},
  });
  await panel.getByRole("button", { name: "对话设置", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "切换为悬浮窗", exact: true })
    .click();
  await panel.getByRole("button", { name: "新建 Agent 会话" }).click();
  await expect(panel.getByText("参考 1 篇论文", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    panel.getByRole("button", { name: "移除阅读上下文" }),
  ).toHaveCount(0);
  await panel
    .getByRole("button", { name: "收起研究助手", exact: true })
    .click();
  await draw();
  const formulaRequest = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      /\/agent\/sessions\/[^/]+\/runs$/.test(r.url()),
  );
  await page
    .getByRole("dialog", { name: "选区操作" })
    .getByRole("button", { name: "解释公式", exact: true })
    .click();
  const formulaResponse = await formulaRequest;
  expect(formulaResponse.ok()).toBeTruthy();
  const formulaRun = await formulaResponse.json();
  expect(formulaRun.session_id).not.toBe(run.session_id);
  const paperSessions = await (
    await page.request.get(`/api/v1/agent/sessions?paper_id=${paper.id}`)
  ).json();
  expect(paperSessions).toHaveLength(2);
  expect(paperSessions.map((s: { id: string }) => s.id)).toContain(
    formulaRun.session_id,
  );
  expect(formulaRun.runtime.reader_context.source).toBe("region");
  expect(formulaRun.runtime.reader_context.category).toBe("formula");
  expect(formulaRun.runtime.reader_context.rect).toHaveLength(4);
  expect(formulaResponse.request().postDataJSON().prompt).toContain("符号定义");
  await page.request.post(`/api/v1/agent/runs/${formulaRun.id}/cancel`, {
    headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
    data: {},
  });
  // Opening an older record while the panel is closed must beat default-chat
  // initialization, even though that legacy session is not in the paper picker.
  const legacySession = await post("/agent/sessions", {
    title: "Historical explanation",
  });
  const legacyRun = await post(`/agent/sessions/${legacySession.id}/runs`, {
    prompt: "Historical explanation should open here",
    model_config_id: formulaRun.model_config_id,
    writable: false,
  });
  await page.request.post(`/api/v1/agent/runs/${legacyRun.id}/cancel`, {
    headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
    data: {},
  });
  await page.evaluate(
    ({ sessionId, runId }) => {
      window.dispatchEvent(
        new CustomEvent("open-research-agent", {
          detail: { sessionId, runId },
        }),
      );
    },
    { sessionId: legacySession.id, runId: legacyRun.id },
  );
  await expect(
    panel.getByText("Historical explanation should open here", { exact: true }),
  ).toBeVisible();
});
