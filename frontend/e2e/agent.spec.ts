import { test, expect } from "@playwright/test";
test("Agent: global entry, saved models, persistent sessions, read-only, stop and mobile", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/#dashboard");
  await page.getByLabel("用户名", { exact: true }).fill("alice");
  await page
    .getByLabel("密码", { exact: true })
    .fill(process.env.E2E_TEST_PASSWORD!);
  await page.getByRole("button", { name: "登录空间", exact: true }).click();
  await page.getByRole("button", { name: "打开研究助手" }).click();
  const panel = page.getByRole("dialog");
  await expect(panel.getByRole("heading", { name: "研究助手" })).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "发送", exact: true }),
  ).toBeDisabled();
  await expect(panel.getByLabel("API Key", { exact: true })).toHaveCount(0);
  await panel.getByRole("button", { name: "对话设置" }).click();
  await page.getByRole("menuitem", { name: "模型设置", exact: true }).click();
  await expect(page).toHaveURL(/#settings/);
  await page.getByRole("tab", { name: "数据与存储", exact: true }).click();
  await expect(page.getByText("存储空间", { exact: true })).toBeVisible();
  await expect(page.getByText(/已用 .* MB \/ 1.0 GB/)).toBeVisible();
  await page.getByText("存储空间", { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "../test-results/storage-usage.png",
    animations: "disabled",
  });

  const csrf = (await page.context().cookies()).find(
    (c) => c.name === "paper_csrf",
  )!.value;
  const cfg = await page.request.post("/api/v1/translation-settings/configs", {
    headers: { "X-CSRF-Token": csrf },
    data: {
      base_url: "https://api.minimax.cn/v1",
      model: "MiniMax-M3",
      name: "MiniMax 测试模型",
      protocol: "openai",
      api_key: "synthetic-e2e-key",
    },
  });
  expect(cfg.ok()).toBeTruthy();
  const configured = await cfg.json();
  await page.keyboard.press("Control+j");
  await expect(panel.getByLabel("Agent 模型", { exact: true })).toContainText(
    "MiniMax 测试模型",
  );
  await panel.getByRole("button", { name: "新建 Agent 会话" }).click();
  await panel.getByRole("button", { name: "对话设置" }).click();
  await page.getByRole("menuitemcheckbox", { name: "允许修改文库" }).click();
  await panel.getByLabel("给 Agent 的消息").fill("列出我的论文，不要修改");
  await panel.getByRole("button", { name: "发送", exact: true }).click();
  await expect(
    panel.getByRole("button", { name: "停止", exact: true }),
  ).toBeVisible();
  await expect(panel.getByText("等待回复…")).toBeVisible();
  await expect(panel.getByText("等待回复…")).toHaveCSS("font-size", "12px");
  await expect(panel.getByText(/已排队/)).toHaveCount(0);
  await page.screenshot({
    path: "../test-results/agent-quiet-waiting.png",
    animations: "disabled",
  });
  const sessions = await (
    await page.request.get("/api/v1/agent/sessions")
  ).json();
  const first = sessions[0].id;
  const runs = await (
    await page.request.get(`/api/v1/agent/sessions/${first}/runs`)
  ).json();
  expect(runs[0].writable).toBe(false);
  const runsPath = `**/api/v1/agent/sessions/${first}/runs`;
  let streamedReply = "";
  await page.route(runsPath, async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    await route.fulfill({
      response,
      json: data.map((r: { id: string }) =>
        r.id === runs[0].id
          ? {
              ...r,
              status: "running",
              response: streamedReply,
              runtime: {
                phase: "waiting_model",
                waiting_seconds: 75,
                execution_seconds: 4,
              },
            }
          : r,
      ),
    });
  });
  await expect(panel.getByText("等待回复…", { exact: true })).toBeVisible();
  await expect(panel.getByText(/执行 4秒 · 等待 1分15秒/)).toHaveCount(0);
  await expect(panel.getByTitle(/等待服务响应.*等待 1分15秒/)).toBeVisible();
  await page.screenshot({ path: "../test-results/agent-waiting-stage.png" });
  await panel.getByRole("button", { name: "切换为悬浮窗" }).click();
  const regularBox = await panel.boundingBox();
  await panel.getByRole("button", { name: "紧凑窗口", exact: true }).click();
  expect((await panel.boundingBox())!.width).toBeLessThan(regularBox!.width);
  await expect(
    panel.getByRole("button", { name: "停止", exact: true }),
  ).toBeVisible();
  await expect(panel.getByText("等待回复…", { exact: true })).toBeVisible();
  await page.screenshot({
    path: "../test-results/agent-compact-running.png",
    animations: "disabled",
  });

  streamedReply = "第一部分已经到达。";
  await expect(panel.getByText(streamedReply, { exact: true })).toBeVisible();
  await expect(panel.locator(".streaming-markdown")).toHaveAttribute(
    "aria-busy",
    "true",
  );
  await expect(panel.getByText("正在生成…", { exact: true })).toBeVisible();
  await panel.locator(".streaming-markdown .markdown").evaluate((element) => {
    const lengths: number[] = [];
    const observer = new MutationObserver(() => {
      lengths.push(element.textContent?.length || 0);
      element.setAttribute("data-typing-lengths", JSON.stringify(lengths));
    });
    observer.observe(element, {
      subtree: true,
      childList: true,
      characterData: true,
    });
    setTimeout(() => observer.disconnect(), 5000);
  });
  streamedReply += " 后续内容逐字显示。".repeat(12);
  await expect(panel.getByText(streamedReply, { exact: true })).toBeVisible();
  const lengths = JSON.parse(
    (await panel
      .locator(".streaming-markdown .markdown")
      .getAttribute("data-typing-lengths")) || "[]",
  ) as number[];
  expect(
    new Set(lengths.filter((n) => n > 10 && n < streamedReply.length)).size,
  ).toBeGreaterThan(3);
  expect(lengths.at(-1)).toBe(streamedReply.length);
  await page.screenshot({ path: "../test-results/agent-streaming.png" });
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(
    await panel
      .locator(".streaming-markdown .streaming-status")
      .evaluate(
        (element) => getComputedStyle(element, "::before").animationName,
      ),
  ).toBe("none");
  await page.emulateMedia({ reducedMotion: "no-preference" });

  await page.unroute(runsPath);

  await panel.getByRole("button", { name: "停止", exact: true }).click();
  await expect(
    panel.getByText("已停止后续操作；已完成的修改保留。"),
  ).toBeVisible();
  await panel
    .getByRole("button", { name: "恢复常规窗口", exact: true })
    .click();
  expect((await panel.boundingBox())!.width).toBeCloseTo(regularBox!.width, 0);
  await panel.getByRole("button", { name: "重命名会话" }).click();
  await panel.getByLabel("会话名称").fill("文库整理");
  await panel.getByRole("button", { name: "保存名称" }).click();
  await panel.getByRole("button", { name: "新建 Agent 会话" }).click();
  await expect(panel.getByLabel("Agent 会话", { exact: true })).toContainText(
    "新会话",
  );
  await panel.getByLabel("Agent 会话", { exact: true }).click();
  await page.getByRole("option", { name: "文库整理", exact: true }).click();
  await expect(
    panel.getByText("列出我的论文，不要修改", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "打开研究助手" }).click();
  await expect(
    panel.getByText("列出我的论文，不要修改", { exact: true }),
  ).toBeVisible();
  let interrupted = false;
  await page.route(`**/api/v1/agent/sessions/${first}/runs`, async (route) => {
    if (!interrupted) {
      interrupted = true;
      await route.fulfill({ status: 502, body: "" });
    } else await route.continue();
  });
  await expect(
    panel.getByText("连接暂时中断，正在重试；已有消息和任务会保留。"),
  ).toBeVisible();
  await expect(
    panel.getByText("连接暂时中断，正在重试；已有消息和任务会保留。"),
  ).toHaveCount(0);
  await page.unroute(`**/api/v1/agent/sessions/${first}/runs`);
  // The window is non-modal: users can navigate underneath it.
  const before = await panel.boundingBox();
  const title = panel.getByLabel("移动研究助手窗口");
  const bar = await title.boundingBox();
  await page.mouse.move(bar!.x + 50, bar!.y + 15);
  await page.mouse.down();
  await page.mouse.move(bar!.x - 180, bar!.y + 90, { steps: 10 });
  await page.mouse.up();
  const moved = await panel.boundingBox();
  expect(moved!.x).toBeLessThan(before!.x - 100);
  const handle = panel.getByRole("button", {
    name: "调整窗口大小 se",
    exact: true,
  });
  const corner = await handle.boundingBox();
  await page.mouse.move(corner!.x + 4, corner!.y + 4);
  await page.mouse.down();
  await page.mouse.move(corner!.x + 90, corner!.y + 40, { steps: 10 });
  await page.mouse.up();
  const resized = await panel.boundingBox();
  expect(resized!.width).toBeGreaterThan(moved!.width + 50);
  await page.getByRole("button", { name: "我的文库", exact: true }).click();
  await expect(page).toHaveURL(/#library/);
  await expect(panel).toBeVisible();
  await panel.getByRole("button", { name: "能力范围", exact: true }).click();
  await expect(panel.getByText("阅读与笔记", { exact: true })).toBeVisible();
  await expect(panel.locator(".agent-capabilities strong")).toHaveCount(4);
  await page.screenshot({ path: "../test-results/agent-capabilities.png" });
  await panel.getByRole("button", { name: "能力范围", exact: true }).click();
  await panel.getByRole("button", { name: "紧凑窗口", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: "打开研究助手" }).click();
  await expect(panel).toHaveAttribute("data-compact", "true");
  await panel
    .getByRole("button", { name: "恢复常规窗口", exact: true })
    .click();
  expect((await panel.boundingBox())!.width).toBeCloseTo(resized!.width, 0);
  expect(
    (await panel.locator(".agent-composer").boundingBox())!.height,
  ).toBeLessThan(160);
  await page.screenshot({
    path: "../test-results/agent-desktop.png",
    animations: "disabled",
  });
  await panel.getByRole("button", { name: "收起研究助手" }).click();
  await page.goto("/#notebook");
  await page.keyboard.press("Control+j");
  await expect(panel.getByRole("heading", { name: "研究助手" })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "../test-results/agent-mobile.png",
    animations: "disabled",
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
  await panel
    .getByRole("button", { name: "继续未完成任务", exact: true })
    .click();
  await expect(
    panel.getByRole("button", { name: "停止", exact: true }),
  ).toBeVisible();
  const resumed = await (
    await page.request.get(`/api/v1/agent/sessions/${first}/runs`)
  ).json();
  expect(resumed).toHaveLength(2);
  expect(resumed[1].runtime.resume_from).toBe(runs[0].id);
  expect(resumed[1].prompt).toBe(runs[0].prompt);
  await expect(panel.getByText(/MiniMax-M3 · 续接/)).toBeVisible();
  await panel.getByRole("button", { name: "紧凑窗口", exact: true }).click();
  const compactMobile = (await panel.boundingBox())!;
  expect(compactMobile.x).toBeGreaterThanOrEqual(8);
  expect(compactMobile.x + compactMobile.width).toBeLessThanOrEqual(382);
  expect(compactMobile.y + compactMobile.height).toBeLessThanOrEqual(836);
  await expect(
    panel.getByRole("button", { name: "停止", exact: true }),
  ).toBeVisible();

  await page.screenshot({
    path: "../test-results/agent-resume-mobile.png",
    animations: "disabled",
  });
  await panel.getByRole("button", { name: "停止", exact: true }).click();

  expect(
    (
      await page.request.delete(
        `/api/v1/translation-settings/configs/${configured.active_id}`,
        { headers: { "X-CSRF-Token": csrf } },
      )
    ).ok(),
  ).toBeTruthy();
});

