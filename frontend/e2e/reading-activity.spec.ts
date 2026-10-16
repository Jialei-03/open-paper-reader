import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { testPdf } from "./fixtures/pdf";
import { openReaderTool, cancelActiveRuns } from "./helpers";

/** A signed-in reader with one paper, its PDF and a model to ask. */
async function reader(page: Page, title: string) {
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
  const paper = await post("/papers", { title });
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
  const configured = await post("/translation-settings/configs", {
    base_url: "https://api.minimax.cn/v1",
    model: "MiniMax-M3",
    name: "Activity fixture",
    protocol: "openai",
    api_key: "synthetic-e2e-key",
  });
  // Every request the reader can make is recorded as a run; there is no model
  // behind the fixture, so each is stopped at once (one may run at a time).
  const record = async (
    prompt: string,
    quote: string,
    pageNumber: number,
    action?: string,
  ) => {
    const session = await post("/agent/sessions", {});
    const run = await post(`/agent/sessions/${session.id}/runs`, {
      prompt,
      model_config_id: configured.active_id,
      writable: false,
      reader_context: {
        paper_id: paper.id,
        file_id: file.id,
        version_id: file.version_id,
        page: pageNumber,
        source: "selection",
        quote,
        ...(action ? { action } : {}),
      },
    });
    await post(`/agent/runs/${run.id}/cancel`, {});
  };
  return { paper, file, record };
}

test("Explaining and translating are recorded apart, each in its own panel", async ({
  page,
}) => {
  const { paper, record } = await reader(page, "Explain versus translate");
  await record(
    "请结合论文上下文解释所选文字，说明概念、论证及其局限。",
    "Evidence stays connected to its source.",
    1,
    "explain",
  );
  await record(
    "请将所选文字翻译成中文，保留公式、术语和引用编号。",
    "Searchable repeated needle",
    1,
    "translate",
  );
  // A translation saved before the action was recorded is still a translation.
  await record(
    "请将所选文字翻译成中文，保留公式、术语和引用编号。只翻译这段内容。",
    "Another needle on the second page.",
    2,
  );
  await page.goto(`/#paper/${paper.id}`);

  await openReaderTool(page, "解释");
  const cards = page
    .getByLabel("阅读活动记录")
    .getByTestId("reading-activity-card");
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText("Evidence stays connected");
  await expect(cards.first().getByText("解释", { exact: true })).toBeVisible();
  await expect(page.getByText("解释与翻译")).toHaveCount(0);

  await openReaderTool(page, "翻译");
  await expect(cards).toHaveCount(2);
  await expect(
    cards.filter({ hasText: "Searchable repeated needle" }),
  ).toHaveCount(1);
  await expect(
    cards.filter({ hasText: "Another needle on the second page." }),
  ).toHaveCount(1);
  await expect(cards.getByText("翻译", { exact: true })).toHaveCount(2);
  await expect(cards.getByText("解释", { exact: true })).toHaveCount(0);
  // The translation panel also holds how to read the paper translated.
  await expect(page.getByRole("region", { name: "对照翻译" })).toBeVisible();
  await expect(page.getByRole("region", { name: "布局翻译" })).toBeVisible();

  // Each panel exports only its own kind.
  await openReaderTool(page, "解释");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出全部筛选结果" }).click();
  const exported = await readFile((await (await download).path())!, "utf8");
  expect(exported).toContain("共 1 条记录");
  expect(exported).toContain("## 解释 · 第 1 页");
  expect(exported).not.toContain("翻译成中文");
});

