import { test, expect } from "@playwright/test";
test("Library batch: explicit selection, tagging, archive and reversible restore", async ({
  page,
}) => {
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
  const ids: string[] = [];
  for (const title of ["Batch Alpha", "Batch Beta"]) {
    const response = await page.request.post("/api/v1/papers", {
      headers: { "X-CSRF-Token": csrf, "Idempotency-Key": crypto.randomUUID() },
      data: { title, tags: ["batch-fixture"] },
    });
    expect(response.ok()).toBeTruthy();
    ids.push((await response.json()).id);
  }
  await page.goto("/#library?tag=batch-fixture");
  await expect(
    page.getByRole("table", { name: "论文列表" }).getByRole("row"),
  ).toHaveCount(3);
  await page.getByRole("button", { name: "批量管理", exact: true }).click();
  await page.getByRole("checkbox", { name: "选择当前页论文" }).check();
  const toolbar = page.getByRole("toolbar", { name: "批量管理论文" });
  await expect(toolbar.getByRole("status")).toHaveText("已选 2 篇");
  await toolbar.getByRole("button", { name: "比较论文", exact: true }).click();
  const assistant = page.getByRole("dialog", { name: "研究助手" });
  await expect(assistant.getByLabel("给 Agent 的消息")).toHaveValue(
    /Batch Alpha/,
  );
  await expect(assistant.getByLabel("给 Agent 的消息")).toHaveValue(
    /不要自动创建笔记/,
  );
  await expect(assistant.getByLabel("给 Agent 的消息")).toHaveValue(
    /Batch Beta/,
  );
  await assistant
    .getByRole("button", { name: "收起研究助手", exact: true })
    .click();
  await toolbar.getByRole("button", { name: "添加标签", exact: true }).click();
  await page.getByLabel("标签", { exact: true }).fill("批量研究");
  await page.getByRole("button", { name: "应用到所选论文" }).click();
  await expect(toolbar).toHaveCount(0);
  for (const id of ids)
    expect(
      (await (await page.request.get(`/api/v1/papers/${id}`)).json()).tags,
    ).toContain("批量研究");
  await page.getByRole("checkbox", { name: "选择当前页论文" }).check();
  await toolbar.getByRole("button", { name: "归档", exact: true }).click();
  await expect(page.getByText("没有匹配的论文", { exact: true })).toBeVisible();
  await page.goto("/#library?tag=batch-fixture&archived=true");
  await expect(page.getByRole("table").getByRole("row")).toHaveCount(3);
  await page.getByRole("checkbox", { name: "选择当前页论文" }).check();
  await toolbar.getByRole("button", { name: "移出归档", exact: true }).click();
  await expect(page.getByText("没有匹配的论文", { exact: true })).toBeVisible();
  for (const id of ids)
    expect(
      (await (await page.request.get(`/api/v1/papers/${id}`)).json()).archived,
    ).toBe(false);
});
