import { expect, test, type Page } from "@playwright/test";
import { createPaperWithPdf, openReader, signIn } from "./fixtures";

test.use({ locale: "zh-CN" });

/**
 * Dragging either handle across a 15-page paper must not block the page: no
 * task over 100ms on the way. (Generous on purpose: other test workers share
 * the machine, and a stutter that bad is what a reader would notice.)
 */
for (const [name, label, dx] of [
  ["sidebar", "调整侧栏宽度", 140],
  ["panel", "调整右侧面板宽度", -180],
] as const) {
  for (const slow of [1]) {
    test(`dragging the ${name} handle makes no long task (CPU ${slow}x)`, async ({
      page,
    }) => {
      await signIn(page);
      const paper = await createPaperWithPdf(page, { pages: 15 });
      await page.setViewportSize({ width: 1300, height: 900 });
      await openReader(page, { paperId: paper.paperId, page: 4 });
      await expect(page.locator('[data-page="4"]')).toHaveAttribute(
        "data-rendered",
        "true",
      );
      const client = await page.context().newCDPSession(page);
      await client.send("Emulation.setCPUThrottlingRate", { rate: slow });
      await installObserver(page);
      // The observer sees a task that is long (otherwise "none" would prove nothing).
      await page.evaluate(() => {
        setTimeout(() => {
          const end = performance.now() + 120;
          while (performance.now() < end);
        }, 0);
      });
      await page.waitForTimeout(200);
      expect((await longTasks(page)).length).toBeGreaterThan(0);
      await page.evaluate(() => {
        (window as unknown as { __long: number[] }).__long.length = 0;
      });
      const handle = page.getByRole("separator", { name: label });
      const box = (await handle.boundingBox())!;
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      // Out and back, a frame at a time.
      for (let i = 1; i <= 30; i++) {
        await page.mouse.move(x + (dx * i) / 30, y);
        await page.waitForTimeout(16);
      }
      for (let i = 29; i >= 0; i--) {
        await page.mouse.move(x + (dx * i) / 30, y);
        await page.waitForTimeout(16);
      }
      const during = await longTasks(page);
      await page.mouse.up();
      await page.waitForTimeout(1500);
      const after = await longTasks(page);
      await client.send("Emulation.setCPUThrottlingRate", { rate: 1 });
      const worst = (tasks: number[]) => Math.max(0, ...tasks);
      console.log(
        `JANK ${name} cpu${slow}x: during drag ${during.length} long tasks, worst ${Math.round(worst(during))}ms; refit after release worst ${Math.round(worst(after.slice(during.length)))}ms`,
      );
      expect(worst(during)).toBeLessThan(100);
    });
  }
}

async function installObserver(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __long: number[] };
    w.__long = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) w.__long.push(entry.duration);
    }).observe({ type: "longtask", buffered: false });
  });
}
const longTasks = (page: Page) =>
  page.evaluate(() => [...(window as unknown as { __long: number[] }).__long]);