test("Agent: authenticated image previews, enlarge and explicit vision configuration", async ({
  page,
}) => {
  await page.goto("/#dashboard");
  await page.getByLabel("用户名", { exact: true }).fill("alice");
  await page
    .getByLabel("密码", { exact: true })
    .fill(process.env.E2E_TEST_PASSWORD!);
  await page.getByRole("button", { name: "登录空间", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "打开研究助手" }),
  ).toBeVisible();
  const csrf = (await page.context().cookies()).find(
    (c) => c.name === "paper_csrf",
  )!.value;
  const headers = {
    "X-CSRF-Token": csrf,
    "Idempotency-Key": crypto.randomUUID(),
  };
  const p = await (
    await page.request.post("/api/v1/papers", {
      headers,
      data: { title: "视觉功能验收（合成图表）" },
    })
  ).json();
  const encoded = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 720;
    canvas.height = 400;
    const c = canvas.getContext("2d")!;
    c.fillStyle = "white";
    c.fillRect(0, 0, 720, 400);
    c.fillStyle = "#27272a";
    c.font = "28px sans-serif";
    c.fillText("Synthetic chart / visual QA", 40, 50);
    [110, 200, 260].forEach((height, i) => {
      c.fillStyle = ["#0d9488", "#6366f1", "#d97706"][i];
      c.fillRect(90 + i * 180, 350 - height, 90, height);
      c.fillStyle = "#27272a";
      c.font = "20px sans-serif";
      c.fillText(String(height), 110 + i * 180, 330 - height);
    });
    return canvas.toDataURL("image/png").split(",")[1];
  });
  const f = await (
    await page.request.post(`/api/v1/papers/${p.id}/files`, {
      headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
      multipart: {
        version_id: p.current_version,
        file: {
          name: "visual-qa.png",
          mimeType: "image/png",
          buffer: Buffer.from(encoded, "base64"),
        },
      },
    })
  ).json();
  const uploaded = await (
    await page.request.post("/api/v1/agent/attachments", {
      headers,
      multipart: {
        file: {
          name: "uploaded-chart.png",
          mimeType: "image/png",
          buffer: Buffer.from(encoded, "base64"),
        },
      },
    })
  ).json();
  const imageUrl = `/api/v1/agent/files/${f.id}/image?page=1&asset=`;
  const imageResponse = await page.request.get(imageUrl);
  expect(imageResponse.ok(), await imageResponse.text()).toBeTruthy();
  const session = await (
    await page.request.post("/api/v1/agent/sessions", {
      headers,
      data: { title: "图片预览验收" },
    })
  ).json();
  await page.route("**/api/v1/agent/sessions/*/runs", (route) =>
    route.fulfill({
      json: [
        {
          id: "visual-fixture",
          prompt: "请展示论文中的图表",
          attachments: [uploaded],
          response: "图表已显示，可点击放大查看。",
          status: "completed",
          model: "视觉验收模型",
          error: "",
          writable: false,
          steps: [
            {
              name: "view_image",
              label: "查看图表",
              status: "completed",
              arguments: { id: f.id },
              vision_delivered: true,
              images: [
                {
                  url: imageUrl,
                  label: "visual-qa.png · 第 1 页",
                  paper_id: p.id,
                  width: 720,
                  height: 400,
                },
              ],
            },
          ],
        },
      ],
    }),
  );
  await page.getByRole("button", { name: "打开研究助手" }).click();
  const panel = page.getByRole("dialog", { name: "研究助手" });
  await panel.getByLabel("Agent 会话", { exact: true }).click();
  await page.getByRole("option", { name: "图片预览验收", exact: true }).click();
  const img = panel.getByAltText("visual-qa.png");
  await expect(img).toBeVisible();
  await expect
    .poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth))
    .toBe(720);
  await panel.getByRole("button", { name: "放大图片：visual-qa.png" }).click();
  const preview = page.getByRole("dialog", { name: "visual-qa.png" });
  await expect(preview).toBeVisible();
  await page.screenshot({
    path: "../test-results/agent-image-preview.png",
    animations: "disabled",
  });
  await preview.getByRole("button", { name: "关闭", exact: true }).click();
  let downloads = 0;
  page.on("download", () => downloads++);
  await panel
    .getByRole("button", { name: "预览附件：uploaded-chart.png" })
    .click();
  const attachmentPreview = page.getByRole("dialog", {
    name: "uploaded-chart.png",
  });
  await expect(
    attachmentPreview.getByAltText("uploaded-chart.png"),
  ).toBeVisible();
  await expect
    .poll(() =>
      attachmentPreview
        .getByAltText("uploaded-chart.png")
        .evaluate((el: HTMLImageElement) => el.naturalWidth),
    )
    .toBe(720);
  await expect(
    attachmentPreview.getByRole("link", { name: "下载附件" }),
  ).toBeVisible();
  expect(downloads).toBe(0);
  await page.screenshot({
    path: "../test-results/chat-upload-preview.png",
    animations: "disabled",
  });
  await attachmentPreview
    .getByRole("button", { name: "关闭", exact: true })
    .click();
  await panel.getByRole("button", { name: "对话设置" }).click();
  await page.getByRole("menuitem", { name: "模型设置", exact: true }).click();
  await page.getByRole("button", { name: "添加模型", exact: true }).click();
  const form = page.getByRole("dialog", { name: "添加模型" });
  await form.getByLabel("显示名称").fill("Vision UI QA");
  await form.getByLabel("模型服务地址").fill("https://api.openai.com/v1");
  await form.getByLabel("API Key", { exact: true }).fill("synthetic-only");
  await form.getByRole("button", { name: "手动填写" }).click();
  await form.getByLabel("模型名称", { exact: true }).fill("visual-test");
  await form.getByLabel("图片输入（视觉）", { exact: true }).click();
  await form.getByRole("button", { name: "保存模型", exact: true }).click();
  await expect(page.getByText(/输入：文本、图片/)).toBeVisible();
  const cfg = await (
    await page.request.get("/api/v1/translation-settings")
  ).json();
  const model = cfg.models.find(
    (m: { name: string }) => m.name === "Vision UI QA",
  );
  expect(model.vision).toBe(true);
  await page.request.delete(
    `/api/v1/translation-settings/configs/${model.id}`,
    { headers },
  );
  await page.unroute("**/api/v1/agent/sessions/*/runs");
  await page.request.delete(`/api/v1/agent/sessions/${session.id}`, {
    headers,
  });
});

