import { test, expect, Page } from "@playwright/test";
import { openReaderTool } from "./helpers";
import fs from "node:fs/promises";

async function login(page: Page) {
  await page.goto("/#dashboard");
  await page.getByLabel("用户名", { exact: true }).fill("alice");
  await page
    .getByLabel("密码", { exact: true })
    .fill(process.env.E2E_TEST_PASSWORD!);
  await page.getByRole("button", { name: "登录空间", exact: true }).click();
  await expect(page.getByRole("heading", { name: "最近" })).toBeVisible();
}
async function paper(page: Page, external_id: string) {
  const csrf = (await page.context().cookies()).find(
    (c) => c.name === "paper_csrf",
  )!.value;
  const response = await page.request.post("/api/v1/papers", {
    data: { title: "Citation source " + Date.now(), external_id },
    headers: { "X-CSRF-Token": csrf, "Idempotency-Key": crypto.randomUUID() },
  });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

test("Citation cards: explicit lookup, pagination, search, save, BibTeX and complete PDF import", async ({
  page,
}) => {
  await login(page);
  const source = await paper(page, "arxiv:9901.00003");
  await page.goto("/#paper/" + source.id);
  await openReaderTool(page, "引用文献");
  const panel = page.getByRole("region", { name: "引用卡片", exact: true });
  await panel.getByRole("tab", { name: "参考文献", exact: true }).click();
  await expect(
    panel.getByRole("link", { name: "Synthetic reference 0", exact: true }),
  ).toBeVisible();
  await panel.getByRole("button", { name: "加载下一页", exact: true }).click();
  await expect(
    panel.getByRole("link", { name: "Synthetic reference 50", exact: true }),
  ).toBeVisible();
  await panel.getByLabel("搜索引用", { exact: true }).fill("50");
  await expect(
    panel.getByRole("link", { name: "Synthetic reference 0", exact: true }),
  ).toHaveCount(0);
  await panel.getByLabel("搜索引用", { exact: true }).fill("");
  await panel
    .getByRole("button", {
      name: "保存引用：Synthetic reference 0",
      exact: true,
    })
    .click();
  await expect(
    panel.getByRole("button", {
      name: "取消保存：Synthetic reference 0",
      exact: true,
    }),
  ).toBeVisible();
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await panel
    .getByRole("button", {
      name: "复制 BibTeX：Synthetic reference 0",
      exact: true,
    })
    .click();
  await expect(panel.getByRole("status")).toContainText("BibTeX 已复制");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
    "Synthetic reference 0",
  );
  const downloading = page.waitForEvent("download");
  await panel
    .getByRole("button", {
      name: "下载 BibTeX：Synthetic reference 0",
      exact: true,
    })
    .click();
  const download = await downloading;
  expect(await fs.readFile((await download.path())!, "utf8")).toContain(
    "archivePrefix = {arXiv}",
  );
  await panel.getByRole("tab", { name: "被引用", exact: true }).click();
  await expect(
    panel.getByRole("link", { name: "Synthetic citing paper 0", exact: true }),
  ).toBeVisible();
  await page.reload();
  await openReaderTool(page, "引用文献");
  await expect(
    panel.getByRole("link", { name: "Synthetic reference 0", exact: true }),
  ).toBeVisible();
  await panel.getByText("查看摘要", { exact: true }).click();
  await expect(panel).toContainText("Deterministic source abstract");
  await page.screenshot({
    path: "../test-results/citation-cards.png",
    fullPage: true,
  });
  await panel
    .getByRole("button", {
      name: "取消保存：Synthetic reference 0",
      exact: true,
    })
    .click();
  await expect(
    panel.getByRole("link", { name: "Synthetic reference 0", exact: true }),
  ).toHaveCount(0);
  await panel.getByRole("tab", { name: "参考文献", exact: true }).click();
  const card = panel.getByRole("article").filter({
    has: page.getByRole("link", {
      name: "Synthetic reference 0",
      exact: true,
    }),
  });
  await card.getByRole("button", { name: "导入论文", exact: true }).click();
  await expect(page.getByTestId("pdf-canvas").first()).toBeVisible();
  expect(page.url()).not.toContain(source.id);
  const imported = await page.request.get(
    "/api/v1/papers/" + page.url().split("#paper/")[1],
  );
  expect((await imported.json()).external_id).toBe("arxiv:9901.00002v1");
});

test("Citation cards: missing public identifier produces an error, not an empty result", async ({
  page,
}) => {
  await login(page);
  const source = await paper(page, "private internal memo");
  await page.goto("/#paper/" + source.id);
  await openReaderTool(page, "引用文献");
  const panel = page.getByRole("region", { name: "引用卡片", exact: true });
  await panel.getByRole("tab", { name: "参考文献", exact: true }).click();
  await expect(panel.getByRole("alert")).toContainText(
    "请先在论文信息中填写 DOI 或 arXiv 标识",
  );
  await expect(
    panel.getByText("公开引用库暂未返回文献。", { exact: true }),
  ).toHaveCount(0);
});
