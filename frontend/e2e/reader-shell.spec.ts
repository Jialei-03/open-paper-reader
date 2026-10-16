import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";

test("Reader shell: workspace surfaces, library density, PDF outline, rails and responsive layouts", async ({
  page,
}) => {
  const sourcePath = "../data/paper-study/mem0/mem0.pdf";
  test.skip(
    !(await fs.stat(sourcePath).catch(() => null)),
    "Visual acceptance requires the local Mem0 reference PDF",
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
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
  const response = await page.request.post("/api/v1/papers", {
    headers,
    data: {
      title:
        "Mem0: Building Production-Ready AI Agents with Scalable Long-Term Memory",
      authors: "Prateek Chhikara; Dev Khant; Saket Aryan",
      tags: ["Agent Memory"],
      abstract:
        "A memory architecture for AI agents, connecting retrieval with persistent long-term context.",
    },
  });
  expect(response.ok()).toBeTruthy();
  const paper = await response.json();
  const upload = await page.request.post(`/api/v1/papers/${paper.id}/files`, {
    headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
    multipart: {
      version_id: paper.current_version,
      file: {
        name: "mem0.pdf",
        mimeType: "application/pdf",
        buffer: await fs.readFile(sourcePath),
      },
    },
  });
  expect(upload.ok()).toBeTruthy();
  const note = await page.request.post("/api/v1/items", {
    headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
    data: {
      kind: "note",
      paper_id: paper.id,
      title: "Mem0 阅读笔记",
      body: "记录长期记忆架构、检索机制与实验依据。",
    },
  });
  expect(note.ok()).toBeTruthy();
  await page.reload();
  await expect(page.getByRole("heading", { name: "最近" })).toBeVisible();
  for (const [navigation, heading, name] of [
    ["最近", "最近", "dashboard"],
    ["空间设置", "设置", "settings"],
    ["知识图谱", "知识图谱", "graph"],
    ["发现论文", "发现论文", "discovery"],
  ]) {
    await page.getByRole("button", { name: navigation, exact: true }).click();
    await expect(
      page.getByRole("heading", { name: heading, exact: true }),
    ).toBeVisible();
    if (name === "graph")
      await expect(
        page.getByRole("button", { name: "选择 " + paper.title, exact: true }),
      ).toBeVisible();
    await page.screenshot({
      animations: "disabled",
      path: `../test-results/shell-${name}-desktop.png`,
    });
  }
  await page.locator(".workspace-direction-group > summary").click();
  await page.getByRole("button", { name: "管理研究方向", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "研究方向", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("方向名称", { exact: true })).toBeVisible();
  await page.screenshot({
    animations: "disabled",
    path: "../test-results/shell-directions-desktop.png",
  });
  await page.getByRole("button", { name: "我的文库", exact: true }).click();
  const libraryTable = page.getByRole("table", { name: "论文列表" });
  await expect(libraryTable).toBeVisible();
  await expect(
    libraryTable.getByRole("link", { name: paper.title, exact: true }),
  ).toBeVisible();
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBeTruthy();
    await page.screenshot({
      animations: "disabled",
      path: `../test-results/shell-library-${width}.png`,
    });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    animations: "disabled",
    path: "../test-results/shell-library-desktop.png",
  });
  await page.getByRole("radio", { name: "详细列表", exact: true }).click();
  await expect(
    page
      .locator(".paper-table-authors")
      .filter({ hasText: "Prateek Chhikara" }),
  ).toBeVisible();
  await page.screenshot({
    animations: "disabled",
    path: "../test-results/shell-library-detail.png",
  });
  await page.getByRole("radio", { name: "紧凑列表", exact: true }).click();
  await expect(page.locator(".paper-table-preview")).toHaveCount(0);
  await page.goto(`/#paper/${paper.id}`);
  await expect(page.locator("canvas").first()).toHaveAttribute(
    "data-rendered",
    "true",
  );
  const presets = page.getByRole("button", { name: "缩放预设", exact: true });
  await presets.click();
  const menu = page.getByRole("menu", { name: "缩放预设", exact: true });
  await expect(menu).toBeVisible();
  expect(
    await menu.evaluate((el) => ({
      width: el.getBoundingClientRect().width,
      radius: getComputedStyle(el).borderRadius,
    })),
  ).toEqual({ width: 184, radius: "10px" });
  await page.screenshot({
    path: "../test-results/shell-zoom-component.png",
    animations: "disabled",
  });
  await page.getByRole("menuitem", { name: "150%", exact: true }).click();
  await expect(page.getByLabel("PDF 缩放", { exact: true })).toHaveValue("150");
  await presets.click();
  await page.getByRole("menuitem", { name: "自动缩放", exact: true }).click();
  await presets.click();
  await page.keyboard.press("Escape");
  await expect(presets).toBeFocused();
  await page.getByRole("button", { name: "论文目录", exact: true }).click();
  const outline = page.getByRole("navigation", { name: "PDF 目录" });
  await expect(outline).toBeVisible();
  await expect(outline.getByRole("button").first()).toBeVisible();
  await page.screenshot({
    animations: "disabled",
    path: "../test-results/shell-reader-desktop.png",
  });
  await outline.getByRole("button", { name: "Algorithm", exact: true }).click();
  await expect(page.getByLabel("PDF 页码", { exact: true })).not.toHaveValue(
    "1",
  );
  await page.getByLabel("PDF 页码", { exact: true }).fill("1");
  await page.setViewportSize({ width: 1105, height: 853 });
  await page.screenshot({
    path: "../test-results/shell-reader-matched-viewport.png",
    animations: "disabled",
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  const readingNotes = page.getByRole("complementary", { name: "阅读笔记" });
  if (!(await readingNotes.isVisible())) {
    await page.getByRole("button", { name: "笔记", exact: true }).click();
  }
  await expect(readingNotes).toBeVisible();
  await page.getByRole("button", { name: "收起阅读侧栏", exact: true }).click();
  await expect(
    page.getByRole("complementary", { name: "阅读笔记" }),
  ).not.toBeVisible();
  if (!(await outline.isVisible())) {
    await page.getByRole("button", { name: "论文目录", exact: true }).click();
  }
  await expect(outline).toBeVisible();
  await page.getByRole("button", { name: "论文目录", exact: true }).click();
  await expect(outline).not.toBeVisible();
  await page.getByRole("button", { name: "AI", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "研究助手", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "收起阅读侧栏", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "研究助手", exact: true }),
  ).toHaveCount(0);
  await page.setViewportSize({ width: 1024, height: 1366 });
  await page.screenshot({
    animations: "disabled",
    path: "../test-results/shell-reader-tablet.png",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBeTruthy();
  await page.getByRole("button", { name: "论文目录", exact: true }).click();
  await expect(outline).toBeVisible();
  await page.getByRole("button", { name: "论文目录", exact: true }).click();
  await page.getByRole("button", { name: "笔记", exact: true }).click();
  await expect(
    page.getByRole("complementary", { name: "阅读笔记" }),
  ).toBeVisible();
  await expect(page.locator(".document-panel")).toBeHidden();
  await page.screenshot({
    animations: "disabled",
    path: "../test-results/shell-reader-mobile.png",
  });
});
