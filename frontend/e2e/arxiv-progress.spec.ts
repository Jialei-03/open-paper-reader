import { test, expect, type Page } from "@playwright/test";

async function login(page: Page) {
  await page.goto("/#library");
  await page.getByLabel("用户名", { exact: true }).fill("alice");
  await page
    .getByLabel("密码", { exact: true })
    .fill(process.env.E2E_TEST_PASSWORD!);
  await page.getByRole("button", { name: "登录空间", exact: true }).click();
  await page.getByRole("button", { name: "导入论文", exact: true }).click();
  await page
    .getByLabel("从 arXiv 导入", { exact: true })
    .fill("https://arxiv.org/abs/9901.00001v1");
}

function gate() {
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { wait, release };
}

test("arXiv import shows actual bytes and stages until the POST commits", async ({
  page,
}) => {
  const pending = gate();
  let state: { stage: string; received: number; total: number | null } = {
    stage: "metadata",
    received: 0,
    total: null,
  };
  await page.route("**/api/v1/import/arxiv/progress/*", (route) =>
    route.fulfill({ json: state }),
  );
  await page.route("**/api/v1/import/arxiv", async (route) => {
    expect(route.request().headers()["x-import-id"]).toBeTruthy();
    await pending.wait;
    // The deterministic arXiv fixture creates an actual paper after the delay.
    const response = await route.fetch();
    await route.fulfill({ response });
  });
  try {
    await login(page);
    const dialog = page.getByRole("dialog", { name: "导入论文" });
    const progress = dialog.getByRole("progressbar");
    await dialog.getByRole("button", { name: "获取论文", exact: true }).click();
    await expect(
      dialog.getByText("正在获取论文资料", { exact: true }),
    ).toBeVisible();
    await expect(progress).toBeVisible();
    await expect(progress).not.toHaveAttribute("value");
    state = { stage: "pdf", received: 524288, total: 2097152 };
    await expect(
      dialog.getByText("正在下载原版 PDF · 512 KB / 2.0 MB", { exact: true }),
    ).toBeVisible();
    await expect(progress).toHaveAttribute("value", "524288");
    await expect(progress).toHaveAttribute("max", "2097152");
    state = { stage: "saving", received: 0, total: null };
    await expect(
      dialog.getByText("正在校验并保存论文", { exact: true }),
    ).toBeVisible();
    await expect(progress).not.toHaveAttribute("value");
    await expect(
      dialog.getByRole("button", { name: /正在导入…/ }),
    ).toBeDisabled();
    pending.release();
    await expect(page).toHaveURL(/#paper\//);
    await expect(dialog).toHaveCount(0);
    await expect(
      page.getByRole("progressbar", { name: "当前导入阶段的下载进度" }),
    ).toHaveCount(0);
  } finally {
    pending.release();
  }
});

test("arXiv failed download clears progress and can be retried", async ({
  page,
}) => {
  const first = gate();
  let attempts = 0;
  const tokens: string[] = [];
  await page.route("**/api/v1/import/arxiv/progress/*", (route) =>
    route.fulfill({
      json: { stage: "pdf", received: 262144, total: null },
    }),
  );
  await page.route("**/api/v1/import/arxiv", async (route) => {
    attempts += 1;
    tokens.push(route.request().headers()["x-import-id"]);
    if (attempts === 1) {
      await first.wait;
      await route.fulfill({
        status: 502,
        json: { detail: "原版 PDF 下载失败，请重试；未保存本次导入" },
      });
    } else {
      const response = await route.fetch();
      await route.fulfill({ response });
    }
  });
  try {
    await login(page);
    const dialog = page.getByRole("dialog", { name: "导入论文" });
    await dialog.getByRole("button", { name: "获取论文", exact: true }).click();
    await expect(
      dialog.getByText("正在下载原版 PDF · 256 KB", { exact: true }),
    ).toBeVisible();
    await expect(dialog.getByRole("progressbar")).not.toHaveAttribute("value");
    first.release();
    await expect(
      dialog.getByText("原版 PDF 下载失败，请重试；未保存本次导入", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(dialog.getByRole("progressbar")).toHaveCount(0);
    await expect(
      dialog.getByRole("button", { name: "获取论文", exact: true }),
    ).toBeEnabled();
    await dialog.getByRole("button", { name: "获取论文", exact: true }).click();
    await expect(page).toHaveURL(/#paper\//);
    await expect(dialog).toHaveCount(0);
    expect(attempts).toBe(2);
    expect(tokens[0]).not.toBe(tokens[1]);
  } finally {
    first.release();
  }
});
