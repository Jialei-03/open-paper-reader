import { test, expect, type Page } from "@playwright/test";
import { testPdf } from "./fixtures/pdf";
import { cancelActiveRuns, openReaderTool } from "./helpers";

/** A signed-in reader with a paper, its PDF and a model to ask. */
async function reader(page: Page, title: string) {
  await page.goto("/#dashboard");
  await page.getByLabel("用户名", { exact: true }).fill("alice");
  await page
    .getByLabel("密码", { exact: true })
    .fill(process.env.E2E_TEST_PASSWORD!);
  await page.getByRole("button", { name: "登录空间", exact: true }).click();
  await expect(page.getByRole("heading", { name: "最近" })).toBeVisible();
  await cancelActiveRuns(page);
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
  const paper = await post("/papers", { title });
  const upload = await page.request.post(`/api/v1/papers/${paper.id}/files`, {
    headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
    multipart: {
      version_id: paper.current_version,
      file: {
        name: "region.pdf",
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
    name: "Region fixture",
    protocol: "openai",
    api_key: "synthetic-e2e-key",
  });
  return { paper, file, headers };
}

test("A box drawn around a figure opens its own menu beside it, on release and on right-click", async ({
  page,
}) => {
  const { paper, file, headers } = await reader(
    page,
    "Region menu verification",
  );
  await page.goto(`/#paper/${paper.id}`);
  await expect(page.getByTestId("pdf-canvas")).toHaveAttribute(
    "data-rendered",
    "true",
  );
  const menu = page.getByRole("dialog", { name: "选区操作" });
  const draw = async () => {
    await page
      .getByRole("radio", { name: "框选图表或公式", exact: true })
      .click();
    const area = (await page.getByTestId("pdf-canvas").first().boundingBox())!;
    await page.mouse.move(area.x + 60, area.y + 65);
    await page.mouse.down();
    await page.mouse.move(area.x + 220, area.y + 120, { steps: 8 });
    await page.mouse.up();
    return area;
  };
  await draw();
  // Nothing about a box lives on the rail any more: its actions are beside it.
  await expect(menu).toBeVisible();
  await expect(
    menu.getByRole("button", { name: "解释图表或选区", exact: true }),
  ).toBeVisible();
  await expect(
    menu.getByRole("button", { name: "解释公式", exact: true }),
  ).toBeVisible();
  await expect(
    menu.getByRole("button", { name: "翻译选区文字", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "询问 AI" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "摘录到笔记" })).toHaveCount(0);

  // Escape clears the crop; a fresh box can be resized before using it.
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("pdf-region-highlight")).toHaveCount(0);
  await draw();
  const crop = page.getByTestId("pdf-region-highlight");
  const original = (await crop.boundingBox())!;
  const handle = (await crop.locator('[data-handle="nw"]').boundingBox())!;
  await page.mouse.move(handle.x + 7, handle.y + 7);
  await page.mouse.down();
  await page.mouse.move(handle.x - 13, handle.y - 8, { steps: 5 });
  await page.mouse.up();
  await expect
    .poll(async () => (await crop.boundingBox())!.width)
    .toBeGreaterThan(original.width + 10);
  await expect(menu).toBeVisible();
  await page.screenshot({
    path: "../test-results/pdf-adjustable-selection.png",
  });

  // Translating the box is a translation: the request says so and the result
  // is kept in the 翻译 panel.
  const translated = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      /\/agent\/sessions\/[^/]+\/runs$/.test(r.url()),
  );
  await menu.getByRole("button", { name: "翻译选区文字", exact: true }).click();
  const response = await translated;
  expect(response.ok()).toBeTruthy();
  const run = await response.json();
  expect(run.runtime.reader_context).toMatchObject({
    file_id: file.id,
    source: "region",
    action: "translate",
  });
  // Translating is one model call over the box's text and picture, not an agent.
  expect(run.runtime.direct).toBe(true);
  await expect(page.getByRole("complementary", { name: "翻译" })).toBeVisible();
  await page.request.post(`/api/v1/agent/runs/${run.id}/cancel`, {
    headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
    data: {},
  });

  // A question about the box is sent as typed, with the box as its evidence.
  await draw();
  await menu.getByRole("button", { name: "向AI提问", exact: true }).click();
  await menu.getByLabel("对选中的内容提问").fill("这张图的横轴是什么？");
  const asked = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      /\/agent\/sessions\/[^/]+\/runs$/.test(r.url()),
  );
  await menu.getByRole("button", { name: "发送问题", exact: true }).click();
  const question = await asked;
  expect(question.ok()).toBeTruthy();
  expect(question.request().postDataJSON().prompt).toBe("这张图的横轴是什么？");
  const askedRun = await question.json();
  expect(askedRun.runtime.reader_context).toMatchObject({
    source: "region",
    action: "ask",
  });
  await page.request.post(`/api/v1/agent/runs/${askedRun.id}/cancel`, {
    headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
    data: {},
  });
});

