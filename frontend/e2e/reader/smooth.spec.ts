import { expect, test, type Page } from "@playwright/test";
import { createPaperWithPdf, openReader, signIn } from "./fixtures";

test.use({ locale: "zh-CN" });

const SESSION = "smooth-spec-session";
const MODEL = { id: "smooth-model", name: "Spec model", model: "spec-model" };

type Run = {
  id: string;
  prompt: string;
  response: string;
  status: string;
  error: string;
  writable: boolean;
  steps: never[];
  runtime: Record<string, unknown>;
};

/** One discussion whose runs change only when the test changes them, read by the reader's polling. */
async function install(page: Page) {
  const runs: Run[] = [];
  const created: Record<string, unknown>[] = [];
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
    const body = route.request().postDataJSON() as Record<string, unknown>;
    created.push(body);
    const run: Run = {
      id: `run-${runs.length + 1}`,
      prompt: String(body.prompt),
      response: "",
      status: "running",
      error: "",
      writable: false,
      steps: [],
      runtime: {},
    };
    runs.push(run);
    return route.fulfill({ json: run });
  });
  return { runs, created };
}

const assistantTab = (page: Page) =>
  page.getByRole("tablist").getByRole("tab", { name: "助手" });

/** A sentence of 40 characters, repeated: an answer that arrives in big chunks. */
const sentence = (n: number) =>
  `第${String(n).padStart(2, "0")}句：这是助手回答里的一句话，用来观察文字是怎样出现的。`;
const chunk = (from: number, to: number) =>
  Array.from({ length: to - from }, (_, i) => sentence(from + i)).join("");

/** Records the length of the answer's text on every frame. */
async function sample(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __lengths: number[] };
    w.__lengths = [];
    const tick = () => {
      const answer = document.querySelector('[class*="_answer_"]');
      w.__lengths.push(answer?.textContent?.length ?? 0);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}
const lengths = (page: Page) =>
  page.evaluate(() => (window as unknown as { __lengths: number[] }).__lengths);

test.describe("before the first question", () => {
  test("the view holds no prompts: no lead, no suggested questions, no key hints", async ({
    page,
  }) => {
    await signIn(page);
    const { paperId } = await createPaperWithPdf(page);
    await install(page);
    await openReader(page, { paperId });

    const panel = page.getByRole("tabpanel");
    await expect(panel).not.toContainText("像问一位读过这篇论文的同事");
    await expect(panel).not.toContainText("按 ↵ 就能针对它提问");
    await expect(
      panel.getByRole("list", { name: "可以从这些问题开始" }),
    ).toHaveCount(0);
    await expect(page.getByRole("log", { name: "与助手的对话" })).toHaveCount(
      0,
    );
  });
});

test.describe("streamed text", () => {
  test("a few big chunks come in progressively, and are whole once done", async ({
    page,
  }) => {
    await signIn(page);
    const { paperId } = await createPaperWithPdf(page);
    const server = await install(page);
    await openReader(page, { paperId });
    await assistantTab(page).click();
    await page
      .getByRole("textbox", { name: "向助手提问", exact: true })
      .fill("讲讲方法");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await expect.poll(() => server.runs.length).toBe(1);
    await sample(page);

    const first = chunk(0, 8);
    const full = chunk(0, 16);
    server.runs[0].response = first;
    // The first burst: it is not on the page at once, but flows in.
    await expect
      .poll(async () => Math.max(...(await lengths(page))), { timeout: 5000 })
      .toBeGreaterThan(0);
    await page.waitForTimeout(150);
    const early = Math.max(...(await lengths(page)));
    expect(early).toBeLessThan(first.length);

    server.runs[0].response = full;
    server.runs[0].status = "completed";
    await expect(page.locator('[class*="_answer_"]')).toHaveText(full, {
      timeout: 4000,
    });

    // Many different lengths on the way, only ever growing. (How big each
    // step is depends on how busy the machine is, so it is not checked.)
    const seen = (await lengths(page)).filter((n) => n > 0);
    expect(new Set(seen).size).toBeGreaterThan(8);
    for (let i = 1; i < seen.length; i += 1)
      expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);
  });

  test("with reduced motion the text is shown as it arrives", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await signIn(page);
    const { paperId } = await createPaperWithPdf(page);
    const server = await install(page);
    await openReader(page, { paperId });
    await assistantTab(page).click();
    await page
      .getByRole("textbox", { name: "向助手提问", exact: true })
      .fill("讲讲方法");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await expect.poll(() => server.runs.length).toBe(1);
    await sample(page);

    const first = chunk(0, 8);
    server.runs[0].response = first;
    await expect(page.locator('[class*="_answer_"]')).toHaveText(first, {
      timeout: 4000,
    });
    const seen = (await lengths(page)).filter((n) => n > 0);
    expect(seen[0]).toBe(first.length);
  });
});
