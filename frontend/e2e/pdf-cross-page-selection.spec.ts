import { test, expect } from "@playwright/test";
import { testPdf } from "./fixtures/pdf";
import { selectionAction, selectionMenu } from "./helpers";

test("A selection that crosses a page break opens the same menu, on drag and on right-click, and every page keeps its highlight", async ({
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
  const paper = await post("/papers", { title: "Cross page selection" });
  const upload = await page.request.post(`/api/v1/papers/${paper.id}/files`, {
    headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
    multipart: {
      version_id: paper.current_version,
      file: {
        name: "cross-page.pdf",
        mimeType: "application/pdf",
        buffer: testPdf(),
      },
    },
  });
  expect(upload.ok()).toBeTruthy();
  const file = await upload.json();
  await post("/translation-settings/configs", {
    base_url: "https://api.minimax.cn/v1",
    model: "MiniMax-M3",
    name: "Cross page fixture",
    protocol: "openai",
    api_key: "synthetic-e2e-key",
  });
  await page.goto(`/#paper/${paper.id}`);
  await expect(page.getByTestId("pdf-canvas")).toHaveAttribute(
    "data-rendered",
    "true",
  );
  // Show the end of page 1 and the start of page 2 together.
  for (let i = 0; i < 4; i++)
    await page.getByRole("button", { name: "缩小 PDF", exact: true }).click();
  const first = page
    .locator('[data-pdf-page="1"] .textLayer span')
    .filter({ hasText: "Evidence stays connected" });
  const second = page
    .locator('[data-pdf-page="2"] .textLayer span')
    .filter({ hasText: "Another needle" });
  await expect(first).toBeVisible();
  await expect(second).toBeVisible();
  const select = async () => {
    const from = (await first.boundingBox())!;
    const to = (await second.boundingBox())!;
    await page.mouse.move(from.x + from.width * 0.4, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + to.width * 0.6, to.y + to.height / 2, {
      steps: 24,
    });
    await page.mouse.up();
    return { from, to };
  };
  const menu = selectionMenu(page);
  const { from } = await select();
  await expect(menu).toBeVisible();
  await expect(menu.getByText("请先划选文字")).toHaveCount(0);
  await selectionAction(page, "高亮");
  await expect(
    page.locator('[data-pdf-page="1"] [data-testid="pdf-saved-annotation"]'),
  ).toHaveCount(1);
  await expect(
    page.locator('[data-pdf-page="2"] [data-testid="pdf-saved-annotation"]'),
  ).toHaveCount(1);
  const rows = await (
    await page.request.get(`/api/v1/files/${file.id}/annotations`)
  ).json();
  expect(rows.map((row: { page: number }) => row.page)).toEqual([1, 2]);
  expect(rows[0].quote).toContain("connected");
  expect(rows[0].quote).not.toContain("Another needle");
  expect(rows[1].quote).toContain("Another needle");

  // The right-click menu offers the actions too, and Explain carries the whole
  // passage but anchors it on the page where it starts. Pressing inside a
  // selection would start dragging it, so let go of the old one first.
  await page.mouse.click(from.x - 150, from.y + 200);
  await select();
  await page.keyboard.press("Escape");
  await page.mouse.click(from.x + from.width * 0.7, from.y + from.height / 2, {
    button: "right",
  });
  await expect(menu).toBeVisible();
  await expect(menu.getByText("请先划选文字")).toHaveCount(0);
  const submitted = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      /\/agent\/sessions\/[^/]+\/runs$/.test(r.url()),
  );
  await menu.getByRole("button", { name: "解释", exact: true }).click();
  const response = await submitted;
  expect(response.ok()).toBeTruthy();
  const run = await response.json();
  expect(run.runtime.reader_context).toMatchObject({
    file_id: file.id,
    page: 1,
    source: "selection",
  });
  expect(run.runtime.reader_context.quote).toContain("connected");
  expect(run.runtime.reader_context.quote).toContain("Another needle");
  expect(run.runtime.reader_context.rects.length).toBeGreaterThan(0);
  await page.request.post(`/api/v1/agent/runs/${run.id}/cancel`, {
    headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
    data: {},
  });
});
