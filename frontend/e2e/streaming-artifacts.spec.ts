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

test("Translation streams complete pairs, resets retry preview and hides cancelled draft", async ({
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
  const file = await upload.json();
  await page.goto(`/#paper/${paper.id}`);
  await expect(page.getByTestId("pdf-canvas")).toHaveAttribute(
    "data-rendered",
    "true",
  );

  const rows: any[] = [];
  const requests: any[] = [];
  let outcome = "running";
  await page.route("**/api/v1/translation-settings", (route) =>
    route.fulfill({
      json: {
        models: [
          {
            id: "fixture",
            name: "MiniMax",
            model: "fixture",
            controls: {
              thinking_modes: ["disabled"],
              effort_levels: ["default"],
            },
          },
        ],
        active_id: "fixture",
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
      const row = {
        id: `${data.language}-${data.page}`,
        file_id: file.id,
        kind: "page_translation",
        model_config_id: "fixture",
        parameters: { page: data.page, language: data.language },
        status: outcome,
        run_id: crypto.randomUUID(),
        error: outcome === "failed" ? "Fixture translation failed" : "",
        preview: {
          paragraphs: [
            {
              original:
                data.page === 1
                  ? "Evidence stays connected to its source."
                  : "Another needle on the second page.",
              translation: `${data.language} 译文：证据始终对应原文。`,
            },
          ],
        },
      };
      rows.unshift(row);
      return route.fulfill({ json: row });
    },
  );
  await page.route("**/api/v1/reading-artifacts/*", (route) =>
    route.fulfill({
      json: rows.find((r) =>
        route
          .request()
          .url()
          .endsWith("/" + r.id),
      ),
    }),
  );
  await page.route("**/api/v1/agent/runs/*/cancel", (route) => {
    const row = rows.find((r) => route.request().url().includes(r.run_id));
    if (row) row.status = "cancelled";
    return route.fulfill({ json: { status: "cancelled" } });
  });
  await page.getByRole("button", { name: "翻译", exact: true }).click();
  await page.getByRole("button", { name: "打开对照", exact: true }).click();
  const panel = page.getByRole("complementary", {
    name: "第 1 页对照翻译",
    exact: true,
  });
  await page.getByLabel("翻译范围").click();
  await page.getByRole("option", { name: "本页", exact: true }).click();
  await page.getByRole("button", { name: "翻译本页", exact: true }).click();
  await expect(panel.getByTestId("translation-passage")).toHaveCount(1);
  await expect(
    panel.getByText("正在翻译 · 已显示 1 句", { exact: true }),
  ).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "复制本页译文" }),
  ).toBeDisabled();
  await expect(
    panel.getByRole("button", { name: "下载本页译文" }),
  ).toBeDisabled();
  rows[0].preview.paragraphs.push({
    original: "Searchable repeated needle",
    translation: "第二句逐步显示。",
  });
  await expect(panel.getByTestId("translation-passage")).toHaveCount(2);
  await page.screenshot({ path: "../test-results/translation-streaming.png" });
  // A retry clears the previous draft instead of merging different attempts.
  rows[0].preview = null;
  await expect(panel.getByTestId("translation-passage")).toHaveCount(0);
  rows[0].preview = {
    paragraphs: [
      {
        original: "Evidence stays connected to its source.",
        translation: "重试后的新译文。",
      },
    ],
  };
  await expect(panel.getByTestId("translation-passage")).toHaveText(
    "重试后的新译文。",
  );
  await page.getByRole("button", { name: "停止", exact: true }).click();
  await expect(panel.getByTestId("translation-passage")).toHaveCount(0);
  await expect(
    panel.getByRole("button", { name: "复制本页译文" }),
  ).toBeDisabled();
  outcome = "completed";
  // Completed result is used exclusively, even if a stale preview is present.
  await page.unroute(`**/api/v1/papers/${paper.id}/reading-artifacts`);
  await page.route(
    `**/api/v1/papers/${paper.id}/reading-artifacts`,
    (route) => {
      if (route.request().method() === "GET")
        return route.fulfill({ json: rows });
      rows[0].status = "completed";
      rows[0].result = {
        paragraphs: [
          {
            original: "Evidence stays connected to its source.",
            translation: "最终已保存译文。",
          },
        ],
      };
      return route.fulfill({ json: rows[0] });
    },
  );
  await page.getByRole("button", { name: "翻译本页", exact: true }).click();
  await expect(panel.getByTestId("translation-passage")).toHaveText(
    "最终已保存译文。",
  );
  await expect(
    panel.getByRole("button", { name: "复制本页译文" }),
  ).toBeEnabled();
});
