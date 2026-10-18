import {
  expect,
  test,
  type Locator,
  type Page,
  type Route,
} from "@playwright/test";
import { createPaperWithPdf, openReader, signIn } from "./fixtures";

// The interface follows the browser's language; these specs read it in Chinese.
test.use({ locale: "zh-CN" });

const WORDS = "Evidence stays connected across pages";

const main = (page: Page) => page.getByRole("main");
const scroller = (page: Page) =>
  page.getByRole("region", { name: "论文页面", exact: true });
const pdfPage = (page: Page, number: number) =>
  page.locator(`[data-page="${number}"]`);
const menu = (page: Page) =>
  page.getByRole("menu", { name: "划选的文字", exact: true });
const popover = (page: Page) =>
  page.getByRole("dialog", { name: "译文", exact: true });
const pageInput = (page: Page) =>
  main(page).getByRole("textbox", { name: "页码", exact: true });

/** The text selected on the page. */
const selected = (page: Page) =>
  page.evaluate(() => window.getSelection()?.toString() ?? "");

/**
 * Drag across a line of a page's text, from just inside its start to just
 * inside its end, in whole pixels (Chromium starts no selection from a press at
 * a fraction of a pixel that is then dragged).
 */
async function selectLine(page: Page, line: Locator, to?: Locator) {
  // A press inside a selection would drag it away instead: let go of it first, on blank paper.
  if (await selected(page)) {
    const sheet = (await pdfPage(page, 1).boundingBox())!;
    await page.mouse.click(
      Math.round(sheet.x + sheet.width * 0.8),
      Math.round(sheet.y + sheet.height * 0.6),
    );
  }
  const from = (await line.boundingBox())!;
  const end = to ? (await to.boundingBox())! : from;
  await page.mouse.move(
    Math.round(from.x + 2),
    Math.round(from.y + from.height / 2),
  );
  await page.mouse.down();
  await page.mouse.move(
    Math.round(end.x + end.width - 2),
    Math.round(end.y + end.height / 2),
    { steps: 12 },
  );
  await page.mouse.up();
  await expect(menu(page)).toBeVisible();
  return { from, end };
}

const line = (page: Page, number: number, text: string) =>
  pdfPage(page, number).locator(".textLayer span", { hasText: text });

/** What the page passes to console.info: the reader's stand-in for the assistant and the note. */
function watchInfo(page: Page) {
  const logs: unknown[][] = [];
  page.on("console", async (message) => {
    if (message.type() !== "info") return;
    logs.push(await Promise.all(message.args().map((arg) => arg.jsonValue())));
  });
  return logs;
}

async function openPaper(
  page: Page,
  options: Parameters<typeof createPaperWithPdf>[1] = {},
) {
  await signIn(page);
  const paper = await createPaperWithPdf(page, {
    pages: 3,
    words: { 1: WORDS },
    ...options,
  });
  await openReader(page, { paperId: paper.paperId });
  await expect(pdfPage(page, 1)).toHaveAttribute("data-rendered", "true");
  return paper;
}

const fixtureModels = {
  models: [
    {
      id: "fixture-model",
      name: "Fixture model",
      model: "fixture-text",
      thinking_mode: "disabled",
      reasoning_effort: "default",
      controls: { thinking_modes: ["disabled"], effort_levels: ["default"] },
    },
  ],
  active_id: "fixture-model",
};

