import { expect, test, type Page } from "@playwright/test";
import { createPaperWithPdf, openReader, signIn } from "./fixtures";
import { paperWithTranslation } from "./translation-fixtures";

// One download item in the more menu: a dialog with the PDFs the paper can be
// saved as, and what each of them asks the service for.
test.use({ locale: "zh-CN" });

const main = (page: Page) => page.getByRole("main");
const dialog = (page: Page) =>
  page.getByRole("dialog", { name: "下载", exact: true });

async function openDialog(page: Page) {
  await expect(page.locator('[data-page="1"]')).toHaveAttribute(
    "data-rendered",
    "true",
  );
  await main(page).getByRole("button", { name: "更多", exact: true }).click();
  const menu = page.getByRole("menu", { name: "更多", exact: true });
  // One item, not two.
  await expect(menu.getByRole("menuitem", { name: /下载|导出/ })).toHaveText([
    "下载…",
  ]);
  await menu.getByRole("menuitem", { name: "下载…", exact: true }).click();
  await expect(dialog(page)).toBeVisible();
}

test("without a translation the dialog offers the original and the annotated PDF", async ({
  page,
}) => {
  await signIn(page);
  const paper = await createPaperWithPdf(page, { pages: 2 });
  await openReader(page, { paperId: paper.paperId });
  await openDialog(page);
  await expect(dialog(page).getByRole("radio")).toHaveCount(2);
  await expect(
    dialog(page).getByRole("radio", { name: "原文 PDF" }),
  ).toBeChecked();
  await expect(
    dialog(page).getByRole("radio", { name: "带批注的 PDF" }),
  ).toBeVisible();
  await expect(
    dialog(page).getByRole("radio", { name: "译文 PDF" }),
  ).toHaveCount(0);

  // Cancel leaves nothing downloaded.
  await dialog(page).getByRole("button", { name: "取消", exact: true }).click();
  await expect(dialog(page)).toBeHidden();
});

test("each choice asks for its own file", async ({ page }) => {
  const paper = await paperWithTranslation(page, {
    pages: 2,
    translatedPages: 2,
  });
  const asked: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (/^\/api\/v1\/files\/[^/]+\/(content|annotated-pdf)$/.test(path))
      asked.push(`${path.split("/")[4]}:${path.split("/")[5]}`);
  });
  await openReader(page, { paperId: paper.paperId });
  await openDialog(page);
  await expect(dialog(page).getByRole("radio")).toHaveCount(3);

  const save = async (choice: string) => {
    const radio = dialog(page).getByRole("radio", {
      name: choice,
      exact: true,
    });
    await radio.check();
    const [saved] = await Promise.all([
      page.waitForEvent("download"),
      dialog(page).getByRole("button", { name: "下载", exact: true }).click(),
    ]);
    await expect(dialog(page)).toBeHidden();
    return saved.suggestedFilename();
  };

  const before = asked.length;
  expect(await save("原文 PDF")).toBe(`${paper.title}.pdf`);
  expect(asked.slice(before)).toContain(`${paper.fileId}:content`);

  await main(page).getByRole("button", { name: "更多", exact: true }).click();
  await page.getByRole("menuitem", { name: "下载…", exact: true }).click();
  const mark = asked.length;
  expect(await save("带批注的 PDF")).toBe(`${paper.title}-批注.pdf`);
  expect(asked.slice(mark)).toEqual([`${paper.fileId}:annotated-pdf`]);

  await main(page).getByRole("button", { name: "更多", exact: true }).click();
  await page.getByRole("menuitem", { name: "下载…", exact: true }).click();
  const last = asked.length;
  expect(await save("译文 PDF")).toBe(`${paper.title}-译文.pdf`);
  expect(asked.slice(last)).toEqual([`${paper.translatedId}:content`]);
});

test("a translation that has not finished is not offered", async ({ page }) => {
  const paper = await paperWithTranslation(page, {
    pages: 2,
    translatedPages: 2,
    unfinished: true,
  });
  await openReader(page, { paperId: paper.paperId });
  await openDialog(page);
  await expect(dialog(page).getByRole("radio")).toHaveCount(2);
});
