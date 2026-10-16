import { test, expect } from "@playwright/test";

test("Live notes: rendered Markdown, direct edits, autosave, conflict and draft recovery", async ({
  page,
}) => {
  await page.goto("/#dashboard");
  await page.getByLabel("用户名", { exact: true }).fill("alice");
  await page
    .getByLabel("密码", { exact: true })
    .fill(process.env.E2E_TEST_PASSWORD!);
  await page.getByRole("button", { name: "登录空间", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "打开研究助手" }),
  ).toBeVisible();
  const csrf = (await page.context().cookies()).find(
    (c) => c.name === "paper_csrf",
  )!.value;
  const write = async (
    path: string,
    data: unknown,
    method = "POST",
    revision?: number,
  ) => {
    const r = await page.request.fetch("/api/v1" + path, {
      method,
      data,
      headers: {
        "X-CSRF-Token": csrf,
        "Idempotency-Key": crypto.randomUUID(),
        ...(revision ? { "If-Match": String(revision) } : {}),
      },
    });
    expect(r.ok(), await r.text()).toBeTruthy();
    return r.json();
  };
  const p = await write("/papers", { title: "Live Markdown QA" });
  let note = (
    await (await page.request.get("/api/v1/items?paper_id=" + p.id)).json()
  )[0];
  const body = `## 阅读结论\n\n这是一段 **重要结论**。\n\n- [ ] 核对实验\n\n| 方法 | 结果 |\n| --- | --- |\n| 基线 | 42 |\n\n[论文原文](#paper/${p.id})\n\n\`\`\`python\nprint("hello")\n\`\`\``;
  const payload = (n: typeof note, body: string) => ({
    kind: "note",
    paper_id: p.id,
    title: n.title,
    body,
    status: "open",
    tags: [],
    paper_ids: [],
    evidence_ids: [],
    locator: null,
  });
  note = await write(
    "/items/" + note.id,
    payload(note, body),
    "PUT",
    note.revision,
  );
  await page.goto("/#paper/" + p.id);
  const editor = page.getByRole("textbox", { name: "笔记正文" });
  await expect(editor.getByRole("heading", { name: "阅读结论" })).toBeVisible();
  await expect(editor.locator("strong")).toHaveText("重要结论");
  await expect(editor.locator("table")).toContainText("42");
  await expect(
    page.getByRole("button", { name: "编辑笔记", exact: true }),
  ).toHaveCount(0);
  expect(
    (await (await page.request.get("/api/v1/items/" + note.id)).json())
      .revision,
  ).toBe(note.revision);
  await editor.locator("p").first().click();
  await page.keyboard.press("End");
  await page.keyboard.insertText(" 自动保存的新内容。");
  await expect(
    page.getByRole("status").filter({ hasText: "已保存" }),
  ).toBeVisible();
  await expect
    .poll(
      async () =>
        (await (await page.request.get("/api/v1/items/" + note.id)).json())
          .body,
    )
    .toContain("自动保存的新内容");
  const saved = await (
    await page.request.get("/api/v1/items/" + note.id)
  ).json();
  expect(saved.body).toContain("**重要结论**");
  expect(saved.body).toContain("- [ ]");
  expect(saved.body).toContain("| 基线");
  expect(saved.body).toContain(`#paper/${p.id}`);
  expect(saved.body).toContain('print("hello")');
  await page.reload();
  await expect(editor).toContainText("自动保存的新内容");
  await editor.getByRole("checkbox").check();
  await expect
    .poll(
      async () =>
        (await (await page.request.get("/api/v1/items/" + note.id)).json())
          .body,
    )
    .toContain("- [x]");
  await page.screenshot({
    path: "../test-results/live-markdown-note.png",
    animations: "disabled",
  });
  // Concurrent server edit must not be overwritten by this stale editor.
  const latest = await (
    await page.request.get("/api/v1/items/" + note.id)
  ).json();
  await write(
    "/items/" + note.id,
    payload(latest, latest.body + "\n\nAgent 服务端更新"),
    "PUT",
    latest.revision,
  );
  await editor.locator("p").first().click();
  await page.keyboard.press("End");
  await page.keyboard.insertText(" 本地未保存草稿");
  await expect(page.getByText(/笔记已有新版本/)).toBeVisible();
  expect(
    (await (await page.request.get("/api/v1/items/" + note.id)).json()).body,
  ).not.toContain("本地未保存草稿");
  await page.getByRole("button", { name: "我的文库", exact: true }).click();
  await page.goto("/#paper/" + p.id);
  await expect(editor).toContainText("本地未保存草稿");
  await page.goto("/#item/" + note.id);
  await page.reload();
  await page.getByRole("button", { name: "对比与合并", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "合并笔记修改" });
  await expect(
    dialog.getByRole("textbox", { name: "编辑起点", exact: true }),
  ).not.toHaveValue(/Agent 服务端更新/);
  await expect(
    dialog.getByRole("textbox", { name: "本地草稿", exact: true }),
  ).toHaveValue(/本地未保存草稿/);
  await expect(
    dialog.getByRole("textbox", { name: "服务器最新版", exact: true }),
  ).toHaveValue(/Agent 服务端更新/);
  const result = dialog.getByLabel("合并结果（Markdown）", { exact: true });
  await result.fill("保留本地未保存草稿\n\nAgent 服务端更新");
  await page.screenshot({
    path: "../test-results/note-conflict-desktop.png",
    animations: "disabled",
  });
  // A third edit during review must still win the revision race.
  const remote = await (
    await page.request.get("/api/v1/items/" + note.id)
  ).json();
  await write(
    "/items/" + note.id,
    payload(remote, remote.body + "\n\nAgent 第二次更新"),
    "PUT",
    remote.revision,
  );
  await dialog
    .getByRole("button", { name: "保存合并结果", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText("新版本");
  expect(
    (await (await page.request.get("/api/v1/items/" + note.id)).json()).body,
  ).toContain("Agent 第二次更新");
  await dialog
    .getByRole("button", { name: "重新读取版本", exact: true })
    .click();
  await expect(
    dialog.getByRole("textbox", { name: "服务器最新版", exact: true }),
  ).toHaveValue(/Agent 第二次更新/);
  await expect(result).toHaveValue(/保留本地未保存草稿/);
  await result.fill(
    "保留本地未保存草稿\n\nAgent 服务端更新\n\nAgent 第二次更新",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await result.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "../test-results/note-conflict-mobile.png",
    animations: "disabled",
  });
  await dialog
    .getByRole("button", { name: "保存合并结果", exact: true })
    .click();
  await expect(dialog).toBeHidden();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(editor).toContainText("保留本地未保存草稿");
  await expect(editor).toContainText("Agent 第二次更新");
  await page.reload();
  await expect(editor).toContainText("保留本地未保存草稿");
  // Standalone note route uses the same live editor.
  await page.goto("/#item/" + note.id);
  await expect(editor).toContainText("Agent 服务端更新");
  await editor.focus();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.press("Enter");
  await editor.pressSequentially("## 即时标题");
  await expect(editor.getByRole("heading", { name: "即时标题" })).toBeVisible();
  await expect
    .poll(
      async () =>
        (await (await page.request.get("/api/v1/items/" + note.id)).json())
          .body,
    )
    .toContain("即时标题");
  const beforeCopy = await (
    await page.request.get("/api/v1/items/" + note.id)
  ).json();
  const serverCopy = await write(
    "/items/" + note.id,
    payload(beforeCopy, beforeCopy.body + "\n\n保留原笔记"),
    "PUT",
    beforeCopy.revision,
  );
  await page.getByLabel("笔记标题", { exact: true }).fill("另存副本测试");
  await expect(page.getByText(/笔记已有新版本/)).toBeVisible();
  await page.getByRole("button", { name: "对比与合并", exact: true }).click();
  await expect(dialog.getByLabel("保存标题")).toHaveValue("另存副本测试");
  let drop = true;
  await page.route("**/api/v1/items", async (route) => {
    if (route.request().method() !== "POST" || !drop) return route.continue();
    drop = false;
    await route.fetch(); // Commit succeeds but the reply is lost.
    await route.abort("failed");
  });
  await dialog
    .getByRole("button", { name: "另存为新笔记", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await dialog
    .getByRole("button", { name: "另存为新笔记", exact: true })
    .click();
  await expect(dialog).toBeHidden();
  await expect(page.getByLabel("笔记标题", { exact: true })).toHaveValue(
    "另存副本测试（副本）",
  );
  const copies = await (
    await page.request.get("/api/v1/items?paper_id=" + p.id)
  ).json();
  expect(
    copies.filter((n: { title: string }) => n.title === "另存副本测试（副本）"),
  ).toHaveLength(1);
  expect(
    (await (await page.request.get("/api/v1/items/" + note.id)).json()).body,
  ).toBe(serverCopy.body);
});

test("Note images: upload, paste, drop, autosave and reload", async ({
  page,
}) => {
  await page.goto("/#dashboard");
  await page.getByLabel("用户名", { exact: true }).fill("alice");
  await page
    .getByLabel("密码", { exact: true })
    .fill(process.env.E2E_TEST_PASSWORD!);
  await page.getByRole("button", { name: "登录空间", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "打开研究助手" }),
  ).toBeVisible();
  const csrf = (await page.context().cookies()).find(
    (c) => c.name === "paper_csrf",
  )!.value;
  const response = await page.request.post("/api/v1/items", {
    headers: { "X-CSRF-Token": csrf, "Idempotency-Key": crypto.randomUUID() },
    data: {
      kind: "note",
      title: "图文笔记验收",
      body: "## 实验结果\n\n在这里插入图片。",
    },
  });
  expect(response.ok()).toBeTruthy();
  const note = await response.json();
  await page.goto("/#item/" + note.id);
  const editor = page.getByRole("textbox", { name: "笔记正文" });
  await expect(editor).toBeVisible();
  const png = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 480;
    canvas.height = 240;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ecfdf5";
    ctx.fillRect(0, 0, 480, 240);
    ctx.fillStyle = "#047857";
    ctx.font = "28px sans-serif";
    ctx.fillText("Experiment A · 42%", 45, 110);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await editor.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.getByLabel("上传笔记图片", { exact: true }).setInputFiles({
    name: "experiment.png",
    mimeType: "image/png",
    buffer: Buffer.from(png, "base64"),
  });
  await expect(editor.locator("img")).toHaveCount(1);
  await expect
    .poll(() =>
      editor
        .locator("img")
        .evaluate((img: HTMLImageElement) => img.naturalWidth),
    )
    .toBe(480);
  await editor.evaluate((el, png) => {
    const data = new DataTransfer();
    data.items.add(
      new File(
        [Uint8Array.from(atob(png), (c) => c.charCodeAt(0))],
        "clipboard.png",
        { type: "image/png" },
      ),
    );
    el.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, png);
  await expect(editor.locator("img")).toHaveCount(2);
  await expect(page.getByText("正在上传图片…", { exact: true })).toHaveCount(0);
  await editor.evaluate((el, png) => {
    const data = new DataTransfer();
    data.items.add(
      new File(
        [Uint8Array.from(atob(png), (c) => c.charCodeAt(0))],
        "drop.png",
        { type: "image/png" },
      ),
    );
    const rect = el.getBoundingClientRect();
    el.dispatchEvent(
      new DragEvent("drop", {
        dataTransfer: data,
        clientX: rect.x + 20,
        clientY: rect.y + 20,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, png);
  await expect(editor.locator("img")).toHaveCount(3);
  await expect
    .poll(async () => {
      const saved = await (
        await page.request.get("/api/v1/items/" + note.id)
      ).json();
      return (saved.body.match(/\/api\/v1\/note-images\//g) || []).length;
    })
    .toBe(3);
  await page.reload();
  await expect(editor.locator("img")).toHaveCount(3);
  await expect
    .poll(() =>
      editor
        .locator("img")
        .first()
        .evaluate((img: HTMLImageElement) => img.naturalWidth),
    )
    .toBe(480);
  await page.screenshot({
    path: "../test-results/note-images.png",
    fullPage: true,
  });
  // A selected image can be deleted with normal editing controls and undone.
  await editor.locator("img").last().click();
  await page.keyboard.press("Backspace");
  await expect(editor.locator("img")).toHaveCount(2);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(editor.locator("img")).toHaveCount(3);
});
