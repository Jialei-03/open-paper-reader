import { expect, test, type Locator, type Page } from "@playwright/test";
import { createPaperWithPdf, openReader, signIn } from "./fixtures";

// The interface follows the browser's language; these specs read it in Chinese.
test.use({ locale: "zh-CN" });

const MODEL = { id: "cite-model", name: "Cite model", model: "cite" };
const SESSION = "cite-session";
const TITLES = ["研究问题", "方法", "主要结果", "适用边界"];

/** The words on pages 2 and 3 of the paper made below: what a citation can really point at. */
const LATENCY = "Latency drops by forty percent on long inputs.";
const GAINS = "Gains vanish on short inputs.";
/** The part of the first line a citation quotes: not the whole line. */
const LATENCY_QUOTE = "Latency drops by forty percent";

const mark = (page: number, quote: string) => `[[p${page}: "${quote}"]]`;

const panel = (page: Page) => page.getByRole("tabpanel");
const tab = (page: Page, name: string) =>
  page.getByRole("tablist").getByRole("tab", { name, exact: true });
const chips = (scope: Locator) => scope.locator("[data-cite-chip]");
const pageInput = (page: Page) =>
  page.getByRole("main").getByRole("textbox", { name: "页码", exact: true });
const pdfPage = (page: Page, number: number) =>
  page.locator(`[data-page="${number}"]`);

async function paperWithWords(page: Page) {
  await signIn(page);
  return createPaperWithPdf(page, {
    pages: 5,
    words: { 2: LATENCY, 3: GAINS },
  });
}

type Row = Record<string, unknown>;

/** The guide the service holds (set before the reader is opened). */
async function serveGuide(
  page: Page,
  paperId: string,
  fileId: string,
  result: Row,
  extra: Row = {},
) {
  const row = {
    id: "guide-1",
    file_id: fileId,
    kind: "guide",
    status: "completed",
    run_id: "run-1",
    session_id: "session-1",
    model_config_id: MODEL.id,
    error: "",
    result,
    parameters: {},
    ...extra,
  };
  const started: Row[] = [];
  await page.route("**/api/v1/translation-settings", (route) =>
    route.fulfill({
      json: { models: [MODEL], active_id: MODEL.id, configured: true },
    }),
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
    if (route.request().method() === "GET")
      return route.fulfill({ json: [row] });
    started.push(route.request().postDataJSON());
    return route.fulfill({ json: { ...row, status: "queued", result: null } });
  });
  await page.route("**/api/v1/reading-artifacts/guide-1", (route) =>
    route.fulfill({ json: row }),
  );
  return started;
}

const guideResult = (cited: boolean): Row => ({
  keywords: ["latency"],
  summary: [
    cited ? `延迟显著下降。${mark(2, LATENCY_QUOTE)}` : "延迟显著下降。",
    "短输入上没有收益。",
    "方法有适用范围。",
  ],
  sections: TITLES.map((title, index) => ({
    title,
    body:
      index === 2 && cited
        ? `长输入上延迟降低了四成。${mark(2, LATENCY_QUOTE)}短输入上收益消失。${mark(3, GAINS)}`
        : `${title}的内容。`,
    pages: index === 2 ? [2, 3] : [index + 1],
  })),
  cited,
});

test("a guide's sentences carry numbered sources: hover shows the paper's words, a press goes to that sentence", async ({
  page,
}) => {
  const { paperId, fileId } = await paperWithWords(page);
  await serveGuide(page, paperId, fileId, guideResult(true));
  await openReader(page, { paperId });
  await expect(pageInput(page)).toHaveValue("1");

  // One chip in the summary and two in the results; the same words are one number.
  await expect(chips(panel(page))).toHaveCount(3);
  await expect(chips(panel(page)).nth(0)).toHaveText("1");
  await expect(chips(panel(page)).nth(1)).toHaveText("1");
  await expect(chips(panel(page)).nth(2)).toHaveText("2");
  // No marker is left as text.
  await expect(panel(page)).not.toContainText("[[");
  // A section whose sentences name their sources has no page pills beside them.
  await expect(
    panel(page).getByRole("button", { name: "第 3 页" }),
  ).toHaveCount(0);

  const chip = chips(panel(page)).nth(2);
  await chip.hover();
  const card = page.getByRole("tooltip");
  await expect(card).toContainText(GAINS);
  await expect(card).toContainText("第 3 页");
  // Keyboard focus shows it too.
  await page.mouse.move(0, 0);
  await expect(card).toHaveCount(0);
  await chip.focus();
  await expect(page.getByRole("tooltip")).toContainText(GAINS);

  // Pressed: the page, and the sentence marked on it.
  await chips(panel(page)).nth(1).click();
  await expect(pageInput(page)).toHaveValue("2");
  const line = pdfPage(page, 2).locator(".textLayer span", {
    hasText: "Latency drops",
  });
  const underline = pdfPage(page, 2)
    .locator(".pdf-reference-lines .pdf-reference-underline")
    .first();
  await expect(underline).toBeVisible();
  const [whole, marked] = await Promise.all([
    line.boundingBox(),
    underline.boundingBox(),
  ]);
  // Only the quoted words are marked, not the whole line.
  expect(marked!.width).toBeLessThan(whole!.width * 0.85);
  expect(marked!.width).toBeGreaterThan(whole!.width * 0.4);
  expect(Math.abs(marked!.x - whole!.x)).toBeLessThan(6);
});