test("Shared MiniMax is labeled free without exposing configuration controls", async ({
  page,
}) => {
  await page.route("**/api/v1/translation-settings", async (route) => {
    await route.fulfill({
      json: {
        configured: true,
        active_id: "platform-minimax",
        model: "MiniMax-M3",
        protocol: "openai",
        base_url: "https://api.minimax.cn/v1",
        allowed_hosts: [],
        models: [
          {
            id: "platform-minimax",
            name: "MiniMax",
            model: "MiniMax-M3",
            protocol: "openai",
            base_url: "https://api.minimax.cn/v1",
            vision: true,
            shared: true,
            badge: "限时免费",
            concurrency_limit: 3,
          },
        ],
      },
    });
  });
  await page.goto("/#dashboard");
  await page.getByLabel("用户名", { exact: true }).fill("bob");
  await page
    .getByLabel("密码", { exact: true })
    .fill(process.env.E2E_TEST_PASSWORD!);
  await page.getByRole("button", { name: "登录空间", exact: true }).click();
  await page.getByRole("button", { name: "空间设置", exact: true }).click();
  await expect(page.getByText("限时免费", { exact: true })).toBeVisible();
  await expect(page.getByText("限时免费", { exact: true })).toHaveAttribute(
    "title",
    "共享并发最多 3",
  );
  await expect(page.getByLabel("API Key", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /管理.*MiniMax/ })).toHaveCount(
    0,
  );
  await page.screenshot({
    path: "../test-results/shared-minimax-settings.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "打开研究助手" }).click();
  await expect(page.getByLabel("Agent 模型", { exact: true })).toContainText(
    "MiniMax",
  );
});

test("Chat attachments: upload, remove, session drafts and persisted message", async ({
  page,
}) => {
  await page.goto("/#dashboard");
  await page.getByLabel("用户名", { exact: true }).fill("bob");
  await page
    .getByLabel("密码", { exact: true })
    .fill(process.env.E2E_TEST_PASSWORD!);
  await page.getByRole("button", { name: "登录空间", exact: true }).click();
  await page.getByRole("button", { name: "打开研究助手" }).click();
  const panel = page.getByRole("dialog", { name: "研究助手" });
  const csrf = (await page.context().cookies()).find(
    (c) => c.name === "paper_csrf",
  )!.value;
  await page.request.post("/api/v1/translation-settings/configs", {
    headers: { "X-CSRF-Token": csrf },
    data: {
      name: "附件测试",
      model: "test-model",
      base_url: "https://api.minimax.cn/v1",
      api_key: "synthetic-test-key",
    },
  });
  await panel.getByRole("button", { name: "收起研究助手" }).click();
  await page.getByRole("button", { name: "打开研究助手" }).click();
  const input = panel.getByLabel("聊天附件文件");
  await input.setInputFiles({
    name: "notes.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("Attachment proof: blue whale 42"),
  });
  await expect(
    panel.getByRole("button", { name: "移除附件 notes.md" }),
  ).toBeVisible();
  await panel.getByRole("button", { name: "移除附件 notes.md" }).click();
  await expect(
    panel.getByRole("button", { name: "移除附件 notes.md" }),
  ).toHaveCount(0);
  await input.setInputFiles({
    name: "notes.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("Attachment proof: blue whale 42"),
  });
  await expect(
    panel.getByRole("button", { name: "添加附件", exact: true }),
  ).toBeEnabled();
  await panel.getByLabel("给 Agent 的消息").fill("请阅读我的附件");
  await panel.getByRole("button", { name: "发送", exact: true }).click();
  await expect(
    panel.getByRole("link", { name: "notes.md", exact: true }),
  ).toBeVisible();
  const url = await panel
    .getByRole("link", { name: "notes.md", exact: true })
    .getAttribute("href");
  expect(await (await page.request.get(url!)).text()).toContain(
    "blue whale 42",
  );
  await page.reload();
  await page.getByRole("button", { name: "打开研究助手" }).click();
  await expect(
    panel.getByRole("link", { name: "notes.md", exact: true }),
  ).toBeVisible();
  await panel.getByRole("button", { name: "停止", exact: true }).click();
  const artifactId = url!.split("/attachments/")[1].split("/")[0];
  await page.route("**/api/v1/agent/sessions/*/runs", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const response = await route.fetch();
    const rows = await response.json();
    if (rows.length)
      Object.assign(rows.at(-1), {
        status: "completed",
        response: `[result.md](#attachment/${artifactId})`,
        steps: [
          {
            name: "write_note",
            label: "保存笔记",
            status: "completed",
            arguments: {},
            receipt: {
              entity_type: "items",
              state: "saved",
              verification: "confirmed",
              url: "#item/receipt-fixture",
            },
          },
          {
            name: "export_file",
            label: "导出文件",
            status: "completed",
            arguments: {},
            files: [
              {
                id: artifactId,
                name: "result.md",
                url,
                mime: "text/markdown",
                size: 32,
              },
            ],
          },
        ],
      });
    await route.fulfill({ response, json: rows });
  });
  await expect(
    panel.getByRole("link", { name: "下载 result.md" }),
  ).toHaveAttribute("href", url!);
  await expect(
    panel.getByRole("link", { name: "result.md", exact: true }),
  ).toHaveAttribute("href", url!);
  await expect(
    panel.getByRole("link", { name: "笔记已保存并核验" }),
  ).toHaveAttribute("href", "#item/receipt-fixture");
  await page.screenshot({
    path: "../test-results/chat-attachments.png",
    fullPage: true,
  });
});

