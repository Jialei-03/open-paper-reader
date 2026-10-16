import { test, expect } from "@playwright/test";

test("Recent homepage shares library controls and keeps device-scoped opening order", async ({
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
  await expect(page.locator(".dashboard")).toHaveCount(0);
  await expect(page.getByText("最近更新", { exact: true })).toHaveCount(0);
  const csrf = (await page.context().cookies()).find(
    (c) => c.name === "paper_csrf",
  )!.value;
  const headers = { "X-CSRF-Token": csrf };
  const titles = [
    "Mem0: Building Production-Ready AI Agents with Scalable Long-Term Memory",
    "A-MEM: Agentic Memory for LLM Agents",
    "MemoryOS: An Operating System for Personalized AI",
    "LongMemEval: Benchmarking Long-Term Interactive Memory",
    "Generative Agents: Interactive Simulacra of Human Behavior",
    "Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks",
    "Lost in the Middle: How Language Models Use Long Contexts",
    "Self-RAG: Learning to Retrieve, Generate, and Critique",
    "MemGPT: Towards LLMs as Operating Systems",
    "Agent Laboratory: Using LLM Agents for Research",
    "HippoRAG: Neurobiologically Inspired Long-Term Memory",
    "From Local to Global: A Graph RAG Approach",
    "Attention Is All You Need",
    "ReAct: Synergizing Reasoning and Acting in Language Models",
    "Reflexion: Language Agents with Verbal Reinforcement Learning",
    "Toolformer: Language Models Can Teach Themselves to Use Tools",
    "Tree of Thoughts: Deliberate Problem Solving with LLMs",
    "Voyager: An Open-Ended Embodied Agent",
    "The Rise and Potential of Large Language Model Based Agents",
  ];
  const papers = [];
  for (const title of titles) {
    const response = await page.request.post("/api/v1/papers", {
      headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
      data: {
        title,
        authors: "Research team",
        tags: ["recent-home", "Agent Memory"],
      },
    });
    expect(response.ok()).toBeTruthy();
    papers.push(await response.json());
  }
  // A visit is only remembered for papers the app already knows about; papers
  // made through the API appear after the next load.
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "最近", exact: true }),
  ).toBeVisible();
  await page.goto(`/#paper/${papers[1].id}`);
  await expect(page.locator(".reader-page")).toBeVisible();
  await page.goto(`/#paper/${papers[0].id}`);
  await expect(page.locator(".reader-page")).toBeVisible();
  await page.goto("/#dashboard?tag=recent-home");
  const table = page.getByRole("table", { name: "论文列表" });
  await expect(table.getByRole("row")).toHaveCount(19);
  await expect(table.getByRole("row").nth(1)).toContainText(titles[0]);
  await expect(table.getByRole("row").nth(2)).toContainText(titles[1]);
  await page.getByRole("button", { name: "下一页", exact: true }).click();
  await expect(page).toHaveURL(/#dashboard.*page=2/);
  await expect(table.getByRole("row")).toHaveCount(2);
  await page.getByRole("button", { name: "上一页", exact: true }).click();
  await page.getByRole("radio", { name: "详细列表", exact: true }).click();
  await expect(page.locator(".paper-table-detailed")).toBeVisible();
  await page.getByRole("radio", { name: "紧凑列表", exact: true }).click();
  await page.getByRole("button", { name: "搜索论文", exact: true }).click();
  await page.getByLabel("搜索论文", { exact: true }).fill("Mem0:");
  await expect(table.getByRole("row")).toHaveCount(2);
  await expect(page).toHaveURL(/#dashboard/);
  await page
    .getByRole("button", { name: "收藏：" + titles[0], exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "取消收藏：" + titles[0], exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "取消收藏：" + titles[0], exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "收藏：" + titles[0], exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "清空搜索", exact: true }).click();
  await page.getByRole("button", { name: "批量管理", exact: true }).click();
  await page.getByRole("checkbox", { name: "选择当前页论文" }).check();
  await expect(
    page.getByRole("toolbar", { name: "批量管理论文" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "批量管理", exact: true }).click();
  await page.goto("/#dashboard");
  await expect(table.getByRole("row").nth(1)).toContainText(titles[0]);
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0);
  await page.screenshot({
    path: "../test-results/recent-home-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("heading", { name: "最近", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "导入论文", exact: true }),
  ).toBeVisible();
  const scrollContainer = page.locator(
    '.paper-table [data-slot="table-container"]',
  );
  await scrollContainer.evaluate((element) => {
    element.scrollLeft = element.scrollWidth;
  });
  const lastColumn = table.getByRole("columnheader", {
    name: "最后打开 · 此设备",
    exact: true,
  });
  const rightBounds = await lastColumn.boundingBox();
  expect(rightBounds!.x).toBeGreaterThanOrEqual(0);
  expect(rightBounds!.x + rightBounds!.width).toBeLessThanOrEqual(390);
  await scrollContainer.evaluate((element) => {
    element.scrollLeft = 0;
  });
  await page.screenshot({
    path: "../test-results/recent-home-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
});
