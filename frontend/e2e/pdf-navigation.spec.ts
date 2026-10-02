import { test, expect } from "@playwright/test";
import { cancelActiveRuns } from "./helpers";
function testPdf(padding = 0) {
  const streams = [
    "BT /F1 20 Tf 40 720 Td (Searchable repeated needle) Tj 0 -40 Td (Evidence stays connected to its source.) Tj ET",
    "BT /F1 20 Tf 40 720 Td (Another needle on the second page.) Tj 0 -30 Td (Synthetic reference 0) Tj ET",
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
  if (padding)
    objects.push(
      `<< /Length ${padding} >>\nstream\n${"x".repeat(padding)}\nendstream`,
    );
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

test("PDF navigation: cross-page search, match geometry, cancel and thumbnails", async ({
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
    data: {
      title: "PDF navigation fixture",
      authors: "Test",
      external_id: "arxiv:9901.00003",
    },
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
  await page.getByRole("button", { name: "查找论文", exact: true }).click();
  await page.getByRole("textbox", { name: "查找论文内容" }).fill("NEEDLE");
  const search = page.getByRole("search", { name: "论文全文查找" });
  await expect(search.getByRole("status")).toHaveText("1 / 2");
  await expect(
    page.getByTestId("pdf-search-highlight").locator("span").first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "下一个查找结果" }).click();
  await expect(page.getByLabel("PDF 页码", { exact: true })).toHaveValue("2");
  await expect(search.getByRole("status")).toHaveText("2 / 2");
  await expect(
    page.locator('[data-pdf-page="2"] [data-testid="pdf-search-highlight"]'),
  ).toBeVisible();
  await page.getByRole("button", { name: "上一个查找结果" }).click();
  await expect(page.getByLabel("PDF 页码", { exact: true })).toHaveValue("1");
  await page
    .getByRole("textbox", { name: "查找论文内容" })
    .fill("no_such_phrase_999");
  await expect(search.getByRole("status")).toHaveText("无匹配文字");
  await page.getByRole("textbox", { name: "查找论文内容" }).press("Escape");
  await expect(search).toHaveCount(0);
  await expect(page.getByTestId("pdf-search-highlight")).toHaveCount(0);
  await expect(page.getByLabel("PDF 页码", { exact: true })).toHaveValue("1");
  await page.getByRole("button", { name: "论文目录", exact: true }).click();
  await page.getByRole("tab", { name: "缩略图", exact: true }).click();
  const thumb = page.getByRole("button", { name: "转到第 2 页", exact: true });
  await expect(thumb.locator("canvas")).toBeVisible();
  await thumb.click();
  await expect(page.getByLabel("PDF 页码", { exact: true })).toHaveValue("2");
  await expect(thumb).toHaveAttribute("aria-current", "page");
  await page.getByRole("button", { name: "转到第 1 页", exact: true }).click();
  const internal = page.getByRole("button", { name: "跳转论文引用位置" });
  await expect(internal).toHaveCount(1);
  const linkBounds = (await internal.boundingBox())!;
  await page.mouse.move(linkBounds.x + 8, linkBounds.y + 8);
  const preview = page.getByRole("dialog", { name: "论文链接预览" });
  await expect(preview).toBeVisible();
  await expect(preview.getByText(/第 2 页/)).toBeVisible();
  await expect(page.getByLabel("PDF 页码", { exact: true })).toHaveValue("1");
  await preview
    .getByRole("button", { name: "查看引用详情", exact: true })
    .click();
  await expect(preview.getByLabel("引用详情")).toContainText(
    "Deterministic source abstract",
  );
  await expect(preview.getByLabel("引用详情")).toContainText(
    "Citation Test Author",
  );
  await page.screenshot({ path: "../test-results/citation-preview.png" });
  await preview.getByRole("button", { name: "跳转", exact: true }).click();
  await expect(page.getByLabel("PDF 页码", { exact: true })).toHaveValue("2");
  await page.getByRole("button", { name: "返回引用前位置" }).click();
  await internal.focus();
  await internal.press("Enter");
  await expect(page.getByLabel("PDF 页码", { exact: true })).toHaveValue("2");
  await page.getByRole("button", { name: "返回引用前位置" }).click();
  await expect(page.getByLabel("PDF 页码", { exact: true })).toHaveValue("1");
  const external = page.getByRole("link", {
    name: "打开论文链接：https://example.org/paper",
  });
  await expect(external).toHaveAttribute("href", "https://example.org/paper");
  await expect(external).toHaveAttribute("rel", "noopener noreferrer");
  await expect(
    page.locator('.pdf-link-targets [href^="javascript:"]'),
  ).toHaveCount(0);
  await page.route("**/api/v1/papers/*/link-preview*", (route) =>
    route.fulfill({
      json: { title: "Example source", description: "Public source metadata" },
    }),
  );
  const externalBounds = (await external.boundingBox())!;
  await page.mouse.move(externalBounds.x + 8, externalBounds.y + 8);
  await expect(
    preview.getByText("Example source", { exact: true }),
  ).toBeVisible();
  const requestEvent = page.evaluate(
    () =>
      new Promise((resolve) =>
        window.addEventListener(
          "reader-explanation",
          (event) => resolve((event as CustomEvent).detail),
          { once: true },
        ),
      ),
  );
  await preview
    .getByRole("button", { name: "解释链接与本文的关系", exact: true })
    .click();
  const request: any = await requestEvent;
  expect(request.context.category).toBe("url");
  expect(request.context.paper_id).toBe(paper.id);
  expect(request.prompt).toContain("https://example.org/paper");
  await expect(
    page.getByRole("complementary", { name: "解释", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: "../test-results/pdf-navigation.png" });
  // Explaining a link starts a task; there is no worker here to finish it.
  await cancelActiveRuns(page);
});

test("large PDF shows byte progress and requests real ranges before rendering", async ({
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
    (cookie) => cookie.name === "paper_csrf",
  )!.value;
  const headers = {
    "X-CSRF-Token": csrf,
    "Idempotency-Key": crypto.randomUUID(),
  };
  const created = await page.request.post("/api/v1/papers", {
    headers,
    data: { title: "PDF range progress fixture" },
  });
  expect(created.ok()).toBeTruthy();
  const paper = await created.json();
  const uploaded = await page.request.post(`/api/v1/papers/${paper.id}/files`, {
    headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
    multipart: {
      version_id: paper.current_version,
      file: {
        name: "large-progress.pdf",
        mimeType: "application/pdf",
        buffer: testPdf(900 * 1024),
      },
    },
  });
  expect(uploaded.ok()).toBeTruthy();
  const file = await uploaded.json();
  const endpoint = `/api/v1/files/${file.id}/content`;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ranges: string[] = [];
  const partialResponses: number[] = [];
  page.on("response", (response) => {
    if (response.url().endsWith(endpoint) && response.status() === 206)
      partialResponses.push(response.status());
  });
  await page.route(`**${endpoint}`, async (route) => {
    const range = route.request().headers()["range"];
    if (range) {
      ranges.push(range);
      // Let the first chunk arrive, then hold subsequent chunks to expose real progress.
      if (ranges.length > 1) await gate;
    }
    await route.continue();
  });
  try {
    await page.goto(`/#paper/${paper.id}`);
    const progress = page.getByRole("progressbar", { name: "PDF 加载进度" });
    await expect(progress).toBeVisible();
    await expect.poll(() => ranges.length).toBeGreaterThan(1);
    await expect
      .poll(async () => Number(await progress.getAttribute("value")))
      .toBeGreaterThan(0);
    expect(Number(await progress.getAttribute("value"))).toBeLessThan(100);
    await expect(page.getByText(/MB \/ .*MB · \d+%/)).toBeVisible();
    release();
    await expect(page.getByTestId("pdf-canvas")).toHaveAttribute(
      "data-rendered",
      "true",
    );
    await expect(progress).toHaveCount(0);
    expect(partialResponses.length).toBeGreaterThan(0);
    expect(ranges.every((range) => /^bytes=\d+-\d+$/.test(range))).toBeTruthy();
  } finally {
    release();
    await cancelActiveRuns(page);
  }
});
