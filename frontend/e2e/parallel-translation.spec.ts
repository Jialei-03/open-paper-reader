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

test("Translation comparison: options, sentence hover, language cache and all-page continuation", async ({
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
  let outcome = "completed";
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
        result: {
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
  let panel = page.getByRole("complementary", {
    name: "第 1 页对照翻译",
    exact: true,
  });
  await expect(panel).toBeVisible();
  await expect(
    page.getByRole("button", { name: "翻译设置", exact: true }),
  ).toHaveCount(1);
  expect(requests).toHaveLength(0);
  await expect(page.getByLabel("翻译范围")).toContainText("全文");
  await page.getByLabel("翻译范围").click();
  await page.getByRole("option", { name: "本页", exact: true }).click();

  await expect(
    page.locator(".pdf-translation-slot .parallel-translation"),
  ).toHaveCount(2);
  expect(
    await panel.evaluate((element) => Boolean(element.closest(".pdf-sheet"))),
  ).toBe(true);
  const pairedBounds = await panel.evaluate((element) => {
    const paper = element
      .closest("[data-pdf-page]")!
      .querySelector(".pdf-page")!
      .getBoundingClientRect();
    const translation = element.getBoundingClientRect();
    return {
      top: Math.abs(paper.top - translation.top),
      height: Math.abs(paper.height - translation.height),
      adjacent: translation.left >= paper.right,
    };
  });
  expect(pairedBounds.top).toBeLessThan(2);
  expect(pairedBounds.height).toBeLessThan(2);
  expect(pairedBounds.adjacent).toBe(true);
  await expect
    .poll(() =>
      panel.evaluate((element) => {
        const viewport = element.closest(".pdf-sheet")!;
        return viewport.scrollWidth - viewport.clientWidth;
      }),
    )
    .toBeLessThanOrEqual(1);
  const beforeWidth = await panel.evaluate(
    (el) => el.getBoundingClientRect().width,
  );
  await panel
    .getByRole("separator", { name: "调整原文和译文宽度" })
    .press("ArrowLeft");
  await expect
    .poll(() => panel.evaluate((el) => el.getBoundingClientRect().width))
    .toBeGreaterThan(beforeWidth);
  await panel
    .getByRole("separator", { name: "调整原文和译文宽度" })
    .press("Home");
  const independentWidth = await panel.evaluate(
    (el) => el.getBoundingClientRect().width,
  );
  await page.getByRole("button", { name: "放大 PDF", exact: true }).click();
  await expect
    .poll(() => panel.evaluate((el) => el.getBoundingClientRect().width))
    .toBeCloseTo(independentWidth, 0);
  await page.getByRole("button", { name: "适合宽度", exact: true }).click();
  // Resize the reading sidebar, hide it, then reopen it: both translation
  // columns must track the actual viewport, including a fixed PDF zoom.
  await page.getByLabel("PDF 缩放", { exact: true }).fill("80");
  await page.getByLabel("PDF 缩放", { exact: true }).press("Enter");
  if (
    await page
      .getByRole("button", { name: "打开阅读侧栏", exact: true })
      .isVisible()
  )
    await page
      .getByRole("button", { name: "打开阅读侧栏", exact: true })
      .click();
  const sidebarDivider = page.locator(
    '.reader-layout > [data-slot="resizable-handle"]',
  );
  await sidebarDivider.press("ArrowLeft");
  await sidebarDivider.press("ArrowLeft");
  const narrowWidth = await panel.evaluate(
    (el) => el.getBoundingClientRect().width,
  );
  await page.getByRole("button", { name: "收起阅读侧栏", exact: true }).click();
  await expect
    .poll(() => panel.evaluate((el) => el.getBoundingClientRect().width))
    .toBeGreaterThan(narrowWidth);
  const emptyRight = () =>
    panel.evaluate((el) => {
      const sheet = el.closest(".pdf-sheet")!;
      return (
        sheet.getBoundingClientRect().right - el.getBoundingClientRect().right
      );
    });
  await expect.poll(emptyRight).toBeLessThan(35);
  await page.getByRole("button", { name: "打开阅读侧栏", exact: true }).click();
  await expect.poll(emptyRight).toBeLessThan(35);
  await page.getByRole("button", { name: "收起阅读侧栏", exact: true }).click();
  await page.getByRole("button", { name: "适合宽度", exact: true }).click();
  await page.getByRole("button", { name: "翻译本页", exact: true }).click();
  await expect(panel.getByTestId("translation-passage")).toContainText(
    "zh 译文",
  );
  await panel.getByTestId("translation-passage").hover();
  const marker = page.locator(
    '[data-pdf-page="1"] .pdf-reference-fill:not(.is-leaving) .pdf-reference-underline',
  );
  await expect(marker.first()).toBeVisible();
  await expect
    .poll(() =>
      marker.first().evaluate((e) => e.getBoundingClientRect().height),
    )
    .toBeGreaterThan(4);
  await page.screenshot({
    path: "../test-results/parallel-translation-hover.png",
  });
  // Hovering the exact PDF sentence activates its aligned translation too.
  const passage = panel.getByTestId("translation-passage");
  const source = page
    .locator('[data-pdf-page="1"] .textLayer span')
    .filter({ hasText: "Evidence stays connected to its source." })
    .first();
  await panel.getByRole("button", { name: "复制本页译文" }).hover();
  await expect(passage).toHaveAttribute("data-active", "false");
  await source.hover({ position: { x: 10, y: 5 } });
  await expect(passage).toHaveAttribute("data-active", "true");
  await expect(marker.first()).toBeVisible();
  expect(requests).toHaveLength(1);
  // Long translations expand the document instead of creating a hidden nested scroller.
  await panel.getByRole("button", { name: "复制本页译文" }).hover();
  await passage.evaluate((element) => {
    element.style.marginTop = "1200px";
  });
  await panel.locator(".parallel-translation-body").evaluate((element) => {
    element.scrollTop = 0;
  });
  await source.hover({ position: { x: 10, y: 5 } });
  await expect(passage).toHaveAttribute("data-active", "true");
  await expect
    .poll(() =>
      panel
        .locator(".parallel-translation-body")
        .evaluate((element) => element.scrollTop),
    )
    .toBe(0);
  await expect
    .poll(() =>
      passage.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        const viewport = element.parentElement!.getBoundingClientRect();
        return bounds.top >= viewport.top && bounds.bottom <= viewport.bottom;
      }),
    )
    .toBe(true);
  // Hovering a translation whose source is above the viewport must not
  // pull the shared scroller back to the source and lose the reading position.
  await passage.scrollIntoViewIfNeeded();
  await page.mouse.move(0, 0);
  const readingTop = await page
    .locator(".pdf-sheet")
    .evaluate((el) => el.scrollTop);
  const sourceStillVisible = await page
    .locator('[data-pdf-page="1"] .pdf-source-pane')
    .evaluate((el) => {
      const bounds = el.getBoundingClientRect();
      const viewport = el.closest(".pdf-sheet")!.getBoundingClientRect();
      return bounds.bottom > viewport.top && bounds.top < viewport.bottom;
    });
  expect(sourceStillVisible).toBe(true);
  await passage.hover();
  await expect(passage).toHaveAttribute("data-active", "true");
  await page.waitForTimeout(500); // Allow any erroneous smooth scroll to finish.
  expect(
    await page.locator(".pdf-sheet").evaluate((el) => el.scrollTop),
  ).toBeCloseTo(readingTop, 0);
  await passage.evaluate((element) => {
    element.style.marginTop = "";
  });

  // Rebuilding source text invalidates cached ranges; unmatched quotes draw nothing.
  await panel.getByRole("button", { name: "复制本页译文" }).hover();
  const originalText = await source.textContent();
  await source.evaluate((element) => {
    element.textContent = "Unrelated source text.";
  });
  await passage.hover();
  await expect(marker).toHaveCount(0);
  await page
    .locator('[data-pdf-page="1"] .textLayer span')
    .filter({ hasText: "Unrelated source text." })
    .evaluate((element, text) => {
      element.textContent = text;
    }, originalText);
  await panel.getByRole("button", { name: "复制本页译文" }).hover();
  await passage.hover();
  await expect(marker.first()).toBeVisible();

  // The identical text in a different file must never establish correspondence.
  await panel.getByRole("button", { name: "复制本页译文" }).hover();
  const pdf = page.locator(`.pdf-view[data-source-file="${file.id}"]`);
  await pdf.evaluate((element) => {
    element.setAttribute("data-source-file", "other-file");
  });
  await source.hover({ position: { x: 12, y: 5 } });
  await expect(passage).toHaveAttribute("data-active", "false");
  await expect(marker).toHaveCount(0);
  // Restore the real identity before hovering the translation: a changed PDF
  // identity can legitimately remove its paired translation portal.
  await page
    .locator('.pdf-view[data-source-file="other-file"]')
    .evaluate((element, id) => {
      element.setAttribute("data-source-file", id);
      // The column finds its PDF view when the workspace's children change, and
      // the hover above may have run while the attribute was still swapped.
      const workspace = element.closest(".parallel-reader-workspace")!;
      workspace.appendChild(document.createElement("i")).remove();
    }, file.id);

  await page.getByRole("button", { name: "翻译设置", exact: true }).click();
  await page.getByRole("switch", { name: "悬停对照原文" }).click();
  await page.keyboard.press("Escape");
  await passage.hover();
  await expect(passage).toHaveAttribute("data-active", "false");
  await expect(marker).toHaveCount(0);
  await source.hover({ position: { x: 10, y: 5 } });
  await expect(passage).toHaveAttribute("data-active", "false");
  await page.getByRole("button", { name: "翻译设置", exact: true }).click();
  await page.getByRole("switch", { name: "悬停对照原文" }).click();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "译文字号", exact: true }).click();
  await page.getByRole("button", { name: "放大译文字号" }).click();
  await expect(page.getByText("16px", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "翻译设置", exact: true }).click();
  await page.getByLabel("翻译语言", { exact: true }).click();
  await page.getByRole("option", { name: "日本語", exact: true }).click();
  await expect(
    page.getByRole("option", { name: "日本語", exact: true }),
  ).toBeHidden();
  await page.getByRole("button", { name: "翻译设置", exact: true }).click();
  await expect(panel.getByTestId("translation-passage")).toHaveCount(0);
  await page.getByLabel("翻译范围").click();
  await page.getByRole("option", { name: "全文", exact: true }).click();
  await page.getByRole("button", { name: "翻译全文", exact: true }).click();
  await expect(panel.getByRole("status")).toContainText("已翻译 2 / 2 页");
  expect(
    requests
      .filter((r) => r.language === "ja")
      .map((r) => r.page)
      .sort(),
  ).toEqual([1, 2]);
  await page.getByRole("button", { name: "下一页", exact: true }).click();
  panel = page.getByRole("complementary", {
    name: "第 2 页对照翻译",
    exact: true,
  });
  await expect(panel.getByTestId("translation-passage")).toContainText(
    "ja 译文",
  );
  await panel.getByTestId("translation-passage").hover();
  await expect(
    page.locator('[data-pdf-page="2"] .pdf-reference-fill:not(.is-leaving)'),
  ).toBeVisible();
  await panel.getByRole("button", { name: "复制本页译文" }).hover();
  await page
    .locator('[data-pdf-page="2"] .textLayer span')
    .filter({ hasText: "Another needle on the second page." })
    .first()
    .hover({ position: { x: 10, y: 5 } });
  await expect(panel.getByTestId("translation-passage")).toHaveAttribute(
    "data-active",
    "true",
  );
  await expect(
    page.locator('[data-pdf-page="2"] .pdf-reference-fill:not(.is-leaving)'),
  ).toBeVisible();
  await page.getByRole("button", { name: "上一页", exact: true }).click();
  const firstPanel = page.getByRole("complementary", {
    name: "第 1 页对照翻译",
    exact: true,
  });
  await firstPanel.getByTestId("translation-passage").hover();
  await expect(marker.first()).toBeVisible();
  await expect(
    page.locator('[data-pdf-page="2"] .pdf-reference-fill:not(.is-leaving)'),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "下一页", exact: true }).click();
  outcome = "failed";
  await page.getByRole("button", { name: "重新翻译本页" }).click();
  await expect(panel.getByRole("alert")).toBeVisible();
  outcome = "running";
  await page.getByRole("button", { name: "重新翻译本页" }).click();
  await expect(
    page.getByRole("button", { name: "停止", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "停止", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "重新翻译本页" }),
  ).toBeEnabled();
  expect(rows[0].status).toBe("cancelled");
  outcome = "completed";
  await page.getByRole("button", { name: "重新翻译本页" }).click();
  await expect(panel.getByTestId("translation-passage")).toBeVisible();
  await page.getByRole("button", { name: "翻译设置", exact: true }).click();
  await page.getByRole("radio", { name: "仅看译文", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(
    page.locator('[data-pdf-page="2"] > .pdf-source-pane'),
  ).toBeHidden();
  await page.getByRole("button", { name: "关闭对照翻译", exact: true }).click();
  await expect(page.locator(".parallel-reader-document")).toBeVisible();
});
