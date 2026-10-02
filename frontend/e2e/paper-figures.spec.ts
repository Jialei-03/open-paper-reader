import { test, expect } from "@playwright/test";
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

test("Figure catalogue: source-backed location, explicit draft, existing explanations and session navigation", async ({
  page,
}) => {
  await page.route("**/api/v1/translation-settings", (route) =>
    route.fulfill({ json: { models: [], active_id: "" } }),
  );
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

  const file = await upload.json();
  const targetSession = crypto.randomUUID(),
    otherSession = crypto.randomUUID(),
    runId = crypto.randomUUID();
  let sentRuns = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      /\/agent\/sessions\/[^/]+\/runs$/.test(new URL(request.url()).pathname)
    )
      sentRuns++;
  });
  await page.route(`**/api/v1/papers/${paper.id}/figure-assets`, (route) =>
    route.fulfill({
      json: {
        source_images: [
          { id: file.id, asset: "figures/memory.png", supported: true },
        ],
      },
    }),
  );
  await page.route(`**/api/v1/files/${file.id}/figure-captions`, (route) =>
    route.fulfill({
      json: {
        items: [
          {
            page: 2,
            quote: "Another needle on the second page.",
            kind: "figure",
          },
        ],
        pages_scanned: 2,
        total_pages: 2,
        limited: false,
      },
    }),
  );
  await page.route(
    `**/api/v1/papers/${paper.id}/reading-activity*`,
    (route) => {
      const query = new URL(route.request().url()).searchParams.get("q") || "";
      return route.fulfill({
        json: {
          items:
            query === "missing"
              ? []
              : [
                  {
                    id: runId,
                    session_id: targetSession,
                    prompt: "Explain memory",
                    excerpt:
                      "A grounded explanation in the original conversation.",
                    kind: "explanation",
                    category: "image",
                    body: "A grounded explanation in the original conversation.",
                    file_id: file.id,
                    page: 2,
                    quote: "Another needle on the second page.",
                  },
                ],
          next: null,
          total: 1,
        },
      });
    },
  );
  await page.route("**/api/v1/agent/sessions", (route) =>
    route.fulfill({
      json: [
        { id: otherSession, title: "Draft conversation" },
        { id: targetSession, title: "Source conversation" },
      ],
    }),
  );
  await page.route(`**/api/v1/agent/sessions/${otherSession}/runs`, (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route(`**/api/v1/agent/sessions/${targetSession}/runs`, (route) =>
    route.fulfill({
      json: [
        {
          id: runId,
          prompt: "Explain memory",
          response: "A grounded explanation in the original conversation.",
          status: "completed",
          model: "fixture",
          error: "",
          writable: false,
          steps: [],
        },
      ],
    }),
  );
  await page.getByRole("button", { name: "图表", exact: true }).click();
  const panel = page.getByRole("region", { name: "图表与解释", exact: true });
  await expect(panel.getByText("全文图表", { exact: true })).toBeVisible();
  // Images found in the LaTeX source are kept out of the way until asked for.
  await expect(
    panel.getByText("figures/memory.png", { exact: true }),
  ).toBeHidden();
  await panel.getByText("论文源码里的图片", { exact: false }).click();
  await expect(
    panel.getByText("figures/memory.png", { exact: true }),
  ).toBeVisible();
  // A paper with one PDF never shows the stored file name.
  await expect(panel.getByLabel("图表来源 PDF")).toHaveCount(0);
  await expect(panel).not.toContainText("navigation.pdf");
  await panel.getByRole("button", { name: "定位原文", exact: true }).click();
  await expect(page.getByLabel("PDF 页码", { exact: true })).toHaveValue("2");
  // Figure explanations use the same persisted reading activity as text.
  await panel
    .getByRole("button", { name: "解释", exact: true })
    .first()
    .click();
  await expect(page.getByLabel("阅读活动记录")).toBeVisible();
  await expect(
    page.getByText("需要可用模型才能生成解释。", { exact: false }),
  ).toBeVisible();
  expect(sentRuns).toBe(0);
  const composer = page.getByLabel("给 Agent 的消息");
  const history = page.getByLabel("阅读活动记录");
  await expect(
    history.getByText("A grounded explanation in the original conversation.", {
      exact: true,
    }),
  ).toBeVisible();
  await history.getByLabel("搜索解释记录").fill("missing");
  await expect(
    history.getByText("没有符合筛选条件的记录。", { exact: true }),
  ).toBeVisible();
  await history.getByLabel("搜索解释记录").fill("");
  await history.getByRole("button", { name: "继续追问", exact: true }).click();
  await expect(page.locator(`[data-agent-run="${runId}"]`)).toBeVisible();
  await expect(composer).toHaveValue("");
  await page.evaluate(
    (sessionId) =>
      window.dispatchEvent(
        new CustomEvent("open-research-agent", {
          detail: { sessionId, runId: "missing-run" },
        }),
      ),
    otherSession,
  );
  await expect(composer).toHaveValue("");
  expect(sentRuns).toBe(0);
  await page.screenshot({ path: "../test-results/paper-figures.png" });
});