test("Right-clicking with nothing selected offers to work on the page under it", async ({
  page,
}) => {
  const { paper, file, headers } = await reader(page, "Page menu verification");
  await page.goto(`/#paper/${paper.id}`);
  await expect(page.getByTestId("pdf-canvas")).toHaveAttribute(
    "data-rendered",
    "true",
  );
  const menu = page.getByRole("dialog", { name: "页面操作" });
  const first = page.locator('[data-pdf-page="1"] .pdf-page');
  const box = (await first.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, {
    button: "right",
  });
  await expect(menu).toBeVisible();
  await expect(menu.getByText("请先划选文字")).toHaveCount(0);
  for (const name of [
    "解释第 1 页",
    "翻译第 1 页",
    "向AI提问",
    "与助手讨论全文",
  ])
    await expect(menu.getByRole("button", { name, exact: true })).toBeVisible();

  const submitted = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      /\/agent\/sessions\/[^/]+\/runs$/.test(r.url()),
  );
  await menu.getByRole("button", { name: "解释第 1 页", exact: true }).click();
  const response = await submitted;
  expect(response.ok()).toBeTruthy();
  const run = await response.json();
  expect(run.runtime.reader_context).toMatchObject({
    file_id: file.id,
    page: 1,
    source: "page",
    action: "explain",
  });
  expect(run.runtime.reader_context.quote).toBeFalsy();
  await page.request.post(`/api/v1/agent/runs/${run.id}/cancel`, {
    headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
    data: {},
  });

  // It is the page under the pointer, not the page in the indicator.
  const second = page.locator('[data-pdf-page="2"] .pdf-page');
  await second.scrollIntoViewIfNeeded();
  // A menu closes when the page scrolls; let the scroll finish first.
  await expect(page.getByLabel("PDF 页码", { exact: true })).toHaveValue("2");
  await page.waitForTimeout(300);
  const other = (await second.boundingBox())!;
  await page.mouse.click(other.x + other.width / 2, other.y + 200, {
    button: "right",
  });
  await expect(
    menu.getByRole("button", { name: "翻译第 2 页", exact: true }),
  ).toBeVisible();
});

async function box(page: Page) {
  await page
    .getByRole("radio", { name: "框选图表或公式", exact: true })
    .click();
  const area = (await page.getByTestId("pdf-canvas").first().boundingBox())!;
  await page.mouse.move(area.x + 60, area.y + 65);
  await page.mouse.down();
  await page.mouse.move(area.x + 220, area.y + 120, { steps: 8 });
  await page.mouse.up();
}

/** What the clipboard holds, read the way an application would read a pasted picture. */
async function clipboardPicture(page: Page) {
  return page.evaluate(async () => {
    const [item] = await navigator.clipboard.read();
    const blob = await item.getType("image/png");
    const bitmap = await createImageBitmap(blob);
    return { type: blob.type, width: bitmap.width, height: bitmap.height };
  });
}

test("A boxed region is copied as a picture that the assistant and a note take", async ({
  page,
}) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  const { paper, headers } = await reader(page, "Region picture verification");
  const note = await page.request.post("/api/v1/items", {
    headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
    data: {
      kind: "note",
      paper_id: paper.id,
      title: "截图笔记",
      body: "在这里粘贴。",
    },
  });
  expect(note.ok()).toBeTruthy();
  await page.goto(`/#paper/${paper.id}`);
  await expect(page.getByTestId("pdf-canvas")).toHaveAttribute(
    "data-rendered",
    "true",
  );
  await box(page);
  const menu = page.getByRole("dialog", { name: "选区操作" });
  await menu.getByRole("button", { name: "复制为图片", exact: true }).click();
  await expect(page.getByText("已复制选区图片")).toBeVisible();
  // The clipboard holds a real, sharp picture of the box, not a link to it.
  const copied = await clipboardPicture(page);
  expect(copied.type).toBe("image/png");
  expect(copied.width).toBeGreaterThan(300);
  expect(copied.height).toBeGreaterThan(50);

  // The assistant takes it as an attachment…
  await openReaderTool(page, "AI");
  await page.getByLabel("给 Agent 的消息").click();
  await page.keyboard.press("ControlOrMeta+V");
  await expect(page.getByText("image.png", { exact: true })).toBeVisible();
  // …and a note takes it as an image, where it is kept.
  await openReaderTool(page, "笔记");
  const editor = page.getByRole("textbox", { name: "笔记正文" });
  await editor.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.press("ControlOrMeta+V");
  await expect(editor.locator("img")).toHaveCount(1);
  await expect
    .poll(() =>
      editor
        .locator("img")
        .evaluate((img: HTMLImageElement) => img.naturalWidth),
    )
    .toBeGreaterThan(300);
});

