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

test("Reader docking: bottom split preserves note editor and independent scrolling", async ({
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

  const editor = page.getByRole("textbox", { name: "笔记正文", exact: true });
  await expect(editor).toBeVisible();
  const draft =
    "Draft survives docking.\n\n" +
    Array.from(
      { length: 70 },
      (_, i) =>
        `Research detail ${i + 1}: evidence remains connected to its source.`,
    ).join("\n\n");
  await editor.fill(draft);
  await editor.evaluate((element) =>
    element.setAttribute("data-dock-preserved", "yes"),
  );
  await page
    .getByRole("button", { name: "阅读面板停靠位置", exact: true })
    .click();
  await page
    .getByRole("menuitemradio", { name: "停靠底部", exact: true })
    .click();
  await expect(page.locator(".reader-page")).toHaveAttribute(
    "data-aux-dock",
    "bottom",
  );
  await expect(editor).toHaveAttribute("data-dock-preserved", "yes");
  await expect(editor).toContainText("Draft survives docking.");
  const note = page.getByRole("complementary", {
    name: "阅读笔记",
    exact: true,
  });
  const documentPane = page.getByRole("region", {
    name: "文件预览",
    exact: true,
  });
  await expect
    .poll(async () => {
      const a = await documentPane.boundingBox(),
        b = await note.boundingBox();
      return !!a && !!b && b.y >= a.y + a.height - 2;
    })
    .toBe(true);
  const sheet = page.locator(".pdf-sheet").first(),
    body = page.locator(".notebook-body");
  const noteBefore = await body.evaluate((element) => element.scrollTop);
  await sheet.evaluate((element) => {
    element.scrollTop = 350;
  });
  await expect
    .poll(() => body.evaluate((element) => element.scrollTop))
    .toBe(noteBefore);
  const pdfBefore = await sheet.evaluate((element) => element.scrollTop);
  await body.evaluate((element) => {
    element.scrollTop = 200;
  });
  await expect
    .poll(() => sheet.evaluate((element) => element.scrollTop))
    .toBe(pdfBefore);
  await page.setViewportSize({ width: 1200, height: 800 });
  // Responsive adaptation may close the side panels; reopening must retain the chosen
  // axis. The panel's button toggles, so only press it when the panel is closed.
  if (!(await editor.isVisible()))
    await page.getByRole("button", { name: "笔记", exact: true }).click();
  await expect(editor).toContainText("Draft survives docking.");
  await expect(documentPane).toBeVisible();
  await page.screenshot({ path: "../test-results/reader-bottom-dock.png" });
  await page
    .getByRole("button", { name: "阅读面板停靠位置", exact: true })
    .click();
  await page
    .getByRole("menuitemradio", { name: "停靠右侧", exact: true })
    .click();
  await expect(page.locator(".reader-page")).toHaveAttribute(
    "data-aux-dock",
    "right",
  );
  await expect(editor).toContainText("Draft survives docking.");
  await page
    .getByRole("button", { name: "阅读面板停靠位置", exact: true })
    .click();
  await page
    .getByRole("menuitemradio", { name: "停靠底部", exact: true })
    .click();
  await page.setViewportSize({ width: 820, height: 1180 });
  if (await page.getByRole("button", { name: "笔记", exact: true }).isVisible())
    await page.getByRole("button", { name: "笔记", exact: true }).click();
  await expect(editor).toBeVisible();
  await expect(documentPane).toBeVisible();
  await page.screenshot({ path: "../test-results/reader-bottom-ipad.png" });
});
