import { test, expect } from "@playwright/test";
import { openReaderTool } from "./helpers";
function testPdf() {
  const streams = [
    "BT /F1 20 Tf 40 720 Td (Searchable repeated needle) Tj 0 -40 Td (Evidence stays connected to its source.) Tj ET",
    "BT /F1 20 Tf 40 720 Td (Another needle on the second page.) Tj ET",
  ];
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R /Annots [8 0 R 9 0 R 10 0 R] >>`,
    `<< /Length ${streams[0].length} >>\nstream\n${streams[0]}\nendstream`,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>`,
    `<< /Length ${streams[1].length} >>\nstream\n${streams[1]}\nendstream`,
    `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`,
    `<< /Type /Annot /Subtype /Link /Rect [40 700 260 740] /Border [0 0 0] /Dest [5 0 R /XYZ 40 720 null] >>`,
    `<< /Type /Annot /Subtype /Link /Rect [40 650 200 680] /Border [0 0 0] /A << /S /URI /URI (https://example.org/paper) >> >>`,
    `<< /Type /Annot /Subtype /Link /Rect [40 600 200 630] /A << /S /URI /URI (javascript:alert\\(1\\)) >> >>`,
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

test("Reading insights: explicit generation, model, guide evidence, quiz grading and regenerate", async ({
  page,
}) => {
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
    data: { title: "PDF navigation fixture", authors: "Test" },
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
  await expect(page.getByTestId("pdf-canvas")).toHaveAttribute(
    "data-rendered",
    "true",
  );

  const rows: any[] = [];
  const requests: any[] = [];
  await page.route("**/api/v1/translation-settings", (route) =>
    route.fulfill({
      json: {
        models: [
          {
            id: "fixture-model",
            name: "Fixture model",
            model: "fixture-text",
            thinking_mode: "disabled",
            reasoning_effort: "default",
            controls: {
              thinking_modes: ["disabled"],
              effort_levels: ["default"],
            },
          },
        ],
        active_id: "fixture-model",
      },
    }),
  );
  await page.route(
    `**/api/v1/papers/${paper.id}/reading-artifacts`,
    async (route) => {
      if (route.request().method() === "GET")
        return route.fulfill({ json: rows });
      const data = route.request().postDataJSON();
      requests.push(data);
      const row = {
        id: "fixture-" + data.kind,
        file_id: data.file_id,
        kind: data.kind,
        status: "running",
        run_id: crypto.randomUUID(),
        session_id: "fixture-session",
        model_config_id: data.model_config_id,
        parameters: {
          question_count: data.question_count,
          difficulty: data.difficulty,
        },
        error: "",
        result: null,
      };
      rows.splice(
        0,
        rows.length,
        ...rows.filter((item) => item.id !== row.id),
        row,
      );
      return route.fulfill({ json: row });
    },
  );
  await page.route("**/api/v1/reading-artifacts/fixture-*", (route) => {
    const row = rows.find((item) => route.request().url().endsWith(item.id));
    row.status = "completed";
    row.result =
      row.kind === "guide"
        ? {
            keywords: ["test evidence", "navigation"],
            summary: [
              "First supported sentence.",
              "Second supported sentence.",
              "Third supported sentence.",
            ],
            sections: ["研究问题", "方法", "主要结果", "适用边界"].map(
              (title) => ({
                title,
                body: "Grounded fixture explanation.",
                pages: [2],
              }),
            ),
          }
        : {
            questions: Array.from(
              { length: row.parameters.question_count },
              (_, i) => ({
                question: `Evidence question ${i + 1}?`,
                options: [
                  "Correct choice",
                  "Distractor one",
                  "Distractor two",
                  "Distractor three",
                ],
                answer: 0,
                explanation: "The quoted source supports choice A.",
                pages: [1],
              }),
            ),
          };
    return route.fulfill({ json: row });
  });
  await page.getByRole("button", { name: "AI", exact: true }).click();
  let insights = page.getByRole("complementary", { name: "论文 AI" });
  await expect(
    insights.getByRole("button", { name: "生成导读", exact: true }),
  ).toBeEnabled();
  expect(requests).toHaveLength(0);
  await insights.getByRole("button", { name: "生成导读", exact: true }).click();
  await expect(
    insights.getByRole("button", { name: "三行摘要", exact: true }),
  ).toBeVisible();
  await expect(insights.locator("ol li")).toHaveCount(3);
  await expect(
    insights.locator(".agent-session-controls").first(),
  ).toBeVisible();
  await expect(
    insights.locator("[data-slot=message-scroller-viewport] .reading-insights"),
  ).toHaveCount(1);
  await expect(
    insights.locator(
      "[data-slot=message-scroller-viewport] .reader-discussion-heading",
    ),
  ).toHaveText("讨论");
  await expect(insights.locator(".agent-composer")).toBeVisible();
  const discussion = await page.request.post(
    `/api/v1/papers/${paper.id}/discussion`,
    { headers, data: {} },
  );
  const canonical = await discussion.json();
  const reopened = await page.request.post(
    `/api/v1/papers/${paper.id}/discussion`,
    {
      headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
      data: {},
    },
  );
  expect((await reopened.json()).id).toBe(canonical.id);

  await insights
    .locator(".guide-card")
    .filter({ has: page.getByRole("button", { name: "摘要", exact: true }) })
    .getByRole("button", { name: "查看全部", exact: true })
    .click();
  await insights
    .getByRole("button", { name: "第 2 页", exact: true })
    .first()
    .click();
  await expect(page.getByLabel("PDF 页码", { exact: true })).toHaveValue("2");
  await openReaderTool(page, "测验");
  insights = page.getByRole("complementary", { name: "测验" });
  await insights.getByRole("button", { name: "生成测验", exact: true }).click();
  await expect(
    insights.getByRole("group", { name: /第 \d+ 题选项/ }),
  ).toHaveCount(5);
  await expect(insights.getByText("正确答案：A", { exact: true })).toHaveCount(
    0,
  );
  for (let i = 1; i <= 5; i++)
    await insights
      .getByRole("group", { name: `第 ${i} 题选项`, exact: true })
      .getByRole("button", { name: "A. Correct choice", exact: true })
      .click();
  await insights
    .getByRole("button", { name: "提交并查看解析", exact: true })
    .click();
  await expect(insights.getByText("得分 5 / 5", { exact: true })).toBeVisible();
  await expect(insights.getByText("正确答案：A", { exact: true })).toHaveCount(
    5,
  );
  await insights.getByRole("button", { name: "重新作答", exact: true }).click();
  await expect(insights.getByText("正确答案：A", { exact: true })).toHaveCount(
    0,
  );
  await insights.getByRole("button", { name: "重新生成", exact: true }).click();
  await expect.poll(() => requests.at(-1)?.regenerate).toBe(true);
  await expect(
    insights.getByRole("group", { name: /第 \d+ 题选项/ }),
  ).toHaveCount(5);
  await expect(
    insights.getByRole("button", { name: "重新生成", exact: true }),
  ).toBeEnabled();
  await page.screenshot({ path: "../test-results/reading-insights.png" });
  await page.getByRole("button", { name: "AI", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "三行摘要", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: "../test-results/reader-ai-entrypoints.png" });
  await page
    .getByRole("button", { name: "阅读面板停靠位置", exact: true })
    .click();
  await page
    .getByRole("menuitemradio", { name: "停靠底部", exact: true })
    .click();
  await expect(page.locator(".reader-ai-flow")).toBeVisible();
  await expect(page.getByLabel("给 Agent 的消息")).toBeVisible();
  const dockedBox = await page.locator(".reader-ai-flow").boundingBox();
  const composerBox = await page.getByLabel("给 Agent 的消息").boundingBox();
  expect(composerBox!.y + composerBox!.height).toBeLessThanOrEqual(
    dockedBox!.y + dockedBox!.height + 1,
  );
  await page.screenshot({ path: "../test-results/reader-ai-bottom.png" });
});
