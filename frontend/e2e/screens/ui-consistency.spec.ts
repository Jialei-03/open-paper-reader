import { expect, test, type Page } from "@playwright/test";
import { createPaperWithPdf, signIn } from "../reader/fixtures";

const task = {
  id: "task-ui",
  title: "Daily papers",
  prompt: "Find papers",
  workspace_id: "workspace-ui",
  destination: "new",
  research_id: null,
  frequency: "daily",
  local_time: "09:00",
  weekday: 4,
  interval_hours: 4,
  timezone: "Asia/Singapore",
  paused: true,
  next_run_at: "2026-10-24T01:00:00+00:00",
  created_at: "2026-10-23T00:00:00+00:00",
  updated_at: "2026-10-23T00:00:00+00:00",
  runs: [],
};

async function setup(page: Page) {
  await page.addInitScript(() => localStorage.setItem("paper-locale", "zh"));
  await page.route("**/api/v1/health", (route) =>
    route.fulfill({ json: { mode: "local", status: "ok" } }),
  );
  await page.route("**/api/v1/translation-settings", (route) =>
    route.fulfill({ json: { active_id: "", configured: true, models: [] } }),
  );
  // All research calls are mocked, including automatic machine probes.
  await page.route("**/api/v1/research/**", (route) => {
    const key = new URL(route.request().url()).pathname.replace(
      "/api/v1/research/",
      "",
    );
    const answers: Record<string, unknown> = {
      navigation: {
        collections: [],
        workspaces: [
          {
            id: "workspace-ui",
            name: "UI project",
            archived: false,
            researches: [],
            location: {
              kind: "local",
              path: "/tmp/ui-project",
              connection_id: "",
            },
          },
        ],
      },
      schedules: [task],
      "schedules/task-ui": task,
      settings: {
        computes: [],
        default_compute: "host",
        states: {},
        tracker: {
          kind: "wandb",
          mode: "local",
          project: "original",
          has_key: false,
        },
      },
      "ssh-hosts": [],
      roles: [{ id: "research-advisor", title: "Advisor" }],
      "roles/research-advisor": {
        id: "research-advisor",
        title: "Advisor",
        body: "# Advisor",
      },
      playbook: { version: 1, rules: [], history: [] },
    };
    return route.fulfill({ json: answers[key] ?? [] });
  });
  await page.route("**/api/v1/discover/**", (route) =>
    route.fulfill({ json: { state: "no_seeds", items: [] } }),
  );
  for (const engine of ["layout", "latex"]) {
    await page.route(`**/api/v1/${engine}-install`, (route) =>
      route.fulfill({
        json: {
          supported: true,
          installed: false,
          status: "idle",
          progress: 0,
          stage: "",
          error: "",
        },
      }),
    );
  }
  await signIn(page);
}

async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const surface = page.locator("dialog[open], [data-app-screen]").last();
  expect(
    await surface.evaluate(
      (element) => element.scrollWidth <= element.clientWidth + 1,
    ),
  ).toBe(true);
}

