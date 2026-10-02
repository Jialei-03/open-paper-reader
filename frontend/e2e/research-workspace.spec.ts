import { test, expect, Page } from "@playwright/test";
import {
  openLayoutTranslation,
  selectionAction,
  selectionMenu,
} from "./helpers";
import fs from "node:fs/promises";

async function login(page: Page) {
  await page.goto("/#dashboard");
  await page.getByLabel("用户名", { exact: true }).fill("alice");
  await page
    .getByLabel("密码", { exact: true })
    .fill(process.env.E2E_TEST_PASSWORD!);
  await page.getByRole("button", { name: "登录空间", exact: true }).click();
  await expect(page.getByRole("heading", { name: "最近" })).toBeVisible();
}
async function write(
  page: Page,
  path: string,
  data: unknown,
  method = "POST",
  revision?: number,
) {
  const csrf = (await page.context().cookies()).find(
    (c) => c.name === "paper_csrf",
  )!.value;
  const result = await page.request.fetch("/api/v1" + path, {
    method,
    data,
    headers: {
      "X-CSRF-Token": csrf,
      "Idempotency-Key": crypto.randomUUID(),
      ...(revision ? { "If-Match": String(revision) } : {}),
    },
  });
  expect(result.ok(), await result.text()).toBeTruthy();
  return result.json();
}
// Deterministic, explicitly synthetic two-page PDF; never presented as a real paper.
function testPdf() {
  const streams = [
    "BT /F1 20 Tf 40 720 Td (Research workspace test document) Tj 0 -40 Td (Evidence stays connected to its source.) Tj ET",
    "BT /F1 20 Tf 40 720 Td (Second page for navigation verification.) Tj ET",
  ];
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>`,
    `<< /Length ${streams[0].length} >>\nstream\n${streams[0]}\nendstream`,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>`,
    `<< /Length ${streams[1].length} >>\nstream\n${streams[1]}\nendstream`,
    `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, i) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf +=
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets
      .slice(1)
      .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
      .join("") +
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf);
}

test("Library: filters survive reading and refresh, sort, favorite, bibliography, responsive views", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await login(page);
  const titles = [
    "Retrieval-Augmented Generation for Research",
    "Long-Term Memory in Language Agents",
    "Efficient Attention and Context Compression",
    "Evaluating Multi-Agent Collaboration",
    "A Survey of Scientific Document Understanding",
    "Evidence-Grounded Knowledge Synthesis",
  ];
  const papers = [];
  for (const [index, title] of titles.entries())
    papers.push(
      await write(page, "/papers", {
        title,
        authors: "Research Team; Workspace QA",
        abstract:
          "用于界面与工作流验收的测试条目。记录研究问题、核心方法与实验线索，将个人判断连接到可以回溯的原文证据。",
        external_id: "QA-" + (index + 1),
        tags: ["workspace-qa", index % 2 ? "agent-memory" : "retrieval"],
        version_label: "v1",
      }),
    );
  await page.goto("/#library?view=grid&tag=workspace-qa");
  await expect(page.locator(".paper-card")).toHaveCount(6);
  await page.getByRole("button", { name: "筛选与排序" }).click();
  await page.getByLabel("论文排序").click();
  await page.getByRole("option", { name: "标题 A-Z", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.locator(".paper-card h2").first()).toHaveText(titles[4]);
  const card = page.locator(".paper-card").filter({ hasText: titles[1] });
  await card
    .getByRole("button", { name: "收藏：" + titles[1], exact: true })
    .click();
  await expect(
    card.getByRole("button", { name: "取消收藏：" + titles[1] }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: /^已收藏/ }).click();
  await page.getByRole("button", { name: "更多文库操作" }).click();
  await page.getByRole("button", { name: "卡片视图", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.locator(".paper-card")).toHaveCount(1);
  await expect(page.locator(".paper-card h2")).toHaveText(titles[1]);
  await page.goto("/#library?view=grid&tag=workspace-qa&sort=title");
  await expect(page.locator(".paper-card")).toHaveCount(6);
  await page.getByRole("button", { name: "搜索论文", exact: true }).click();
  await page
    .getByRole("textbox", { name: "搜索论文", exact: true })
    .fill("Long-Term");
  await expect(page.locator(".paper-card")).toHaveCount(1);
  await page.getByRole("heading", { name: titles[1], exact: true }).click();
  await page.getByRole("button", { name: "我的文库", exact: true }).click();
  await expect(page.getByLabel("搜索论文")).toHaveValue("Long-Term");
  await page.getByRole("button", { name: "筛选与排序" }).click();
  await expect(page.getByLabel("标签筛选")).toHaveValue("workspace-qa");
  await page.keyboard.press("Escape");
  await page.reload();
  await expect(page.getByLabel("搜索论文")).toHaveValue("Long-Term");
  await page.getByRole("button", { name: "更多文库操作" }).click();
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 BibTeX" }).click();
  const download = await downloaded;
  expect(await fs.readFile((await download.path())!, "utf8")).toContain(
    titles[1],
  );
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "清空搜索" }).click();
  await expect(page.locator(".paper-card")).toHaveCount(6);
  await page.screenshot({
    path: "../test-results/library-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "更多文库操作" }).click();
  await page.getByRole("button", { name: "列表视图", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("radio", { name: "紧凑列表" })).toBeChecked();
  await page.getByRole("radio", { name: "详细列表" }).click();
  await expect(page.locator(".paper-table-authors")).toHaveCount(6);
  await expect(page.locator(".paper-table-abstract")).toHaveCount(6);
  await page.getByRole("radio", { name: "紧凑列表" }).click();
  await expect(page.locator(".paper-table-preview")).toHaveCount(0);
  await expect(
    page.getByRole("table", { name: "论文列表" }).locator("tbody tr"),
  ).toHaveCount(6);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBeTruthy();
  await page.getByRole("button", { name: "更多文库操作" }).click();
  await page.getByRole("button", { name: "卡片视图", exact: true }).click();
  await page.keyboard.press("Escape");
  await page.screenshot({
    path: "../test-results/library-mobile.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("Reading: PDF selectable text, quote provenance, page and zoom, paper-owned notes", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await login(page);
  await page.getByRole("button", { name: "导入论文", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("论文标题").fill("Portable reading workflow");
  await dialog.getByLabel("作者", { exact: true }).fill("Workspace QA");
  await dialog.getByRole("button", { name: "创建论文" }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole("button", { name: "上传第一个附件" }).click();
  await dialog.locator("input[type=file]").setInputFiles({
    name: "synthetic-test.pdf",
    mimeType: "application/pdf",
    buffer: testPdf(),
  });
  await dialog.getByRole("button", { name: "上传附件", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByTestId("pdf-canvas")).toHaveAttribute(
    "data-rendered",
    "true",
  );
  const sheet = page.locator(".pdf-sheet");
  await expect(sheet).toHaveAttribute("data-reading-mode", "scroll");
  await expect(sheet.locator("[data-pdf-page]")).toHaveCount(2);
  await sheet.evaluate((el) => {
    el.scrollTop = (
      el.querySelector('[data-pdf-page="2"]') as HTMLElement
    ).offsetTop;
  });
  await expect(page.getByLabel("PDF 页码")).toHaveValue("2");
  await page.getByLabel("阅读方式", { exact: true }).click();
  await page.getByRole("option", { name: "单页翻页", exact: true }).click();
  await expect(sheet.locator("[data-pdf-page]")).toHaveCount(1);
  await expect(page.getByTestId("pdf-text-layer")).toContainText("Second page");
  await page.getByLabel("阅读方式", { exact: true }).click();
  await page.getByRole("option", { name: "连续滚动", exact: true }).click();
  await page.getByRole("button", { name: "上一页", exact: true }).click();
  const text = page.getByTestId("pdf-text-layer");
  await expect(text).toContainText("Evidence stays connected");
  const sentence = text
    .locator("span")
    .filter({ hasText: "Evidence stays connected" });
  const bounds = await sentence.boundingBox();
  expect(bounds!.width).toBeGreaterThan(100);
  expect(bounds!.height).toBeGreaterThan(10);
  const beforeSelection = await page.locator(".pdf-sheet").boundingBox();
  // Use actual pointer selection, not an injected selection, to verify text/canvas alignment.
  await page.mouse.move(bounds!.x + 1, bounds!.y + bounds!.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    bounds!.x + bounds!.width - 1,
    bounds!.y + bounds!.height / 2,
    { steps: 15 },
  );
  await page.mouse.up();
  await expect(page.locator(".pdf-floating-tools")).toHaveCount(0);
  await expect(
    selectionMenu(page).getByRole("button", { name: "摘录", exact: true }),
  ).toBeEnabled();
  expect(await page.locator(".pdf-sheet").boundingBox()).toEqual(
    beforeSelection,
  );
  await page.screenshot({
    path: "../test-results/reader-selection-floating.png",
    animations: "disabled",
  });
  await selectionAction(page, "摘录");
  await expect(page.getByRole("textbox", { name: "笔记正文" })).toContainText(
    "Evidence stays connected",
  );
  await expect(
    page.locator(".paper-note a").filter({ hasText: "原文" }),
  ).toHaveAttribute("href", /file=.*page=1/);
  await page
    .locator(".paper-note a")
    .filter({ hasText: "原文" })
    .click({ modifiers: ["Control"] });
  await expect(page.getByTestId("pdf-text-layer")).toHaveAttribute(
    "data-reference-found",
    "true",
  );
  await expect(page.locator(".pdf-reference-underline").first()).toBeVisible();
  await expect(sentence).toHaveCSS("color", "rgba(0, 0, 0, 0)");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollHeight <= innerHeight,
    ),
  ).toBe(true);
  const documentWidth = (await page.locator(".reader-document").boundingBox())!
    .width;
  await page.getByRole("button", { name: "收起阅读侧栏", exact: true }).click();
  await expect(page.locator(".notebook")).toHaveCount(0);
  expect(
    (await page.locator(".reader-document").boundingBox())!.width,
  ).toBeGreaterThan(documentWidth);
  await page.getByRole("button", { name: "笔记", exact: true }).click();
  await page.getByLabel("PDF 缩放").fill("137.5");
  await page.getByLabel("PDF 缩放").press("Enter");
  await expect(page.locator('[data-pdf-page="1"] .pdf-page')).toHaveAttribute(
    "data-scale",
    "1.375",
  );
  const pinch = await sheet.evaluate((el) => {
    const r = el.getBoundingClientRect(),
      p = el.querySelector(".pdf-page")!.getBoundingClientRect();
    const x = r.left + 300,
      y = r.top + 250;
    return { x, y, fx: (x - p.left) / p.width, fy: (y - p.top) / p.height };
  });
  await sheet.dispatchEvent("wheel", {
    ctrlKey: true,
    deltaY: -30,
    clientX: pinch.x,
    clientY: pinch.y,
    cancelable: true,
    bubbles: true,
  });
  await expect
    .poll(async () =>
      Number(
        await page
          .locator('[data-pdf-page="1"] .pdf-page')
          .getAttribute("data-scale"),
      ),
    )
    .toBeGreaterThan(1.7);
  await expect
    .poll(async () => {
      const p = await page
        .locator('[data-pdf-page="1"] .pdf-page')
        .boundingBox();
      return Math.abs(p!.y + p!.height * pinch.fy - pinch.y);
    })
    .toBeLessThan(5);
  await page.getByLabel("PDF 缩放").fill("800");
  await page.getByLabel("PDF 缩放").press("Enter");
  await expect(page.locator('[data-pdf-page="1"] .pdf-page')).toHaveAttribute(
    "data-scale",
    "8",
  );
  await expect(page.getByTestId("pdf-canvas")).toHaveAttribute(
    "data-rendered",
    "true",
  );
  expect(
    await page
      .getByTestId("pdf-canvas")
      .evaluate((canvas: HTMLCanvasElement) => canvas.width * canvas.height),
  ).toBeLessThanOrEqual(16_000_000);
  await page.getByRole("button", { name: "适合宽度", exact: true }).click();
  await page.getByRole("button", { name: "下一页", exact: true }).click();
  await expect(text).toContainText("Second page");
  await page.getByLabel("PDF 缩放").fill("150");
  await page.getByLabel("PDF 缩放").press("Enter");
  await expect(page.getByTestId("pdf-canvas")).toHaveAttribute(
    "data-rendered",
    "true",
  );
  await page.getByRole("button", { name: "适合宽度", exact: true }).click();
  await expect(
    page.getByRole("radio", { name: "框选图表或公式", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "../test-results/reader-tools-scroll.png",
    animations: "disabled",
  });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "添加笔记" }).click();
  await dialog.getByLabel("标题", { exact: true }).fill("研究笔记验收");
  await dialog
    .locator("#item-body")
    .fill("唯一检索词：跨论文溯源。下一步验证实验设置。");
  await dialog.getByRole("button", { name: "保存个人笔记" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByTestId("pdf-canvas")).toHaveAttribute(
    "data-rendered",
    "true",
  );
  await page.keyboard.press("Escape");
  await page.screenshot({
    path: "../test-results/reader-desktop.png",
    fullPage: true,
  });
  await page
    .getByRole("textbox", { name: "笔记正文" })
    .fill("唯一检索词：跨论文溯源。已补充阅读问题。");
  await page.getByRole("textbox", { name: "笔记正文" }).blur();
  await expect(
    page.getByRole("status").filter({ hasText: "已保存" }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByRole("textbox", { name: "笔记正文" })).toContainText(
    "已补充阅读问题",
  );
  await page.getByRole("button", { name: "论文信息", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "Portable reading workflow",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.locator('[data-variant="semantic"][data-kind="unread"]'),
  ).toHaveText("未读");
  expect(errors).toEqual([]);
});

test("Library: failures offer retry, empty states recover, pagination and keyboard dialog", async ({
  page,
}) => {
  await login(page);
  for (let n = 0; n < 20; n++)
    await write(page, "/papers", {
      title: `Pagination ${String(n).padStart(2, "0")}`,
      tags: ["pagination-qa"],
    });
  await page.route("**/api/v1/papers?*", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ detail: "临时不可用" }),
    }),
  );
  await page.goto("/#library?view=grid&tag=pagination-qa");
  await expect(
    page.getByRole("alert").filter({ hasText: "文库加载失败" }),
  ).toBeVisible();
  await page.unroute("**/api/v1/papers?*");
  await page.getByRole("button", { name: "重新加载" }).click();
  await expect(page.locator(".paper-card")).toHaveCount(18);
  await page.getByRole("button", { name: "下一页" }).click();
  await expect(page.locator(".paper-card")).toHaveCount(2);
  await page.getByRole("button", { name: "搜索论文", exact: true }).click();
  await page
    .getByRole("textbox", { name: "搜索论文", exact: true })
    .fill("does-not-exist");
  await expect(page.locator(".library-empty")).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "论文分页" }),
  ).not.toBeVisible();
  await page.getByLabel("搜索论文").fill("Pagination 00");
  await expect(page.locator(".paper-card")).toHaveCount(1);
  const trigger = page.getByRole("button", { name: "导入论文", exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Shift+Tab");
  await expect
    .poll(() => dialog.evaluate((el) => el.contains(document.activeElement)))
    .toBeTruthy();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await page.keyboard.press("Control+k");
  await expect(page.getByRole("dialog", { name: "搜索工作区" })).toBeVisible();
  await expect(page.getByPlaceholder("搜索论文、笔记…")).toBeFocused();
  await page.keyboard.press("Escape");
});

test("Appearance: light and dark persist, system changes propagate, narrow layouts remain usable", async ({
  page,
}) => {
  const fontFailures: string[] = [];
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      /font.*Content Security Policy/i.test(message.text())
    )
      fontFailures.push(message.text());
  });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await login(page);
  const appearanceTag = "appearance-" + crypto.randomUUID();
  for (let i = 0; i < 6; i++)
    await write(page, "/papers", {
      title: "Appearance fixture " + i,
      tags: [appearanceTag],
    });
  await page.goto("/#library?view=grid&tag=" + appearanceTag);
  await expect(page.locator(".paper-card")).toHaveCount(6);
  await page.evaluate(() => document.fonts.ready);
  expect(fontFailures).toEqual([]);
  await expect
    .poll(() =>
      page
        .locator(".paper-tag")
        .first()
        .evaluate((el) => el.getBoundingClientRect().height),
    )
    .toBeGreaterThanOrEqual(24);
  await page.screenshot({
    path: "../test-results/taste-library-light.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "空间设置", exact: true }).click();
  await page.getByRole("tab", { name: "外观", exact: true }).click();
  await expect(page.locator(".settings-surface")).toHaveCSS(
    "border-top-width",
    "0px",
  );
  await expect(page.locator(".settings-surface")).toHaveCSS(
    "box-shadow",
    "none",
  );
  await expect(page.locator(".settings-surface")).toHaveCSS(
    "border-radius",
    "0px",
  );
  await expect(page.locator(".appearance-toggle")).toHaveCount(0);
  await page.getByRole("button", { name: "alice", exact: true }).click();
  await expect(
    page.getByRole("menuitem", { name: "账户设置", exact: true }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.getByRole("radio", { name: "浅色", exact: true }).check();
  await page.getByRole("radio", { name: "深色", exact: true }).check();
  await expect(page.locator("html")).toHaveClass("dark");
  await page.emulateMedia({ colorScheme: "dark" });
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveClass("dark");
  await page.screenshot({
    path: "../test-results/settings-appearance-dark.png",
    fullPage: true,
  });
  await page.reload();
  await page.getByRole("tab", { name: "外观", exact: true }).click();
  await expect(
    page.getByRole("radio", { name: "深色", exact: true }),
  ).toBeChecked();
  await page.goto("/#library?view=grid&tag=" + appearanceTag);
  await expect(page.locator(".paper-card")).toHaveCount(6);
  await page.screenshot({
    path: "../test-results/taste-library-dark.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "导入论文", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.screenshot({ path: "../test-results/taste-dialog-dark.png" });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "空间设置", exact: true }).click();
  await page.getByRole("tab", { name: "外观", exact: true }).click();
  await page.getByRole("radio", { name: "跟随系统", exact: true }).check();
  await page.screenshot({
    path: "../test-results/settings-appearance-light.png",
    fullPage: true,
  });
  await expect(page.locator("html")).not.toHaveClass("dark");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveClass("dark");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBeTruthy();
  await page.getByRole("button", { name: "打开导航", exact: true }).click();
  const navigation = page.getByRole("dialog");
  await expect(navigation).toBeVisible();
  await navigation.getByRole("button", { name: "最近", exact: true }).click();
  await expect(navigation).not.toBeVisible();
  await expect(
    page.getByRole("heading", { name: "最近", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "打开导航", exact: true }).click();
  await navigation
    .getByRole("button", { name: "我的文库", exact: true })
    .click();
  await expect(navigation).not.toBeVisible();
  await expect(page.locator(".paper-card").first()).toBeVisible();
  await page.screenshot({
    path: "../test-results/taste-mobile-dark.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "打开导航", exact: true }).click();
  await navigation
    .getByRole("button", { name: "空间设置", exact: true })
    .click();
  await page.getByRole("tab", { name: "外观", exact: true }).click();
  await page.getByRole("radio", { name: "浅色", exact: true }).check();
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBeTruthy();
  await page.screenshot({
    path: "../test-results/settings-appearance-mobile.png",
    fullPage: true,
  });
  await expect(page.locator("html")).not.toHaveClass("dark");
});

test("Account: username login, recovery availability and account settings", async ({
  page,
}) => {
  await page.goto("/#forgot-password");
  await expect(page.getByText("找回账号与密码", { exact: true })).toBeVisible();
  await page
    .getByLabel("找回邮箱", { exact: true })
    .fill("alice@browser.example");
  await page.getByRole("button", { name: "发送找回邮件", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("邮件服务尚未配置");
  await page.getByRole("link", { name: "返回登录", exact: true }).click();
  await expect(page.getByLabel("用户名", { exact: true })).toBeVisible();
  await login(page);
  await page.getByRole("button", { name: "空间设置", exact: true }).click();
  await page.getByRole("tab", { name: "账户", exact: true }).click();
  await expect(page.getByText("账户与找回", { exact: true })).toBeVisible();
  await expect(page.getByText("用户名：alice", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "发送邮箱验证链接", exact: true }),
  ).toBeDisabled();
  await page.screenshot({
    path: "../test-results/username-account-settings.png",
    fullPage: true,
  });
});

test("Command palette: search papers, keyboard navigation and account menu", async ({
  page,
}) => {
  await login(page);
  await write(page, "/papers", {
    title: "Command palette verification",
    tags: ["command-qa"],
  });
  await page.reload();
  await expect(page.getByRole("heading", { name: "最近" })).toBeVisible();
  await page.keyboard.press("Control+k");
  const palette = page.getByRole("dialog", { name: "搜索工作区" });
  await expect(palette).toBeVisible();
  await palette
    .getByPlaceholder("搜索论文、笔记…")
    .fill("Command palette verification");
  await expect(palette.getByRole("option")).toHaveCount(1);
  await page.screenshot({
    path: "../test-results/refined-command-results.png",
  });
  await page.keyboard.press("Enter");
  await expect(palette).not.toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Command palette verification",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "我的文库", exact: true }).click();
  await page.getByRole("button", { name: "空间设置", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "设置", exact: true }),
  ).toBeVisible();
});

test("Knowledge graph: persistent bidirectional links, navigation and insertion", async ({
  page,
}) => {
  await login(page);
  const p = await write(page, "/papers", {
    title: "Graph verification paper",
    version_label: "v1",
  });
  const topic = await write(page, "/items", {
    kind: "topic",
    title: "Graph verification topic",
    paper_ids: [p.id],
    body: "A shared research direction.",
  });
  const note = await write(page, "/items", {
    kind: "note",
    paper_id: p.id,
    title: "Graph verification note",
    body: `[Topic](#item/${topic.id})\n\n\`[not a link](#paper/${p.id})\``,
  });
  await page.goto(`/#graph?focus=${encodeURIComponent(`item/${topic.id}`)}`);
  await expect(
    page.getByRole("heading", { name: "知识图谱", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "选择 Graph verification note",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "选择 Graph verification note", exact: true })
    .click();
  await page.getByRole("button", { name: "打开内容", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "笔记标题" })).toHaveValue(
    "Graph verification note",
  );
  await page
    .getByRole("link", { name: "Topic", exact: true })
    .click({ modifiers: ["Control"] });
  await expect(page).toHaveURL(new RegExp(`item/${topic.id}`));
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.getByRole("button", { name: "插入关联", exact: true }).click();
  await page
    .getByPlaceholder("搜索要关联的内容…")
    .fill("Graph verification note");
  await page.getByRole("option", { name: /Graph verification note/ }).click();
  await page.getByRole("button", { name: "保存主题笔记", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("link", { name: "Graph verification note", exact: true }),
  ).toBeVisible();
  await page.goto(`/#graph?focus=${encodeURIComponent(`item/${topic.id}`)}`);
  await page.getByRole("button", { name: "放大图谱" }).click();
  await page.getByRole("button", { name: "重置图谱视图" }).click();
  await page.screenshot({
    path: "../test-results/knowledge-graph.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("button", {
      name: "选择 Graph verification note",
      exact: true,
    }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: "../test-results/knowledge-graph-mobile.png",
    fullPage: true,
  });
});