test("The 解释 list searches, previews and exports records beyond the first page", async ({
  page,
}) => {
  const { paper, record } = await reader(page, "Activity completeness");
  await record(
    "Earliest needle question",
    "Another needle on the second page.",
    2,
    "explain",
  );
  for (let i = 1; i < 51; i++)
    await record(`Question ${i}`, `Evidence ${i}`, 1, "explain");
  await page.goto(`/#paper/${paper.id}`);
  await openReaderTool(page, "解释");
  const activity = page.getByLabel("阅读活动记录");
  const cards = activity.getByTestId("reading-activity-card");
  await expect(cards).toHaveCount(10);
  const downloadPromise = page.waitForEvent("download");
  await activity.getByRole("button", { name: "导出全部筛选结果" }).click();
  const download = await downloadPromise;
  const exported = await readFile((await download.path())!, "utf8");
  expect(exported).toContain("共 51 条记录");
  expect(exported).toContain("Another needle on the second page.");
  await activity.getByLabel("搜索解释记录").fill("Earliest needle");
  await expect(cards).toHaveCount(1);
  await expect(cards).toContainText("Another needle on the second page.");
  const card = cards;
  const routeBefore = page.url();
  await card.hover();
  const marker = page.locator(
    '[data-pdf-page="2"] .pdf-reference-preview:not(.is-leaving)',
  );
  await expect(marker).toBeVisible();
  await expect(marker.locator(".pdf-reference-underline")).not.toHaveCount(0);
  await expect
    .poll(() =>
      marker.evaluate((node) => {
        const line = node.firstElementChild!.getBoundingClientRect();
        const viewport = node.closest(".pdf-sheet")!.getBoundingClientRect();
        return line.top >= viewport.top && line.bottom <= viewport.bottom;
      }),
    )
    .toBe(true);
  await expect(page.locator('[data-pdf-page="2"] canvas')).toHaveAttribute(
    "data-rendered",
    "true",
  );
  expect(
    await page
      .locator('[data-pdf-page="2"] canvas')
      .evaluate((canvas) => (canvas as HTMLCanvasElement).width),
  ).toBeGreaterThan(300);
  expect(page.url()).toBe(routeBefore);
  await page.screenshot({ path: "../test-results/reading-activity-hover.png" });
  await page.mouse.move(10, 10);
  await expect(page.locator(".pdf-reference-preview")).toHaveCount(0);
  await card.focus();
  await expect(marker).toBeVisible();
  await card.evaluate((node) => (node as HTMLElement).blur());
  await expect(page.locator(".pdf-reference-preview")).toHaveCount(0);
  await page.screenshot({
    path: "../test-results/reading-activity-search.png",
  });
  await activity.getByLabel("搜索解释记录").fill("No such record");
  await expect(activity.getByText("没有符合筛选条件的记录。")).toBeVisible();
  await activity.getByLabel("搜索解释记录").fill("");
  await expect(cards).toHaveCount(10);
  for (const count of [20, 30, 40, 50, 51]) {
    await activity.getByRole("button", { name: "加载更多记录" }).click();
    await expect(cards).toHaveCount(count);
  }
});

test("Translation history can remove a record or clear matching records without deleting chats", async ({
  page,
}) => {
  const { paper, record } = await reader(page, "Managed translation history");
  await record("Translate first", "First selection", 1, "translate");
  await record("Translate second", "Second selection", 1, "translate");
  await record("Explain selection", "Explanation retained", 1, "explain");
  await page.goto(`/#paper/${paper.id}`);
  await openReaderTool(page, "翻译");
  const activity = page.getByLabel("阅读活动记录");
  const cards = activity.getByTestId("reading-activity-card");
  await expect(cards).toHaveCount(2);
  const sessionsBefore = await (
    await page.request.get("/api/v1/agent/sessions")
  ).json();

  await cards
    .filter({ hasText: "First selection" })
    .getByRole("button", { name: "移除记录" })
    .click();
  await expect(cards).toHaveCount(1);
  await expect(cards).toContainText("Second selection");
  page.once("dialog", (dialog) => dialog.dismiss());
  await activity.getByRole("button", { name: "清空筛选记录" }).click();
  await expect(cards).toHaveCount(1);
  page.once("dialog", (dialog) => dialog.accept());
  await activity.getByRole("button", { name: "清空筛选记录" }).click();
  await expect(cards).toHaveCount(0);
  const sessionsAfter = await (
    await page.request.get("/api/v1/agent/sessions")
  ).json();
  expect(sessionsAfter.map((row: { id: string }) => row.id).sort()).toEqual(
    sessionsBefore.map((row: { id: string }) => row.id).sort(),
  );
  const remaining = await (
    await page.request.get(`/api/v1/papers/${paper.id}/reading-activity`)
  ).json();
  expect(remaining.items).toHaveLength(1);
  expect(remaining.items[0].kind).toBe("explanation");
});
