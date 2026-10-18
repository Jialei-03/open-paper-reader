import { expect, test, type Locator, type Page } from "@playwright/test";
import { createPaperWithPdf, openReader, signIn } from "./fixtures";

// The interface follows the browser's language; these specs read it in Chinese.
test.use({ locale: "zh-CN" });

const WORDS = "Evidence stays connected across pages";
const SESSION = "composer-spec-session";
const MODEL = { id: "composer-model", name: "Spec model", model: "spec" };

const panel = (page: Page) => page.getByRole("complementary");
const card = (page: Page) => page.getByRole("main");
const tab = (page: Page, name: string) =>
  panel(page).getByRole("tab", { name, exact: true });
const pdfPage = (page: Page, number: number) =>
  page.locator(`[data-page="${number}"]`);
const questionBox = (page: Page) =>
  page.getByRole("textbox", { name: "向助手提问", exact: true });
const detach = (page: Page) =>
  page.getByRole("button", { name: "移出面板，浮在论文上", exact: true });
const attach = (page: Page) =>
  page.getByRole("button", { name: "放回右侧面板", exact: true });
const menu = (page: Page) =>
  page.getByRole("menu", { name: "划选的文字", exact: true });
const line = (page: Page, number: number, text: string) =>
  pdfPage(page, number).locator(".textLayer span", { hasText: text });

/** The box (what the field sits in), as a rectangle in the window. */
const boxRect = (page: Page) =>
  questionBox(page).evaluate((element) => {
    const { x, y, width, height } = element
      .closest('[class*="composer"]')!
      .getBoundingClientRect();
    return { x, y, width, height };
  });
/** Where the box's grip is, in the window. */
const gripPoint = async (page: Page) => {
  const rect = await boxRect(page);
  return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + 6) };
};
const inside = async (page: Page, region: Locator) => {
  const [box, outer] = await Promise.all([boxRect(page), region.boundingBox()]);
  return (
    box.x >= outer!.x - 1 &&
    box.y >= outer!.y - 1 &&
    box.x + box.width <= outer!.x + outer!.width + 1 &&
    box.y + box.height <= outer!.y + outer!.height + 1
  );
};

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
      response: "好的。",
      status: "completed",
      error: "",
      writable: false,
      steps: [],
      runtime: body.reader_context
        ? { reader_context: { ...body.reader_context, file_name: "paper.pdf" } }
        : { phase: "completed", execution_seconds: 1 },
    };
    runs.push(run);
    return route.fulfill({ json: run });
  });
  return created;
}

async function open(page: Page) {
  await signIn(page);
  const paper = await createPaperWithPdf(page, {
    pages: 3,
    words: { 1: WORDS },
  });
  const created = await fakeAssistant(page);
  await openReader(page, { paperId: paper.paperId });
  await expect(pdfPage(page, 1)).toHaveAttribute("data-rendered", "true");
  // In a window too narrow for the panel it is folded away, out of the accessibility tree.
  await expect(
    page.getByRole("textbox", {
      name: "向助手提问",
      exact: true,
      includeHidden: true,
    }),
  ).toBeEnabled();
  return { ...paper, created };
}

/** Drag the grip from where it is to a point, in steps (a pointer that travels). */
async function dragGrip(page: Page, to: { x: number; y: number }) {
  const from = await gripPoint(page);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 14 });
}

test("the question box is docked in the panel's foot by default, under every tab", async ({
  page,
}) => {
  await open(page);
  await expect(questionBox(page)).toBeVisible();
  expect(await inside(page, panel(page))).toBe(true);
  expect(await inside(page, card(page))).toBe(false);
  // The box spans the panel (less its margins), at the foot.
  const [box, side] = await Promise.all([
    boxRect(page),
    panel(page).boundingBox(),
  ]);
  expect(box.width).toBeGreaterThan(side!.width - 40);
  expect(side!.y + side!.height - (box.y + box.height)).toBeLessThan(24);

  // It stays under the other tabs too.
  for (const name of ["助手", "笔记", "导读"]) {
    await tab(page, name).click();
    await expect(questionBox(page)).toBeVisible();
  }
  // Asking from another tab shows the thread.
  await tab(page, "笔记").click();
  await questionBox(page).fill("这篇论文讲了什么？");
  await questionBox(page).press("Enter");
  await expect(tab(page, "助手")).toHaveAttribute("aria-selected", "true");
  await expect(
    panel(page).getByRole("log", { name: "与助手的对话", exact: true }),
  ).toContainText("这篇论文讲了什么？");
});

