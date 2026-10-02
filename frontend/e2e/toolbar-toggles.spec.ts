import { test, expect, type Page } from "@playwright/test";
import { testPdf } from "./fixtures/pdf";

async function reader(page: Page, title: string) {
  await page.goto("/#dashboard");
  await page.getByLabel("用户名", { exact: true }).fill("alice");
  await page
    .getByLabel("密码", { exact: true })
    .fill(process.env.E2E_TEST_PASSWORD!);
  await page.getByRole("button", { name: "登录空间", exact: true }).click();
  await expect(page.getByRole("heading", { name: "最近" })).toBeVisible();
  const csrf = (await page.context().cookies()).find(
    (c) => c.name === "paper_csrf",
  )!.value;
  const headers = { "X-CSRF-Token": csrf };
  const created = await page.request.post("/api/v1/papers", {
    headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
    data: { title },
  });
  expect(created.ok()).toBeTruthy();
  const paper = await created.json();
  const upload = await page.request.post(`/api/v1/papers/${paper.id}/files`, {
    headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
    multipart: {
      version_id: paper.current_version,
      file: {
        name: "toggle.pdf",
        mimeType: "application/pdf",
        buffer: testPdf(),
      },
    },
  });
  expect(upload.ok()).toBeTruthy();
  await page.goto(`/#paper/${paper.id}`);
  await expect(page.getByTestId("pdf-canvas")).toHaveAttribute(
    "data-rendered",
    "true",
  );
  return paper;
}

const panelToggle = (page: Page) =>
  page.getByRole("button", { name: /^(收起|打开)阅读侧栏$/ });

test("The button of the panel that is showing hides it again", async ({
  page,
}) => {
  await reader(page, "Toggle verification");
  for (const name of ["批注", "翻译", "解释", "图表", "引用文献", "测验"]) {
    const tab = page.getByRole("button", { name, exact: true });
    // Closed: the tab opens its panel.
    if ((await panelToggle(page).getAttribute("aria-label")) === "收起阅读侧栏")
      await panelToggle(page).click();
    await expect(panelToggle(page)).toHaveAccessibleName("打开阅读侧栏");
    await tab.click();
    await expect(tab).toHaveAttribute("aria-pressed", "true");
    await expect(panelToggle(page)).toHaveAccessibleName("收起阅读侧栏");
    // The second click on the same tab hides it, wherever the panel is docked.
    await tab.click();
    await expect(tab).toHaveAttribute("aria-pressed", "false");
    await expect(panelToggle(page)).toHaveAccessibleName("打开阅读侧栏");
  }
});

test("Another tab replaces the panel that is showing instead of closing it", async ({
  page,
}) => {
  await reader(page, "Toggle switching verification");
  const notes = page.getByRole("button", { name: "笔记", exact: true });
  const annotations = page.getByRole("button", { name: "批注", exact: true });
  if ((await panelToggle(page).getAttribute("aria-label")) === "打开阅读侧栏")
    await notes.click();
  await expect(notes).toHaveAttribute("aria-pressed", "true");
  await annotations.click();
  await expect(annotations).toHaveAttribute("aria-pressed", "true");
  await expect(notes).toHaveAttribute("aria-pressed", "false");
  await expect(panelToggle(page)).toHaveAccessibleName("收起阅读侧栏");
});

test("The assistant's button hides its panel on the second click too", async ({
  page,
}) => {
  await reader(page, "Assistant toggle verification");
  const assistant = page.getByRole("button", { name: "AI", exact: true });
  const panel = page.getByRole("dialog", { name: "研究助手", exact: true });
  await assistant.click();
  await expect(panel).toBeVisible();
  await assistant.click();
  await expect(panel).toHaveCount(0);
  await expect(assistant).toHaveAttribute("aria-pressed", "false");
});

test("The navigation toggle stays in one place, open or closed, on every page", async ({
  page,
}) => {
  await reader(page, "Navigation toggle verification");
  // A collapsed navigation keeps its own toggle off to the left of the screen,
  // so what counts is the toggles that can actually be seen and clicked.
  const onScreen = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('[data-slot="sidebar-trigger"]')]
        .map((el) => el.getBoundingClientRect())
        .filter(
          (r) =>
            r.width > 0 &&
            r.right > 0 &&
            r.left < innerWidth &&
            r.bottom > 0 &&
            r.top < innerHeight,
        )
        .map((r) => ({
          x: Math.round(r.x),
          y: Math.round(r.y),
          w: Math.round(r.width),
        })),
    );
  // A closed navigation slides off to the left rather than leaving the page.
  const navigationOnScreen = () =>
    page.evaluate(
      () =>
        document
          .querySelector('[data-slot="sidebar-container"]')!
          .getBoundingClientRect().right > 0,
    );
  const where = async () => {
    // The navigation slides for a moment; wait until the toggle has settled.
    let previous = "";
    let found: { x: number; y: number; w: number }[] = [];
    await expect
      .poll(async () => {
        found = await onScreen();
        const key = JSON.stringify(found);
        const settled = found.length === 1 && key === previous;
        previous = key;
        return settled;
      })
      .toBe(true);
    // Exactly one toggle is showing, so there is one place to look for it.
    expect(found).toHaveLength(1);
    return found[0];
  };
  const press = async () => {
    const { x, y, w } = await where();
    await page.mouse.click(x + w / 2, y + w / 2);
  };
  await page.setViewportSize({ width: 1440, height: 1000 });
  const readerOpen = await where();
  await press();
  await expect.poll(navigationOnScreen).toBe(false);
  expect(await where()).toEqual(readerOpen);

  await page.goto("/#library");
  await expect(page.getByRole("heading", { name: "我的文库" })).toBeVisible();
  expect(await where()).toEqual(readerOpen);
  await press();
  await expect.poll(navigationOnScreen).toBe(true);
  expect(await where()).toEqual(readerOpen);
});
