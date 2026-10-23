import { expect, test } from "@playwright/test";
import type { Workflow } from "../../src/screens/team/workflow/workflow-model";
import type { TeamMessage } from "../../src/screens/research/team-api";
import { signIn } from "../reader/fixtures";

test.use({ locale: "zh-CN" });
const wid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const dm = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const cid = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const members = [
  "human",
  "advisor",
  "executor",
  "librarian",
  "reviewer",
  "writer",
  "distiller",
].map((role) => ({
  id: role,
  role,
  name: role,
  status: "idle",
  active_run_id: null,
}));
const fresh = (): Workflow => ({
  id: "peers",
  name: "Peers",
  builtin: false,
  version: 1,
  rules: [
    {
      id: "source-review",
      enabled: true,
      when: { event: "message", from_role: "executor", kind: "result" },
      then: {
        action: "review",
        role: "advisor",
        on_fail: "executor",
        max_rounds: 3,
      },
      limit: { per_thread: 10 },
    },
  ],
  layout: { members: {}, channels: {} },
});

async function setup(page: import("@playwright/test").Page) {
  let workflow = fresh();
  const writes: Workflow[] = [];
  const libraryWrites: Workflow[] = [];
  const reply: TeamMessage = {
    id: "reply",
    channel_id: cid,
    thread_id: null,
    author_id: "advisor",
    text: "已评审",
    kind: "text",
    mentions: [],
    replies: 0,
    created_at: "2026-10-23T15:44:00Z",
    data: {},
    run: {
      id: "review-run",
      status: "completed",
      response: "已评审",
      error: "",
      steps: [],
      runtime: {},
      created_at: "2026-10-23T15:27:00Z",
      updated_at: "2026-10-23T15:44:00Z",
    },
  };
  await page.route("**/api/v1/health", async (route) => {
    const real = await (await route.fetch()).json();
    await route.fulfill({ json: { ...real, mode: "local" } });
  });
  await page.route("**/api/v1/translation-settings", (route) =>
    route.fulfill({
      json: {
        configured: true,
        active_id: "fake",
        models: [{ id: "fake", model: "Fake", name: "Fake" }],
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
              name: "团队",
              kind: "research",
              archived: false,
              location: { kind: "managed", path: "", connection_id: "" },
              researches: [],
            },
          ],
          collections: [],
        },
      });
    if (path === "/workflows" || path.startsWith("/workflows/")) {
      if (["POST", "PUT"].includes(route.request().method())) {
        const body = route.request().postDataJSON() as Workflow;
        libraryWrites.push(body);
        workflow = {
          ...body,
          id: path === "/workflows" ? "copied" : workflow.id,
        };
        return route.fulfill({ json: workflow });
      }
      return route.fulfill({
        json: [workflow, { ...fresh(), id: "second", name: "Second" }],
      });
    }
    if (path.endsWith("/team/workflow")) {
      if (route.request().method() === "PUT") {
        const body = route.request().postDataJSON() as Workflow;
        expect(body.version).toBe(workflow.version);
        writes.push(body);
        workflow = { ...body, version: body.version + 1 };
      }
      if (route.request().method() === "POST")
        workflow = { ...fresh(), id: "second", name: "Second" };
      return route.fulfill({ json: workflow });
    }
    if (path.endsWith("/team"))
      return route.fulfill({
        json: {
          workspace_id: wid,
          workflow,
          members,
          runtime: {
            members: { advisor: "working" },
            fired: [{ rule: "source-review", at: new Date().toISOString() }],
          },
          channels: [
            {
              id: cid,
              key: "experiments",
              name: "实验",
              member_id: null,
              unread: 0,
            },
            {
              id: dm,
              key: "dm:advisor",
              name: "导师",
              member_id: "advisor",
              unread: 0,
            },
          ],
          notifications: [],
        },
      });
    if (path.endsWith("/messages"))
      return route.fulfill({
        json: {
          root: null,
          research_id: null,
          messages: [
            {
              ...reply,
              data: {
                rule: "source-review",
                workflow: workflow.id,
                workflow_version: workflow.version,
              },
            },
          ],
        },
      });
    if (path.endsWith("/read")) return route.fulfill({ json: { ok: true } });
    if (path === "/compare") return route.fulfill({ json: { threads: [] } });
    if (path === "/schedules")
      return route.fulfill({
        json: [
          {
            id: "timer",
            title: "Daily",
            timezone: "UTC",
            paused: false,
            next_run_at: "2026-10-24T09:00:00Z",
            editor_url: `team/${wid}/settings?thread=rule%3Apeers%3A1%3Asource-review`,
          },
        ],
      });
    if (path === "/settings")
      return route.fulfill({ json: { computes: [], states: {} } });
    return route.fulfill({ json: [] });
  });
  await signIn(page);
  return { writes, libraryWrites, reply };
}

