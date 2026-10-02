import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Every panel beside the paper — AI, 解释, 翻译, 批注, 笔记, 图表, 引用文献,
 * 测验 — has its own button on the reader's right rail, named as shown. 分享论文
 * is a document action in the header.
 */
export async function openReaderTool(page: Page, name: string) {
  await page.getByRole("button", { name, exact: true }).click();
}

/** The floating menu that appears after selecting text in the PDF. */
export function selectionMenu(page: Page): Locator {
  return page.getByRole("dialog", { name: "选中文字操作" });
}

/** Click one action of the selection menu (解释 / 高亮 / 翻译 / 评论 / 向AI提问 / 复制 / 摘录). */
export async function selectionAction(page: Page, name: string) {
  const menu = selectionMenu(page);
  await expect(menu).toBeVisible();
  await menu.getByRole("button", { name, exact: true }).click();
}

/**
 * The layout-translation controls (model, engine, source) are a section of the 翻译
 * panel. The panel's button toggles, so only press it when the panel is closed.
 */
export async function openLayoutTranslation(page: Page) {
  const section = page.getByRole("region", { name: "布局翻译" });
  if (!(await section.isVisible()))
    await page.getByRole("button", { name: "翻译", exact: true }).click();
  await expect(section).toBeVisible();
}

/**
 * These tests have no worker to finish the tasks they start. Stop whatever an
 * earlier test left, so it is not still queued when the next test looks at the
 * account's tasks (and so a limit that is switched back on cannot refuse it).
 */
export async function cancelActiveRuns(page: Page) {
  const csrf = (await page.context().cookies()).find(
    (cookie) => cookie.name === "paper_csrf",
  )!.value;
  const sessions = await (
    await page.request.get("/api/v1/agent/sessions")
  ).json();
  for (const session of sessions) {
    const runs = await (
      await page.request.get(`/api/v1/agent/sessions/${session.id}/runs`)
    ).json();
    for (const run of runs)
      if (["queued", "running"].includes(run.status))
        await page.request.post(`/api/v1/agent/runs/${run.id}/cancel`, {
          headers: {
            "X-CSRF-Token": csrf,
            "Idempotency-Key": crypto.randomUUID(),
          },
          data: {},
        });
  }
}
