import { test, expect } from "@playwright/test";
import { who } from "./reader/fixtures";

test("The public site and the sign-in page load without the workspace", async ({
  page,
}) => {
  const scripts = new Map<string, number>();
  page.on("response", async (response) => {
    const path = new URL(response.url()).pathname;
    if (/\.m?js$/.test(path))
      scripts.set(
        path,
        (await response.body().catch(() => Buffer.alloc(0))).length,
      );
  });
  const loaded = () => [...scripts.keys()];
  const bytes = () =>
    [...scripts.values()].reduce((sum, size) => sum + size, 0);

  await page.goto("/#home");
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  expect(loaded().some((path) => /AppShell/.test(path))).toBe(false);

  await page.goto("/#dashboard");
  await expect(page.getByLabel("用户名", { exact: true })).toBeVisible();
  // Nothing of the reader, editor or graph is needed to sign in, so the whole
  // script budget of the front door stays small (it was 2.3 MB in one file).
  expect(loaded().some((path) => /AppShell|pdf-|PaperSharing/.test(path))).toBe(
    false,
  );
  expect(bytes()).toBeLessThan(500_000);

  // Signing in is what brings the workspace.
  await page.getByLabel("用户名", { exact: true }).fill(who("alice"));
  await page
    .getByLabel("密码", { exact: true })
    .fill(process.env.E2E_TEST_PASSWORD!);
  await page.getByRole("button", { name: "登录空间", exact: true }).click();
  await expect(page.locator("[data-app-screen]")).toBeVisible();
  expect(loaded().some((path) => /AppShell/.test(path))).toBe(true);
});

test("A tab from before an update reloads once, then says so instead of going blank", async ({
  page,
}) => {
  let attempts = 0;
  await page.route(/\/assets\/AppShell-[^/]+\.js$/, (route) => {
    attempts++;
    return route.abort();
  });
  await page.goto("/#dashboard");
  await page.getByLabel("用户名", { exact: true }).fill(who("alice"));
  await page
    .getByLabel("密码", { exact: true })
    .fill(process.env.E2E_TEST_PASSWORD!);
  await page.getByRole("button", { name: "登录空间", exact: true }).click();
  // The module file is gone: one automatic reload, and if that fails too the
  // reader is told what to do rather than left with an empty page.
  await expect(page.getByText("页面已更新，请刷新后继续")).toBeVisible();
  expect(attempts).toBeGreaterThanOrEqual(2);
});
