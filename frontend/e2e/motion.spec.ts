import { test, expect } from "@playwright/test";

test("Reading motion: open/exit, quick reopen, drag and reduced motion", async ({
  page,
}) => {
  await page.goto("/#dashboard");
  await page.getByLabel("用户名", { exact: true }).fill("alice");
  await page
    .getByLabel("密码", { exact: true })
    .fill(process.env.E2E_TEST_PASSWORD!);
  await page.getByRole("button", { name: "登录空间", exact: true }).click();
  const launch = page.getByRole("button", { name: "打开研究助手" });
  await launch.click();
  await page.getByRole("button", { name: "切换为悬浮窗", exact: true }).click();
  const panel = page.locator(".agent-floating-window");
  const frames = await panel.evaluate((el) => {
    const a = el
      .getAnimations()
      .find(
        (a) => a instanceof CSSAnimation && a.animationName === "assistant-in",
      )!;
    if (!a) throw new Error("Missing assistant entrance");
    a.pause();
    const values = [0, 100, 200].map((t) => {
      a.currentTime = t;
      return Number(getComputedStyle(el).opacity);
    });
    a.currentTime = 100;
    return values;
  });
  expect(frames[0]).toBe(0);
  expect(frames[1]).toBeGreaterThan(0);
  expect(frames[1]).toBeLessThan(1);
  expect(frames[2]).toBe(1);
  await page.screenshot({
    path: "../test-results/reading-motion-midframe.png",
  });
  await panel.evaluate((el) => el.getAnimations().forEach((a) => a.finish()));
  await page.getByRole("button", { name: "对话设置" }).click();
  const menu = page.getByRole("menu");
  await expect(menu).toHaveCSS("animation-name", "surface-in");
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(page.getByRole("button", { name: "对话设置" })).toBeFocused();
  const before = await panel.boundingBox();
  const title = page.getByLabel("移动研究助手窗口");
  await title.press("ArrowLeft");
  expect((await panel.boundingBox())!.x).toBeCloseTo(before!.x - 10, 0);
  await page.getByRole("button", { name: "收起研究助手" }).click();
  await expect(launch).toBeFocused();
  // Reopen while exit may still be running; Radix Presence must not leave ghosts.
  await launch.click();
  await expect(panel).toHaveCount(1);
  await expect(panel).toHaveAttribute("data-state", "open");
  await expect(panel).not.toHaveAttribute("inert");
  await page.getByRole("button", { name: "收起研究助手" }).click();
  await expect(panel).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await launch.click();
  await expect(panel).toHaveCSS("animation-name", "none");
  await page.getByRole("button", { name: "对话设置" }).click();
  await expect(menu).toHaveCSS("animation-name", "none");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "收起研究助手" }).click();
  await expect(panel).toHaveCount(0);
});
