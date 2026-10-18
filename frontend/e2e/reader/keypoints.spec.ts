import { expect, test, type Page } from "@playwright/test";
import { createPaperWithPdf, openReader, signIn } from "./fixtures";

// The interface follows the browser's language; these specs read it in Chinese.
test.use({ locale: "zh-CN" });

const MODEL = { id: "fixture-model", name: "Fixture model", model: "fixture" };
const NOVEL = "Our key idea is a shared memory graph";
const LIMIT = "It does not scale to very long documents";
const GUIDE = {
  keywords: ["记忆"],
  summary: ["摘要第一句。", "摘要第二句。", "摘要第三句。"],
  sections: ["研究问题", "方法", "主要结果", "适用边界"].map((title) => ({
    title,
    body: `${title}的内容。`,
    pages: [1],
  })),
};
const KEYPOINTS = {
  keypoints: [
    { page: 1, quote: NOVEL, category: "novelty", reason: "提出了共享记忆图" },
    // Not in the paper (a model's slip): listed nowhere on a page, never marked in a wrong place.
    {
      page: 1,
      quote: "A sentence the paper never says",
      category: "method",
      reason: "",
    },
    { page: 2, quote: LIMIT, category: "limits", reason: "长文档上不适用" },
  ],
};

type Row = Record<string, unknown>;

/** The service's answers, in place of the model. `started` collects the bodies that asked for key sentences. */
async function serve(
  page: Page,
  paperId: string,
  fileId: string,
  options: { keypoints?: Row | null } = {},
) {
  const started: Row[] = [];
  let keypoints: Row | null = options.keypoints ?? null;
  await page.route("**/api/v1/translation-settings", (route) =>
    route.fulfill({ json: { models: [MODEL], active_id: MODEL.id } }),
  );
  await page.route(`**/api/v1/papers/${paperId}/preparation`, (route) =>
    route.fulfill({
      json: {
        enabled: true,
        status: "completed",
        stage: "",
        error: "",
        completed: 0,
        total: 0,
        guide_status: "completed",
        translation_status: "waiting",
        layout_status: "waiting",
      },
    }),
  );
  await page.route(`**/api/v1/papers/${paperId}/reading-artifacts`, (route) => {
    if (route.request().method() === "GET") {
      const guide = {
        id: "guide-1",
        file_id: fileId,
        kind: "guide",
        status: "completed",
        error: "",
        result: GUIDE,
      };
      return route.fulfill({ json: keypoints ? [guide, keypoints] : [guide] });
    }
    const body = route.request().postDataJSON() as Row;
    if (body.kind !== "keypoints") return route.fulfill({ json: {} });
    started.push(body);
    keypoints = {
      id: "keypoints-1",
      file_id: fileId,
      kind: "keypoints",
      status: "completed",
      error: "",
      result: KEYPOINTS,
    };
    return route.fulfill({ json: keypoints });
  });
  return { started };
}

const guide = (page: Page) => page.getByRole("tabpanel").first();
const marks = (page: Page, number: number) =>
  page.locator(`[data-page="${number}"] [data-keypoint]`);

async function open(page: Page, options: { keypoints?: Row | null } = {}) {
  await signIn(page);
  const { paperId, fileId } = await createPaperWithPdf(page, {
    pages: 3,
    words: { 1: NOVEL, 2: LIMIT },
  });
  const service = await serve(page, paperId, fileId, options);
  await openReader(page, { paperId });
  await expect(page.locator('[data-page="1"]')).toHaveAttribute(
    "data-rendered",
    "true",
  );
  return { service, paperId, fileId };
}

test("once the guide is written the key sentences are asked for and underlined where the paper says them", async ({
  page,
}) => {
  const { service } = await open(page);

  await expect(
    guide(page).getByRole("heading", { name: "重点", exact: true }),
  ).toBeVisible();
  expect(service.started).toHaveLength(1);
  expect(service.started[0]).toMatchObject({ kind: "keypoints" });

  // Only the sentence that is in the paper is marked on its page, in its own category.
  await expect(marks(page, 1)).not.toHaveCount(0);
  await expect(marks(page, 1).first()).toHaveAttribute(
    "data-keypoint",
    "novelty",
  );
  expect(
    await marks(page, 1).evaluateAll((all) =>
      all.some((mark) => mark.getAttribute("data-keypoint") === "method"),
    ),
  ).toBe(false);
  // The third page is far from the second: scroll to see the second page's mark too.
  await page.locator('[data-page="2"]').scrollIntoViewIfNeeded();
  await expect(marks(page, 2).first()).toHaveAttribute(
    "data-keypoint",
    "limits",
  );
});

