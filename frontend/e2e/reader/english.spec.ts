import {
  expect,
  test,
  type Locator,
  type Page,
  type Route,
} from "@playwright/test";
import { en } from "../../src/i18n/messages/en";
import { createPaperWithPdf, openReader, signIn } from "./fixtures";

// The reader follows the browser's language: here it is English, and the service still answers in Chinese.
test.use({ locale: "en-US" });

const WORDS = "Evidence stays connected across pages";
const SESSION = "english-spec-session";
const MODEL = { id: "english-model", name: "Spec model", model: "spec" };

/** The CJK Unified Ideographs: none of them may be in the English interface. */
const CHINESE = /[一-鿿]/;

/** All that a region gives a person or a screen reader: its text, and the names and hints it carries. */
const wordsIn = (region: Locator) =>
  region.evaluate((root) => {
    const found = [(root as HTMLElement).innerText];
    for (const element of [root, ...root.querySelectorAll("*")])
      for (const attribute of ["aria-label", "title", "placeholder", "alt"]) {
        const value = element.getAttribute(attribute);
        if (value) found.push(value);
      }
    return found.join("\n");
  });

async function expectNoChinese(region: Locator, what: string) {
  const text = await wordsIn(region);
  expect(text.match(CHINESE)?.[0] ?? null, `Chinese in ${what}: ${text}`).toBe(
    null,
  );
}

const pdfPage = (page: Page, number: number) =>
  page.locator(`[data-page="${number}"]`);
const line = (page: Page, number: number, text: string) =>
  pdfPage(page, number).locator(".textLayer span", { hasText: text });
const menu = (page: Page) =>
  page.getByRole("menu", { name: en["reader.selection.menu"], exact: true });
const panel = (page: Page) => page.getByRole("complementary");
const toasts = (page: Page) =>
  page.getByRole("region", { name: en["toast.region"] });

/** Drag across a line of a page's text, in whole pixels, and wait for the menu over it. */
async function selectLine(page: Page, words: Locator) {
  const selected = await page.evaluate(
    () => window.getSelection()?.toString() ?? "",
  );
  if (selected) {
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

test("what goes wrong is said in English, whatever the service says in Chinese", async ({
  page,
}) => {
  await signIn(page);
  const paper = await createPaperWithPdf(page, {
    pages: 3,
    words: { 1: WORDS },
  });

  // The model's side, and the service's refusals, all in Chinese.
  await page.route("**/api/v1/translation-settings", (route) =>
    route.fulfill({
      json: { active_id: MODEL.id, configured: true, models: [MODEL] },
    }),
  );
  await page.route("**/api/v1/papers/*/discussion", (route) =>
    route.fulfill({ json: { id: SESSION, title: "Discussion" } }),
  );
  const failed = {
    id: "run-failed",
    prompt: "What does page 2 show?",
    response: "",
    status: "failed",
    error: "模型服务暂时不可用，请稍后重试",
    writable: false,
    steps: [
      {
        name: "read_file",
        label: "读取论文附件文本",
        status: "failed",
        arguments: { id: "file", page: 2, pages: 1 },
        error: "读取附件失败：文件已被删除",
      },
    ],
    runtime: { phase: "failed", execution_seconds: 3 },
  };
  await page.route(`**/api/v1/agent/sessions/${SESSION}/runs`, (route) => {
    if (route.request().method() !== "POST")
      return route.fulfill({ json: [failed] });
    const body = route.request().postDataJSON() as {
      reader_context?: { action?: string };
    };
    return body.reader_context?.action === "translate"
      ? route.fulfill({ status: 503, json: { detail: "模型服务暂时不可用" } })
      : route.fulfill({
          status: 429,
          json: { detail: "今天的助手次数已用完，明天再试" },
        });
  });
  await page.route(`**/api/v1/files/${paper.fileId}/annotations/*`, (route) =>
    route.request().method() === "PUT"
      ? route.fulfill({
          status: 500,
          json: { detail: "保存批注失败：数据库忙" },
        })
      : route.fallback(),
  );
  // A guide that failed, in the service's words; asked again, refused.
  await page.route(
    `**/api/v1/papers/${paper.paperId}/reading-artifacts`,
    (route: Route) =>
      route.request().method() === "GET"
        ? route.fulfill({
            json: [
              {
                id: "guide-1",
                file_id: paper.fileId,
                kind: "guide",
                status: "failed",
                error: "导读生成失败：模型超时",
                result: null,
              },
            ],
          })
        : route.fulfill({
            status: 503,
            json: { detail: "模型服务繁忙，导读稍后再生成" },
          }),
  );

  await openReader(page, { paperId: paper.paperId });
  await expect(pdfPage(page, 1)).toHaveAttribute("data-rendered", "true");
  await expect(page.locator("html")).toHaveAttribute("lang", /^en/);

  // The guide that failed, and the refusal to make it again.
  const side = panel(page);
  await expect(side.getByRole("alert")).toHaveText(en["reader.guide.failed"]);
  await side.getByRole("button", { name: en["common.retry"] }).first().click();
  await expect(side.getByRole("alert")).toHaveText(
    en["reader.error.server"].replace("{status}", "503"),
  );
  await expectNoChinese(side, "the guide");

  // The menu over the selection.
  await selectLine(page, line(page, 1, WORDS));
  await expectNoChinese(menu(page), "the selection menu");

  // A translation the service refused.
  await page.keyboard.press("t");
  const popover = page.getByRole("dialog", {
    name: en["reader.translate.region"],
    exact: true,
  });
  await expect(popover.getByRole("alert")).toHaveText(
    en["reader.error.server"].replace("{status}", "503"),
  );
  await expectNoChinese(popover, "the translation");
  await page.keyboard.press("Escape");
  await expect(popover).toBeHidden();

  // A highlight the service would not keep.
  await selectLine(page, line(page, 1, WORDS));
  await page.keyboard.press("h");
  await expect(toasts(page).getByRole("alert")).toContainText(
    en["reader.selection.highlightFailed"],
  );
  await expectNoChinese(toasts(page), "the notifications");

  // The answer that failed, with the step that failed, and a question the service refused.
  await side
    .getByRole("tab", { name: en["reader.tab.assistant"], exact: true })
    .click();
  const log = side.getByRole("log", { name: en["reader.assistant.thread"] });
  await expect(log).toContainText(en["reader.assistant.failed"]);
  await log.getByRole("button", { name: /read 1 page/ }).click();
  await expect(log.getByRole("listitem")).toContainText(
    en["reader.assistant.step.failed"],
  );
  await expectNoChinese(log, "the assistant's thread");
  const box = page.getByRole("textbox", {
    name: en["reader.assistant.input"],
    exact: true,
  });
  await box.fill("Is the conclusion sound?");
  await box.press("Enter");
  const composer = page.locator('[class*="composer"]').filter({ has: box });
  await expect(composer.getByRole("alert")).toHaveText(en["reader.error.busy"]);
  await expectNoChinese(composer, "the question box");
});