test("a guide made before sources are per sentence keeps its page chips and offers to regenerate", async ({
  page,
}) => {
  const { paperId, fileId } = await paperWithWords(page);
  const started = await serveGuide(page, paperId, fileId, guideResult(false));
  await openReader(page, { paperId });

  await expect(chips(panel(page))).toHaveCount(0);
  await expect(
    panel(page).getByRole("button", { name: "第 2 页" }),
  ).toHaveCount(2);
  const again = panel(page).getByRole("button", {
    name: "重新生成以获得逐句出处",
  });
  await expect(again).toBeVisible();
  await again.click();
  const guides = () => started.filter((body) => body.kind === "guide");
  await expect.poll(() => guides().length).toBe(1);
  expect(guides()[0]).toMatchObject({ regenerate: true });
});

test("markers in a guide that is still being written are not shown", async ({
  page,
}) => {
  const { paperId, fileId } = await paperWithWords(page);
  await serveGuide(
    page,
    paperId,
    fileId,
    {},
    {
      status: "running",
      result: null,
      preview: {
        keywords: ["latency"],
        summary: [`延迟显著下降。${mark(2, LATENCY_QUOTE)}`],
        sections: [
          {
            title: "研究问题",
            body: `正文开头。${mark(2, LATENCY_QUOTE)}还没写完的 [[p3: "Gains van`,
            pages: [2],
          },
        ],
      },
    },
  );
  await openReader(page, { paperId });
  await expect(panel(page).getByText("正文开头。")).toBeVisible();
  await expect(chips(panel(page))).toHaveCount(0);
  await expect(panel(page)).not.toContainText("[[");
  await expect(panel(page)).not.toContainText("Gains van");
});

/** The assistant's discussion, played by the test: runs are what it says they are. */
async function serveAssistant(page: Page, runs: Row[]) {
  await page.route("**/api/v1/translation-settings", (route) =>
    route.fulfill({
      json: { models: [MODEL], active_id: MODEL.id, configured: true },
    }),
  );
  await page.route("**/api/v1/papers/*/discussion", (route) =>
    route.fulfill({ json: { id: SESSION, title: "Discussion" } }),
  );
  await page.route(`**/api/v1/agent/sessions/${SESSION}/runs`, (route) =>
    route.fulfill({ json: runs }),
  );
}

const run = (id: string, response: string, status = "completed"): Row => ({
  id,
  prompt: "延迟怎么样？",
  response,
  status,
  error: "",
  writable: false,
  steps: [],
  runtime: { phase: status },
});

const thread = (page: Page) =>
  page.getByRole("log", { name: "与助手的对话", exact: true });

test("an answer's sources are checked against the paper: right ones shown, a wrong page fixed, invented ones left out", async ({
  page,
}) => {
  const { paperId } = await paperWithWords(page);
  const answer =
    `长输入上延迟降低了四成。${mark(2, LATENCY_QUOTE)}` +
    // Said to be on page 5; it is on page 3.
    `短输入上收益消失。${mark(5, "Gains vanish on short inputs")}` +
    `论文还说在手机上更快。${mark(4, "It is also faster on phones by a wide margin")}`;
  await serveAssistant(page, [run("run-1", answer)]);
  await openReader(page, { paperId });
  await tab(page, "助手").click();

  await expect(chips(thread(page))).toHaveCount(2);
  await expect(chips(thread(page)).nth(0)).toHaveText("1");
  await expect(chips(thread(page)).nth(1)).toHaveText("2");
  // The sentence that could not be supported stays, without a source and without the marker.
  await expect(thread(page)).toContainText("论文还说在手机上更快。");
  await expect(thread(page)).not.toContainText("[[");
  await expect(thread(page)).not.toContainText("手机上更快。1");

  // The page is the one the paper has it on.
  await chips(thread(page)).nth(1).hover();
  await expect(page.getByRole("tooltip")).toContainText("第 3 页");
  await expect(page.getByRole("tooltip")).toContainText("Gains vanish");

  await chips(thread(page)).nth(1).click();
  await expect(pageInput(page)).toHaveValue("3");
  await expect(
    pdfPage(page, 3)
      .locator(".pdf-reference-lines .pdf-reference-underline")
      .first(),
  ).toBeVisible();
});

