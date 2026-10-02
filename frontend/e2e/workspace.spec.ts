import { test, expect, Page } from "@playwright/test";
import fs from "node:fs";
// Optional integration input: a directory with manifest.json and the original
// files of a real paper. Without it the test that needs it is skipped.
const sample = process.env.REALMEM_FIXTURE_DIR || "";
const manifest =
  sample && fs.existsSync(sample + "/manifest.json")
    ? JSON.parse(fs.readFileSync(sample + "/manifest.json", "utf8"))
    : null;
test("Local OpenAPI documentation renders under restrictive CSP", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/api/v1/docs");
  await expect(page.locator(".swagger-ui")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Authorize", exact: true }),
  ).toBeVisible();
  await expect(
    page.locator('.opblock-summary-path[data-path="/api/v1/papers"]'),
  ).toHaveCount(2);
  expect(errors).toEqual([]);
});
async function login(page: Page, user = "alice") {
  await page.goto("/#dashboard");
  await page.getByLabel("用户名", { exact: true }).fill(user);
  await page
    .getByLabel("密码", { exact: true })
    .fill(process.env.E2E_TEST_PASSWORD!);
  await page.getByRole("button", { name: "登录空间", exact: true }).click();
  await expect(page.getByRole("heading", { name: "最近" })).toBeVisible();
}
async function csrf(page: Page) {
  return (await page.context().cookies()).find((c) => c.name === "paper_csrf")!
    .value;
}
async function write(
  page: Page,
  url: string,
  data: any,
  method = "POST",
  revision?: number,
) {
  const r = await page.request.fetch("/api/v1" + url, {
    method,
    data,
    headers: {
      "X-CSRF-Token": await csrf(page),
      "Idempotency-Key": crypto.randomUUID(),
      ...(revision ? { "If-Match": String(revision) } : {}),
    },
  });
  expect(r.ok(), await r.text()).toBeTruthy();
  return r.json();
}
async function upload(page: Page, file: string, sourcePath?: string) {
  await page.getByRole("button", { name: "论文信息", exact: true }).click();
  await page.getByRole("button", { name: "上传附件", exact: true }).click();
  const d = page.getByRole("dialog");
  await d.locator("input[type=file]").setInputFiles(file);
  if (sourcePath) await d.getByLabel("原始相对路径").fill(sourcePath);
  await d.getByRole("button", { name: "上传附件", exact: true }).click();
  await expect(d).not.toBeVisible();
}

