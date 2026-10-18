import { expect, test, type Locator, type Page } from "@playwright/test";
import { createPaperWithPdf, openReader, signIn } from "./fixtures";

// The interface follows the browser's language; these specs read it in Chinese.
test.use({ locale: "zh-CN" });

const WORDS = "Evidence stays connected across pages";
const SESSION = "integration-spec-session";
const MODEL = { id: "integration-model", name: "Spec model", model: "spec" };

const panel = (page: Page) => page.getByRole("complementary");
const tab = (page: Page, name: string) =>
  panel(page).getByRole("tab", { name, exact: true });
const pdfPage = (page: Page, number: number) =>
  page.locator(`[data-page="${number}"]`);
const scroller = (page: Page) =>
  page.getByRole("region", { name: "论文页面", exact: true });
const menu = (page: Page) =>
  page.getByRole("menu", { name: "划选的文字", exact: true });
const questionBox = (page: Page) =>
  page.getByRole("textbox", { name: "向助手提问", exact: true });
const toasts = (page: Page) => page.getByRole("region", { name: "通知" });
const line = (page: Page, number: number, text: string) =>
  pdfPage(page, number).locator(".textLayer span", { hasText: text });

/**
 * The model's side of the service, played by the test: the settings name one
 * model, and the paper's discussion keeps the runs the reader creates. Notes,
 * highlights and papers are the real service's.
 */
async function fakeAssistant(page: Page) {
  const created: Record<string, any>[] = [];
  const runs: Record<string, unknown>[] = [];
  await page.route("**/api/v1/translation-settings", (route) =>
    route.fulfill({
      json: { active_id: MODEL.id, configured: true, models: [MODEL] },
    }),
  );
  await page.route("**/api/v1/papers/*/discussion", (route) =>
    route.fulfill({ json: { id: SESSION, title: "Discussion" } }),
  );
  await page.route(`**/api/v1/agent/sessions/${SESSION}/runs`, (route) => {
    if (route.request().method() !== "POST")
      return route.fulfill({ json: runs });
    const body = route.request().postDataJSON() as Record<string, any>;
    created.push(body);
    const run = {
      id: `run-${created.length}`,
      prompt: String(body.prompt),
      response: "",
      status: "queued",
      error: "",
      writable: false,
      steps: [],
      runtime: body.reader_context
        ? { reader_context: { ...body.reader_context, file_name: "paper.pdf" } }
        : {},
    };
    runs.push(run);
    return route.fulfill({ json: run });
  });
  return created;
}

/** The text selected on the page. */
const selected = (page: Page) =>
  page.evaluate(() => window.getSelection()?.toString() ?? "");

/** Drag across a line of a page's text, in whole pixels, and wait for the menu over it. */
async function selectLine(page: Page, words: Locator) {
  if (await selected(page)) {
    const sheet = (await pdfPage(page, 1).boundingBox())!;
    await page.mouse.click(
      Math.round(sheet.x + sheet.width * 0.8),
      Math.round(sheet.y + sheet.height * 0.6),
    );
  }
  const box = (await words.boundingBox())!;
  const y = Math.round(box.y + box.height / 2);
  await page.mouse.move(Math.round(box.x + 2), y);
  await page.mouse.down();
  await page.mouse.move(Math.round(box.x + box.width - 2), y, { steps: 12 });
  await page.mouse.up();
  await expect(menu(page)).toBeVisible();
}

async function openPaper(page: Page, pages = 3) {
  await signIn(page);
  const paper = await createPaperWithPdf(page, { pages, words: { 1: WORDS } });
  const created = await fakeAssistant(page);
  await openReader(page, { paperId: paper.paperId });
  await expect(pdfPage(page, 1)).toHaveAttribute("data-rendered", "true");
  await expect(questionBox(page)).toBeEnabled();
  return { ...paper, created };
}

/** The top edge of the floating question box, in the window. */
const composerTop = (page: Page) =>
  questionBox(page).evaluate(
    (element) =>
      element.closest('[class*="composer"]')!.getBoundingClientRect().top,
  );

