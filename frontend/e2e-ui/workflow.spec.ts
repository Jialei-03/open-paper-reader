import { expect, test, type Page } from "@playwright/test";
import type { Workflow } from "../src/screens/team/workflow/workflow-model";

const state = async (page: Page): Promise<Workflow> =>
  JSON.parse((await page.getByTestId("workflow-state").textContent())!);
const row = (page: Page, id: string) => page.locator(`[data-rule-id="${id}"]`);
const node = (page: Page, id: string) =>
  page.locator(`.react-flow__node[data-id="${id}"]`);
const edge = (page: Page, id: string) =>
  page.locator(`.react-flow__edge[data-id="${id}"]`);

for (const theme of ["light", "dark"] as const) {
  test(`workflow edits, keyboard layout and runtime stay shared at 720px in ${theme}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 720, height: 800 });
    await page.goto(`/e2e-ui/workflow.html?theme=${theme}`);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await row(page, "review").getByRole("button", { name: /When/ }).click();
    const editor = page.getByRole("dialog", { name: "Edit rule", exact: true });
    await editor
      .getByLabel("Instruction", { exact: true })
      .fill("Check uncertainty");
    await editor.getByLabel("Trigger limit per thread").fill("7");
    await editor.getByRole("button", { name: "Save", exact: true }).click();
    await expect(row(page, "review")).toContainText("Check uncertainty");
    await row(page, "review").getByRole("switch").click();
    await expect(row(page, "review").getByRole("switch")).toHaveAttribute(
      "aria-checked",
      "false",
    );
    await row(page, "review")
      .getByRole("button", { name: "Drag to reorder", exact: true })
      .focus();
    await page.keyboard.press("Alt+ArrowDown");
    await expect
      .poll(async () => (await state(page)).rules.map((rule) => rule.id))
      .toEqual(["wait", "review", "subscribe", "schedule"]);

    await page.getByRole("tab", { name: "Canvas", exact: true }).click();
    await expect(node(page, "member:executor")).toBeVisible();
    await expect(node(page, "member:executor")).toContainText("Working");
    await expect(node(page, "member:reviewer")).toContainText(
      "Waiting for you",
    );
    await edge(page, "rule:review").focus();
    await page.keyboard.press("Enter");
    await expect(editor.getByLabel("Instruction", { exact: true })).toHaveValue(
      "Check uncertainty",
    );
    await expect(editor.getByLabel("Trigger limit per thread")).toHaveValue(
      "7",
    );
    await editor.getByLabel("Review limit", { exact: true }).fill("4");
    await editor.getByRole("button", { name: "Save", exact: true }).click();
    await edge(page, "return:review").focus();
    await page.keyboard.press("Enter");
    await expect(
      editor.getByLabel("Review limit", { exact: true }),
    ).toHaveValue("4");
    await editor.getByRole("button", { name: "Cancel", exact: true }).click();

    await node(page, "member:executor").focus();
    await page.keyboard.press("ArrowRight");
    await expect
      .poll(async () => (await state(page)).layout.members.executor.x)
      .toBe(10);
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("workflow-opened")).toHaveText(
      JSON.stringify({ kind: "member", id: "executor" }),
    );
    await page.evaluate(() =>
      window.dispatchEvent(
        new CustomEvent("ora-workflow-runtime", {
          detail: {
            members: { executor: "waiting" },
            fired: [{ rule: "subscribe", at: new Date().toISOString() }],
          },
        }),
      ),
    );
    await expect(node(page, "member:executor")).toContainText(
      "Waiting for you",
    );
    await expect(edge(page, "rule:subscribe")).toHaveClass(/animated/);
    await expect(edge(page, "rule:subscribe")).not.toHaveClass(/animated/, {
      timeout: 4000,
    });
    await page.getByRole("button", { name: "Add Sam", exact: true }).click();
    await expect(node(page, "member:writer")).toBeAttached();
    await page
      .getByRole("button", { name: "Add Writing", exact: true })
      .dragTo(page.locator(".react-flow__pane"));
    await expect
      .poll(async () => (await state(page)).layout.channels.writing)
      .toBeTruthy();
    await page.getByRole("tab", { name: "List", exact: true }).click();
    await expect(row(page, "review")).toContainText("Up to 4 times");
    await expect(row(page, "review").getByRole("switch")).toHaveAttribute(
      "aria-checked",
      "false",
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  });
}

test("dragging a connection creates a rule only after saving the shared editor", async ({
  page,
}) => {
  await page.goto("/e2e-ui/workflow.html");
  await page.getByRole("tab", { name: "Canvas", exact: true }).click();
  const source = node(page, "member:executor").locator('[data-handleid="out"]');
  const target = node(page, "member:reviewer").locator('[data-handleid="in"]');
  await expect(source).toBeVisible();
  const dragConnection = async () => {
    const start = (await source.boundingBox())!;
    const end = (await target.boundingBox())!;
    await page.mouse.move(
      start.x + start.width / 2,
      start.y + start.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, {
      steps: 12,
    });
    await page.mouse.up();
  };
  await dragConnection();
  const editor = page.getByRole("dialog", { name: "Edit rule", exact: true });
  await expect(editor.getByLabel("Author", { exact: true })).toHaveValue(
    "m:executor",
  );
  await expect(editor.getByLabel("Member", { exact: true })).toHaveValue(
    "m:reviewer",
  );
  expect((await state(page)).rules).toHaveLength(4);
  await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  expect((await state(page)).rules).toHaveLength(4);
  await dragConnection();
  const triggerLimit = editor.getByLabel("Trigger limit per thread");
  await expect(triggerLimit).toHaveValue("");
  await expect(triggerLimit).toHaveAttribute("placeholder", "Unlimited");
  await editor.getByLabel("Action", { exact: true }).selectOption("review");
  const reviewLimit = editor.getByLabel("Review limit", { exact: true });
  await expect(reviewLimit).toHaveValue("");
  await expect(reviewLimit).toHaveAttribute("placeholder", "Unlimited");
  await triggerLimit.fill("2");
  await reviewLimit.fill("2");
  await triggerLimit.fill("");
  await reviewLimit.fill("");
  await triggerLimit.fill("0");
  await reviewLimit.fill("0");
  await expect(triggerLimit).toHaveValue("");
  await expect(reviewLimit).toHaveValue("");
  await editor.getByLabel("Instruction", { exact: true }).fill("Cross-check");
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(async () => (await state(page)).rules.length).toBe(5);
  expect((await state(page)).rules.at(-1)).toMatchObject({
    limit: { per_thread: 0 },
    then: { action: "review", max_rounds: 0 },
  });
  await page.getByRole("tab", { name: "List", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /When Alex.*Morgan.*Cross-check/ }),
  ).toBeVisible();
});

test("Chinese list supports drag ordering and confirmed deletion", async ({
  page,
}) => {
  await page.goto("/e2e-ui/workflow.html?locale=zh");
  await row(page, "schedule")
    .getByRole("button", { name: "拖动排序", exact: true })
    .dragTo(row(page, "review"));
  await expect
    .poll(async () => (await state(page)).rules[0].id)
    .toBe("schedule");
  await row(page, "schedule")
    .getByRole("button", { name: "规则操作", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "删除规则", exact: true }).click();
  const confirm = page.getByRole("dialog", {
    name: "删除这条规则？",
    exact: true,
  });
  await confirm.getByRole("button", { name: "取消", exact: true }).click();
  await expect(row(page, "schedule")).toBeVisible();
  await row(page, "schedule")
    .getByRole("button", { name: "规则操作", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "删除规则", exact: true }).click();
  await confirm.getByRole("button", { name: "删除规则", exact: true }).click();
  await expect(row(page, "schedule")).toHaveCount(0);
});