for (const theme of ["light", "dark"] as const) {
  for (const width of [1440, 720]) {
    test(`${theme}, ${width}px: headers, empty states and settings`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.addInitScript(
        (mode) => localStorage.setItem("paper-appearance", mode),
        theme,
      );
      await setup(page);
      const pages = [
        ["library", "全部"],
        ["library?view=reading", "在读"],
        ["library?view=unread", "未读"],
        ["library?view=read", "已读"],
        ["discover", "发现"],
        ["schedules", "定时任务"],
        ["schedules/new", "新建任务"],
        ["schedules/task-ui", "Daily papers"],
        ["customize/playbook", "研究手册"],
        ["customize/roles", "研究角色"],
        ["customize/machines", "机器"],
        ["customize/tracking", "实验追踪"],
        ["customize/models", "模型"],
      ];
      let left: number | undefined;
      for (const [hash, title] of pages) {
        await page.goto(`/#${hash}`);
        const heading = page.getByRole("heading", {
          name: title,
          level: 1,
          exact: true,
        });
        await expect(heading).toBeVisible();
        await expect(heading).toHaveCSS("font-size", "24px");
        await expect(heading).toHaveCSS("font-weight", "600");
        const box = (await heading.boundingBox())!;
        left ??= box.x;
        expect(box.x).toBeCloseTo(left, 0);
        expect(
          await page.locator('button[class*="_primary_"]:visible').count(),
        ).toBeLessThanOrEqual(1);
        await noOverflow(page);
      }
      for (const category of ["general", "data", "usage", "access", "cloud"]) {
        await page.goto(`/#settings/${category}`);
        const dialog = page.getByRole("dialog", { name: "设置", exact: true });
        await expect(dialog).toBeVisible();
        await expect(dialog.getByRole("heading", { level: 1 })).toHaveCSS(
          "font-size",
          "24px",
        );
        expect(
          await dialog.locator('button[class*="_primary_"]:visible').count(),
        ).toBeLessThanOrEqual(1);
        await noOverflow(page);
        await page.keyboard.press("Escape");
        await expect(dialog).toBeHidden();
      }
    });
  }
}

test("keyboard reaches import and destructive menus; tracking cancellation keeps the saved value", async ({
  page,
}) => {
  await setup(page);
  await page.goto("/#library");
  const importButton = page
    .getByRole("main")
    .getByRole("button", { name: "导入", exact: true })
    .first();
  await importButton.focus();
  await importButton.press("Enter");
  await page.getByRole("menuitem", { name: "arXiv 链接或编号" }).focus();
  await page.keyboard.press("Enter");
  const importing = page.getByRole("dialog", { name: "导入", exact: true });
  await expect(importing.getByRole("textbox")).toBeFocused();
  await importing.getByRole("textbox").fill("2401.00001");
  await importing.getByRole("button", { name: "取消" }).click();
  await expect(importing).toBeHidden();
  await expect(importButton).toBeFocused();

  await page.goto("/#schedules/task-ui");
  await page.getByRole("button", { name: "更多", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menuitem").last()).toHaveText("删除");
  await page.getByRole("menuitem", { name: "删除", exact: true }).focus();
  await page.keyboard.press("Enter");
  const deleting = page.getByRole("dialog", { name: "删除这个任务？" });
  await expect(deleting).toBeVisible();
  await deleting.getByRole("button", { name: "取消" }).click();
  await expect(deleting).toBeHidden();

  await page.goto("/#customize/tracking");
  await page.getByRole("button", { name: "W&B 的更多操作" }).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("menuitem", { name: "编辑", exact: true }).click();
  const tracking = page.getByRole("dialog", { name: "W&B", exact: true });
  await tracking.getByRole("textbox").fill("unsaved");
  await tracking.getByRole("button", { name: "取消" }).click();
  await page.getByRole("button", { name: "W&B 的更多操作" }).click();
  await page.getByRole("menuitem", { name: "编辑", exact: true }).click();
  await expect(tracking.getByRole("textbox")).toHaveValue("original");
});

test("reader shell stays within a 720px dark window", async ({ page }) => {
  await setup(page);
  const paper = await createPaperWithPdf(page, {
    title: "A long paper title ".repeat(12),
  });
  await page.setViewportSize({ width: 720, height: 1000 });
  await page.addInitScript(() =>
    localStorage.setItem("paper-appearance", "dark"),
  );
  await page.goto(`/#read/${paper.paperId}`);
  const heading = page.getByRole("main").getByRole("heading", { level: 1 });
  await expect(heading).toBeVisible();
  await expect(heading).toHaveCSS("font-size", "14px");
  await noOverflow(page);
  await page.getByRole("button", { name: "更多", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "论文详情" })).toBeVisible();
});