test("RealMem: real import, PDF and source preview, evidence, notes, history, topics, reading and export", async ({
  page,
}) => {
  test.skip(
    !manifest,
    "RealMem originals unavailable; set REALMEM_FIXTURE_DIR to run this integration.",
  );
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await login(page);
  await page.getByRole("button", { name: "导入论文", exact: true }).click();
  let d = page.getByRole("dialog");
  await d.getByLabel("论文标题").fill(manifest.pdf.metadata.title);
  await d
    .getByLabel("作者", { exact: true })
    .fill(manifest.pdf.metadata.author);
  await d.getByLabel("标识 / arXiv ID").fill(manifest.paper_id);
  await d.getByLabel("标签", { exact: true }).fill("memory, evaluation");
  await d.getByLabel("来源与溯源").fill(manifest.source_url);
  await d.getByRole("button", { name: "创建论文" }).click();
  await expect(
    page.getByRole("heading", {
      name: manifest.pdf.metadata.title,
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "上传第一个附件" }).click();
  d = page.getByRole("dialog");
  await d
    .locator("input[type=file]")
    .setInputFiles(sample + "/source/paper-v1.pdf");
  await d.getByRole("button", { name: "上传附件", exact: true }).click();
  await expect(d).not.toBeVisible();
  await expect(page.getByTestId("pdf-canvas")).toHaveAttribute(
    "data-rendered",
    "true",
  );
  expect(
    await page.getByTestId("pdf-canvas").evaluate((c: HTMLCanvasElement) => {
      const x = c.getContext("2d")!;
      const data = x.getImageData(0, 0, c.width, c.height).data;
      return data.some((v, i) => i % 4 < 3 && v < 180);
    }),
  ).toBeTruthy();
  await expect(page.getByText("/ 18", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "下一页", exact: true }).click();
  await expect(page.getByLabel("PDF 页码")).toHaveValue("2");
  await expect(page.getByTestId("pdf-canvas")).toHaveAttribute(
    "data-rendered",
    "true",
  );
  await upload(
    page,
    sample + "/source/latex-v1/sec/method.tex",
    "sec/method.tex",
  );
  await upload(page, sample + "/visual/framework.png");
  await upload(page, sample + "/SOP-v0.1.md");
  await upload(page, sample + "/source/source-v1.tar");
  await page.getByRole("button", { name: "论文信息", exact: true }).click();
  await page.getByLabel("预览文件").click();
  await page
    .getByRole("option", { name: "sec/method.tex · v1", exact: true })
    .click();
  await expect(page.getByText("UTF-8 源码 · 点击行号定位")).toBeVisible();
  await page.getByRole("button", { name: "选择第 2 行", exact: true }).click();
  await page.getByRole("tab", { name: /^证据\s*0$/ }).click();
  await page.getByRole("button", { name: "添加原文证据" }).click();
  d = page.getByRole("dialog");
  await d.getByLabel("标题", { exact: true }).fill("RealMem 方法源码位置");
  await d.locator("#item-body").fill("保留原文位置，等待进一步阅读核验。");
  await d.getByRole("button", { name: "保存原文证据" }).click();
  await expect(d).not.toBeVisible();
  await expect(
    page.getByRole("heading", { name: "RealMem 方法源码位置" }),
  ).toBeVisible();
  await page.getByRole("tab", { name: /^批注\s*0$/ }).click();
  await page.getByRole("button", { name: "添加个人笔记" }).click();
  d = page.getByRole("dialog");
  await d.getByLabel("标题", { exact: true }).fill("我的方法阅读笔记");
  await d
    .locator("#item-body")
    .fill("这里只记录自己的问题，还没有确认已读全文。");
  await d.getByRole("button", { name: "保存个人笔记" }).click();
  await expect(d).not.toBeVisible();
  await page
    .locator(".note-card")
    .getByRole("button", { name: "编辑", exact: true })
    .click();
  d = page.getByRole("dialog");
  await d.locator("#item-body").fill("更新：需要对照 PDF 核验框架图。");
  await d.getByRole("button", { name: "保存个人笔记" }).click();
  await expect(d).not.toBeVisible();
  await page
    .locator(".note-card")
    .getByRole("button", { name: "历史", exact: true })
    .click();
  d = page.getByRole("dialog");
  await expect(
    d.getByText("这里只记录自己的问题，还没有确认已读全文。", { exact: true }),
  ).toBeVisible();
  await expect(
    d.getByText("更新：需要对照 PDF 核验框架图。", { exact: true }),
  ).toBeVisible();
  await d.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("tab", { name: /^问题\s*0$/ }).click();
  await page.getByRole("button", { name: "添加开放问题" }).click();
  d = page.getByRole("dialog");
  await d
    .getByLabel("标题", { exact: true })
    .fill("框架图与方法源码如何对应？");
  await d.locator("#item-body").fill("请在后续阅读时对照图示。");
  await d.getByRole("button", { name: "保存开放问题" }).click();
  await expect(d).not.toBeVisible();
  await expect(page.getByText("本人 · 未读", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "记录阅读进度", exact: true }).click();
  d = page.getByRole("dialog");
  await d.getByLabel("我的状态").click();
  await page.getByRole("option", { name: "阅读中", exact: true }).click();
  await d
    .getByLabel("已读范围 / 进度说明")
    .fill("仅开始查看方法源码；尚未读完。");
  await d.getByRole("button", { name: "确认并记录" }).click();
  await expect(d).not.toBeVisible();
  await expect(page.getByText("本人 · 阅读中", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "论文信息", exact: true }).click();
  await page.getByLabel("预览文件").click();
  await page
    .getByRole("option", { name: "framework.png · v1", exact: true })
    .click();
  await expect(page.getByAltText("framework.png")).toBeVisible();
  expect(
    await page
      .getByAltText("framework.png")
      .evaluate((i: HTMLImageElement) => i.naturalWidth),
  ).toBeGreaterThan(0);
  await page.getByRole("button", { name: "论文信息", exact: true }).click();
  await page.getByLabel("预览文件").click();
  await page
    .getByRole("option", { name: "SOP-v0.1.md · v1", exact: true })
    .click();
  await expect(page.locator(".markdown-preview")).toBeVisible();
  await page.getByRole("button", { name: "论文信息", exact: true }).click();
  await page.getByLabel("预览文件").click();
  await page
    .getByRole("option", { name: "source-v1.tar · v1", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "此格式暂不支持预览" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "论文信息", exact: true }).click();
  await page.getByLabel("预览文件").click();
  await page
    .getByRole("option", { name: "paper-v1.pdf · v1", exact: true })
    .click();
  await expect(page.getByTestId("pdf-canvas")).toHaveAttribute(
    "data-rendered",
    "true",
  );
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: "../test-results/reader-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  const papers = await (await page.request.get("/api/v1/papers")).json();
  const paper = papers.find((p: any) => p.external_id === manifest.paper_id);
  const files = await (
    await page.request.get("/api/v1/papers/" + paper.id + "/files")
  ).json();
  const pdf = await page.request.get(
    "/api/v1/files/" +
      files.find((f: any) => f.mime === "application/pdf").id +
      "/content",
  );
  expect(
    (await pdf.body()).equals(fs.readFileSync(sample + "/source/paper-v1.pdf")),
  ).toBeTruthy();
  await page.goto("/#topics"); // Legacy deep links remain compatible; no main-navigation entry.
  await page.getByRole("button", { name: "新建主题", exact: true }).click();
  d = page.getByRole("dialog");
  await d.getByLabel("标题", { exact: true }).fill("长期记忆评估");
  await d.locator("#item-body").fill("从源码证据出发整理研究问题。");
  await d.getByLabel("标签", { exact: true }).fill("memory");
  await d.getByRole("checkbox", { name: manifest.pdf.metadata.title }).check();
  await d.getByRole("checkbox", { name: "RealMem 方法源码位置" }).check();
  await d.getByRole("button", { name: "保存主题笔记" }).click();
  await expect(d).not.toBeVisible();
  await expect(
    page.getByRole("heading", { name: "长期记忆评估" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "最近", exact: true }).click();
  await expect(
    page.getByRole("link", { name: manifest.pdf.metadata.title, exact: true }),
  ).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: "../test-results/dashboard-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  const zip = await page.request.get("/api/v1/export");
  expect(zip.status()).toBe(200);
  expect((await zip.body()).subarray(0, 2).toString()).toBe("PK");
  await page.reload();
  await expect(
    page.getByRole("link", { name: manifest.pdf.metadata.title, exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "alice" }).click();
  await page.getByRole("menuitem", { name: "退出登录", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "登录空间", exact: true }),
  ).toBeVisible();
  expect((await page.request.get("/api/v1/papers")).status()).toBe(401);
  expect(errors).toEqual([]);
});

test("Browser security: two users, token scopes/revocation, Markdown XSS, public registration, and mobile layout", async ({
  page,
  browser,
}) => {
  await login(page);
  const p = await write(page, "/papers", {
    title: "Security fixture paper",
    tags: ["memory"],
  });
  const html =
    '<img src=x onerror="window.__xss=1"><script>window.__xss=2</script>\n\n[unsafe](javascript:alert(1))\n\n![tracking](https://example.invalid/pixel.png)\n\n**Safe bold content**';
  await write(page, "/items", {
    kind: "note",
    paper_id: p.id,
    title: "Markdown 安全验证",
    body: html,
  });
  await page.goto("/#paper/" + p.id);
  await expect(page.getByRole("textbox", { name: "笔记标题" })).toHaveValue(
    "Markdown 安全验证",
  );
  await expect(
    page.getByText("Safe bold content", { exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => (window as any).__xss)).toBeUndefined();
  expect(
    await page
      .locator(
        '.live-note-editor script,.live-note-editor img,.live-note-editor a[href^="javascript:"]',
      )
      .count(),
  ).toBe(0);
  const other = await browser.newContext();
  const bob = await other.newPage();
  await login(bob, "bob");
  await bob.goto("/#paper/" + p.id);
  await expect(bob.getByText("论文不存在或无权访问。")).toBeVisible();
  expect((await bob.request.get("/api/v1/papers/" + p.id)).status()).toBe(404);
  await other.close();
  await page.getByRole("button", { name: "我的文库", exact: true }).click();
  await page.getByRole("button", { name: "空间设置", exact: true }).click();
  await page.getByRole("tab", { name: "开发者", exact: true }).click();
  await page.getByRole("button", { name: "创建凭据", exact: true }).click();
  let d = page.getByRole("dialog");
  await d.getByLabel("名称", { exact: true }).fill("Browser readonly agent");
  await d.getByRole("button", { name: "创建凭据", exact: true }).click();
  d = page.getByRole("dialog");
  const raw = await d.getByLabel("新 Agent 凭据").inputValue();
  expect(raw).toMatch(/^pp_/);
  await d.getByRole("button", { name: "关闭", exact: true }).click();
  expect(
    (
      await page.request.post("/api/v1/papers", {
        data: { title: "denied" },
        headers: {
          Authorization: "Bearer " + raw,
          "Idempotency-Key": crypto.randomUUID(),
        },
      })
    ).status(),
  ).toBe(403);
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(page.getByText("已撤销", { exact: true })).toBeVisible();
  expect(
    (
      await page.request.get("/api/v1/papers", {
        headers: { Authorization: "Bearer " + raw },
      })
    ).status(),
  ).toBe(401);
  const invited = await browser.newContext();
  const ip = await invited.newPage();
  await ip.goto("/#dashboard");
  await ip.getByRole("button", { name: "创建账户" }).click();
  await ip.getByLabel("用户名", { exact: true }).fill("invited");
  await ip
    .getByLabel("密码", { exact: true })
    .fill(process.env.E2E_TEST_PASSWORD!.slice(0, 8));
  await expect(ip.getByLabel("邀请凭据", { exact: true })).toHaveCount(0);
  await ip.getByRole("button", { name: "注册并进入空间" }).click();
  await expect(ip.getByRole("heading", { name: "最近" })).toBeVisible();
  expect(await (await ip.request.get("/api/v1/papers")).json()).toEqual([]);
  await invited.close();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#dashboard");
  await expect(page.getByRole("heading", { name: "最近" })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: "../test-results/dashboard-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "打开导航" }).click();
  await page.getByRole("button", { name: "我的文库", exact: false }).click();
  await expect(
    page.getByRole("heading", { name: "我的文库", exact: true }),
  ).toBeVisible();
  await page.goto("/#paper/" + p.id);
  await page.getByRole("button", { name: "笔记", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "笔记标题" })).toHaveValue(
    "Markdown 安全验证",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: "../test-results/reader-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
});

test("Browser: optimistic conflict, searchable library, recommendations, topic edit/delete, archive and delete", async ({
  page,
}) => {
  await login(page);
  const anchor = await write(page, "/papers", {
    title: "Anchor on sparse retrieval",
    tags: ["sparse-retrieval"],
  });
  await write(
    page,
    "/papers/" + anchor.id,
    { favorite: true },
    "PATCH",
    anchor.revision,
  );
  const p = await write(page, "/papers", {
    title: "Candidate on sparse retrieval",
    tags: ["sparse-retrieval"],
  });
  await page.goto("/#library");
  await page.getByRole("button", { name: "搜索论文", exact: true }).click();
  await page
    .getByRole("textbox", { name: "搜索论文", exact: true })
    .fill("Candidate on sparse");
  await expect(page.getByRole("link", { name: p.title })).toBeVisible();
  await expect(
    page.getByRole("link", { name: anchor.title }),
  ).not.toBeVisible();
  await page.getByRole("link", { name: p.title }).click();
  await page.getByRole("button", { name: "论文信息", exact: true }).click();
  await page.getByRole("button", { name: "编辑论文", exact: true }).click();
  const d = page.getByRole("dialog");
  await d.getByLabel("论文标题").fill("Stale edit");
  await write(
    page,
    "/papers/" + p.id,
    { abstract: "Changed externally" },
    "PATCH",
    1,
  );
  await d.getByRole("button", { name: "保存资料" }).click();
  await expect(page.getByRole("alert")).toContainText("保存冲突");
  await d.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(page.getByRole("alert")).not.toBeVisible();
  await page.getByRole("button", { name: "我的文库", exact: true }).click();
  await page.getByRole("button", { name: "发现论文", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "发现论文", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: p.title, exact: true }),
  ).toHaveCount(0);
  await page.getByRole("tab", { name: "研究偏好", exact: true }).click();
  await expect(page.getByLabel("研究目标与偏好")).toBeVisible();
  await page.goto("/#topics"); // Legacy deep links remain compatible; no main-navigation entry.
  await page.getByRole("button", { name: "跨论文比较", exact: true }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("标题", { exact: true }).fill("稀疏检索比较");
  await dialog
    .getByRole("checkbox", { name: anchor.title, exact: true })
    .check();
  await dialog.getByRole("checkbox", { name: p.title, exact: true }).check();
  await dialog.locator("#item-body").fill("比较框架待补充。");
  await dialog.getByRole("button", { name: "保存跨论文比较" }).click();
  await expect(dialog).not.toBeVisible();
  const topic = page.locator(".topic-card").filter({ hasText: "稀疏检索比较" });
  await topic.getByRole("button", { name: "编辑", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.locator("#item-body").fill("修订后的比较框架。");
  await dialog.getByRole("button", { name: "保存跨论文比较" }).click();
  await expect(topic).toContainText("修订后的比较框架。");
  page.once("dialog", (d) => d.accept());
  await topic.getByRole("button", { name: "删除", exact: true }).click();
  await expect(topic).not.toBeVisible();
  await page.goto("/#paper/" + p.id);
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "论文信息", exact: true }).click();
  await page.getByRole("button", { name: "归档论文", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "恢复论文", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "我的文库" }).click();
  await page.getByRole("combobox", { name: "文库范围" }).click();
  await page.getByRole("option", { name: "已归档", exact: true }).click();
  await expect(
    page.getByRole("link", { name: p.title, exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: p.title, exact: true }).click();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "论文信息", exact: true }).click();
  await page.getByRole("button", { name: "删除论文", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "我的文库", exact: true }),
  ).toBeVisible();
  expect((await page.request.get("/api/v1/papers/" + p.id)).status()).toBe(404);
});
