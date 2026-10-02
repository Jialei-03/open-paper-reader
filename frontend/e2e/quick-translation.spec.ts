import { test, expect } from "@playwright/test";
import { selectionAction } from "./helpers";
import { testPdf } from "./fixtures/pdf";

test("Quick translation: only selected text, no layout jump, optional persistent save", async ({
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
  const headers = { "X-CSRF-Token": csrf };
  const post = async (path: string, data: unknown) => {
    const response = await page.request.post("/api/v1" + path, {
      headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
      data,
    });
    expect(response.ok()).toBeTruthy();
    return response.json();
  };
  const paper = await post("/papers", { title: "Reader context verification" });
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
  let submitted: unknown;
  await page.route("**/api/v1/files/*/quick-translation", async (route) => {
    submitted = route.request().postDataJSON();
    await route.fulfill({
      json: { text: "证据始终与其来源关联。", provider: "Google", page: 1 },
    });
  });
  await page.goto(`/#paper/${paper.id}`);
  const layer = page.getByTestId("pdf-text-layer").first();
  await expect(layer).toContainText("Evidence stays connected");
  const originalBounds = await page.locator(".pdf-sheet").boundingBox();
  const select = async () =>
    layer.evaluate((element) => {
      const span = Array.from(element.querySelectorAll("span")).find((node) =>
        node.textContent?.includes("Evidence stays"),
      )!;
      const range = document.createRange();
      range.selectNodeContents(span);
      const selected = window.getSelection()!;
      selected.removeAllRanges();
      selected.addRange(range);
      element.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    });
  await select();
  expect(submitted).toBeUndefined();
  await selectionAction(page, "翻译");
  const popup = page.getByRole("dialog", { name: "选段快速翻译" });
  await expect(popup).toContainText("证据始终与其来源关联。");
  const exactLine = page
    .locator(".pdf-reference-preview:not(.is-leaving) .pdf-reference-underline")
    .first();
  await expect(exactLine).toBeVisible();
  const originalLine = await layer
    .locator("span")
    .filter({ hasText: "Evidence stays" })
    .evaluate((node) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      const r = range.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    });
  const underline = await exactLine.boundingBox();
  expect(Math.abs(underline!.x - originalLine!.x)).toBeLessThan(3);
  expect(Math.abs(underline!.width - originalLine!.width)).toBeLessThan(3);
  expect(
    Math.abs(underline!.y - (originalLine!.y + originalLine!.height - 2)),
  ).toBeLessThan(3);
  expect(submitted).toEqual({
    page: 1,
    text: "Evidence stays connected to its source.",
    language: "zh",
  });
  expect(await page.locator(".pdf-sheet").boundingBox()).toEqual(
    originalBounds,
  );
  await expect(page.getByTestId("pdf-saved-annotation")).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "选中文字操作" })).toBeHidden();
  await expect(popup).toHaveCSS("opacity", "1");
  await page.screenshot({
    path: "../test-results/quick-translation-selection.png",
    animations: "disabled",
  });
  await popup.getByRole("button", { name: "保存为评论" }).click();
  await expect(page.getByTestId("pdf-saved-annotation")).toHaveCount(1);
  const annotations = await (
    await page.request.get(`/api/v1/files/${file.id}/annotations`)
  ).json();
  expect(JSON.stringify(annotations)).toContain("证据始终与其来源关联。");
  await page.reload();
  await expect(page.getByTestId("pdf-saved-annotation")).toHaveCount(1);
});