test("Discovery: editable preference document, external search and import exclusion", async ({
  page,
}) => {
  await login(page);
  await page.getByRole("button", { name: "发现论文", exact: true }).click();
  await page.getByRole("tab", { name: "研究偏好", exact: true }).click();
  await page
    .getByLabel("研究目标与偏好")
    .fill("Research goal: persistent agent memory");
  await page
    .getByLabel("关注关键词", { exact: true })
    .fill("test-discovery-memory");
  await page.getByRole("button", { name: "保存偏好", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "保存偏好", exact: true }),
  ).toBeDisabled();
  await page.reload();
  await page.getByRole("tab", { name: "研究偏好", exact: true }).click();
  await expect(page.getByLabel("研究目标与偏好")).toHaveValue(
    "Research goal: persistent agent memory",
  );
  await page.getByRole("tab", { name: "新论文", exact: true }).click();
  await page.getByRole("button", { name: "查找新论文", exact: true }).click();
  await expect(
    page.getByRole("link", {
      name: "Synthetic discovery memory paper",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "不感兴趣", exact: true }).click();
  await expect(
    page.getByRole("link", {
      name: "Synthetic discovery memory paper",
      exact: true,
    }),
  ).toHaveCount(0);
  await page.getByRole("tab", { name: "研究偏好", exact: true }).click();
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await page.getByRole("tab", { name: "新论文", exact: true }).click();
  await page.getByRole("button", { name: "加入文库", exact: true }).click();
  await expect(page).toHaveURL(/#paper\//);
  await expect(page.getByTestId("pdf-canvas").first()).toBeVisible();
  const importedId = page.url().split("#paper/")[1].split("?")[0];
  const importedFiles = await page.request.get(
    `/api/v1/papers/${importedId}/files`,
  );
  expect(
    (await importedFiles.json()).some(
      (file: { mime: string }) => file.mime === "application/pdf",
    ),
  ).toBeTruthy();
  await page.goto("/#recommendations");

  await expect(
    page.getByRole("link", {
      name: "Synthetic discovery memory paper",
      exact: true,
    }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "查找新论文", exact: true }).click();
  await expect(
    page.getByRole("link", {
      name: "Synthetic discovery memory paper",
      exact: true,
    }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "我的文库", exact: true }).click();
  await page.getByRole("button", { name: "搜索论文", exact: true }).click();
  await page
    .getByRole("textbox", { name: "搜索论文", exact: true })
    .fill("Synthetic discovery memory paper");
  await expect(
    page.getByRole("link", {
      name: "Synthetic discovery memory paper",
      exact: true,
    }),
  ).toBeVisible();
});

test("Directions: rename and merge labels without losing papers", async ({
  page,
}) => {
  await login(page);
  const p = await write(page, "/papers", {
    title: "Direction merge verification",
    tags: ["merge-old-a", "merge-old-b"],
  });
  await page.locator(".workspace-direction-group > summary").click();
  await page.getByRole("button", { name: "管理研究方向", exact: true }).click();
  await page
    .getByRole("checkbox", { name: "merge-old-a", exact: true })
    .check();
  await page
    .getByRole("checkbox", { name: "merge-old-b", exact: true })
    .check();
  await page.getByLabel("方向名称").fill("Merged direction");
  await page.getByRole("button", { name: "合并方向", exact: true }).click();
  await expect(
    page.getByRole("checkbox", { name: "Merged direction", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("checkbox", { name: "merge-old-a", exact: true }),
  ).toHaveCount(0);
  expect(
    (await (await page.request.get("/api/v1/papers/" + p.id)).json()).tags,
  ).toEqual(["Merged direction"]);
  await page
    .getByRole("checkbox", { name: "Merged direction", exact: true })
    .check();
  await page.getByLabel("方向名称").fill("Renamed direction");
  await page.getByRole("button", { name: "保存名称", exact: true }).click();
  await expect(
    page.getByRole("checkbox", { name: "Renamed direction", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("checkbox", { name: "Renamed direction", exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});

test("Reader scroll roots and Markdown editing tools", async ({ page }) => {
  await login(page);
  const p = await write(page, "/papers", {
    title: "Independent scroll verification",
  });
  await page.goto("/#paper/" + p.id);
  const editor = page.getByRole("textbox", { name: "笔记正文" });
  await editor.fill("Long note paragraph.\n\n".repeat(100));
  await editor.blur();
  const notes = page.locator(".notebook-body");
  const file = page.getByRole("region", { name: "文件预览", exact: true });
  const before = await file.evaluate((e) => e.scrollTop);
  await notes.hover();
  await page.mouse.wheel(0, 400);
  await expect
    .poll(() => notes.evaluate((e) => e.scrollTop))
    .toBeGreaterThan(0);
  expect(await file.evaluate((e) => e.scrollTop)).toBe(before);
  await editor.fill("Selected text");
  await editor.focus();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("ControlOrMeta+b");
  await expect(editor.locator("strong")).toHaveText("Selected text");
  await page.getByRole("button", { name: "表格", exact: true }).click();
  await expect(editor.getByRole("table")).toBeVisible();
  await editor.focus();
  await page.keyboard.press("Control+s");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("Graph physics: dragging a node pulls neighbors and releases after zoom", async ({
  page,
}) => {
  await login(page);
  const paper = await write(page, "/papers", { title: "Elastic graph paper" });
  const note = await write(page, "/items", {
    kind: "note",
    paper_id: paper.id,
    title: "Elastic graph note",
    body: "Connected note",
  });
  await page.goto(`/#graph?focus=${encodeURIComponent(`paper/${paper.id}`)}`);
  const node = page.locator(`[data-node="item/${note.id}"]`);
  const neighbor = page.locator(`[data-node="paper/${paper.id}"]`);
  await expect(node).toBeVisible();
  const center = (locator: typeof node) =>
    locator.evaluate((el) => {
      const r = el.querySelector("circle")!.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
  for (const zoomed of [false, true]) {
    if (zoomed)
      await page.getByRole("button", { name: "放大图谱", exact: true }).click();
    const start = await center(node);
    const other = await center(neighbor);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 90, start.y + 45, { steps: 12 });
    await expect
      .poll(async () =>
        Math.hypot(
          (await center(node)).x - start.x - 90,
          (await center(node)).y - start.y - 45,
        ),
      )
      .toBeLessThan(3);
    await expect
      .poll(async () =>
        Math.hypot(
          (await center(neighbor)).x - other.x,
          (await center(neighbor)).y - other.y,
        ),
      )
      .toBeGreaterThan(5);
    const held = await center(node);
    await page.mouse.up();
    await expect(node).toHaveAttribute("aria-pressed", "false");
    await expect
      .poll(async () =>
        Math.hypot(
          (await center(node)).x - held.x,
          (await center(node)).y - held.y,
        ),
      )
      .toBeGreaterThan(3);
  }
  await node.focus();
  await page.keyboard.press("Enter");
  await expect(node).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "打开内容", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`item/${note.id}`));
});

test("Simple notes: default note, free editing, additional note and no type index", async ({
  page,
}) => {
  await login(page);
  const p = await write(page, "/papers", { title: "Simple paper" });
  const records = await (
    await page.request.get("/api/v1/items?paper_id=" + p.id)
  ).json();
  expect(records).toHaveLength(1);
  expect(records[0].kind).toBe("note");
  await page.goto("/#paper/" + p.id);
  await expect(
    page.getByRole("tab", { name: /证据|解读|问题|批注/ }),
  ).toHaveCount(0);
  await page
    .getByRole("textbox", { name: "笔记正文" })
    .fill("My unrestricted reading note");
  await page.getByRole("textbox", { name: "笔记正文" }).blur();
  await expect(page.getByText("引用已有原文证据", { exact: true })).toHaveCount(
    0,
  );
  await expect(page.locator(".paper-note")).toContainText(
    "My unrestricted reading note",
  );
  await page.getByRole("button", { name: "添加笔记", exact: true }).click();
  await page.getByLabel("标题", { exact: true }).fill("Second note");
  await page.locator("#item-body").fill("Another idea");
  await page.getByRole("button", { name: "保存个人笔记", exact: true }).click();
  await page.getByRole("button", { name: "Second note", exact: true }).click();
  await expect(page.locator(".paper-note")).toContainText("Another idea");
  await page.goto("/#notebook");
  await expect(page).toHaveURL(/#library$/);
  await expect(
    page.getByRole("heading", { name: "我的文库", exact: true }),
  ).toBeVisible();
  await page.goto("/#paper/" + p.id);
  await page.getByRole("button", { name: "Second note", exact: true }).click();
  await expect(page.locator(".paper-note")).toContainText("Another idea");
});

test("References: no self links and exact cross-note highlight", async ({
  page,
}) => {
  await login(page);
  const p = await write(page, "/papers", { title: "Reference paper" });
  const target = await write(page, "/items", {
    kind: "note",
    paper_id: p.id,
    title: "Target note",
    body: "Earlier paragraph.\n\nThe **precise target** crosses formatting.\n\nLast paragraph.",
  });
  const source = (
    await (await page.request.get("/api/v1/items?paper_id=" + p.id)).json()
  ).find((i: any) => i.id !== target.id);
  await write(
    page,
    "/items/" + source.id,
    {
      kind: "note",
      paper_id: p.id,
      title: "Source note",
      body: `[self](#item/${source.id})`,
    },
    "PUT",
    source.revision,
  );
  const saved = await (
    await page.request.get("/api/v1/items/" + source.id)
  ).json();
  expect(saved.body).toBe("self");
  await page.goto(`/#paper/${p.id}?note=${source.id}`);
  await page.getByRole("button", { name: "关联与引用", exact: true }).click();
  await page.getByRole("button", { name: "引用具体位置", exact: true }).click();
  await page.getByPlaceholder("搜索要关联的内容…").fill("Target note");
  await page.getByRole("option", { name: /Target note/ }).click();
  const dialog = page.getByRole("dialog").filter({
    has: page.getByRole("heading", { name: "引用具体位置", exact: true }),
  });
  await dialog.locator("strong").selectText();
  await dialog.locator("strong").dispatchEvent("pointerup");
  await dialog
    .getByRole("button", { name: "插入位置引用", exact: true })
    .click();
  await page
    .getByRole("link", { name: "precise target", exact: true })
    .click({ modifiers: ["Control"] });
  await expect(page).toHaveURL(new RegExp(`item/${target.id}`));
  await expect(
    page.locator(".content-document .note-reference"),
  ).toHaveAttribute("data-reference-found", "true");
  expect(
    await page.evaluate(() =>
      [...(CSS as any).highlights.values()].flatMap((h: any) =>
        [...h].map((r: any) => r.toString()),
      ),
    ),
  ).toContain("precise target");
  await page.screenshot({
    path: "../test-results/reference-note-highlight.png",
  });
  await page.goto(`/#item/${target.id}?quote=missing-quote`);
  await expect(
    page.getByText("引用位置未找到，内容可能已被修改。", { exact: true }),
  ).toBeVisible();
});

test("PDF regions: box selection saves a scale-independent citation", async ({
  page,
}) => {
  await login(page);
  const p = await write(page, "/papers", { title: "Region verification" });
  const csrf = (await page.context().cookies()).find(
    (c) => c.name === "paper_csrf",
  )!.value;
  const upload = await page.request.post("/api/v1/papers/" + p.id + "/files", {
    headers: { "X-CSRF-Token": csrf, "Idempotency-Key": crypto.randomUUID() },
    multipart: {
      version_id: p.current_version,
      file: {
        name: "regions.pdf",
        mimeType: "application/pdf",
        buffer: testPdf(),
      },
    },
  });
  expect(upload.ok()).toBeTruthy();
  await page.goto("/#paper/" + p.id);
  await expect(page.getByTestId("pdf-canvas")).toHaveAttribute(
    "data-rendered",
    "true",
  );
  await page
    .getByRole("radio", { name: "框选图表或公式", exact: true })
    .click();
  const layer = page.getByTestId("pdf-region-selector");
  await layer.evaluate((e) => e.scrollIntoView({ block: "start" }));
  const b = (await layer.boundingBox())!;
  await page.mouse.move(b.x + b.width * 0.15, b.y + b.height * 0.08);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * 0.65, b.y + b.height * 0.22, {
    steps: 10,
  });
  await page.mouse.up();
  await expect(
    page.getByRole("link", { name: "图表区域", exact: true }),
  ).toHaveCount(0);
  // A box drawn around a figure opens its own menu beside it.
  await page
    .getByRole("dialog", { name: "选区操作" })
    .getByRole("button", { name: "摘录", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: "图表区域", exact: true }),
  ).toHaveAttribute("href", /rect=/);
  await page
    .getByRole("link", { name: "图表区域", exact: true })
    .click({ modifiers: ["Control"] });
  const highlight = page.getByTestId("pdf-region-highlight");
  await expect(highlight).toBeVisible();
  const style = await highlight.getAttribute("style");
  await page.getByLabel("PDF 缩放").fill("150");
  await page.getByLabel("PDF 缩放").press("Enter");
  await expect(page.getByTestId("pdf-canvas")).toHaveAttribute(
    "data-rendered",
    "true",
  );
  await expect(highlight).toHaveAttribute("style", style!);
});

test("Translation: model settings stay private and bilingual references open both PDFs", async ({
  page,
}) => {
  await login(page);
  await page.goto("/#settings");
  await expect(page.getByLabel("模型服务地址", { exact: true })).toHaveCount(0);
  await page.route("**/api/v1/translation-settings/models", (route) =>
    route.fulfill({ json: { models: ["test-model", "second-model"] } }),
  );
  await page.setViewportSize({ width: 1280, height: 720 });
  for (const model of ["test-model", "second-model"]) {
    await page.getByRole("button", { name: "添加模型", exact: true }).click();
    await page
      .getByLabel("模型服务地址", { exact: true })
      .fill("https://api.deepseek.com/v1");
    await page.getByLabel("API Key", { exact: true }).fill("fixture-key");
    await page
      .getByRole("button", { name: "获取上游模型", exact: true })
      .click();
    await page.getByLabel("模型名称", { exact: true }).click();
    await page.getByRole("option", { name: model, exact: true }).click();
    const modelDialog = page.getByRole("dialog");
    const bounds = await modelDialog.boundingBox();
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(720);
    await page
      .getByRole("button", { name: "保存模型", exact: true })
      .scrollIntoViewIfNeeded();
    await page.getByRole("button", { name: "保存模型", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "添加模型", exact: true }).click();
  const mobileDialog = page.getByRole("dialog");
  const mobileBounds = await mobileDialog.boundingBox();
  expect(mobileBounds!.y).toBeGreaterThanOrEqual(0);
  expect(mobileBounds!.y + mobileBounds!.height).toBeLessThanOrEqual(844);
  await mobileDialog
    .getByRole("button", { name: "保存模型", exact: true })
    .scrollIntoViewIfNeeded();
  await expect(
    mobileDialog.getByRole("heading", { name: "添加模型", exact: true }),
  ).toBeInViewport();
  await expect(
    mobileDialog.getByRole("button", { name: "保存模型", exact: true }),
  ).toBeInViewport();
  await page.screenshot({
    path: "../test-results/model-dialog-mobile-fixed.png",
  });
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1280, height: 720 });
  await page
    .getByRole("button", { name: /的操作$/ })
    .last()
    .click();
  await expect(
    page.getByRole("menuitem", { name: "设为默认", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "../test-results/model-specifications-menu.png",
    animations: "disabled",
  });
  await page.getByRole("menuitem", { name: "设为默认", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await (await page.request.get("/api/v1/translation-settings")).json())
          .model,
    )
    .toBe("second-model");
  await page.reload();
  await expect(page.getByLabel("API Key", { exact: true })).toHaveCount(0);
  await expect(page.getByText("second-model", { exact: true })).toBeVisible();
  await page.screenshot({ path: "../test-results/saved-model-list.png" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  const p = await write(page, "/papers", {
    title: "Bilingual fixture",
    external_id: "arxiv:2504.19413v1",
  });
  const csrf = (await page.context().cookies()).find(
    (c) => c.name === "paper_csrf",
  )!.value;
  const upload = async (name: string) =>
    (
      await page.request.post(`/api/v1/papers/${p.id}/files`, {
        headers: {
          "X-CSRF-Token": csrf,
          "Idempotency-Key": crypto.randomUUID(),
        },
        multipart: {
          version_id: p.current_version,
          file: { name, mimeType: "application/pdf", buffer: testPdf() },
        },
      })
    ).json();
  const source = await upload("source.pdf"),
    target = await upload("translated-fixture.pdf");
  // The translator output is a fixture: this test validates UI, not model quality.
  const quote = "Evidence stays connected";
  await page.route(`**/api/v1/papers/${p.id}/translations`, (r) =>
    r.fulfill({
      json: [
        {
          id: "fixture",
          status: "completed",
          stage: "翻译完成",
          source_file: source.id,
          translated_file: target.id,
          alignment: [
            {
              id: "u1",
              source_text: quote,
              translated_text: quote + " to its source.",
              source: { page: 1, quote },
              translated: { page: 1, quote },
            },
          ],
        },
      ],
    }),
  );
  await page.goto(`/#paper/${p.id}`);
  await page.getByLabel("PDF 缩放", { exact: true }).fill("257");
  await page.getByLabel("PDF 缩放", { exact: true }).press("Enter");
  await page.getByRole("button", { name: "放大 PDF", exact: true }).click();
  await expect(page.getByLabel("PDF 缩放", { exact: true })).toHaveValue("260");
  await page.getByRole("button", { name: "缩小 PDF", exact: true }).click();
  await expect(page.getByLabel("PDF 缩放", { exact: true })).toHaveValue("250");
  await page.getByLabel("PDF 缩放", { exact: true }).fill("150");
  await page.getByLabel("PDF 缩放", { exact: true }).press("Enter");
  await openLayoutTranslation(page);
  // UI download behavior; the backend suite separately verifies real merged page order.
  let mergeFails = true;
  const mergedOrders: string[] = [];
  await page.route(`**/api/v1/papers/${p.id}/merged-pdf?*`, (route) => {
    const url = new URL(route.request().url());
    expect(url.searchParams.get("translation_job_id")).toBe("fixture");
    mergedOrders.push(url.searchParams.get("order")!);
    return mergeFails
      ? route.fulfill({
          status: 409,
          json: { detail: "翻译版本已变更，请重新选择" },
        })
      : route.fulfill({ contentType: "application/pdf", body: testPdf() });
  });
  await page.getByRole("button", { name: "合并下载", exact: true }).click();
  await page.getByRole("menuitem", { name: "原文在前，译文在后" }).click();
  await expect(page.getByRole("alert")).toContainText("翻译版本已变更");
  mergeFails = false;
  await page.getByRole("button", { name: "合并下载", exact: true }).click();
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "译文在前，原文在后" }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe("论文-译文与原文.pdf");
  expect(await download.failure()).toBeNull();
  expect(mergedOrders).toEqual(["original-first", "translation-first"]);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.getByRole("tab", { name: "并排查看", exact: true }).click();
  await expect(page.getByTestId("pdf-canvas")).toHaveCount(2);
  const leftPdf = page.locator(".pdf-view").first();
  const rightPdf = page.locator(".pdf-view").last();
  const zoomValue = async (pane: typeof leftPdf) =>
    Number(await pane.locator(".pdf-page").first().getAttribute("data-scale")) *
    100;
  await expect.poll(() => zoomValue(rightPdf)).toBe(150);
  await page.getByLabel("PDF 缩放", { exact: true }).fill("150");
  await page.getByLabel("PDF 缩放", { exact: true }).press("Enter");
  await expect.poll(() => zoomValue(rightPdf)).toBe(150);
  await page
    .getByRole("radiogroup", { name: "工具作用页面" })
    .getByRole("radio", { name: "译文", exact: true })
    .click();
  await page.getByRole("button", { name: "放大 PDF", exact: true }).click();
  await expect.poll(() => zoomValue(leftPdf)).toBe(160);
  await page.getByRole("button", { name: "联动缩放", exact: true }).click();
  await page.getByRole("button", { name: "缩小 PDF", exact: true }).click();
  await expect.poll(() => zoomValue(leftPdf)).toBe(160);
  await expect.poll(() => zoomValue(rightPdf)).toBe(150);
  await page.getByRole("button", { name: "联动缩放", exact: true }).click();
  await page.getByLabel("同步滚动", { exact: true }).click();
  await page.getByRole("option", { name: "跟随右侧", exact: true }).click();
  const leftSheet = leftPdf.locator(".pdf-sheet"),
    rightSheet = rightPdf.locator(".pdf-sheet");
  await expect(rightPdf.locator(".pdf-page").first()).toHaveAttribute(
    "data-scale",
    "1.6",
  );
  // Let the gesture anchor settle before scrolling; these are real browser scroll events.
  await page.waitForTimeout(400);
  await rightSheet.hover();
  await page.mouse.wheel(0, 220);
  await expect
    .poll(() => leftSheet.evaluate((el) => el.scrollTop))
    .toBeGreaterThan(180);
  const before = await rightSheet.evaluate((el) => el.scrollTop);
  await leftSheet.hover();
  await page.mouse.wheel(0, 120);
  await page.waitForTimeout(150);
  expect(await rightSheet.evaluate((el) => el.scrollTop)).toBeCloseTo(
    before,
    0,
  );
  await page.getByRole("button", { name: "一键对齐", exact: true }).click();
  await expect
    .poll(async () =>
      Math.abs(
        (await leftSheet.evaluate((el) => el.scrollTop)) -
          (await rightSheet.evaluate((el) => el.scrollTop)),
      ),
    )
    .toBeLessThan(2);
  await page.getByRole("button", { name: "交换左右", exact: true }).click();
  expect((await rightSheet.boundingBox())!.x).toBeLessThan(
    (await leftSheet.boundingBox())!.x,
  );
  await page.getByLabel("同步滚动", { exact: true }).click();
  await page.getByRole("option", { name: "双向同步", exact: true }).click();
  await leftSheet.hover();
  const start = await rightSheet.evaluate((el) => el.scrollTop);
  await page.mouse.wheel(0, 160);
  await expect
    .poll(() => rightSheet.evaluate((el) => el.scrollTop))
    .toBeGreaterThan(start + 120);
  // Trackpad/pinch-style Ctrl+wheel updates both percentages after settling.
  await rightSheet.dispatchEvent("wheel", {
    ctrlKey: true,
    deltaY: -30,
    clientX: 250,
    clientY: 300,
  });
  await expect.poll(async () => await zoomValue(leftPdf)).toBeGreaterThan(160);
  await expect
    .poll(async () => await zoomValue(rightPdf))
    .toBe(await zoomValue(leftPdf));
  await page.getByRole("button", { name: "适合宽度", exact: true }).click();
  await expect
    .poll(async () =>
      Math.abs((await zoomValue(leftPdf)) - (await zoomValue(rightPdf))),
    )
    .toBeLessThan(0.2);
  await page.waitForTimeout(400);
  await page
    .getByRole("radiogroup", { name: "工具作用页面" })
    .getByRole("radio", { name: "原文", exact: true })
    .click();
  await page.getByLabel("PDF 页码", { exact: true }).fill("1");
  await page.getByRole("button", { name: "一键对齐", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(leftPdf).toBeVisible();
  await expect(rightPdf).toBeHidden();
  await expect(
    page.getByRole("toolbar", { name: "双栏阅读工具" }),
  ).toBeHidden();
  await page.getByRole("tab", { name: "译文", exact: true }).click();
  await expect(rightPdf).toBeVisible();
  await expect(leftPdf).toBeHidden();
  await expect(rightPdf.locator("canvas").first()).toHaveAttribute(
    "data-rendered",
    "true",
  );
  await page.screenshot({
    path: "../test-results/pdf-mobile-tabs.png",
    animations: "disabled",
  });
  await page.getByRole("tab", { name: "并排", exact: true }).click();
  await expect(leftPdf).toBeVisible();
  await expect(rightPdf).toBeVisible();
  await expect
    .poll(async () =>
      Math.abs((await zoomValue(leftPdf)) - (await zoomValue(rightPdf))),
    )
    .toBeLessThan(0.2);
  await expect
    .poll(() =>
      rightPdf
        .locator(".pdf-page")
        .first()
        .evaluate((el) => el.getBoundingClientRect().width),
    )
    .toBeLessThan(390);
  await page.screenshot({ path: "../test-results/pdf-fit-mobile-fixed.png" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: "../test-results/pdf-comparison.png" });
  // Resizing from mobile starts a new PDF/text-layer render. Select only after
  // the real page is visible and that render finishes, as a reader would.
  const selectedText = rightPdf
    .getByTestId("pdf-text-layer")
    .first()
    .getByText(quote, { exact: false });
  await selectedText.scrollIntoViewIfNeeded();
  await expect(selectedText).toBeInViewport();
  await expect(rightPdf.locator(".pdf-pages")).toHaveCSS("zoom", "1");
  await expect(rightPdf.locator("canvas").first()).toHaveAttribute(
    "data-rendered",
    "true",
  );
  await expect
    .poll(() =>
      rightPdf
        .getByTestId("pdf-text-layer")
        .first()
        .evaluate(
          (layer) => layer.clientWidth / layer.parentElement!.clientWidth,
        ),
    )
    .toBeCloseTo(1, 2);
  // Selecting translated PDF text highlights its counterpart without writing notes or opening AI.
  await selectedText.selectText();
  await rightPdf
    .getByTestId("pdf-text-layer")
    .first()
    .dispatchEvent("pointerup");
  await expect(leftPdf.locator(".pdf-reference-lines")).toHaveCount(1);
  await expect(page.getByRole("dialog", { name: "研究助手" })).toBeHidden();
  await page.screenshot({
    path: "../test-results/pdf-selection-counterpart.png",
  });
  // Reset before the existing citation checks.
  await page.getByLabel("同步滚动", { exact: true }).click();
  await page.getByRole("option", { name: "独立滚动", exact: true }).click();
  await openLayoutTranslation(page);
  await page.getByRole("button", { name: "段落对照", exact: true }).click();
  await page.getByRole("button", { name: "定位两侧原文", exact: true }).click();
  await expect(page.locator(".pdf-reference-lines")).toHaveCount(2);
  await openLayoutTranslation(page);
  await page.getByRole("tab", { name: "仅看译文", exact: true }).click();
  await expect(page.getByTestId("pdf-canvas")).toHaveCount(1);
  await page.getByRole("button", { name: "论文信息", exact: true }).click();
  await expect(page.getByLabel("预览文件")).toContainText(
    "translated-fixture.pdf",
  );
});

test("Arxiv import shows waiting and inline failure, then opens a successful retry", async ({
  page,
}) => {
  await login(page);
  const p = await write(page, "/papers", { title: "Import progress fixture" });
  let finish: () => void = () => {};
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let attempts = 0;
  await page.route("**/api/v1/import/arxiv", async (route) => {
    attempts++;
    if (attempts === 1) {
      await pending;
      await route.fulfill({
        status: 502,
        json: { detail: "原版 PDF 下载失败，请重试" },
      });
    } else await route.fulfill({ json: p });
  });
  await page
    .getByRole("button", { name: "导入论文", exact: true })
    .first()
    .click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("从 arXiv 导入")
    .fill("https://arxiv.org/abs/2502.12110");
  await dialog.getByRole("button", { name: "获取论文", exact: true }).click();
  // The import says which step it is on, and that it is waiting and will open the paper.
  const waiting = dialog.getByRole("status").filter({ hasText: "已等待" });
  await expect(waiting).toContainText("正在获取论文资料");
  await expect(waiting).toContainText("导入完成后会自动打开论文");
  await expect(
    dialog.getByRole("button", { name: "创建论文", exact: true }),
  ).toBeDisabled();
  await expect(
    dialog.getByRole("button", { name: "保存中…", exact: true }),
  ).toHaveCount(0);
  finish();
  await expect(dialog.getByRole("alert")).toContainText("原版 PDF 下载失败");
  await dialog.getByRole("button", { name: "获取论文", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp("#paper/" + p.id));
});

test("Library background refresh retains cards instead of flashing skeletons", async ({
  page,
}) => {
  await login(page);
  const paper = await write(page, "/papers", {
    title: "Stable background refresh",
  });
  await page.goto("/#library?q=Stable%20background%20refresh");
  const title = page.getByText("Stable background refresh", { exact: true });
  await expect(title).toBeVisible();
  const original = await title.elementHandle();
  let requested = false;
  let release!: () => void;
  const paused = new Promise<void>((r) => {
    release = r;
  });
  await page.route("**/api/v1/papers?**", async (route) => {
    if (route.request().url().includes("Stable")) {
      requested = true;
      await paused;
    }
    await route.continue();
  });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(() => requested).toBe(true);
  await expect(title).toBeVisible();
  expect(await original!.evaluate((el) => el.isConnected)).toBe(true);
  await expect(page.getByText("正在查找论文…", { exact: true })).toHaveCount(0);
  release();
  await expect(title).toBeVisible();
  await page.unroute("**/api/v1/papers?**");
});

test("Real paper: responsive bilingual reading preserves position", async ({
  page,
}) => {
  const originalPath = process.env.READER_ORIGINAL_PDF;
  const translatedPath = process.env.READER_TRANSLATED_PDF;
  test.skip(
    !originalPath || !translatedPath,
    "Provide local original and translated PDFs for visual acceptance",
  );
  await login(page);
  const p = await write(page, "/papers", { title: "Mem0 · 双语阅读验收" });
  const csrf = (await page.context().cookies()).find(
    (c) => c.name === "paper_csrf",
  )!.value;
  const upload = async (path: string, name: string) => {
    const response = await page.request.post(`/api/v1/papers/${p.id}/files`, {
      headers: { "X-CSRF-Token": csrf, "Idempotency-Key": crypto.randomUUID() },
      multipart: {
        version_id: p.current_version,
        file: {
          name,
          mimeType: "application/pdf",
          buffer: await fs.readFile(path),
        },
      },
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    return response.json();
  };
  const source = await upload(originalPath!, "mem0.pdf");
  const target = await upload(translatedPath!, "mem0-zh.pdf");
  await page.route(`**/api/v1/papers/${p.id}/translations`, (r) =>
    r.fulfill({
      json: [
        {
          id: "visual-existing-translation",
          status: "completed",
          stage: "翻译完成",
          source_file: source.id,
          translated_file: target.id,
          alignment: [],
        },
      ],
    }),
  );
  await page.setViewportSize({ width: 2560, height: 1000 });
  await page.goto(`/#paper/${p.id}`);
  await expect(page.locator("canvas").first()).toHaveAttribute(
    "data-rendered",
    "true",
  );
  await expect(page.locator(".pdf-page").first()).toHaveAttribute(
    "data-scale",
    "1",
  );
  await expect(page.getByLabel("PDF 缩放", { exact: true })).toHaveValue("100");
  await page.screenshot({
    path: "../test-results/mem0-reader-default-100.png",
    animations: "disabled",
  });
  await openLayoutTranslation(page);
  await page.getByRole("tab", { name: "并排查看", exact: true }).click();
  const original = page.locator(".pdf-view").first();
  const translated = page.locator(".pdf-view").last();
  for (const width of [1440, 1280, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await expect(original.locator("canvas").first()).toHaveAttribute(
      "data-rendered",
      "true",
    );
    if (width < 1400)
      await expect(
        page.getByRole("button", { name: "笔记", exact: true }),
      ).toBeVisible();
    await page.waitForTimeout(400);
    await page.screenshot({
      path: `../test-results/mem0-reader-${width}.png`,
      animations: "disabled",
    });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
  }
  // Return to desktop and synchronize absolute page positions, including a
  // follower hitting its shorter document's end before the leader reverses.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByLabel("同步滚动", { exact: true }).click();
  await page.getByRole("option", { name: "跟随左侧", exact: true }).click();
  const pagePosition = (el: Element) => {
    const root = el as HTMLElement;
    const rows = [...root.querySelectorAll<HTMLElement>("[data-pdf-page]")];
    const tops = rows.map(
      (r) =>
        root.scrollTop +
        r.getBoundingClientRect().top -
        root.getBoundingClientRect().top -
        root.clientTop,
    );
    const y = root.scrollTop + 20;
    let i = tops.findLastIndex((top) => top <= y);
    i = Math.max(0, i);
    return (
      Number(rows[i].dataset.pdfPage) -
      1 +
      Math.max(
        0,
        (y - tops[i]) /
          (tops[i + 1] !== undefined
            ? tops[i + 1] - tops[i]
            : rows[i].getBoundingClientRect().height),
      )
    );
  };
  const sourceSheet = original.locator(".pdf-sheet");
  const targetSheet = translated.locator(".pdf-sheet");
  for (const fraction of [1, 0.1, 0.8, 0.2, 0.6, 0.3, 0.9, 0.1]) {
    await sourceSheet.evaluate((el, fraction) => {
      el.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
      el.scrollTop = (el.scrollHeight - el.clientHeight) * fraction;
    }, fraction);
    if (fraction < 1)
      await expect
        .poll(async () =>
          Math.abs(
            (await sourceSheet.evaluate(pagePosition)) -
              (await targetSheet.evaluate(pagePosition)),
          ),
        )
        .toBeLessThan(0.02);
  }
  await page.getByLabel("同步滚动", { exact: true }).click();
  await page.getByRole("option", { name: "独立滚动", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  const sheet = original.locator(".pdf-sheet");
  await sheet.hover();
  await page.mouse.wheel(0, 900);
  await page.waitForTimeout(400);
  const before = await sheet.evaluate((el) => el.scrollTop);
  expect(before).toBeGreaterThan(500);
  await page.getByRole("tab", { name: "译文", exact: true }).click();
  await expect(original).toBeHidden();
  await expect(translated.locator("canvas").first()).toHaveAttribute(
    "data-rendered",
    "true",
  );
  await page.waitForTimeout(400);
  await page.screenshot({
    path: "../test-results/mem0-reader-390-translated.png",
    animations: "disabled",
  });
  await page.getByRole("tab", { name: "原文", exact: true }).click();
  await expect
    .poll(() => sheet.evaluate((el) => el.scrollTop))
    .toBeCloseTo(before, 0);
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(original).toBeVisible();
  await expect(translated).toBeVisible();
});

test("Model preferences: selectable models and per-user thinking controls persist", async ({
  page,
}) => {
  await login(page);
  for (const model of ["MiniMax-M3", "MiniMax-M3.1-Flash-Preview"]) {
    await write(page, "/translation-settings/configs", {
      name: "参数测试 " + model,
      model,
      base_url: "https://api.minimax.cn/v1",
      api_key: "fixture-key",
      protocol: "openai",
      vision: true,
    });
  }
  await page.goto("/#settings");
  await page
    .getByRole("button", {
      name: "参数测试 MiniMax-M3.1-Flash-Preview的操作",
      exact: true,
    })
    .click();
  await page.getByRole("menuitem", { name: "模型参数", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("思考模式", { exact: true }).click();
  await expect(
    page.getByRole("option", { name: "关闭", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("option", { name: "自适应", exact: true }).click();
  await dialog.getByLabel("思考强度（effort）").click();
  await page.getByRole("option", { name: "低 · low", exact: true }).click();
  await page.screenshot({
    path: "../test-results/model-options-desktop.png",
    animations: "disabled",
  });
  await dialog.getByRole("button", { name: "保存参数", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.reload();
  await page
    .getByRole("button", {
      name: "参数测试 MiniMax-M3.1-Flash-Preview的操作",
      exact: true,
    })
    .click();
  await page.getByRole("menuitem", { name: "模型参数", exact: true }).click();
  await expect(dialog.getByLabel("思考强度（effort）")).toHaveText("低 · low");
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("button", { name: "打开研究助手", exact: true }).click();
  await page.getByRole("button", { name: "Agent 模型", exact: true }).click();
  await page
    .getByRole("menuitemradio", { name: "参数测试 MiniMax-M3", exact: true })
    .click();

  await page
    .getByRole("button", { name: "Agent 思考强度", exact: true })
    .click();
  const quick = page.getByRole("dialog", {
    name: "Agent 快捷参数",
    exact: true,
  });
  const slider = quick.getByRole("slider");
  const motion = await quick.evaluate((element) => {
    const animation = element
      .getAnimations()
      .find(
        (item) =>
          item instanceof CSSAnimation && item.animationName === "picker-open",
      );
    if (!animation) throw new Error("Picker opening animation missing");
    animation.pause();
    const frames = [0, 90, 180].map((time) => {
      animation.currentTime = time;
      return Number(getComputedStyle(element).opacity);
    });
    animation.currentTime = 90;
    return frames;
  });
  expect(motion[0]).toBe(0);
  expect(motion[1]).toBeGreaterThan(motion[0]);
  expect(motion[1]).toBeLessThan(motion[2]);
  expect(motion[2]).toBe(1);
  const aligned = await quick.evaluate((element) => {
    const thumb = element
      .querySelector('[data-slot="slider-thumb"]')!
      .getBoundingClientRect();
    const range = element
      .querySelector('[data-slot="slider-range"]')!
      .getBoundingClientRect();
    return Math.abs(thumb.x + thumb.width / 2 - range.right);
  });
  expect(aligned).toBeLessThan(3);
  await page.screenshot({
    path: "../test-results/picker-opening-midframe.png",
  });
  await quick.evaluate((element) =>
    element.getAnimations().forEach((animation) => animation.finish()),
  );
  await quick
    .getByRole("button", { name: "参数测试 MiniMax-M3", exact: true })
    .click();
  await expect(page.getByRole("menu")).toBeVisible();
  await page
    .getByRole("menuitemradio", { name: "参数测试 MiniMax-M3", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Agent 思考强度", exact: true })
    .click();
  await expect(slider).toHaveAttribute("aria-valuetext", "关闭");
  await slider.focus();
  await slider.press("End");
  await expect(
    page.getByRole("button", { name: "Agent 思考强度", exact: true }),
  ).toContainText("自适应");
  await expect(quick.getByRole("button", { name: "保存参数" })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(slider).toBeInViewport();
  await page.screenshot({
    path: "../test-results/quick-model-mobile.png",
    animations: "disabled",
  });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Agent 模型", exact: true }).click();
  await page
    .getByRole("menuitemradio", {
      name: "参数测试 MiniMax-M3.1-Flash-Preview",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Agent 思考强度", exact: true })
    .click();
  await expect(slider).toHaveAttribute("aria-valuetext", "低");
  await slider.focus();
  await slider.press("ArrowRight");
  await expect(
    page.getByRole("button", { name: "Agent 思考强度", exact: true }),
  ).toContainText("中");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({
    path: "../test-results/quick-model-desktop.png",
    animations: "disabled",
  });
  // A failed save must retain the last actual setting.
  await page.route(
    "**/api/v1/translation-settings/configs/*/options",
    (route) => route.fulfill({ status: 503, json: { detail: "暂时无法保存" } }),
  );
  await slider.focus();
  await slider.press("ArrowRight");
  await expect(quick.getByText(/暂时无法保存/)).toBeVisible();
  await expect(slider).toHaveAttribute("aria-valuetext", "中");
  await page.unroute("**/api/v1/translation-settings/configs/*/options");
  // Reduced motion turns the picker's opening animation off.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Agent 思考强度", exact: true })
    .click();
  await expect(quick).toHaveCSS("animation-name", "none");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "收起研究助手", exact: true }).click();
  const paper = await write(page, "/papers", {
    title: "快捷翻译参数",
    external_id: "2504.19413v1",
  });
  await page.goto("/#paper/" + paper.id);
  await openLayoutTranslation(page);
  await page.getByRole("button", { name: "翻译 模型", exact: true }).click();
  await page
    .getByRole("menuitemradio", {
      name: "参数测试 MiniMax-M3.1-Flash-Preview",
      exact: true,
    })
    .click();
  // Translating is a fixed job: the app picks how hard the model thinks, so
  // there is no strength to set here, and the job runs at the lowest one
  // whatever was chosen for conversation above.
  await expect(
    page.getByRole("button", { name: "翻译 思考强度", exact: true }),
  ).toHaveCount(0);
  await page.screenshot({
    path: "../test-results/quick-translation.png",
    animations: "disabled",
  });
  await page.getByRole("button", { name: "翻译成中文", exact: true }).click();
  await expect
    .poll(
      async () =>
        (
          await (
            await page.request.get(`/api/v1/papers/${paper.id}/translations`)
          ).json()
        )[0]?.model_options?.reasoning_effort,
    )
    .toBe("low");
});

test("Handwriting: pen ink, finger scroll, erase undo, durable save and retry", async ({
  page,
}) => {
  await login(page);
  const paper = await write(page, "/papers", {
    title: "Handwriting reader test",
  });
  const csrf = (await page.context().cookies()).find(
    (c) => c.name === "paper_csrf",
  )!.value;
  const upload = await page.request.post(
    "/api/v1/papers/" + paper.id + "/files",
    {
      headers: { "X-CSRF-Token": csrf, "Idempotency-Key": crypto.randomUUID() },
      multipart: {
        version_id: paper.current_version,
        file: {
          name: "ink.pdf",
          mimeType: "application/pdf",
          buffer: testPdf(),
        },
      },
    },
  );
  expect(upload.ok()).toBeTruthy();
  const file = await upload.json();
  await page.setViewportSize({ width: 1024, height: 1366 });
  await page.goto("/#paper/" + paper.id);
  await expect(page.getByTestId("pdf-canvas")).toHaveAttribute(
    "data-rendered",
    "true",
  );
  const endpoint = "/api/v1/files/" + file.id + "/ink";
  await expect
    .poll(async () => (await page.request.get(endpoint)).status())
    .toBe(200);
  await page.getByRole("radio", { name: "手写笔", exact: true }).click();
  const surface = page.locator(".pdf-page").first();
  const draw = async () => {
    const box = (await surface.boundingBox())!;
    await page.mouse.move(box.x + 80, box.y + 200);
    await page.mouse.down();
    await page.mouse.move(box.x + 150, box.y + 220, { steps: 15 });
    await page.mouse.move(box.x + 220, box.y + 180, { steps: 15 });
    await page.mouse.up();
  };
  await draw();
  await expect
    .poll(async () => (await (await page.request.get(endpoint)).json()).length)
    .toBe(1);
  await expect(surface.locator("[data-stroke]")).toHaveCount(1);
  const original = await surface.locator("[data-stroke]").getAttribute("d");
  await page.getByLabel("PDF 缩放", { exact: true }).fill("150");
  await page.getByLabel("PDF 缩放", { exact: true }).press("Enter");
  await expect(surface.locator("[data-stroke]")).toHaveAttribute(
    "d",
    original!,
  );
  await page.reload();
  await expect(page.locator("[data-stroke]")).toHaveCount(1);
  await page.getByRole("radio", { name: "橡皮擦", exact: true }).click();
  const box = (await surface.boundingBox())!;
  await page.mouse.click(box.x + 80, box.y + 200);
  await expect(surface.locator("[data-stroke]")).toHaveCount(0);
  await page.getByRole("button", { name: "手写设置", exact: true }).click();
  await page.getByRole("button", { name: "撤销笔迹", exact: true }).click();
  await expect(surface.locator("[data-stroke]")).toHaveCount(1);
  await page.getByRole("button", { name: "重做笔迹", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(surface.locator("[data-stroke]")).toHaveCount(0);
  await expect
    .poll(async () => (await (await page.request.get(endpoint)).json()).length)
    .toBe(0);
  await page.getByRole("radio", { name: "手写笔", exact: true }).click();
  // Synthetic touch must scroll the page and must never create a stroke.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true });
  const sheet = page.locator(".pdf-sheet");
  await page.getByLabel("PDF 缩放", { exact: true }).fill("250");
  await page.getByLabel("PDF 缩放", { exact: true }).press("Enter");
  // Start the gesture on the requested scale, not the previous 150% layout.
  await expect(surface).toHaveAttribute("data-scale", "2.5");
  await expect
    .poll(() => sheet.evaluate((el) => el.scrollWidth - el.clientWidth))
    .toBeGreaterThan(200);
  await sheet.evaluate((el) => {
    el.scrollLeft = 150;
    el.scrollTop = 0;
  });
  const initialLeft = await sheet.evaluate((el) => el.scrollLeft);
  const viewport = (await sheet.boundingBox())!;
  const x = viewport.x + 100,
    y = viewport.y + 350;
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x, y }],
  });
  for (let i = 1; i <= 10; i++)
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: x - i * 6, y: y - i * 20 }],
    });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect
    .poll(() => sheet.evaluate((el) => el.scrollTop))
    .toBeGreaterThan(50);
  expect(
    Math.abs((await sheet.evaluate((el) => el.scrollLeft)) - initialLeft),
  ).toBeLessThan(2);
  // A new deliberately horizontal gesture still reveals the sides of the PDF.
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x, y }],
  });
  for (let i = 1; i <= 8; i++)
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: x - i * 8, y: y - i }],
    });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect
    .poll(() => sheet.evaluate((el) => el.scrollLeft))
    .toBeGreaterThan(initialLeft + 40);
  await page.getByLabel("PDF 缩放", { exact: true }).fill("150");
  await page.getByLabel("PDF 缩放", { exact: true }).press("Enter");
  await sheet.evaluate((el) => {
    el.scrollLeft = 0;
    el.scrollTop = 0;
  });
  expect((await (await page.request.get(endpoint)).json()).length).toBe(0);
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: false });
  await sheet.evaluate((el) => (el.scrollTop = 0));
  await page.getByRole("radio", { name: "选择文字", exact: true }).click();
  const pencilBox = (await surface.boundingBox())!;
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: pencilBox.x + 80,
    y: pencilBox.y + 200,
    button: "left",
    buttons: 1,
    clickCount: 1,
    pointerType: "pen",
    force: 0.5,
  });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: pencilBox.x + 180,
    y: pencilBox.y + 230,
    button: "left",
    buttons: 1,
    pointerType: "pen",
    force: 0.8,
  });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: pencilBox.x + 180,
    y: pencilBox.y + 230,
    button: "left",
    buttons: 0,
    clickCount: 1,
    pointerType: "pen",
  });
  await expect
    .poll(async () => (await (await page.request.get(endpoint)).json()).length)
    .toBe(1);
  await page.getByRole("button", { name: "手写设置", exact: true }).click();
  await page.getByRole("button", { name: "撤销笔迹", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect
    .poll(async () => (await (await page.request.get(endpoint)).json()).length)
    .toBe(0);
  await page.getByRole("radio", { name: "手写笔", exact: true }).click();
  // Saving failure keeps the visible ink and an explicit retry, without pretending success.
  await page.route("**/ink/*", (route) =>
    route.request().method() === "PUT"
      ? route.fulfill({ status: 503, json: { detail: "test offline" } })
      : route.continue(),
  );
  await draw();
  await expect(page.getByText("笔迹未保存", { exact: true })).toBeVisible();
  await expect(surface.locator("[data-stroke]")).toHaveCount(1);
  await page.unroute("**/ink/*");
  await page.getByRole("button", { name: "重试保存", exact: true }).click();
  await expect
    .poll(async () => (await (await page.request.get(endpoint)).json()).length)
    .toBe(1);
  await expect(page.getByText("笔迹未保存", { exact: true })).toBeHidden();
  await expect(page.getByText("保存笔迹…", { exact: true })).toBeHidden();
  await sheet.evaluate((el) => (el.scrollTop = 0));
  await page.screenshot({
    path: "../test-results/reader-handwriting-ipad.png",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBeTruthy();
  await page.screenshot({
    path: "../test-results/reader-handwriting-mobile.png",
  });
});
