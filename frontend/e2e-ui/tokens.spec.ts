import { expect, test } from "@playwright/test";
import { contrastOfTokens, openKit } from "./helpers";

for (const theme of ["light", "dark"] as const) {
  test(`text tokens meet WCAG AA in ${theme}`, async ({ page }) => {
    await openKit(page, { theme });
    const pairs: [string, string[]][] = [
      ["--ui-fg", ["--ui-bg", "--ui-bg-1", "--ui-bg-2", "--ui-elev"]],
      ["--ui-fg-1", ["--ui-bg", "--ui-bg-1", "--ui-bg-2", "--ui-elev"]],
      ["--ui-fg-2", ["--ui-bg", "--ui-bg-1", "--ui-bg-2", "--ui-elev"]],
      ["--ui-fg-3", ["--ui-bg", "--ui-bg-1", "--ui-elev"]],
      ["--ui-accent-text", ["--ui-bg", "--ui-bg-1", "--ui-elev"]],
      ["--ui-danger-text", ["--ui-bg", "--ui-elev"]],
      ["--ui-success-text", ["--ui-bg", "--ui-elev"]],
      ["--ui-warning-text", ["--ui-bg", "--ui-elev"]],
      ["--ui-primary-fg", ["--ui-primary"]],
    ];
    for (const [fg, bgs] of pairs)
      for (const bg of bgs)
        expect(
          await contrastOfTokens(page, fg, bg),
          `${fg} on ${bg}`,
        ).toBeGreaterThanOrEqual(4.5);
    // Orange text on the orange tint (the context label).
    expect(
      await contrastOfTokens(
        page,
        "--ui-accent-text",
        "--ui-accent-soft",
        "--ui-bg",
      ),
    ).toBeGreaterThanOrEqual(4.5);
  });
}
test("system appearance follows the OS live", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/ui-kit.html");
  await page.evaluate(() => localStorage.setItem("paper-appearance", "system"));
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("html")).toHaveClass(/\bdark\b/);
});
test("reduced motion zeroes the duration tokens", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openKit(page);
  const dur = await page.evaluate(() =>
    getComputedStyle(document.documentElement)
      .getPropertyValue("--ui-dur-2")
      .trim(),
  );
  expect(dur).toBe("0.01ms");
});
