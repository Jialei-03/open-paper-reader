import { test, expect } from "@playwright/test";
import { testPdf } from "./fixtures/pdf";

test("One navigation across library and reader; docked agent keeps drafts when floating", async ({
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
  await expect(
    page.getByRole("heading", { name: "最近", exact: true }),
  ).toBeVisible();
  const sidebar = page.locator('[data-slot="sidebar-inner"]');
  const navigation = await sidebar.getByRole("button").allTextContents();
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
      title: "Unified navigation reading fixture",
      tags: ["Agent Memory"],
    },
  });
  expect(response.ok()).toBeTruthy();
  const paper = await response.json();
  const upload = await page.request.post(`/api/v1/papers/${paper.id}/files`, {
    headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
    multipart: {
      version_id: paper.current_version,
      file: {
        name: "navigation.pdf",
        mimeType: "application/pdf",
        buffer: testPdf(),
      },
    },
  });
  expect(upload.ok()).toBeTruthy();
  await page.goto(`/#paper/${paper.id}`);
  await expect(page.getByTestId("pdf-text-layer").first()).toContainText(
    "Evidence stays connected",
  );
  await expect(page.locator(".reader-navigation-rail")).toHaveCount(0);
  expect(await sidebar.getByRole("button").allTextContents()).toEqual(
    navigation,
  );
  await expect(
    sidebar.getByRole("button", { name: "我的文库", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await page.getByRole("button", { name: "AI", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "研究助手" });
  await expect(page.locator(".reader-agent-host .agent-docked")).toBeVisible();
  await panel.getByLabel("给 Agent 的消息").fill("保留这份输入草稿");
  await page.screenshot({
    path: "../test-results/unified-reader-agent.png",
    animations: "disabled",
  });
  await panel.getByRole("button", { name: "对话设置", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "切换为悬浮窗", exact: true })
    .click();
  await expect(panel).toHaveClass(/agent-floating-window/);
  await expect(panel.getByLabel("给 Agent 的消息")).toHaveValue(
    "保留这份输入草稿",
  );
  await panel.getByRole("button", { name: "停靠到侧栏" }).click();
  await expect(page.locator(".reader-agent-host .agent-docked")).toBeVisible();
  await expect(panel.getByLabel("给 Agent 的消息")).toHaveValue(
    "保留这份输入草稿",
  );
  await sidebar.getByRole("button", { name: "我的文库", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "我的文库", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".agent-global-dock .agent-docked")).toBeVisible();
  await expect(panel.getByLabel("给 Agent 的消息")).toHaveValue(
    "保留这份输入草稿",
  );
  await panel.getByRole("button", { name: "收起研究助手" }).click();
  await expect(
    page.getByRole("link", { name: paper.title, exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "../test-results/unified-library.png",
    animations: "disabled",
  });
  await page.goto(`/#paper/${paper.id}`);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "切换主导航", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "我的文库", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "打开研究助手", exact: true }).click();
  await expect(panel).toBeVisible();
  await expect(panel.getByLabel("给 Agent 的消息")).toHaveValue(
    "保留这份输入草稿",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await expect(
    page.locator(".reader-ai-flow .reader-discussion-heading"),
  ).toBeVisible();
  await expect(page.locator(".reader-ai-flow .reading-insights")).toBeVisible();
  await page.screenshot({
    path: "../test-results/unified-agent-mobile.png",
    animations: "disabled",
  });
  await panel.getByRole("button", { name: "对话设置", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "收起研究助手", exact: true })
    .click();
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: "../test-results/unified-reader-dark.png",
    animations: "disabled",
  });
  expect(errors).toEqual([]);
});
