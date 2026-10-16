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

test("Page tools: explicit translation, cached page, highlights, failure and cancellation", async ({
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
  let outcome = "complete";
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
    (route) => {
      if (route.request().method() === "GET")
        return route.fulfill({ json: rows });
      const data = route.request().postDataJSON();
      requests.push(data);
      const id = `fixture-${data.kind}-${data.page || 0}-${data.language || ""}`;
      const row = {
        id,
        file_id: data.file_id,
        kind: data.kind,
        model_config_id: data.model_config_id,
        parameters: { page: data.page, language: data.language },
        status: "running",
        run_id: crypto.randomUUID(),
        result: null,
        error: "",
        evidence_pages: [],
      };
      rows.splice(
        0,
        rows.length,
        ...rows.filter((item) => item.id !== id),
        row,
      );
      return route.fulfill({ json: row });
    },
  );
  await page.route("**/api/v1/reading-artifacts/fixture-*", (route) => {
    const row = rows.find((item) => route.request().url().endsWith(item.id));
    if (row.status === "running" && outcome !== "hold") {
      row.status = outcome === "fail" ? "failed" : "completed";
      row.error = outcome === "fail" ? "Fixture upstream unavailable" : "";
      row.evidence_pages =
        row.kind === "highlights" ? [2] : [row.parameters.page];
      row.result =
        row.status === "failed"
          ? null
          : row.kind === "highlights"
            ? {
                highlights: [
                  {
                    page: 2,
                    quote: "Another needle on the second page.",
                    category: "method",
                  },
                  {
                    page: 2,
                    quote:
                      "Unmatched stale source quote must not produce a rectangle.",
                    category: "novelty",
                  },
                ],
              }
            : {
                paragraphs: [
                  {
                    original: "Searchable repeated needle",
                    translation: `中文译文 ${row.parameters.page} 页`,
                  },
                ],
              };
    }
    return route.fulfill({ json: row });
  });
  await page.route("**/api/v1/agent/runs/*/cancel", (route) => {
    const row = rows.find((item) =>
      route.request().url().includes(item.run_id),
    );
    row.status = "cancelled";
    return route.fulfill({ json: { status: "cancelled" } });
  });
  await openReaderTool(page, "批注");
  await page.getByText("AI 重点建议", { exact: true }).click();
  const tools = page.getByRole("region", { name: "重点建议", exact: true });
  expect(requests).toHaveLength(0);
  await tools
    .getByRole("button", { name: "生成重点建议", exact: true })
    .click();
  await expect(tools.getByText(/已核验 1 \/ 2 页/)).toBeVisible();
  await tools.getByRole("button", { name: /方法.*第 2 页/ }).click();
  await expect(page.getByLabel("PDF 页码", { exact: true })).toHaveValue("2");
  const overlay = page.getByTestId("pdf-suggested-highlights");
  const annotationUrl = `/api/v1/files/${requests[0].file_id}/annotations`;
  const manualAnnotation = await page.request.put(
    `${annotationUrl}/${crypto.randomUUID()}`,
    {
      headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
      data: {
        page: 1,
        quote: "Searchable repeated needle",
        rects: [{ x: 0.06, y: 0.07, w: 0.4, h: 0.03 }],
        comment: "Keep this manual note",
      },
    },
  );
  expect(manualAnnotation.ok()).toBeTruthy();
  const originalAnnotations = await (
    await page.request.get(annotationUrl)
  ).json();
  const annotationWrites: string[] = [];
  page.on("request", (request) => {
    if (
      request.url().includes("/annotations") &&
      !["GET", "HEAD"].includes(request.method())
    )
      annotationWrites.push(request.url());
  });
  await expect(overlay).toHaveCount(0);
  await tools.getByRole("checkbox", { name: "在论文上显示重点" }).check();
  await expect(
    overlay.locator('[data-category="method"]').first(),
  ).toBeVisible();
  await expect(overlay).toHaveText("");
  await expect(overlay.locator('[data-category="novelty"]')).toHaveCount(0);
  const originalWidth = await overlay
    .locator("span")
    .first()
    .evaluate((el) => el.getBoundingClientRect().width);
  await page.getByRole("button", { name: "放大 PDF", exact: true }).click();
  await expect
    .poll(async () =>
      overlay
        .locator("span")
        .first()
        .evaluate((el) => el.getBoundingClientRect().width),
    )
    .toBeGreaterThan(originalWidth);
  await openReaderTool(page, "批注");
  await expect(overlay.locator("span").first()).toBeVisible();
  // The toolbar button toggles the panel; reopen it before checking its controls.
  await openReaderTool(page, "批注");
  await expect(
    tools.getByRole("checkbox", { name: "在论文上显示重点" }),
  ).toBeChecked();
  await tools.getByRole("checkbox", { name: "在论文上显示重点" }).uncheck();
  await expect(overlay).toHaveCount(0);
  expect(await (await page.request.get(annotationUrl)).json()).toEqual(
    originalAnnotations,
  );
  expect(annotationWrites).toHaveLength(0);
  outcome = "fail";
  await tools.getByRole("button", { name: "重新生成", exact: true }).click();
  await expect(
    tools.getByText("Fixture upstream unavailable", { exact: false }),
  ).toBeVisible();
  outcome = "hold";
  await tools.getByRole("button", { name: "重试生成", exact: true }).click();
  await tools.getByRole("button", { name: "停止生成", exact: true }).click();
  await expect(
    tools.getByRole("button", { name: "重试生成", exact: true }),
  ).toBeVisible();
  outcome = "complete";
  await tools.getByRole("button", { name: "重试生成", exact: true }).click();
  await expect(tools.getByText(/已核验 1 \/ 2 页/)).toBeVisible();
  await page.screenshot({ path: "../test-results/paper-reading-tools.png" });
});
