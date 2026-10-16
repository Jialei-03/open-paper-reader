import { test, expect } from "@playwright/test";

test("Preparation overview: separate phases, retries preserve work, pause/resume and responsive layout", async ({
  page,
}) => {
  const rows = [
    {
      id: "failed",
      paper_id: "failed-paper",
      title: "译文已完成但 PDF 尚未生成",
      status: "failed",
      stage: "布局生成未完成",
      error: "排版失败",
      enabled: true,
      guide_status: "completed",
      translation_status: "completed",
      layout_status: "failed",
      completed: 12,
      total: 12,
      layout_progress: {
        status: "failed",
        stage: "排版译文",
        completed: 80,
        total: 100,
        error: "排版失败",
      },
    },
    {
      id: "active",
      paper_id: "active-paper",
      title: "正在等待资源的论文",
      status: "waiting",
      stage: "等待可用内存进行排版",
      error: "",
      enabled: true,
      guide_status: "completed",
      translation_status: "completed",
      layout_status: "running",
      completed: 8,
      total: 8,
      layout_progress: {
        status: "running",
        stage: "等待可用内存进行排版",
        completed: 42,
        total: 100,
        error: "",
      },
    },
    {
      id: "ready",
      paper_id: "ready-paper",
      title: "已经可以阅读的论文",
      status: "completed",
      stage: "全部就绪",
      error: "",
      enabled: true,
      guide_status: "completed",
      translation_status: "completed",
      layout_status: "completed",
      completed: 9,
      total: 9,
      layout_progress: {
        status: "completed",
        stage: "翻译完成",
        completed: 100,
        total: 100,
        error: "",
      },
    },
  ];
  const actions: unknown[] = [];
  let reads = 0;
  let offline = false;
  await page.route("**/api/v1/preparations?**", (route) => {
    reads++;
    if (offline)
      return route.fulfill({ status: 503, json: { detail: "网络暂时不可用" } });
    const filter = new URL(route.request().url()).searchParams.get("status");
    const summary: Record<string, number> = {
      total: rows.length,
      active: 0,
      failed: 0,
      completed: 0,
      paused: 0,
      running: 0,
      queued: 0,
      waiting: 0,
    };
    for (const row of rows) {
      summary[row.status]++;
      if (["running", "queued", "waiting"].includes(row.status))
        summary.active++;
    }
    const items = rows.filter(
      (row) =>
        filter === "all" ||
        (filter === "active"
          ? ["running", "queued", "waiting"].includes(row.status)
          : row.status === filter),
    );
    return route.fulfill({
      json: { enabled: true, summary, items, total: items.length },
    });
  });
  await page.route("**/api/v1/papers/*/preparation", (route) => {
    const command = route.request().postDataJSON().action;
    const id = route.request().url().split("/").at(-2);
    const row = rows.find((row) => row.paper_id === id)!;
    actions.push({ id, command });
    row.status = command === "pause" ? "paused" : "queued";
    row.error = "";
    return route.fulfill({ json: row });
  });
  await page.goto("/#dashboard");
  await page.getByLabel("用户名", { exact: true }).fill("alice");
  await page
    .getByLabel("密码", { exact: true })
    .fill(process.env.E2E_TEST_PASSWORD!);
  await page.getByRole("button", { name: "登录空间", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "最近", exact: true }),
  ).toBeVisible();
  await page.locator('[data-nav="preparations"]').click();
  const view = page.getByRole("region", { name: "论文准备任务总览" });
  await expect(view.getByRole("heading", { name: "准备任务" })).toBeVisible();
  await expect(page.getByText("这个页面不存在。", { exact: true })).toHaveCount(
    0,
  );
  const failed = page.getByLabel("准备任务：译文已完成但 PDF 尚未生成", {
    exact: true,
  });
  await expect(
    failed.getByRole("progressbar", { name: "正文翻译进度" }),
  ).toHaveAttribute("value", "12");
  await expect(
    failed.getByRole("progressbar", { name: "布局 PDF进度" }),
  ).toHaveAttribute("value", "80");
  await expect(
    failed.getByText("需要重试", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page
      .getByLabel("准备任务：正在等待资源的论文")
      .getByText("等待可用内存进行排版")
      .first(),
  ).toBeVisible();
  expect(actions).toEqual([]); // Viewing does not enqueue anything.
  await view.getByRole("button", { name: "待重试 1", exact: true }).click();
  await expect(view.getByLabel(/准备任务：/)).toHaveCount(1);
  await view.getByRole("button", { name: "重试未完成部分" }).click();
  await expect(view.getByText("这个状态下没有任务。")).toBeVisible();
  await view.getByRole("button", { name: "准备中 2", exact: true }).click();
  const retried = view.getByLabel("准备任务：译文已完成但 PDF 尚未生成", {
    exact: true,
  });
  await expect(
    retried.getByRole("progressbar", { name: "正文翻译进度" }),
  ).toHaveAttribute("value", "12");
  await retried.getByRole("button", { name: "暂停本篇" }).click();
  await view.getByRole("button", { name: "已暂停 1", exact: true }).click();
  await view.getByRole("button", { name: "继续准备" }).click();
  await expect
    .poll(() => actions)
    .toEqual([
      { id: "failed-paper", command: "retry" },
      { id: "failed-paper", command: "pause" },
      { id: "failed-paper", command: "resume" },
    ]);
  await view.getByRole("button", { name: "全部 3", exact: true }).click();
  await expect(view.getByLabel(/准备任务：/)).toHaveCount(3);
  for (const width of [1440, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(view).toBeVisible();
    const progress = retried.getByRole("progressbar", { name: "正文翻译进度" });
    expect((await progress.boundingBox())!.height).toBe(4);
    expect(
      await retried.evaluate((element) => getComputedStyle(element).boxShadow),
    ).toBe("none");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBeTruthy();
    await expect(
      retried.getByRole("button", { name: "暂停本篇" }),
    ).toBeVisible();
  }
  offline = true;
  await view.getByRole("button", { name: "刷新", exact: true }).click();
  await expect(view.getByRole("alert")).toContainText("任务状态暂时无法更新");
  offline = false;
  await view.getByRole("button", { name: "刷新", exact: true }).click();
  await expect(view.getByLabel(/准备任务：/)).toHaveCount(3);
  expect(reads).toBeGreaterThan(1);
});
