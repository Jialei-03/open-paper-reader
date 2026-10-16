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

test("Paper preparation: shared progress, pause and background guide discovery from an empty list", async ({
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
  const paper = await (
    await page.request.post("/api/v1/papers", {
      headers,
      data: { title: "Automatic preparation fixture" },
    })
  ).json();
  const uploaded = await page.request.post(`/api/v1/papers/${paper.id}/files`, {
    headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
    multipart: {
      version_id: paper.current_version,
      file: {
        name: "preparation.pdf",
        mimeType: "application/pdf",
        buffer: testPdf(),
      },
    },
  });
  expect(uploaded.ok()).toBeTruthy();
  const file = await uploaded.json();
  let status = "running";
  const actions: unknown[] = [];
  let rows: any[] = [];
  let artifactWrites = 0;
  await page.route(`**/api/v1/papers/${paper.id}/preparation`, (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON();
      actions.push(body);
      if (body.action === "pause") {
        status = "paused";
        for (const row of rows)
          if (row.parameters?.preparation_id) row.status = "paused";
      }
      if (body.action === "resume") status = "running";
    }
    return route.fulfill({
      json: {
        enabled: true,
        status,
        stage: "正在翻译正文",
        error: "",
        completed: 1,
        total: 2,
        guide_status: "queued",
        translation_status: "running",
        layout_status: "waiting",
      },
    });
  });
  await page.route("**/api/v1/translation-settings", (route) =>
    route.fulfill({
      json: {
        models: [
          { id: "automatic-model", name: "Automatic model", model: "fixture" },
        ],
        active_id: "automatic-model",
      },
    }),
  );
  await page.route(
    `**/api/v1/papers/${paper.id}/reading-artifacts`,
    (route) => {
      if (route.request().method() !== "GET") artifactWrites++;
      return route.fulfill({ json: rows });
    },
  );
  await page.goto(`/#paper/${paper.id}`);
  await page.getByRole("button", { name: "论文准备进度" }).click();
  await expect(page.getByText("共用正文译文", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("progressbar", { name: "正文翻译进度" }),
  ).toHaveAttribute("value", "1");
  await page.getByRole("button", { name: "暂停本篇" }).click();
  await page.getByRole("button", { name: "继续准备" }).click();
  await expect
    .poll(() => actions)
    .toEqual([{}, { action: "pause" }, { action: "resume" }]);
  await page.keyboard.press("Escape");
  await openReaderTool(page, "AI");
  rows = [
    {
      id: "automatic-guide",
      file_id: file.id,
      kind: "guide",
      status: "completed",
      run_id: "",
      session_id: "",
      model_config_id: "previous-model",
      error: "",
      result: {
        keywords: ["自动准备"],
        summary: ["无需点击生成即可看到后台导读"],
        sections: [],
      },
    },
  ];
  await expect(page.getByText("无需点击生成即可看到后台导读")).toBeVisible();
  expect(artifactWrites).toBe(0);
  expect(
    actions.filter((body) => Object.keys(body as object).length === 0),
  ).toHaveLength(1);
  // Automatic page artifacts have a preparation parent, not a chat run.
  rows.push({
    id: "automatic-page",
    file_id: file.id,
    kind: "page_translation",
    status: "running",
    run_id: "",
    model_config_id: "automatic-model",
    parameters: { page: 1, language: "zh", preparation_id: "automatic-parent" },
    error: "",
    preview: { paragraphs: [] },
  });
  let cancelledRuns = 0;
  await page.route("**/api/v1/agent/runs/**/cancel", (route) => {
    cancelledRuns++;
    return route.fulfill({ json: {} });
  });
  await page.route("**/api/v1/reading-artifacts/automatic-page", (route) =>
    route.fulfill({ json: rows.find((row) => row.id === "automatic-page") }),
  );
  await openReaderTool(page, "翻译");
  await page.getByRole("button", { name: "打开对照", exact: true }).click();
  await page.getByRole("button", { name: "停止", exact: true }).click();
  await expect.poll(() => actions.at(-1)).toEqual({ action: "pause" });
  expect(cancelledRuns).toBe(0);
  await expect(
    page.getByText("已停止，完成的译文已保留").first(),
  ).toBeVisible();
  let enabled = true;
  await page.route("**/api/v1/preparation-settings", (route) => {
    if (route.request().method() === "PATCH")
      enabled = route.request().postDataJSON().enabled;
    return route.fulfill({ json: { enabled } });
  });
  await page.goto("/#settings");
  const toggle = page.getByRole("switch", { name: "自动准备导读与翻译" });
  await expect(toggle).toBeChecked();
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  expect(enabled).toBe(false);
});