test("selecting text shows the actions beside it and keeps the selection", async ({
  page,
}) => {
  await openPaper(page);
  const words = line(page, 1, WORDS);
  const { end } = await selectLine(page, words);

  await expect(menu(page)).toBeVisible();
  const items = menu(page).getByRole("menuitem");
  await expect(items).toHaveText([
    "解释E",
    "翻译T",
    "高亮H",
    "记到笔记N",
    "问助手↵",
  ]);
  for (const [name, keys] of [
    ["解释", "e"],
    ["翻译", "t"],
    ["高亮", "h"],
    ["记到笔记", "n"],
    ["问助手", "Enter"],
  ])
    await expect(
      menu(page).getByRole("menuitem", { name, exact: true }),
    ).toHaveAttribute("aria-keyshortcuts", keys);

  // Just under the selected line, over its middle.
  const box = (await menu(page).boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(end.y + end.height - 1);
  expect(box.y).toBeLessThan(end.y + end.height + 24);
  expect(box.x).toBeLessThan(end.x + end.width);
  expect(box.x + box.width).toBeGreaterThan(end.x);

  // The menu took neither the selection nor the keyboard.
  expect((await selected(page)).trim()).toBe(WORDS);
  await expect(scroller(page)).toBeFocused();
  // Nor does resting the pointer on it, or pressing on it without letting go.
  await menu(page).getByRole("menuitem", { name: "翻译", exact: true }).hover();
  expect((await selected(page)).trim()).toBe(WORDS);
  const item = (await menu(page)
    .getByRole("menuitem", { name: "高亮", exact: true })
    .boundingBox())!;
  await page.mouse.move(item.x + item.width / 2, item.y + item.height / 2);
  await page.mouse.down();
  expect((await selected(page)).trim()).toBe(WORDS);
  await page.mouse.move(5, 5);
  await page.mouse.up();
  await expect(menu(page)).toBeVisible();

  // It follows the line when the paper scrolls.
  await scroller(page).evaluate((element) => (element.scrollTop += 60));
  await expect
    .poll(async () => (await menu(page).boundingBox())!.y)
    .toBeLessThan(box.y - 50);
  const moved = (await words.boundingBox())!;
  expect((await menu(page).boundingBox())!.y).toBeGreaterThanOrEqual(
    moved.y + moved.height - 1,
  );

  // A right click on the selection shows the menu at the pointer instead of the browser's.
  const point = {
    x: Math.round(moved.x + moved.width / 3),
    y: Math.round(moved.y + moved.height / 2),
  };
  await page.mouse.click(point.x, point.y, { button: "right" });
  await expect(menu(page)).toBeVisible();
  await expect
    .poll(async () => {
      const at = (await menu(page).boundingBox())!;
      return Math.abs(at.y - point.y) < 12 && at.x <= point.x;
    })
    .toBe(true);
  expect((await selected(page)).trim()).toBe(WORDS);
});

test("E explains, ↵ asks and N keeps the selection; Esc closes the menu", async ({
  page,
}) => {
  const logs = watchInfo(page);
  const paper = await openPaper(page);
  const words = line(page, 1, WORDS);

  await selectLine(page, words);
  await expect(menu(page)).toBeVisible();
  await page.keyboard.press("e");
  await expect(menu(page)).toBeHidden();
  await expect.poll(() => logs.length).toBe(1);
  expect(logs[0][0]).toBe("reader ask");
  expect(logs[0][1]).toMatchObject({
    paperId: paper.paperId,
    fileId: paper.fileId,
    page: 1,
    source: "selection",
    action: "explain",
    quote: WORDS,
  });
  expect((logs[0][1] as { rects: unknown[] }).rects.length).toBe(1);

  await selectLine(page, words);
  await page.keyboard.press("Enter");
  await expect.poll(() => logs.length).toBe(2);
  expect(logs[1][0]).toBe("reader ask");
  expect(logs[1][1]).toMatchObject({ action: "ask", quote: WORDS });

  await selectLine(page, words);
  await menu(page).getByRole("menuitem", { name: "记到笔记" }).click();
  await expect(menu(page)).toBeHidden();
  await expect.poll(() => logs.length).toBe(3);
  expect(logs[2][0]).toBe("reader note");
  expect(logs[2][1]).toMatchObject({ page: 1, quote: WORDS });

  // Escape closes it and nothing else: the selection stays, the keys are the page's again.
  await selectLine(page, words);
  await expect(menu(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu(page)).toBeHidden();
  expect((await selected(page)).trim()).toBe(WORDS);
  await page.keyboard.press("e");
  await page.waitForTimeout(200);
  expect(logs.length).toBe(3);
  await page.keyboard.press("]");
  await expect(pageInput(page)).toHaveValue("2");

  // A selection scrolled out of view takes its menu with it; one cleared does too.
  await pageInput(page).fill("1");
  await pageInput(page).press("Enter");
  await expect(pageInput(page)).toHaveValue("1");
  await selectLine(page, words);
  await expect(menu(page)).toBeVisible();
  await scroller(page).evaluate((element) => (element.scrollTop += 2000));
  await expect(menu(page)).toBeHidden();
  await scroller(page).evaluate((element) => (element.scrollTop = 0));
  await selectLine(page, words);
  await expect(menu(page)).toBeVisible();
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  await expect(menu(page)).toBeHidden();
});

test("H highlights the selection, and the highlight is saved", async ({
  page,
}) => {
  const paper = await openPaper(page);
  const words = line(page, 1, WORDS);
  await selectLine(page, words);
  await expect(menu(page)).toBeVisible();

  const saved = page.waitForRequest(
    (request) =>
      request.method() === "PUT" &&
      request.url().includes(`/api/v1/files/${paper.fileId}/annotations/`),
  );
  await page.keyboard.press("h");
  const request = await saved;
  expect(request.postDataJSON()).toMatchObject({
    page: 1,
    quote: WORDS,
    color: "#FACC15",
    comment: "",
  });
  await expect(menu(page)).toBeHidden();
  await expect(
    page.getByRole("status").filter({ hasText: "已高亮" }),
  ).toBeVisible();
  expect(await selected(page)).toBe("");
  const block = pdfPage(page, 1).locator("[data-annotation-id]");
  await expect(block).toHaveCount(1);
  // Over the words it was made from.
  const [mark, text] = await Promise.all([
    block.locator("[data-annotation-rect]").first().boundingBox(),
    words.boundingBox(),
  ]);
  expect(Math.abs(mark!.y - text!.y)).toBeLessThan(6);

  await page.reload();
  await expect(pdfPage(page, 1)).toHaveAttribute("data-rendered", "true");
  await expect(pdfPage(page, 1).locator("[data-annotation-id]")).toHaveCount(1);
});

test("a selection across two pages is highlighted on both", async ({
  page,
}) => {
  // Short pages, so that the end of the first and the start of the second are in view together.
  const paper = await openPaper(page, {
    pages: 2,
    size: [612, 240],
    words: {},
  });
  await expect(pdfPage(page, 2)).toHaveAttribute("data-rendered", "true");
  await selectLine(page, line(page, 1, "Page 1 of 2"), line(page, 2, "Page 2"));
  await expect(menu(page)).toBeVisible();
  const text = await selected(page);
  expect(text).toContain("Page 1 of 2");
  expect(text).toContain("Page 2");

  await menu(page).getByRole("menuitem", { name: "高亮", exact: true }).click();
  await expect(pdfPage(page, 1).locator("[data-annotation-id]")).toHaveCount(1);
  await expect(pdfPage(page, 2).locator("[data-annotation-id]")).toHaveCount(1);
  const rows = await (
    await page.request.get(`/api/v1/files/${paper.fileId}/annotations`)
  ).json();
  expect(rows.map((row: { page: number }) => row.page)).toEqual([1, 2]);
  expect(rows[0].quote).toContain("Page 1 of 2");
  expect(rows[1].quote).toContain("Page 2");
});

test("T translates beside the selection as the translation is written", async ({
  page,
}) => {
  const logs = watchInfo(page);
  const paper = await openPaper(page);
  await page.route("**/api/v1/translation-settings", (route) =>
    route.fulfill({ json: fixtureModels }),
  );
  const created: Record<string, any>[] = [];
  const cancelled: string[] = [];
  let failNext = true;
  let finished = false;
  const run = () => {
    const id = `translate-run-${created.length}`;
    return finished
      ? {
          id,
          status: "completed",
          response: "证据在页面之间保持相连。",
          error: "",
        }
      : { id, status: "running", response: "证据在页面之间", error: "" };
  };
  await page.route("**/api/v1/agent/sessions/*/runs", (route: Route) => {
    if (route.request().method() === "POST") {
      created.push(route.request().postDataJSON());
      if (failNext) {
        failNext = false;
        return route.fulfill({
          status: 503,
          json: { detail: "模型服务暂时不可用" },
        });
      }
      return route.fulfill({
        json: {
          id: `translate-run-${created.length}`,
          status: "queued",
          response: "",
          error: "",
        },
      });
    }
    return route.fulfill({ json: [run()] });
  });
  await page.route("**/api/v1/agent/runs/*/cancel", (route) => {
    cancelled.push(route.request().url());
    return route.fulfill({ json: {} });
  });

  const words = line(page, 1, WORDS);
  await selectLine(page, words);
  await page.keyboard.press("t");
  await expect(menu(page)).toBeHidden();
  // The server's reason, and a way to try again.
  await expect(popover(page).getByRole("alert")).toHaveText(
    "模型服务暂时不可用",
  );
  await popover(page).getByRole("button", { name: "重试" }).click();

  // What is written so far shows as it comes, and the rest once it is there.
  await expect(popover(page)).toContainText("证据在页面之间");
  await expect(popover(page).getByRole("status")).toBeVisible();
  await expect(popover(page).getByRole("button", { name: "复制" })).toHaveCount(
    0,
  );
  finished = true;
  await expect(popover(page)).toContainText("证据在页面之间保持相连。");
  await expect(popover(page).getByRole("status")).toHaveCount(0);
  expect(created).toHaveLength(2);
  expect(created[1]).toMatchObject({
    model_config_id: "fixture-model",
    writable: false,
    context: `paper/${paper.paperId}`,
    reader_context: {
      paper_id: paper.paperId,
      file_id: paper.fileId,
      page: 1,
      source: "selection",
      action: "translate",
      quote: WORDS,
    },
  });
  expect(created[1].prompt).toContain("翻译");

  // Beside the selection, under its line.
  const [box, text] = await Promise.all([
    popover(page).boundingBox(),
    words.boundingBox(),
  ]);
  expect(box!.y).toBeGreaterThanOrEqual(text!.y + text!.height - 1);
  expect(box!.y).toBeLessThan(text!.y + text!.height + 24);

  await popover(page).getByRole("button", { name: "记到笔记" }).click();
  await expect(popover(page)).toBeHidden();
  await expect.poll(() => logs.length).toBe(1);
  expect(logs[0][0]).toBe("reader note");
  expect(logs[0][1]).toMatchObject({
    quote: WORDS,
    action: "translate",
    translation: "证据在页面之间保持相连。",
  });
  expect(cancelled).toEqual([]);

  // A translation closed before it is done is stopped.
  finished = false;
  await selectLine(page, words);
  await page.keyboard.press("t");
  await expect(popover(page)).toContainText("证据在页面之间");
  await page.keyboard.press("Escape");
  await expect(popover(page)).toBeHidden();
  await expect.poll(() => cancelled.length).toBe(1);
  expect(cancelled[0]).toContain(`/agent/runs/translate-run-3/cancel`);
});

test("without a model, the translation says where to add one", async ({
  page,
}) => {
  await openPaper(page);
  await page.route("**/api/v1/translation-settings", (route) =>
    route.fulfill({ json: { models: [], active_id: "" } }),
  );
  const created: unknown[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/runs"))
      created.push(request.url());
  });
  await selectLine(page, line(page, 1, WORDS));
  await page.keyboard.press("t");
  await expect(popover(page)).toContainText("先在设置里添加模型");
  await expect(
    popover(page).getByRole("link", { name: "去设置" }),
  ).toHaveAttribute("href", "#settings");
  await expect(popover(page).getByRole("alert")).toHaveCount(0);
  expect(created).toEqual([]);
});
