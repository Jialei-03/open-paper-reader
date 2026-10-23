import { expect, test } from "@playwright/test";
import { signIn } from "../reader/fixtures";
import type { TeamMessage } from "../../src/screens/research/team-api";

// Fake team and model transport; no provider requests are made by these flows.
test.use({ locale: "zh-CN" });
const workspace = "10000000-0000-0000-0000-000000000001";
const channel = "10000000-0000-0000-0000-000000000002";
const dm = "10000000-0000-0000-0000-000000000003";
const research = "10000000-0000-0000-0000-000000000004";
const otherWorkspace = "10000000-0000-0000-0000-000000000005";
const stamp = "2026-10-23T10:00:00+00:00";

async function setup(page: import("@playwright/test").Page) {
  let working = false;
  const posted: Record<string, unknown>[] = [];
  const messages: TeamMessage[] = [];
  const deliveries: Record<string, unknown>[] = [];
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
  const project = {
    id: research,
    workspace_id: workspace,
    session_id: "session",
    question: "研究问题",
    title: "研究问题",
    stage: "scoping",
    status: "paused",
    plan: {},
    conclusion_record: {},
    environment: {},
    budget: {},
    spent: {},
    workflow: null,
    created_at: stamp,
    updated_at: stamp,
  };
  const root = {
    id: `research:${research}`,
    channel_id: channel,
    thread_id: null,
    author_id: "human",
    text: "研究问题",
    kind: "research",
    mentions: [],
    data: { research_id: research, title: "研究问题" },
    replies: 1,
    created_at: stamp,
  };
  await page.route("**/api/v1/health", (route) =>
    route.fulfill({ json: { mode: "local" } }),
  );
  await page.route("**/api/v1/translation-settings", (route) =>
    route.fulfill({
      json: {
        configured: true,
        active_id: "model",
        models: [
          { id: "model", name: "Fake", model: "Fake", protocol: "openai" },
        ],
      },
    }),
  );
  await page.route("**/api/v1/research/navigation", (route) =>
    route.fulfill({
      json: {
        workspaces: [
          {
            id: workspace,
            name: "表示学习",
            location: { kind: "managed", path: "", connection_id: "" },
            researches: [],
            archived: false,
          },
          {
            id: otherWorkspace,
            name: "图学习",
            location: { kind: "managed", path: "", connection_id: "" },
            researches: [],
            archived: false,
          },
        ],
        collections: [],
      },
    }),
  );
  await page.route("**/api/v1/research/connections", (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route("**/api/v1/research/settings", (route) =>
    route.fulfill({ json: { computes: [], states: {} } }),
  );
  await page.route(`**/api/v1/research/projects/${research}`, (route) =>
    route.fulfill({
      json: {
        project,
        nodes: [],
        sprints: [],
        jobs: [],
        datasets: [],
        input_needed: "",
        docker: {},
      },
    }),
  );
  await page.route(`**/api/v1/research/projects/${research}/events*`, (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route(`**/api/v1/research/projects/${research}/runs`, (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route("**/api/v1/research/workspaces/*/team**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (path.endsWith("/team"))
      return route.fulfill({
        json: {
          workspace_id: path.split("/")[5],
          members: members.map((m) => ({
            ...m,
            status: working && m.role === "advisor" ? "working" : m.status,
          })),
          channels: [
            {
              id: channel,
              key: "experiments",
              name: "实验",
              member_id: null,
              unread: 0,
            },
            ...members
              .filter((m) => m.role !== "human")
              .map((m, index) => ({
                id:
                  m.role === "advisor"
                    ? dm
                    : `10000000-0000-0000-0000-${String(index + 10).padStart(12, "0")}`,
                key: `dm:${m.role}`,
                name: m.name,
                member_id: m.id,
                unread: 0,
              })),
          ],
          notifications: [],
        },
      });
    if (path.endsWith("/read")) return route.fulfill({ json: { ok: true } });
    if (path.endsWith("/deliveries"))
      return route.fulfill({ json: deliveries });
    if (path.includes("/deliveries/")) {
      const body = request.postDataJSON();
      posted.push(body);
      const index = deliveries.findIndex(
        (d) => d.id === path.split("/").at(-1),
      );
      if (index < 0) return route.fulfill({ status: 404, json: {} });
      if (body.cancel) deliveries.splice(index, 1);
      else {
        Object.assign(deliveries[index], body);
        if (body.text)
          messages.find((m) => m.id === deliveries[index].message_id)!.text =
            body.text;
        if (body.mode === "immediate") deliveries[index].status = "steering";
      }
      return route.fulfill({ json: {} });
    }
    if (path.endsWith("/messages")) {
      const target = path.split("/channels/")[1].split("/")[0];
      if (request.method() === "POST") {
        const body = request.postDataJSON();
        posted.push(body);
        const message: TeamMessage = {
          id: crypto.randomUUID(),
          channel_id: target,
          thread_id: body.thread_id || null,
          author_id: "human",
          text: body.text,
          kind: "message",
          mentions: [],
          data: {},
          created_at: stamp,
          replies: 0,
        };
        messages.push(message);
        if (working && body.mode === "queue")
          deliveries.push({
            id: crypto.randomUUID(),
            member_id: "advisor",
            message_id: message.id,
            channel_id: target,
            thread_id: message.thread_id,
            text: body.text,
            mode: body.mode,
            status: "queued",
            error: "",
            editable: true,
          });
        working =
          body.text.includes("@advisor") ||
          body.text.includes("@导师") ||
          target === dm;
        return route.fulfill({ json: message });
      }
      const thread = url.searchParams.get("thread_id");
      return route.fulfill({
        json: {
          messages: [
            ...(!thread && target === channel ? [root] : []),
            ...messages.filter(
              (m) =>
                m.channel_id === target && m.thread_id === (thread || null),
            ),
          ],
          root:
            thread === root.id
              ? root
              : messages.find((m) => m.id === thread) || null,
          research_id: thread === root.id ? research : null,
        },
      });
    }
    return route.fulfill({ json: [] });
  });
  await signIn(page);
  await page.goto(`/#team/${workspace}/${channel}`);
  return { posted, messages, members };
}

test("channel messages, mentions, side thread, fullscreen and research thread", async ({
  page,
}) => {
  const { posted } = await setup(page);
  const screen = page.getByTestId("team-screen");
  const composer = screen.getByRole("textbox", { name: "消息", exact: true });
  await composer.fill("频道消息");
  await composer.press("Enter");
  const message = screen.locator("article").filter({ hasText: "频道消息" });
  await expect(message).toBeVisible();
  await message.hover();
  await message.getByRole("button", { name: "回复", exact: true }).click();
  const thread = page.getByRole("region", { name: "线程", exact: true });
  await thread
    .getByRole("textbox", { name: "消息", exact: true })
    .fill("线程回复");
  await thread
    .getByRole("textbox", { name: "消息", exact: true })
    .press("Enter");
  await expect.poll(() => posted.some((m) => !!m.thread_id)).toBe(true);
  await thread.getByRole("button", { name: "全屏线程" }).click();
  await expect(thread).toBeVisible();
  await thread.getByRole("button", { name: "关闭", exact: true }).click();
  await screen.getByRole("button", { name: "研究问题", exact: true }).click();
  await expect(thread.getByRole("heading", { name: "研究问题" })).toBeVisible();
});

test("mention completion, queue edits, immediate send and direct messages", async ({
  page,
}) => {
  const { posted } = await setup(page);
  let composer = page
    .getByTestId("team-screen")
    .getByRole("textbox", { name: "消息", exact: true });
  await composer.fill("@ad");
  await page.getByRole("option", { name: /^advisor / }).click();
  await expect(composer).toHaveValue("@advisor ");
  await composer.press("End");
  await composer.press("a");
  await composer.press("Enter");
  await expect
    .poll(() => posted.some((m) => m.text === "@advisor a"))
    .toBe(true);
  await composer.fill("@advisor 排队消息");
  await expect(
    page.getByRole("navigation").getByRole("img", { name: "工作中" }),
  ).toBeVisible();
  await expect(
    page
      .getByTestId("team-screen")
      .getByRole("button", { name: "立即发送", exact: true }),
  ).toBeVisible();
  await composer.press("Enter");
  const queued = page
    .getByTestId("team-queue")
    .filter({ hasText: "@advisor 排队消息" });
  await expect(queued.getByText("排队中", { exact: true })).toBeVisible();
  await queued.getByRole("button", { name: "编辑消息", exact: true }).click();
  await page
    .getByRole("textbox", { name: "编辑消息", exact: true })
    .fill("@advisor 修改后");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect
    .poll(() => posted.some((m) => m.text === "@advisor 修改后"))
    .toBe(true);
  await expect(
    page.getByTestId("team-queue").filter({ hasText: "@advisor 修改后" }),
  ).toBeVisible();
  await composer.fill("@advisor 撤回消息");
  await composer.press("Enter");
  await page
    .getByTestId("team-queue")
    .filter({ hasText: "@advisor 撤回消息" })
    .getByRole("button", { name: "撤回", exact: true })
    .click();
  await expect.poll(() => posted.some((m) => m.cancel === true)).toBe(true);
  await expect(
    page.getByTestId("team-queue").filter({ hasText: "@advisor 撤回消息" }),
  ).toHaveCount(0);
  await expect(
    page.getByTestId("team-queue").filter({ hasText: "@advisor 修改后" }),
  ).toBeVisible();
  await composer.fill("@advisor 改成立即发送");
  await composer.press("Enter");
  await page
    .getByTestId("team-queue")
    .filter({ hasText: "@advisor 改成立即发送" })
    .getByRole("button", { name: "立即发送", exact: true })
    .click();
  await expect
    .poll(() => posted.some((m) => m.mode === "immediate" && !m.client_id))
    .toBe(true);
  const steering = page
    .getByTestId("team-queue")
    .filter({ hasText: "@advisor 改成立即发送" });
  await expect(steering.getByText("发送中", { exact: true })).toBeVisible();
  await expect(steering.getByRole("button")).toHaveCount(0);
  await composer.fill("@advisor 插话");
  await composer.press("Control+Enter");
  await expect
    .poll(() =>
      posted.some(
        (m) =>
          m.mode === "immediate" && m.text === "@advisor 插话" && !!m.client_id,
      ),
    )
    .toBe(true);
  await page.goto(`/#team/${workspace}/${dm}`);
  composer = page
    .getByTestId("team-screen")
    .getByRole("textbox", { name: "消息", exact: true });
  await expect(
    page.getByRole("region", { name: "advisor", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Fake", exact: true }),
  ).toBeVisible();
  await composer.fill("私信消息");
  await composer.press("Enter");
  await expect
    .poll(() => posted.find((m) => m.text === "私信消息"))
    .toMatchObject({
      text: "私信消息",
      model_config_id: "model",
      mode: "queue",
    });
});

for (const theme of ["light", "dark"] as const) {
  test(`${theme}: team name, composer focus, actions and member status stay consistent`, async ({
    page,
  }) => {
    await page.addInitScript(
      (value) => localStorage.setItem("paper-appearance", value),
      theme,
    );
    const { messages, members } = await setup(page);
    members.find((m) => m.role === "advisor")!.status = "working";
    members.find((m) => m.role === "reviewer")!.status = "waiting";
    for (const role of ["advisor", "reviewer", "writer"]) {
      messages.push({
        id: `status-${role}`,
        channel_id: channel,
        thread_id: null,
        author_id: role,
        text: `来自 ${role}`,
        kind: "message",
        mentions: [],
        data: {},
        created_at: stamp,
        replies: 0,
      });
    }
    await page.reload();
    const screen = page.getByTestId("team-screen");
    const sidebar = page.getByRole("navigation", { name: "侧栏", exact: true });
    const switcher = sidebar.getByRole("button", {
      name: "切换团队",
      exact: true,
    });
    await expect(switcher).toHaveText("表示学习");
    for (const [role, status] of [
      ["advisor", "工作中"],
      ["reviewer", "等你"],
      ["writer", "空闲"],
    ]) {
      // The author avatar and its DM row must expose the same status and geometry.
      const avatar = screen
        .locator(`[data-message-id="status-${role}"]`)
        .getByRole("img", { name: status, exact: true });
      const marker = sidebar
        .getByRole("img", { name: status, exact: true })
        .first();
      await expect(avatar).toBeVisible();
      await expect(avatar).toHaveCSS(
        "width",
        await marker.evaluate((el) => getComputedStyle(el).width),
      );
      await expect(avatar).toHaveCSS(
        "height",
        await marker.evaluate((el) => getComputedStyle(el).height),
      );
      await expect(avatar).toHaveCSS(
        "background-color",
        await marker.evaluate((el) => getComputedStyle(el).backgroundColor),
      );
      if (role === "writer") {
        const neutral = await avatar.evaluate((el) => {
          const style = document.createElement("span").style;
          style.color = getComputedStyle(el).getPropertyValue("--ui-fg-3");
          return style.color;
        });
        await expect(avatar).toHaveCSS("background-color", neutral);
      }
    }
    const header = screen.locator("header").first();
    await expect(
      header.getByRole("button", { name: "新研究", exact: true }),
    ).toHaveCount(0);
    await header.getByRole("button", { name: "更多操作", exact: true }).click();
    await expect(
      page.getByRole("menuitem", { name: "新研究", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    const input = screen.getByRole("textbox", { name: "消息", exact: true });
    await input.focus();
    await expect(input).toHaveCSS("border-top-width", "0px");
    await expect(input).toHaveCSS("box-shadow", "none");
    expect(
      await input
        .locator("..")
        .evaluate((el) => getComputedStyle(el).boxShadow),
    ).not.toBe("none");
    await page.setViewportSize({ width: 720, height: 900 });
    await input.focus();
    await expect(input).toBeInViewport();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await sidebar
      .getByRole("button", { name: "展开侧栏", exact: true })
      .click();
    await switcher.click();
    const picker = page.getByRole("dialog", { name: "选择项目", exact: true });
    await picker.getByRole("option", { name: /图学习/ }).click();
    await expect(page).toHaveURL(new RegExp(`#team/${otherWorkspace}$`));
    await sidebar
      .getByRole("button", { name: "展开侧栏", exact: true })
      .click();
    await expect(switcher).toHaveText("图学习");
  });
}

test("DM empty state identifies its member", async ({ page }) => {
  await setup(page);
  await page.goto(`/#team/${workspace}/${dm}`);
  const empty = page.getByTestId("team-empty");
  // The avatar uses initials; the separate label keeps the full file-defined name.
  await expect(empty.locator("[data-color]")).toHaveText("AD");
  await expect(empty.locator("[data-color]")).toHaveAttribute(
    "aria-hidden",
    "true",
  );
  await expect(empty.getByText("advisor", { exact: true })).toBeVisible();
  await expect(empty.locator("svg")).toHaveCount(0);
});

test("one author, preserved draft, one timeout and Continue on the agent message", async ({
  page,
}) => {
  const { messages } = await setup(page);
  messages.push({
    id: "limited",
    channel_id: channel,
    thread_id: null,
    author_id: "writer",
    text: "已写好的引言",
    kind: "text",
    mentions: [],
    created_at: stamp,
    replies: 0,
    data: { files: [{ path: "drafts/intro.md", name: "intro.md" }] },
    run: {
      id: "run-limited",
      status: "failed",
      response: "已写好的引言",
      error: "timeout",
      steps: [],
      runtime: { time_limit_reached: true, max_execution_seconds: 1200 },
      created_at: stamp,
      updated_at: stamp,
    },
  });
  await page.route("**/team/file?**", (route) =>
    route.fulfill({
      json: { kind: "markdown", content: "# 引言\n\n已保存的正文" },
    }),
  );
  await page.route("**/team/deliveries", (route) =>
    route.fulfill({
      json: [
        {
          id: "agent-failure",
          channel_id: channel,
          thread_id: null,
          editable: false,
          status: "failed",
          error: "timeout",
          text: "",
          mode: "queue",
        },
      ],
    }),
  );
  let continued = 0;
  await page.route("**/team/messages/limited/continue", (route) => {
    continued++;
    return route.fulfill({ json: {} });
  });
  await page.reload();
  const row = page.locator('[data-message-id="limited"]');
  await expect(row.getByText("writer", { exact: true })).toHaveCount(1);
  await expect(row.locator("[data-color]")).toHaveCount(1);
  await expect(row.getByText("已写好的引言", { exact: true })).toBeVisible();
  await expect(
    row.getByText("已到时间上限，已保存内容", { exact: true }),
  ).toHaveCount(1);
  await expect(page.getByTestId("team-queue")).toHaveCount(0);
  await row.getByRole("button", { name: "intro.md", exact: true }).click();
  const preview = page.getByRole("complementary", {
    name: "drafts/intro.md",
    exact: true,
  });
  await expect(
    preview.getByText("已保存的正文", { exact: true }),
  ).toBeVisible();
  await preview.getByRole("button", { name: "关闭", exact: true }).click();
  await row.getByRole("button", { name: "继续", exact: true }).click();
  await expect.poll(() => continued).toBe(1);
});

test("thread results stay with their request and link to cross-channel posts", async ({
  page,
}) => {
  const { messages } = await setup(page);
  messages.push(
    {
      id: "request",
      channel_id: channel,
      thread_id: null,
      author_id: "human",
      text: "找论文再写引言",
      kind: "text",
      mentions: [],
      created_at: stamp,
      replies: 1,
      data: {},
    },
    {
      id: "reply",
      channel_id: channel,
      thread_id: "request",
      author_id: "librarian",
      text: "找到了三篇论文",
      kind: "text",
      mentions: [],
      created_at: stamp,
      replies: 0,
      data: {
        links: [{ channel_id: channel, thread_id: "draft", name: "写作" }],
      },
    },
  );
  await page.goto(`/#team/${workspace}/${channel}?thread=request`);
  const thread = page.getByRole("region", { name: "线程", exact: true });
  await expect(
    thread.getByText("找到了三篇论文", { exact: true }),
  ).toBeVisible();
  await expect(
    thread.getByRole("link", { name: "结果见 #写作", exact: true }),
  ).toHaveAttribute("href", `#team/${workspace}/${channel}?thread=draft`);
});

test("queued replies become working turns and settle in completion order", async ({
  page,
}) => {
  const { messages } = await setup(page);
  const started = "2026-10-23T15:27:00Z";
  const finished = "2026-10-23T15:44:00Z";
  const request: TeamMessage = {
    id: "timed-request",
    channel_id: channel,
    thread_id: null,
    author_id: "human",
    text: "查找论文",
    kind: "text",
    mentions: [],
    data: {},
    replies: 2,
    created_at: stamp,
  };
  const reply: TeamMessage = {
    ...request,
    id: "timed-reply",
    author_id: "librarian",
    thread_id: request.id,
    text: "",
    replies: 0,
    created_at: started,
    run: {
      id: "timed-run",
      status: "queued",
      response: "",
      error: "",
      steps: [],
      runtime: {},
      created_at: started,
      updated_at: started,
    },
  };
  messages.push(request, reply, {
    ...request,
    id: "intervening-update",
    thread_id: request.id,
    text: "补充要求",
    replies: 0,
    created_at: "2026-10-23T15:35:00Z",
  });
  await page.goto(`/#team/${workspace}/${channel}?thread=${request.id}`);
  const thread = page.getByRole("region", { name: "线程", exact: true });
  const row = thread.locator('[data-message-id="timed-reply"]');
  const rows = thread.locator("[data-message-id]");
  const order = () =>
    rows.evaluateAll((els) =>
      els.map((el) => el.getAttribute("data-message-id")),
    );
  await expect(row.getByRole("status")).toHaveText("排队中");
  await expect(row.locator("[data-color]")).toHaveCount(1);
  await expect(row.getByText("librarian", { exact: true })).toHaveCount(1);
  await expect(row.locator("time, section")).toHaveCount(0);
  await expect(row.getByText("等着开始…", { exact: true })).toHaveCount(0);
  await expect(
    row.getByRole("button", { name: "回复", exact: true }),
  ).toHaveCount(0);
  await row.hover();
  await expect(
    row.getByRole("button", { name: "停止", exact: true }),
  ).toBeVisible();
  await expect
    .poll(order)
    .toEqual([request.id, reply.id, "intervening-update"]);

  reply.run!.status = "running";
  reply.run!.updated_at = "2026-10-23T15:36:00Z";
  await page.evaluate(() =>
    window.dispatchEvent(new Event("research-team-updated")),
  );
  await expect(row.locator('[data-live="true"]')).toBeVisible();
  await expect(row.locator("time")).toHaveAttribute("datetime", started);
  await expect(row.getByText("排队中", { exact: true })).toHaveCount(0);
  await expect
    .poll(order)
    .toEqual([request.id, reply.id, "intervening-update"]);

  reply.created_at = finished;
  reply.text = reply.run!.response = "找到三篇论文";
  reply.run!.status = "completed";
  reply.run!.updated_at = finished;
  await page.evaluate(() =>
    window.dispatchEvent(new Event("research-team-updated")),
  );
  await expect(row.getByText("找到三篇论文", { exact: true })).toBeVisible();
  await expect(row.locator("time")).toHaveAttribute("datetime", finished);
  const displayed = await page.evaluate(
    (value) =>
      new Date(value).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
    finished,
  );
  await expect(row.locator("time")).toHaveText(displayed);
  await expect(
    row.getByRole("button", { name: "停止", exact: true }),
  ).toHaveCount(0);
  await expect
    .poll(order)
    .toEqual([request.id, "intervening-update", reply.id]);
});

test("stopping a queued member leaves a stopped reply and failures keep their output", async ({
  page,
}) => {
  const { messages } = await setup(page);
  const reply: TeamMessage = {
    id: "stopped-reply",
    channel_id: channel,
    thread_id: null,
    author_id: "librarian",
    text: "",
    kind: "text",
    mentions: [],
    data: {},
    replies: 0,
    created_at: stamp,
    run: {
      id: "stopped-run",
      status: "queued",
      response: "",
      error: "",
      steps: [],
      runtime: {},
      created_at: stamp,
      updated_at: stamp,
    },
  };
  messages.push(reply, {
    ...reply,
    id: "failed-reply",
    text: "已保存的草稿",
    run: {
      ...reply.run!,
      id: "failed-run",
      status: "failed",
      error: "测试错误",
    },
  });
  let cancelled = 0;
  await page.route("**/api/v1/agent/runs/stopped-run/cancel", (route) => {
    expect(route.request().method()).toBe("POST");
    reply.run!.status = "cancelled";
    cancelled++;
    return route.fulfill({ json: reply.run });
  });
  await page.reload();
  const row = page.locator('[data-message-id="stopped-reply"]');
  await expect(row.getByRole("status")).toHaveText("排队中");
  await row.hover();
  await row.getByRole("button", { name: "停止", exact: true }).click();
  await expect.poll(() => cancelled).toBe(1);
  await expect(row.getByText("已停止", { exact: true })).toHaveCount(1);
  await expect(row.getByText("排队中", { exact: true })).toHaveCount(0);
  await expect(
    row.getByRole("button", { name: "停止", exact: true }),
  ).toHaveCount(0);
  const failed = page.locator('[data-message-id="failed-reply"]');
  await expect(failed.getByText("已保存的草稿", { exact: true })).toBeVisible();
  await expect(failed.getByText("测试错误", { exact: true })).toBeVisible();
  await expect(
    failed.getByRole("button", { name: "停止", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByTestId("team-queue")).toHaveCount(0);
});

for (const [locale, waiting] of [
  ["zh", "等你"],
  ["en", "Waiting for you"],
] as const) {
  test(`system wait messages use only ${locale}`, async ({ page }) => {
    await page.addInitScript(
      (value) => localStorage.setItem("paper-locale", value),
      locale,
    );
    const { messages } = await setup(page);
    messages.push({
      id: "owner-wait",
      channel_id: channel,
      thread_id: null,
      author_id: null,
      text: "等你 / Waiting for you",
      kind: "relay_limit",
      mentions: [],
      data: { waiting: true },
      created_at: stamp,
      replies: 0,
    });
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute(
      "lang",
      locale === "zh" ? "zh-CN" : "en",
    );
    const message = page.locator('[data-message-id="owner-wait"]');
    await expect(message.getByText(waiting, { exact: true })).toHaveCount(1);
    await expect(
      message.getByText(locale === "zh" ? "Waiting for you" : "等你", {
        exact: true,
      }),
    ).toHaveCount(0);
  });
}