test("team settings persist rules, switch workflows and open canvas messages", async ({
  page,
}) => {
  const { writes } = await setup(page);
  await page.goto(`/#team/${wid}/${cid}`);
  await page.getByRole("link", { name: "团队设置", exact: true }).click();
  await expect(page.getByRole("heading", { name: "团队设置" })).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "团队设置", exact: true })
      .getByRole("button", { name: "librarian", exact: true }),
  ).toBeVisible();
  await page.getByRole("radio", { name: "工作流", exact: true }).click();
  await page.getByRole("switch").click();
  await expect.poll(() => writes.length).toBe(1);
  await page.getByRole("tab", { name: "画布", exact: true }).click();
  await expect(page.getByTestId("workflow-canvas")).toBeVisible();
  await page.locator('[data-id="member:advisor"]').press("Enter");
  await expect(page).toHaveURL(new RegExp(dm));
  await page.goto(`/#team/${wid}/settings?thread=workflow`);
  await page.getByRole("button", { name: "工作流", exact: true }).click();
  await page.getByRole("menuitem", { name: "Second", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "工作流", exact: true }),
  ).toContainText("Second");
});

test("message provenance and schedule links locate the rule editor at 720px", async ({
  page,
}) => {
  await setup(page);
  await page.setViewportSize({ width: 720, height: 900 });
  await page.goto(`/#team/${wid}/${cid}`);
  await expect(page.locator('[data-message-id="reply"] time')).toHaveAttribute(
    "datetime",
    "2026-10-23T15:44:00Z",
  );
  await page.getByRole("link", { name: "source-review", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "取消", exact: true }).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.goto("/#schedules");
  await page.getByRole("link", { name: "Daily", exact: true }).last().click();
  await expect(page.getByRole("dialog")).toBeVisible();
});

test("queued rule wakes stay compact until work starts", async ({ page }) => {
  const { reply } = await setup(page);
  reply.text = "";
  reply.created_at = reply.run!.created_at;
  reply.run!.status = "queued";
  reply.run!.response = "";
  await page.goto(`/#team/${wid}/${cid}`);
  const row = page.locator('[data-message-id="reply"]');
  await expect(row.getByRole("status")).toHaveText("排队中");
  await expect(row.locator("time, section")).toHaveCount(0);
  await expect(
    row.getByRole("link", { name: "source-review", exact: true }),
  ).toHaveCount(0);
  reply.run!.status = "running";
  await page.evaluate(() =>
    window.dispatchEvent(new Event("research-team-updated")),
  );
  await expect(row.locator('[data-live="true"]')).toBeVisible();
  await expect(row.getByText("排队中", { exact: true })).toHaveCount(0);
  await row.getByRole("link", { name: "source-review", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
});

test("customization manages rule workflows with the same list and canvas editor", async ({
  page,
}) => {
  const { libraryWrites } = await setup(page);
  await page.goto("/#customize/workflows");
  await page.getByRole("button", { name: "Peers", exact: true }).click();
  await expect(
    page.getByRole("tab", { name: "画布", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "名称", exact: true })
    .fill("Peer rules");
  await page.getByRole("switch").click();
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect.poll(() => libraryWrites.length).toBe(1);
  expect(libraryWrites[0].rules[0].enabled).toBe(false);
  await expect(
    page.getByRole("button", { name: "Peer rules", exact: true }),
  ).toBeVisible();
});

test("team canvas fills the main area and lists channels without DMs", async ({
  page,
}) => {
  await setup(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`/#team/${wid}/settings?thread=workflow`);
  await expect(
    page.getByRole("heading", { name: "Peers", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("tab", { name: "画布", exact: true }).click();
  const canvas = page.getByTestId("workflow-canvas");
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(600);
  expect(box!.width).toBeGreaterThan(600);
  const palette = page.getByRole("complementary", {
    name: "节点操作",
    exact: true,
  });
  const channelNodes = palette.locator("div").filter({
    has: page.getByRole("heading", { name: "频道", exact: true }),
  });
  await expect(
    channelNodes.getByRole("button", { name: "添加 实验", exact: true }),
  ).toHaveCount(1);
  await expect(channelNodes.getByRole("button")).toHaveCount(1);
  await expect(
    palette.getByRole("button", { name: "添加 advisor", exact: true }),
  ).toHaveCount(1);
  await expect(
    palette.getByRole("button", { name: "添加 导师", exact: true }),
  ).toHaveCount(0);
  await page.setViewportSize({ width: 720, height: 900 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("team budgets are optional and there is no handoff limit", async ({
  page,
}) => {
  await setup(page);
  const writes: { url: string; body: Record<string, number> }[] = [];
  await page.route("**/team/budget", (route) => {
    const body = route.request().postDataJSON();
    writes.push({ url: route.request().url(), body });
    return route.fulfill({ json: body });
  });
  await page.goto(`/#team/${wid}/settings?thread=budget`);
  const settings = page.getByRole("region", { name: "团队设置", exact: true });
  await expect(
    settings.getByRole("spinbutton", { name: "同时工作的成员数", exact: true }),
  ).toHaveValue("0");
  await expect(settings.getByText("连续接力上限")).toHaveCount(0);
  await settings.getByRole("button", { name: "保存", exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0].body).not.toHaveProperty("relay_limit");
});
