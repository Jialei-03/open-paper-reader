import { expect, test, type Page } from "@playwright/test";
import { createPaperWithPdf, openReader, signIn } from "./fixtures";

test.use({ locale: "zh-CN" });

const SESSION = "composer-model-session";
const FULL = {
  id: "model-full",
  name: "Deep model",
  model: "deep",
  protocol: "openai",
  base_url: "https://api.example.com/v1",
  controls: {
    thinking_modes: ["default", "disabled", "adaptive"],
    effort_levels: ["default", "low", "medium", "high"],
  },
};
const FIXED = {
  id: "model-fixed",
  name: "Fixed model",
  model: "fixed",
  protocol: "openai",
  base_url: "https://api.example.com/v1",
  controls: { thinking_modes: ["default"], effort_levels: ["default"] },
};

const questionBox = (page: Page) =>
  page.getByRole("textbox", { name: "向助手提问", exact: true });

async function setup(page: Page) {
  await signIn(page);
  const paper = await createPaperWithPdf(page, { pages: 2, words: {} });
  const created: Record<string, any>[] = [];
  const selected: string[] = [];
  let active = FULL.id;
  const settings = () => ({
    active_id: active,
    configured: true,
    models: [FULL, FIXED],
  });
  await page.route("**/api/v1/translation-settings", (route) =>
    route.fulfill({ json: settings() }),
  );
  await page.route(
    "**/api/v1/translation-settings/configs/*/select",
    (route) => {
      const id = route.request().url().split("/configs/")[1].split("/")[0];
      selected.push(id);
      active = id;
      return route.fulfill({ json: settings() });
    },
  );
  await page.route("**/api/v1/papers/*/discussion", (route) =>
    route.fulfill({ json: { id: SESSION, title: "Discussion" } }),
  );
  await page.route(`**/api/v1/agent/sessions/${SESSION}/runs`, (route) => {
    if (route.request().method() !== "POST") return route.fulfill({ json: [] });
    const body = route.request().postDataJSON() as Record<string, any>;
    created.push(body);
    return route.fulfill({
      json: {
        id: `run-${created.length}`,
        prompt: String(body.prompt),
        response: "好的。",
        status: "completed",
        error: "",
        writable: false,
        steps: [],
        runtime: { phase: "completed", execution_seconds: 1 },
      },
    });
  });
  await openReader(page, { paperId: paper.paperId });
  await expect(questionBox(page)).toBeEnabled();
  return { created, selected };
}

test("the model and the thinking effort are chosen under the question and sent with it", async ({
  page,
}) => {
  const { created, selected } = await setup(page);
  const modelButton = page.getByRole("button", { name: "模型：Deep model" });
  const effortButton = page.getByRole("button", { name: "思考强度：默认" });
  await expect(modelButton).toBeVisible();
  await expect(effortButton).toBeVisible();

  // The effort menu lists what this model supports, reachable by keyboard.
  await effortButton.focus();
  await page.keyboard.press("ArrowDown");
  const efforts = page.getByRole("menu", { name: "思考强度" });
  await expect(efforts.getByRole("menuitem")).toHaveText([
    "默认",
    "关闭思考",
    "低",
    "中",
    "高",
  ]);
  await efforts.getByRole("menuitem", { name: "高", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "思考强度：高" }),
  ).toBeVisible();

  await questionBox(page).fill("第一个问题");
  await questionBox(page).press("Enter");
  await expect.poll(() => created.length).toBe(1);
  expect(created[0].model_config_id).toBe(FULL.id);
  expect(created[0].model_options).toEqual({
    thinking_mode: "default",
    reasoning_effort: "high",
  });

  // Another model for this paper: its own efforts (none to choose), and no default change.
  await modelButton.click();
  const models = page.getByRole("menu", { name: "选择模型" });
  await expect(
    models.getByRole("menuitem", { name: "Fixed model" }),
  ).toBeVisible();
  await models.getByRole("menuitem", { name: "Fixed model" }).click();
  await expect(
    page.getByRole("button", { name: "模型：Fixed model" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /^思考强度/ })).toHaveCount(0);
  expect(selected).toEqual([]);
  await questionBox(page).fill("第二个问题");
  await questionBox(page).press("Enter");
  await expect.poll(() => created.length).toBe(2);
  expect(created[1].model_config_id).toBe(FIXED.id);
  expect(created[1].model_options).toBeUndefined();

  // The choice is kept for this paper, and "set as default" is the only thing that changes the global one.
  await page.reload();
  await expect(
    page.getByRole("button", { name: "模型：Fixed model" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "模型：Fixed model" }).click();
  await page.getByRole("menuitem", { name: "设为默认模型" }).click();
  await expect.poll(() => selected).toEqual([FIXED.id]);
  await expect(page.getByText("已把 Fixed model 设为默认模型。")).toBeVisible();
});
