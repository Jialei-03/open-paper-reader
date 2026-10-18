import { expect, test, type Page } from "@playwright/test";
import {
  createPaperWithPdf,
  openReader,
  pdfWithPages,
  signIn,
} from "../reader/fixtures";

// The screens follow the browser's language; these specs read them in Chinese.
test.use({ locale: "zh-CN" });

const HOME = "/#home";

// Home asks for a model first while there is none: these specs have one.
test.beforeEach(async ({ page }) => {
  await page.route("**/api/v1/translation-settings", (route) =>
    route.fulfill({
      json: {
        active_id: "model-1",
        configured: true,
        models: [{ id: "model-1" }],
      },
    }),
  );
});

/** Sign in as `name` through the sign-in form. */
async function signInAs(page: Page, name: string) {
  await page.goto("/#dashboard");
  await page.getByLabel("用户名", { exact: true }).fill(name);
  await page
    .getByLabel("密码", { exact: true })
    .fill(process.env.E2E_TEST_PASSWORD!);
  await page.getByRole("button", { name: "登录空间", exact: true }).click();
  await expect(page.locator("[data-app-screen]")).toBeVisible();
}

/** Drops `files` on `target` as a person dragging them from the desktop does. */
async function dropFiles(
  page: Page,
  selector: string,
  files: { name: string; type: string; bytes: number[] }[],
) {
  const transfer = await page.evaluateHandle((list) => {
    const data = new DataTransfer();
    for (const file of list)
      data.items.add(
        new File([new Uint8Array(file.bytes)], file.name, { type: file.type }),
      );
    return data;
  }, files);
  for (const type of ["dragenter", "dragover", "drop"])
    await page.dispatchEvent(selector, type, { dataTransfer: transfer });
}

const pageInput = (page: Page) =>
  page.getByRole("main").getByRole("textbox", { name: "页码", exact: true });

test("with no papers, a dropped PDF is imported and opened", async ({
  page,
}) => {
  // bob has nothing yet: the screen is the large drop zone.
  await signInAs(page, "bob");
  await page.goto(HOME);
  const home = page.getByRole("main");
  await expect(home.getByRole("heading", { name: "首页" })).toBeVisible();
  await expect(home.getByText("把 PDF 拖进来，或粘贴论文链接")).toBeVisible();
  await expect(home.getByText("继续阅读")).toHaveCount(0);

  // Something that is not a PDF is refused, and says why.
  await dropFiles(page, "main header", [
    { name: "notes.txt", type: "text/plain", bytes: [104, 105] },
  ]);
  await expect(home.getByRole("alert")).toHaveText("这个文件不是 PDF。");
  await home.getByRole("button", { name: "关掉", exact: true }).click();
  await expect(home.getByRole("alert")).toHaveCount(0);

  await dropFiles(page, "main header", [
    {
      name: "dropped-paper.pdf",
      type: "application/pdf",
      bytes: [...pdfWithPages(3)],
    },
  ]);
  await expect(page).toHaveURL(/#read\/[a-zA-Z0-9-]+$/);
  await expect(pageInput(page)).toHaveValue("1");
  await expect(page.locator('[data-page="3"]')).toBeAttached();
});

test("an arXiv link shows the import's progress, then opens the paper", async ({
  page,
}) => {
  await signIn(page);
  await createPaperWithPdf(page);
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  let state: { stage: string; received: number; total: number | null } = {
    stage: "metadata",
    received: 0,
    total: null,
  };
  await page.route("**/api/v1/import/arxiv/progress/*", (route) =>
    route.fulfill({ json: state }),
  );
  await page.route("**/api/v1/import/arxiv", async (route) => {
    await held;
    await route.fulfill({ response: await route.fetch() });
  });
  try {
    await page.goto(HOME);
    const home = page.getByRole("main");
    await home
      .getByRole("textbox", { name: "arXiv 链接或编号" })
      .fill("https://arxiv.org/abs/9901.00001v1");
    await home.getByRole("button", { name: "导入", exact: true }).click();
    const imports = home.getByRole("list", { name: "导入" });
    await expect(imports.getByRole("status")).toHaveText("正在获取论文资料");
    const bar = imports.getByRole("progressbar");
    await expect(bar).not.toHaveAttribute("aria-valuenow");
    state = { stage: "pdf", received: 524288, total: 2097152 };
    await expect(imports.getByRole("status")).toHaveText(
      "正在下载 PDF · 512 KB / 2.0 MB",
    );
    await expect(bar).toHaveAttribute("aria-valuenow", "524288");
    await expect(bar).toHaveAttribute("aria-valuemax", "2097152");
    state = { stage: "saving", received: 0, total: null };
    await expect(imports.getByRole("status")).toHaveText("正在校验并保存论文");
    release();
    await expect(page).toHaveURL(/#read\/[a-zA-Z0-9-]+$/);
  } finally {
    release();
  }
});

test("a failed arXiv import says why and can be retried", async ({ page }) => {
  await signIn(page);
  let fail = true;
  await page.route("**/api/v1/import/arxiv", async (route) => {
    if (fail)
      return route.fulfill({
        status: 502,
        json: { detail: "arXiv 暂时无法访问，请稍后重试" },
      });
    await route.fulfill({ response: await route.fetch() });
  });
  await page.goto(HOME);
  const home = page.getByRole("main");
  await home
    .getByRole("textbox", { name: "arXiv 链接或编号" })
    .fill("9901.00002");
  await home.getByRole("button", { name: "导入", exact: true }).click();
  await expect(home.getByRole("alert")).toHaveText(
    "arXiv 暂时无法访问，请稍后重试",
  );
  await expect(home.getByText("9901.00002 没有导入成功")).toBeVisible();
  fail = false;
  await home.getByRole("button", { name: "重试" }).click();
  await expect(page).toHaveURL(/#read\/[a-zA-Z0-9-]+$/);
});

test("continue reading opens a paper at the page it was left at", async ({
  page,
}) => {
  await signIn(page);
  const { paperId, title } = await createPaperWithPdf(page, { pages: 6 });
  await openReader(page, { paperId });
  await pageInput(page).fill("4");
  await pageInput(page).press("Enter");
  await expect(pageInput(page)).toHaveValue("4");
  // The reader writes the page down once it has settled there.
  await expect
    .poll(() =>
      page.evaluate(
        (id) =>
          Object.keys(localStorage)
            .filter((key) => key.startsWith("paper-last-page:"))
            .map((key) => JSON.parse(localStorage.getItem(key)!)[id])
            .find(Boolean),
        paperId,
      ),
    )
    .toBe(4);

  await page.goto(HOME);
  const home = page.getByRole("main");
  const continuing = home.getByRole("region", { name: "继续阅读" });
  const card = continuing.getByRole("link", { name: new RegExp(title) });
  await expect(card).toContainText("第 4 / 6 页");
  // It is also among the papers imported last.
  await expect(
    home.getByRole("region", { name: "最近导入" }).getByRole("link", {
      name: new RegExp(title),
    }),
  ).toBeVisible();

  await card.click();
  await expect(page).toHaveURL(new RegExp(`#read/${paperId}\\?page=4$`));
  await expect(pageInput(page)).toHaveValue("4");
});
