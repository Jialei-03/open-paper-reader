import { expect, test } from "@playwright/test";
import { signIn } from "../reader/fixtures";
import type { Workflow } from "../../src/screens/workflows/workflows-api";

test.use({ locale: "zh-CN" });
test("workflows: built-ins are read-only, copies can be reordered and saved", async ({
  page,
}) => {
  const workflows: Workflow[] = [
    {
      id: "literature-review",
      name: "Literature review",
      version: 1,
      builtin: true,
      steps: [
        {
          name: "Collect",
          type: "agent",
          instructions: "Collect sources",
          outputs: ["review/sources.md"],
          confirmation: false,
          max_rounds: 3,
          max_retries: 2,
        },
        {
          name: "Read",
          type: "agent",
          instructions: "Read sources",
          outputs: ["review/notes.md"],
          confirmation: true,
          max_rounds: 3,
          max_retries: 2,
        },
      ],
    },
  ];
  await page.route("**/api/v1/health", (route) =>
    route.fulfill({ json: { status: "ok", mode: "local", version: "test" } }),
  );
  await page.route("**/api/v1/research/navigation", (route) =>
    route.fulfill({ json: { workspaces: [], collections: [], recent: [] } }),
  );
  await page.route("**/api/v1/research/workflows", async (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON();
      const created = {
        ...body,
        id: "11111111-1111-4111-8111-111111111111",
        builtin: false,
        version: 1,
      };
      workflows.push(created);
      return route.fulfill({ json: created });
    }
    return route.fulfill({ json: workflows });
  });
  await signIn(page);
  await page.goto("/#customize/workflows");
  await expect(
    page.getByRole("heading", { name: "工作流", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "文献综述", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("名称").first()).toBeDisabled();
  await dialog.getByRole("button", { name: "复制", exact: true }).click();
  await expect(dialog.getByLabel("名称").first()).toBeEnabled();
  await dialog.getByLabel("名称").first().fill("每周综述");
  await dialog
    .getByRole("button", { name: "下移", exact: true })
    .first()
    .click();
  await expect(
    dialog.locator("fieldset").first().getByLabel("名称"),
  ).toHaveValue("精读要点");
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "每周综述", exact: true }),
  ).toBeVisible();
  expect(workflows[1].steps.map((step) => step.outputs[0])).toEqual([
    "review/notes.md",
    "review/sources.md",
  ]);
});

test("workflows: selection, output preview, progress and confirmation", async ({
  page,
}) => {
  const wid = "22222222-2222-4222-8222-222222222222";
  const rid = "33333333-3333-4333-8333-333333333333";
  const at = "2026-10-23T00:00:00Z";
  const workflow: Workflow = {
    id: "literature-review",
    name: "Literature",
    version: 1,
    builtin: true,
    steps: [
      {
        name: "Collect",
        type: "agent",
        instructions: "",
        outputs: ["review/sources.md"],
        confirmation: true,
        max_rounds: 3,
        max_retries: 2,
      },
    ],
    state: {
      current: 0,
      steps: [
        {
          status: "waiting",
          summary: "Sources",
          outputs: ["review/sources.md"],
          started_at: at,
          finished_at: at,
        },
      ],
    },
  };
  const project = {
    id: rid,
    title: "综述",
    question: "Review papers",
    workspace_id: wid,
    model_config_id: "model-1",
    session_id: rid,
    status: "waiting",
    stage: "workflow",
    end_reason: "",
    background: "",
    plan: {},
    conclusion_record: {},
    budget: { max_sprints: null, max_tokens: null, max_job_seconds: null },
    spent: { sprints: 1, tokens: 100, job_seconds: 0 },
    environment: {},
    compute_id: "host",
    created_at: at,
    updated_at: at,
    workflow,
  };
  let selected = "";
  let confirmed = false;
  const events = [
    {
      id: "start",
      action: "workflow_step_started",
      detail: { index: 0, status: "running" },
    },
    {
      id: "finish",
      action: "workflow_step_finished",
      detail: { index: 0, status: "waiting", outputs: ["review/sources.md"] },
    },
    {
      id: "confirm",
      action: "decision_requested",
      detail: { kind: "workflow_step", index: 0, reason: "Sources" },
    },
  ].map((event) => ({
    ...event,
    actor: "system",
    sprint_id: null,
    node_id: null,
    created_at: at,
  }));
  await page.route("**/api/v1/health", (route) =>
    route.fulfill({ json: { status: "ok", mode: "local", version: "test" } }),
  );
  await page.route("**/api/v1/translation-settings", (route) =>
    route.fulfill({
      json: {
        active_id: "model-1",
        configured: true,
        models: [
          {
            id: "model-1",
            model: "test",
            name: "Test",
            protocol: "openai",
            base_url: "https://example.test/v1",
          },
        ],
      },
    }),
  );
  await page.route("**/api/v1/research/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace(
      "/api/v1/research",
      "",
    );
    if (path === "/navigation")
      return route.fulfill({
        json: {
          workspaces: [
            {
              id: wid,
              name: "Project",
              archived: false,
              researches: [],
              kind: "research",
              model_config_id: "model-1",
              location: { kind: "managed", path: "", connection_id: "" },
            },
          ],
          collections: [],
        },
      });
    if (path === "/workflows")
      return route.fulfill({
        json: [
          { ...workflow, state: undefined },
          { ...workflow, id: "research", name: "Research", state: undefined },
        ],
      });
    if (path === "/settings")
      return route.fulfill({
        json: {
          computes: [{ id: "host", kind: "host", name: "Local" }],
          states: {},
        },
      });
    if (path === "/projects" && route.request().method() === "POST") {
      selected = route.request().postDataJSON().workflow_id;
      return route.fulfill({ json: project });
    }
    if (path === `/projects/${rid}`)
      return route.fulfill({
        json: {
          project,
          nodes: [],
          sprints: [],
          jobs: [],
          datasets: [],
          docker: { available: true },
          input_needed: null,
        },
      });
    if (path.endsWith("/events")) return route.fulfill({ json: events });
    if (path.endsWith("/workspace/file"))
      return route.fulfill({
        json: {
          name: "sources.md",
          path: "review/sources.md",
          size: 20,
          modified: 1,
          kind: "markdown",
          content: "# Verified sources",
        },
      });
    if (path.endsWith("/decisions/confirm")) {
      confirmed = route.request().postDataJSON().approve;
      return route.fulfill({ json: project });
    }
    if (path.endsWith("/changes"))
      return route.fulfill({ json: { files: [], added: 0, removed: 0 } });
    if (path.endsWith("/read")) return route.fulfill({ json: { read_at: at } });
    return route.fulfill({ json: [] });
  });
  await signIn(page);
  await page.goto("/#new");
  await page.getByRole("button", { name: "工作流", exact: true }).click();
  await page.getByRole("menuitem", { name: "文献综述", exact: true }).click();
  await page
    .locator('[data-testid="new-research"] textarea')
    .fill("Review papers");
  await page
    .locator('[data-testid="new-research"] button[type="submit"]')
    .click();
  await expect(page).toHaveURL(new RegExp(`#research/${rid}$`));
  expect(selected).toBe("literature-review");
  await page
    .getByRole("button", { name: "review/sources.md", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Verified sources" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "返回文件列表", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "工作流", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "继续", exact: true }).click();
  await expect.poll(() => confirmed).toBe(true);
});
