import { test, expect } from "@playwright/test";
import { openReaderTool, selectionAction } from "./helpers";
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

test("PDF annotations: persistent highlight, editable comment, filters, export and delete", async ({
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

  const layer = page.getByTestId("pdf-text-layer");
  await layer.evaluate((element) => {
    const span = Array.from(element.querySelectorAll("span")).find((node) =>
      node.textContent?.includes("needle"),
    )!;
    const range = document.createRange();
    range.selectNodeContents(span);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    element.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
  });
  await expect(page.getByLabel("搜索批注")).toHaveCount(0);
  await expect(
    page.getByRole("dialog", { name: "选中文字操作" }),
  ).toBeVisible();
  await page.screenshot({
    path: "../test-results/pdf-selection-menu.png",
    animations: "disabled",
  });
  await page
    .getByRole("dialog", { name: "选中文字操作" })
    .getByRole("button", { name: "高亮", exact: true })
    .click();
  await expect(page.getByTestId("pdf-saved-annotation")).toHaveCount(1);
  await page.reload();
  await expect(page.getByTestId("pdf-saved-annotation")).toHaveCount(1);
  await openReaderTool(page, "批注");
  await expect(page.getByTestId("pdf-annotation-row")).toHaveCount(1);
  await page.getByRole("button", { name: "编辑批注", exact: true }).click();
  await page
    .getByLabel("批注评论", { exact: true })
    .fill("This evidence needs comparison.");
  await page
    .locator(".pdf-annotation-editor")
    .getByLabel("蓝色", { exact: true })
    .click();
  await page.getByRole("button", { name: "保存批注", exact: true }).click();
  await expect(page.getByTestId("pdf-annotation-row")).toContainText(
    "This evidence needs comparison.",
  );
  await page.getByLabel("搜索批注", { exact: true }).fill("comparison");
  await page.getByRole("combobox", { name: "按批注颜色筛选" }).click();
  await page.getByRole("option", { name: "蓝色", exact: true }).click();
  await expect(page.getByTestId("pdf-annotation-row")).toHaveCount(1);
  await page.getByLabel("搜索批注", { exact: true }).fill("does-not-exist");
  await expect(page.getByTestId("pdf-annotation-row")).toHaveCount(0);
  // The colour menu hands focus back as it closes; on a slow machine that can
  // swallow the clearing keystroke, so clear until the list is back.
  await expect(async () => {
    await page.getByLabel("搜索批注", { exact: true }).fill("");
    await expect(page.getByTestId("pdf-annotation-row")).toHaveCount(1, {
      timeout: 2000,
    });
  }).toPass();
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "导出批注 Markdown", exact: true })
    .click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("PDF navigation fixture-批注.md");
  await page.screenshot({ path: "../test-results/pdf-annotations.png" });
  await page.getByRole("button", { name: "删除批注", exact: true }).click();
  await expect(page.getByTestId("pdf-annotation-row")).toHaveCount(0);
  await expect(page.getByTestId("pdf-saved-annotation")).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId("pdf-canvas")).toHaveAttribute(
    "data-rendered",
    "true",
  );
  await expect(page.getByTestId("pdf-saved-annotation")).toHaveCount(0);
  await layer.evaluate((element) => {
    const span = Array.from(element.querySelectorAll("span")).find((node) =>
      node.textContent?.includes("Evidence"),
    )!;
    const range = document.createRange();
    range.selectNodeContents(span);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    element.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 400,
        clientY: 300,
        button: 2,
      }),
    );
  });
  // Right-click opens the same action menu as a drag selection.
  await selectionAction(page, "评论");
  await page
    .getByRole("textbox", { name: "评论", exact: true })
    .fill("A contextual comment");
  await page.getByRole("button", { name: "保存评论", exact: true }).click();
  await expect(page.getByTestId("pdf-saved-annotation")).toHaveCount(1);
  await page.reload();
  await expect(page.getByTestId("pdf-saved-annotation")).toHaveCount(1);
});
