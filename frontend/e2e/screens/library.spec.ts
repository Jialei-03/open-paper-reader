import { expect, test } from "@playwright/test";
import { createPaperWithPdf, pdfWithPages, signIn } from "../reader/fixtures";

// The screens follow the browser's language; these specs read them in Chinese.
test.use({ locale: "zh-CN" });

const LIBRARY = "/#library";

test("the library searches, filters by reading status and deletes", async ({
  page,
}) => {
  await signIn(page);
  const stamp = Date.now().toString(36);
  const first = await createPaperWithPdf(page, {
    title: `Sparse Attention ${stamp}`,
  });
  const second = await createPaperWithPdf(page, {
    title: `Graph Kernels ${stamp}`,
  });
  // One of them is being read.
  const paper = await (
    await page.request.get(`/api/v1/papers/${second.paperId}`)
  ).json();
  const csrf = (await page.context().cookies()).find(
    (cookie) => cookie.name === "paper_csrf",
  )!.value;
  const update = await page.request.post(
    `/api/v1/papers/${second.paperId}/events`,
    {
      headers: {
        "X-CSRF-Token": csrf,
        "Idempotency-Key": crypto.randomUUID(),
        "If-Match": String(paper.revision),
      },
      data: {
        kind: "reading",
        body: "Started reading",
        reading_status: "reading",
      },
    },
  );
  expect(update.ok()).toBeTruthy();

  await page.goto(LIBRARY);
  const library = page.getByRole("main");
  await expect(library.getByRole("heading", { name: "文库" })).toBeVisible();
  const rows = library.getByRole("row");
  const link = (title: string) =>
    library.getByRole("link", { name: new RegExp(title) });
  await expect(link(first.title)).toBeVisible();
  await expect(link(second.title)).toBeVisible();

  // Search: every word must be in the title, authors or tags.
  const search = library.getByRole("searchbox", { name: "搜索文库" });
  await search.fill(`attention ${stamp}`);
  await expect(link(first.title)).toBeVisible();
  await expect(link(second.title)).toHaveCount(0);
  await search.fill(`nothing-like-this ${stamp}`);
  await expect(library.getByText("没有符合条件的论文。")).toBeVisible();
  await search.fill(stamp);

  // Filter by reading status.
  const status = library.getByRole("radiogroup", { name: "阅读状态" });
  await status.getByRole("radio", { name: "在读" }).click();
  await expect(link(second.title)).toBeVisible();
  await expect(link(first.title)).toHaveCount(0);
  await status.getByRole("radio", { name: "未读" }).click();
  await expect(link(first.title)).toBeVisible();
  await expect(link(second.title)).toHaveCount(0);
  await status.getByRole("radio", { name: "全部" }).click();
  await expect(rows).toHaveCount(3);

  // Delete asks first; cancelling keeps it.
  await library
    .getByRole("button", { name: `删除 ${first.title}`, exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "删除这篇论文？" });
  await expect(dialog).toContainText(first.title);
  await dialog.getByRole("button", { name: "取消" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(link(first.title)).toBeVisible();

  await library
    .getByRole("button", { name: `删除 ${first.title}`, exact: true })
    .click();
  await dialog.getByRole("button", { name: "删除", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(link(first.title)).toHaveCount(0);
  await expect(link(second.title)).toBeVisible();
  expect(
    (await page.request.get(`/api/v1/papers/${first.paperId}`)).status(),
  ).toBe(404);

  // A title opens the paper in the reader.
  await link(second.title).click();
  await expect(page).toHaveURL(new RegExp(`#read/${second.paperId}$`));
});

test("the library imports a PDF from its dialog", async ({ page }) => {
  await signIn(page);
  await page.goto(LIBRARY);
  const library = page.getByRole("main");
  await library.getByRole("button", { name: "导入", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "导入论文" });
  await dialog.getByTestId("import-file-input").setInputFiles({
    name: "library-import.pdf",
    mimeType: "application/pdf",
    buffer: pdfWithPages(2),
  });
  await expect(page).toHaveURL(/#read\/[a-zA-Z0-9-]+$/);
  await expect(page.locator('[data-page="2"]')).toBeAttached();
});
