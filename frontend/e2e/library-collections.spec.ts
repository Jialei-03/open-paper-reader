import { test, expect, Page } from "@playwright/test";

async function write(page: Page, path: string, data: unknown) {
  const csrf = (await page.context().cookies()).find(
    (c) => c.name === "paper_csrf",
  )!.value;
  const response = await page.request.post("/api/v1" + path, {
    data,
    headers: { "X-CSRF-Token": csrf, "Idempotency-Key": crypto.randomUUID() },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}

test("Library collections: explicit folders, selection membership, filter, persistence and non-destructive removal", async ({
  page,
}) => {
  await page.goto("/#dashboard");
  await page.getByLabel("用户名", { exact: true }).fill("alice");
  await page
    .getByLabel("密码", { exact: true })
    .fill(process.env.E2E_TEST_PASSWORD!);
  await page.getByRole("button", { name: "登录空间", exact: true }).click();
  await expect(page.getByRole("heading", { name: "最近" })).toBeVisible();
  const suffix = Date.now().toString();
  const first = await write(page, "/papers", {
    title: `Collection A ${suffix}`,
  });
  const second = await write(page, "/papers", {
    title: `Collection B ${suffix}`,
  });
  await page.goto("/#library");
  await page.getByRole("button", { name: "批量管理", exact: true }).click();
  await page
    .getByRole("checkbox", { name: "选择论文：" + first.title, exact: true })
    .check();
  await page.getByRole("button", { name: "新建集合", exact: true }).click();
  await page.getByLabel("集合名称", { exact: true }).fill("Reading " + suffix);
  await page.getByRole("button", { name: "保存集合", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: first.title, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: second.title, exact: true }),
  ).toHaveCount(0);
  await page.getByRole("combobox", { name: "集合筛选", exact: true }).click();
  await page.getByRole("option", { name: "全部集合", exact: true }).click();
  await page
    .getByRole("checkbox", { name: "选择论文：" + second.title, exact: true })
    .check();
  await page.getByRole("button", { name: "加入集合", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "Reading " + suffix, exact: true })
    .click();
  await page.reload();
  await page.getByRole("combobox", { name: "集合筛选", exact: true }).click();
  await page
    .getByRole("option", { name: `Reading ${suffix} · 2`, exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: first.title, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: second.title, exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "管理当前集合", exact: true }).click();
  await page.getByRole("menuitem", { name: "重命名集合", exact: true }).click();
  await page.getByLabel("集合名称", { exact: true }).fill("Renamed " + suffix);
  await page.getByRole("button", { name: "保存集合", exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "集合筛选", exact: true }),
  ).toContainText("Renamed " + suffix);
  await page.getByRole("button", { name: "批量管理", exact: true }).click();
  await page
    .getByRole("checkbox", { name: "选择论文：" + first.title, exact: true })
    .check();
  await page.getByRole("button", { name: "管理当前集合", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "将所选论文移出集合", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: first.title, exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: second.title, exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "../test-results/library-collections.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "管理当前集合", exact: true }).click();
  await page.getByRole("menuitem", { name: "删除集合", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "删除集合", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: second.title, exact: true }),
  ).toBeVisible();
  expect(
    (await page.request.get(`/api/v1/papers/${first.id}`)).ok(),
  ).toBeTruthy();
});