test("while an answer is written its markers are not shown, not even half of one", async ({
  page,
}) => {
  const { paperId } = await paperWithWords(page);
  await serveAssistant(page, [
    run(
      "run-1",
      `长输入上延迟降低了四成。${mark(2, LATENCY_QUOTE)}短输入上 [[p3: "Gains van`,
      "running",
    ),
  ]);
  await openReader(page, { paperId });
  await tab(page, "助手").click();
  await expect(thread(page)).toContainText("长输入上延迟降低了四成。");
  await expect(chips(thread(page))).toHaveCount(0);
  await expect(thread(page)).not.toContainText("[[");
  await expect(thread(page)).not.toContainText("Gains van");
});

test("copying a cited sentence leaves the page in the text", async ({
  page,
}) => {
  const { paperId } = await paperWithWords(page);
  await serveAssistant(page, [
    run("run-1", `长输入上延迟降低了四成。${mark(2, LATENCY_QUOTE)}`),
  ]);
  await openReader(page, { paperId });
  await tab(page, "助手").click();
  await expect(chips(thread(page))).toHaveCount(1);

  const copied = await page.evaluate(() => {
    const answer = document.querySelector('[role="log"] [class*="answer"] p')!;
    const range = document.createRange();
    range.selectNodeContents(answer);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    let text = "";
    let html = "";
    document.addEventListener(
      "copy",
      (event) => {
        text = event.clipboardData!.getData("text/plain");
        html = event.clipboardData!.getData("text/html");
      },
      { once: true },
    );
    document.execCommand("copy");
    return { text, html };
  });
  expect(copied.text).toBe("长输入上延迟降低了四成。 (p. 2)");
  expect(copied.html).not.toContain("data-cite-chip");
});

async function write(page: Page, path: string, data: unknown) {
  const csrf = (await page.context().cookies()).find(
    (cookie) => cookie.name === "paper_csrf",
  )!.value;
  const response = await page.request.fetch("/api/v1" + path, {
    method: "POST",
    data,
    headers: { "X-CSRF-Token": csrf, "Idempotency-Key": crypto.randomUUID() },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}

const notesOf = async (page: Page, paperId: string) =>
  (await (
    await page.request.get(`/api/v1/items?kind=note&paper_id=${paperId}`)
  ).json()) as { body: string }[];

test("a note's sources are chips too, and an answer kept to the note brings its verified sources along", async ({
  page,
}) => {
  const { paperId } = await paperWithWords(page);
  // Written by the agent: one source is real, one is invented.
  await write(page, "/items", {
    kind: "note",
    paper_id: paperId,
    title: "Notes",
    body:
      `延迟降低了四成。${mark(2, LATENCY_QUOTE)}\n\n` +
      `还说手机上更快。${mark(4, "A sentence the paper never wrote down")}`,
    status: "open",
    tags: [],
    paper_ids: [],
    evidence_ids: [],
    locator: null,
  });
  await serveAssistant(page, [
    run(
      "run-1",
      `短输入上收益消失。${mark(3, GAINS)}手机上更快。${mark(4, "An invented sentence about phones")}`,
    ),
  ]);
  await openReader(page, { paperId });

  // Keep the answer.
  await tab(page, "助手").click();
  await expect(chips(thread(page))).toHaveCount(1);
  await thread(page).getByRole("button", { name: "记到笔记" }).click();
  await expect
    .poll(async () => (await notesOf(page, paperId))[0].body)
    .toContain(mark(3, GAINS));
  const body = (await notesOf(page, paperId))[0].body;
  expect(body).not.toContain("An invented sentence");

  await tab(page, "笔记").click();
  const editor = panel(page).getByRole("textbox", { name: "笔记正文" });
  // Two real sources (the note's own, and the kept answer's); the invented one is not shown.
  await expect(chips(editor)).toHaveCount(2);
  await expect(editor).not.toContainText("[[");
  await expect(editor).toContainText("还说手机上更快。");

  await chips(editor).first().hover();
  await expect(page.getByRole("tooltip")).toContainText(LATENCY_QUOTE);
  await chips(editor).first().click();
  await expect(pageInput(page)).toHaveValue("2");
  await expect(
    pdfPage(page, 2)
      .locator(".pdf-reference-lines .pdf-reference-underline")
      .first(),
  ).toBeVisible();
  // Looking at the note does not change what is stored.
  expect((await notesOf(page, paperId))[0].body).toContain(
    "A sentence the paper never wrote down",
  );
});