test("Agent accepts more messages while earlier tasks run and stops them together", async ({
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
  const { cancelActiveRuns } = await import("./helpers");
  await cancelActiveRuns(page);
  const csrf = (await page.context().cookies()).find(
    (c) => c.name === "paper_csrf",
  )!.value;
  const configured = await page.request.post(
    "/api/v1/translation-settings/configs",
    {
      headers: { "X-CSRF-Token": csrf },
      data: {
        base_url: "https://api.minimax.cn/v1",
        model: "MiniMax-M3",
        name: "Concurrency fixture",
        api_key: "synthetic-concurrency-key",
      },
    },
  );
  expect(configured.ok()).toBeTruthy();
  await page.getByRole("button", { name: "打开研究助手" }).click();
  const panel = page.getByRole("dialog", { name: "研究助手", exact: true });
  await panel.getByRole("button", { name: "新建 Agent 会话" }).click();
  await expect(
    panel.getByRole("button", { name: "新建 Agent 会话" }),
  ).toBeEnabled();
  await expect(
    panel.getByText("告诉我你想处理哪篇论文，或从整理文库开始。", {
      exact: true,
    }),
  ).toBeVisible();
  const input = panel.getByLabel("给 Agent 的消息");
  for (let index = 1; index <= 4; index++) {
    await input.fill(`Concurrent question ${index}`);
    await expect(
      panel.getByRole("button", { name: "发送", exact: true }),
    ).toBeEnabled();
    await panel.getByRole("button", { name: "发送", exact: true }).click();
    await expect(input).toHaveValue("");
    await expect(
      panel
        .getByRole("region", { name: "Messages", exact: true })
        .getByText(`Concurrent question ${index}`, { exact: true }),
    ).toBeVisible();
  }
  await expect(
    panel.getByRole("button", { name: "添加附件", exact: true }),
  ).toBeEnabled();
  await expect(
    panel.getByRole("button", { name: "停止全部任务", exact: true }),
  ).toBeVisible();
  const sessions = await (
    await page.request.get("/api/v1/agent/sessions")
  ).json();
  const runs = await (
    await page.request.get(`/api/v1/agent/sessions/${sessions[0].id}/runs`)
  ).json();
  expect(
    runs.filter((r: { status: string }) =>
      ["queued", "running"].includes(r.status),
    ),
  ).toHaveLength(4);
  await panel
    .getByRole("button", { name: "停止全部任务", exact: true })
    .click();
  await expect(
    panel.getByRole("button", { name: "停止全部任务", exact: true }),
  ).toHaveCount(0);
  await expect(
    panel.getByText("已停止后续操作；已完成的修改保留。", { exact: true }),
  ).toHaveCount(4);
  await expect(
    panel.getByRole("button", { name: "发送", exact: true }),
  ).toBeVisible();
});