test("E explains the selection at once, and the assistant's tab shows the answer", async ({
  page,
}) => {
  const { paperId, fileId, created } = await openPaper(page);
  await expect(tab(page, "导读")).toHaveAttribute("aria-selected", "true");

  await selectLine(page, line(page, 1, WORDS));
  await page.keyboard.press("e");
  await expect(menu(page)).toBeHidden();
  await expect(tab(page, "助手")).toHaveAttribute("aria-selected", "true");
  await expect.poll(() => created.length).toBe(1);
  expect(created[0]).toMatchObject({
    prompt: "请解释这段内容：说明它在说什么、为什么重要，必要时结合上下文。",
    model_config_id: MODEL.id,
    writable: false,
    context: `paper/${paperId}`,
    reader_context: {
      paper_id: paperId,
      file_id: fileId,
      page: 1,
      source: "selection",
      action: "explain",
      quote: WORDS,
    },
  });
  await expect(
    panel(page).getByRole("log", { name: "与助手的对话", exact: true }),
  ).toBeVisible();
  // The keyboard stays on the paper, to read on while the answer is written.
  await expect(scroller(page)).toBeFocused();
  // The tabs are still the person's to choose.
  await tab(page, "笔记").click();
  await expect(tab(page, "笔记")).toHaveAttribute("aria-selected", "true");
});

test("↵ hands the selection to the question box, which takes the keyboard", async ({
  page,
}) => {
  const { created } = await openPaper(page);
  await selectLine(page, line(page, 1, WORDS));
  await page.keyboard.press("Enter");
  await expect(menu(page)).toBeHidden();
  const composer = page.getByRole("main");
  await expect(composer.getByText(/^选中的一句：“Evidence/)).toBeVisible();
  await expect(questionBox(page)).toBeFocused();
  expect(created).toEqual([]);

  // The question goes with the selection as its context.
  await page.keyboard.type("这句话的证据是什么？");
  await page.keyboard.press("Enter");
  await expect.poll(() => created.length).toBe(1);
  expect(created[0]).toMatchObject({
    prompt: "这句话的证据是什么？",
    reader_context: { action: "ask", source: "selection", quote: WORDS },
  });
  await expect(composer.getByText(/^选中的一句：/)).toHaveCount(0);
});

test("N keeps the selection in the note, with a link back to its place", async ({
  page,
}) => {
  const { paperId, fileId } = await openPaper(page);
  await selectLine(page, line(page, 1, WORDS));
  await page.keyboard.press("n");
  await expect(menu(page)).toBeHidden();

  const saved = toasts(page).getByRole("status").filter({ hasText: "已保存" });
  await expect(saved).toBeVisible();
  await saved.getByRole("button", { name: "查看笔记", exact: true }).click();
  await expect(tab(page, "笔记")).toHaveAttribute("aria-selected", "true");

  const editor = panel(page).getByRole("textbox", {
    name: "笔记正文",
    exact: true,
  });
  await expect(editor.locator("blockquote")).toHaveText(WORDS);
  const link = editor.getByRole("link", { name: "原文 · 第 1 页" });
  await expect(link).toHaveAttribute(
    "href",
    new RegExp(
      `^#read/${paperId}\\?file=${fileId}&page=1&quote=${encodeURIComponent(WORDS)}(&prefix=[^&]*)?$`,
    ),
  );

  // It is the paper's note on the service, as Markdown.
  const notes = await (
    await page.request.get(`/api/v1/items?kind=note&paper_id=${paperId}`)
  ).json();
  expect(notes).toHaveLength(1);
  expect(notes[0].body).toContain(`> ${WORDS}`);
  expect(notes[0].body).toContain(
    `[原文 · 第 1 页](#read/${paperId}?file=${fileId}&page=1&quote=`,
  );
});

test("the end of the paper scrolls clear of the question box", async ({
  page,
}) => {
  await openPaper(page, 2);
  const last = pdfPage(page, 2);
  const toEnd = () =>
    scroller(page).evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
  const clear = async () => {
    await toEnd();
    await expect(last).toHaveAttribute("data-rendered", "true");
    await expect
      .poll(async () => {
        const box = (await last.boundingBox())!;
        return box.y + box.height < (await composerTop(page));
      })
      .toBe(true);
  };
  await clear();

  // A longer question makes the box taller; the room under the pages grows with it.
  const before = await composerTop(page);
  await questionBox(page).fill("一\n二\n三\n四\n五");
  await expect.poll(() => composerTop(page)).toBeLessThan(before - 40);
  await clear();
});

test("in a narrow window, explaining opens the folded panel on the assistant", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1000, height: 900 });
  const { created } = await openPaper(page);
  await expect(panel(page)).toBeHidden();
  await selectLine(page, line(page, 1, WORDS));
  await page.keyboard.press("e");
  await expect(panel(page)).toBeVisible();
  await expect(tab(page, "助手")).toHaveAttribute("aria-selected", "true");
  await expect.poll(() => created.length).toBe(1);
  // Esc folds it away again, back to the button that opens it.
  await page.keyboard.press("Escape");
  await expect(panel(page)).toBeHidden();
  await expect(
    page.getByRole("button", { name: "展开右侧面板", exact: true }),
  ).toBeFocused();
});