test("resting on a marked sentence says its category and why", async ({
  page,
}) => {
  await open(page);
  await expect(marks(page, 1).first()).toBeVisible();
  const box = (await marks(page, 1).first().boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.move(box.x + box.width / 2 + 1, box.y + box.height / 2);
  await expect(
    page.locator('[role="tooltip"]', { hasText: "创新点 · 提出了共享记忆图" }),
  ).toBeVisible();
});

test("the legend hides a category on the pages and in the list; pressing a sentence goes to it", async ({
  page,
}) => {
  await open(page);
  const legend = guide(page).getByRole("list", { name: "重点句的类别" });
  await expect(legend).toBeVisible();
  const list = guide(page).getByRole("button", { name: /Our key idea/ });
  await expect(list).toBeVisible();
  await expect(
    guide(page).getByRole("button", { name: /does not scale/ }),
  ).toBeVisible();

  await legend.getByRole("button", { name: /创新点/ }).click();
  await expect(legend.getByRole("button", { name: /创新点/ })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await expect(marks(page, 1)).toHaveCount(0);
  await expect(list).toHaveCount(0);

  await legend.getByRole("button", { name: /创新点/ }).click();
  await expect(marks(page, 1).first()).toBeVisible();

  await guide(page)
    .getByRole("button", { name: /does not scale/ })
    .click();
  await expect(page).toHaveURL(/page=2/);
  await expect(page).toHaveURL(/quote=It/);
});

test("turned off in the settings, nothing is asked and nothing is marked", async ({
  page,
}) => {
  await signIn(page);
  const { paperId, fileId } = await createPaperWithPdf(page, {
    pages: 3,
    words: { 1: NOVEL, 2: LIMIT },
  });
  const service = await serve(page, paperId, fileId, {
    keypoints: {
      id: "keypoints-1",
      file_id: fileId,
      kind: "keypoints",
      status: "completed",
      error: "",
      result: KEYPOINTS,
    },
  });
  await page.goto("/#settings");
  const section = page.getByRole("radiogroup", { name: "自动标出重点句" });
  await section.getByRole("radio", { name: "关" }).click();
  await expect(section.getByRole("radio", { name: "关" })).toBeChecked();

  await openReader(page, { paperId });
  await expect(page.locator('[data-page="1"]')).toHaveAttribute(
    "data-rendered",
    "true",
  );
  await expect(
    guide(page).getByRole("heading", { name: "研究问题", exact: true }),
  ).toBeVisible();
  await expect(marks(page, 1)).toHaveCount(0);
  await expect(
    guide(page).getByRole("heading", { name: "重点", exact: true }),
  ).toHaveCount(0);
  expect(service.started).toHaveLength(0);
});

test("a failed search says why and can be tried again", async ({ page }) => {
  await signIn(page);
  const { paperId, fileId } = await createPaperWithPdf(page, { pages: 2 });
  let attempts = 0;
  await page.route("**/api/v1/translation-settings", (route) =>
    route.fulfill({ json: { models: [MODEL], active_id: MODEL.id } }),
  );
  await page.route(`**/api/v1/papers/${paperId}/preparation`, (route) =>
    route.fulfill({
      json: {
        enabled: true,
        status: "completed",
        stage: "",
        error: "",
        completed: 0,
        total: 0,
        guide_status: "completed",
        translation_status: "waiting",
        layout_status: "waiting",
      },
    }),
  );
  await page.route(`**/api/v1/papers/${paperId}/reading-artifacts`, (route) => {
    const guideRow = {
      id: "guide-1",
      file_id: fileId,
      kind: "guide",
      status: "completed",
      error: "",
      result: GUIDE,
    };
    if (route.request().method() === "GET")
      return route.fulfill({ json: [guideRow] });
    attempts += 1;
    if (attempts === 1)
      return route.fulfill({
        status: 409,
        json: { detail: "请先选择可用模型" },
      });
    return route.fulfill({
      json: {
        id: "keypoints-1",
        file_id: fileId,
        kind: "keypoints",
        status: "completed",
        error: "",
        result: KEYPOINTS,
      },
    });
  });
  await openReader(page, { paperId });

  await expect(guide(page).getByRole("alert")).toBeVisible();
  await guide(page).getByRole("button", { name: "重试" }).click();
  await expect(
    guide(page).getByRole("list", { name: "重点句的类别" }),
  ).toBeVisible();
});