test("the button moves the box over the paper and back, keeping the draft and the selection it carries", async ({
  page,
}) => {
  const { created } = await open(page);
  await line(page, 1, WORDS).first().scrollIntoViewIfNeeded();
  const words = (await line(page, 1, WORDS).boundingBox())!;
  const y = Math.round(words.y + words.height / 2);
  await page.mouse.move(Math.round(words.x + 2), y);
  await page.mouse.down();
  await page.mouse.move(Math.round(words.x + words.width - 2), y, {
    steps: 12,
  });
  await page.mouse.up();
  await expect(menu(page)).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(questionBox(page)).toBeFocused();
  const chip = page.getByText(/^选中的一句：“Evidence/);
  await expect(chip).toBeVisible();
  await page.keyboard.type("还没写完");

  await detach(page).click();
  await expect(attach(page)).toBeVisible();
  expect(await inside(page, card(page))).toBe(true);
  await expect(questionBox(page)).toHaveValue("还没写完");
  await expect(questionBox(page)).toBeFocused();
  await expect(chip).toBeVisible();

  await attach(page).click();
  expect(await inside(page, panel(page))).toBe(true);
  await expect(questionBox(page)).toHaveValue("还没写完");
  await expect(questionBox(page)).toBeFocused();
  await expect(chip).toBeVisible();

  // The question is sent with its selection, from the docked box.
  await page.keyboard.type("，现在写完了");
  await page.keyboard.press("Enter");
  await expect.poll(() => created.length).toBe(1);
  expect(created[0]).toMatchObject({
    prompt: "还没写完，现在写完了",
    reader_context: { action: "ask", quote: WORDS },
  });
  await expect(chip).toHaveCount(0);
});

test("dragging the grip out of the panel lifts the box over the paper; its place is kept across a reload; dragging it back docks it", async ({
  page,
}) => {
  const { created } = await open(page);
  await questionBox(page).fill("拖出去的草稿");
  const side = (await panel(page).boundingBox())!;
  const paper = (await card(page).boundingBox())!;

  // Out of the panel, to the middle of the paper.
  const target = {
    x: Math.round(paper.x + paper.width * 0.4),
    y: Math.round(paper.y + paper.height * 0.5),
  };
  await dragGrip(page, target);
  // Mid-drag the box is under the pointer, and the panel shows no drop hint yet while the box is not over it.
  expect(await inside(page, card(page))).toBe(true);
  const held = await boxRect(page);
  expect(Math.abs(held.x + held.width / 2 - target.x)).toBeLessThan(60);
  expect(Math.abs(held.y - (target.y - 6))).toBeLessThan(40);
  await page.mouse.up();
  await expect(questionBox(page)).toHaveValue("拖出去的草稿");
  await expect(attach(page)).toBeVisible();
  const placed = await boxRect(page);
  expect(placed.y).toBeLessThan(paper.y + paper.height * 0.7);

  // The place, and the floating state, are the person's across a reload.
  await page.reload();
  await expect(pdfPage(page, 1)).toHaveAttribute("data-rendered", "true");
  await expect(attach(page)).toBeVisible();
  await expect
    .poll(async () => Math.abs((await boxRect(page)).y - placed.y))
    .toBeLessThan(3);

  // Sending works while it floats.
  await questionBox(page).fill("浮着也能问");
  await questionBox(page).press("Enter");
  await expect.poll(() => created.length).toBe(1);
  expect(created[0]).toMatchObject({ prompt: "浮着也能问" });

  // The box cannot be dragged out of the paper's card.
  await dragGrip(page, { x: paper.x + 2, y: paper.y + 2 });
  await page.mouse.up();
  expect(await inside(page, card(page))).toBe(true);

  // Back over the panel: the drop hint firms up, and letting go docks the box.
  await questionBox(page).fill("放回去的草稿");
  await dragGrip(page, {
    x: Math.round(side.x + side.width / 2),
    y: Math.round(side.y + side.height * 0.5),
  });
  await expect(panel(page).getByText("松开，放回右侧面板")).toBeVisible();
  await page.mouse.up();
  await expect(detach(page)).toBeVisible();
  expect(await inside(page, panel(page))).toBe(true);
  await expect(questionBox(page)).toHaveValue("放回去的草稿");
});

test("a drag that does not leave the panel leaves the box docked", async ({
  page,
}) => {
  await open(page);
  const side = (await panel(page).boundingBox())!;
  await dragGrip(page, { x: side.x + 60, y: side.y + 200 });
  await page.mouse.up();
  await expect(detach(page)).toBeVisible();
  expect(await inside(page, panel(page))).toBe(true);
});

test("in a narrow window the box is docked in the opened panel and cannot be detached", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1000, height: 800 });
  await open(page);
  await expect(panel(page)).toBeHidden();
  await page.getByRole("button", { name: "展开右侧面板", exact: true }).click();
  await expect(questionBox(page)).toBeVisible();
  expect(await inside(page, panel(page))).toBe(true);
  await expect(detach(page)).toHaveCount(0);
  await expect(attach(page)).toHaveCount(0);
  await expect(page.locator("[data-composer-grip]")).toHaveCount(0);
});