test("Copying with the keyboard copies the boxed region, but not while text is being copied", async ({
  page,
}) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  const { paper } = await reader(page, "Region keyboard verification");
  await page.goto(`/#paper/${paper.id}`);
  await expect(page.getByTestId("pdf-canvas")).toHaveAttribute(
    "data-rendered",
    "true",
  );
  await page.evaluate(() => navigator.clipboard.writeText("before"));
  await box(page);
  await expect(page.getByRole("dialog", { name: "选区操作" })).toBeVisible();
  await page.keyboard.press("ControlOrMeta+C");
  await expect(page.getByText("已复制选区图片")).toBeVisible();
  expect((await clipboardPicture(page)).type).toBe("image/png");

  // Text being copied from a field keeps its own copy, box or no box.
  await openReaderTool(page, "AI");
  const composer = page.getByLabel("给 Agent 的消息");
  await composer.fill("keep this text");
  await composer.press("ControlOrMeta+A");
  await composer.press("ControlOrMeta+C");
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe("keep this text");
});

test("When the browser refuses the clipboard the picture is saved as a file, and the keyboard says why", async ({
  page,
}) => {
  const { paper } = await reader(page, "Region fallback verification");
  await page.goto(`/#paper/${paper.id}`);
  await expect(page.getByTestId("pdf-canvas")).toHaveAttribute(
    "data-rendered",
    "true",
  );
  // An embedded view or a locked-down browser: the page may not write the clipboard.
  await page.evaluate(() =>
    Object.defineProperty(navigator.clipboard, "write", {
      configurable: true,
      value: () =>
        Promise.reject(
          new DOMException("Write permission denied.", "NotAllowedError"),
        ),
    }),
  );
  let downloads = 0;
  page.on("download", () => downloads++);
  await box(page);
  const menu = page.getByRole("dialog", { name: "选区操作" });
  const saved = page.waitForEvent("download");
  await menu.getByRole("button", { name: "复制为图片", exact: true }).click();
  expect((await saved).suggestedFilename()).toBe("选区-第1页.png");
  await expect(page.getByText("已把选区图片保存为文件")).toBeVisible();

  // ⌘C does not drop files into Downloads behind the reader's back.
  await page.keyboard.press("ControlOrMeta+C");
  await expect(page.getByText("浏览器不允许网页写入剪贴板")).toBeVisible();
  expect(downloads).toBe(1);
});

test("Scrolling away and back keeps the rendered page and selectable text", async ({
  page,
}) => {
  const { paper } = await reader(page, "PDF retained raster verification");
  await page.goto(`/#paper/${paper.id}`);
  const first = page.locator('[data-pdf-page="1"] canvas');
  await expect(first).toHaveAttribute("data-rendered", "true");
  await page
    .getByRole("textbox", { name: "PDF 缩放", exact: true })
    .fill("200");
  await page
    .getByRole("textbox", { name: "PDF 缩放", exact: true })
    .press("Enter");
  await expect(first).toHaveAttribute("data-rendered", "true");
  await expect(page.locator('[data-pdf-page="1"] .pdf-page')).toHaveAttribute(
    "data-scale",
    "2",
  );
  // User wheel/pointer input releases the zoom anchor before scrolling.
  await page
    .locator(".pdf-sheet")
    .first()
    .dispatchEvent("pointerdown", { button: 0 });
  const canvas = await first.elementHandle();
  const text = await page
    .locator('[data-pdf-page="1"] .textLayer span')
    .first()
    .elementHandle();
  await page
    .locator(".pdf-sheet")
    .first()
    .evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
  await expect(page.getByLabel("PDF 页码", { exact: true })).toHaveValue("2");
  await page.waitForTimeout(200);
  expect(await canvas!.evaluate((el) => el.isConnected)).toBe(true);
  expect(await text!.evaluate((el) => el.isConnected)).toBe(true);
  await page
    .locator(".pdf-sheet")
    .first()
    .evaluate((el) => {
      el.scrollTop = 0;
    });
  await expect(page.getByLabel("PDF 页码", { exact: true })).toHaveValue("1");
  expect(await first.evaluate((el, previous) => el === previous, canvas)).toBe(
    true,
  );
  expect(await text!.evaluate((el) => el.isConnected)).toBe(true);
});

test("Offscreen PDF retention evicts oldest pages and never evicts visible pages", async () => {
  const { PdfRenderRetention } = await import(
    "../src/lib/pdf-render-retention"
  );
  const pool = new PdfRenderRetention(2);
  const a = {},
    b = {},
    c = {},
    d = {};
  const evicted: string[] = [];
  pool.retain(a, () => evicted.push("a"));
  pool.retain(b, () => evicted.push("b"));
  pool.visible(a);
  pool.retain(c, () => evicted.push("c"));
  pool.retain(d, () => evicted.push("d"));
  expect(evicted).toEqual(["b"]);
  pool.remove(c);
  pool.retain(a, () => evicted.push("a"));
  expect(evicted).toEqual(["b"]);
});
