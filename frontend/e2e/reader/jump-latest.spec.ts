import { expect, test, type Page } from "@playwright/test";
import { createPaperWithPdf, openReader, signIn } from "./fixtures";

test.use({ locale: "zh-CN" });

const SESSION = "jump-spec-session";
const MODEL = { id: "jump-model", name: "Spec model", model: "spec-model" };

const longText = (lines: number) =>
  Array.from({ length: lines }, (_, i) => `第 ${i + 1} 段回答的内容。`).join(
    "\n\n",
  );

type Run = Record<string, unknown>;
const makeRun = (id: string, status: string, lines: number): Run => ({
  id,
  prompt: `问题 ${id}`,
  response: longText(lines),
  status,
  error: "",
  writable: false,
  steps: [],
  runtime: {},
});

async function setup(page: Page, runs: { value: Run[] }) {
  await signIn(page);
  const { paperId } = await createPaperWithPdf(page);
  await page.route("**/api/v1/translation-settings", (route) =>
    route.fulfill({
      json: { active_id: MODEL.id, configured: true, models: [MODEL] },
    }),
  );
  await page.route("**/api/v1/papers/*/discussion", (route) =>
    route.fulfill({ json: { id: SESSION, title: "Discussion" } }),
  );
  await page.route(`**/api/v1/agent/sessions/${SESSION}/runs`, (route) =>
    route.fulfill({ json: runs.value }),
  );
  await openReader(page, { paperId });
  await page.getByRole("tab", { name: "助手" }).click();
}

const button = (page: Page) => page.getByRole("button", { name: "回到最新" });
const scroller = (page: Page) =>
  page.getByRole("tabpanel").first().locator("xpath=..");
const fromBottom = (page: Page) =>
  scroller(page).evaluate(
    (el) => el.scrollHeight - el.scrollTop - el.clientHeight,
  );

test("the button shows when scrolled away from the bottom, and takes you back", async ({
  page,
}) => {
  await setup(page, { value: [makeRun("a", "completed", 60)] });
  await expect(page.getByText("第 60 段回答的内容。")).toBeVisible();
  await scroller(page).evaluate((el) => (el.scrollTop = 0));
  await expect(button(page)).toBeVisible();
  // Nothing is being written: no dot.
  await expect(page.getByTestId("latest-dot")).toHaveCount(0);

  await button(page).focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => fromBottom(page)).toBeLessThan(2);
  await expect(button(page)).toBeHidden();
  // Not on the other tabs.
  await page.getByRole("tab", { name: "笔记" }).click();
  await expect(button(page)).toHaveCount(0);
});

test("a dot says an answer is being written below", async ({ page }) => {
  const runs = { value: [makeRun("a", "running", 60)] };
  await setup(page, runs);
  await scroller(page).evaluate((el) => (el.scrollTop = 0));
  await expect(button(page)).toBeVisible();
  await expect(page.getByTestId("latest-dot")).toBeVisible();
  runs.value = [makeRun("a", "completed", 60)];
  await expect(page.getByTestId("latest-dot")).toHaveCount(0, {
    timeout: 10_000,
  });
});

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });
  test("jumps at once, with no bobbing", async ({ page }) => {
    await setup(page, { value: [makeRun("a", "completed", 60)] });
    await scroller(page).evaluate((el) => (el.scrollTop = 0));
    await expect(button(page)).toBeVisible();
    const animated = await button(page).evaluate(
      (el) => el.querySelector("svg")!.getAnimations().length,
    );
    expect(animated).toBe(0);
    await button(page).click();
    // No smooth scroll to wait for.
    expect(await fromBottom(page)).toBeLessThan(2);
  });
});
