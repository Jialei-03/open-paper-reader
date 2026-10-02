import { test, expect, type Page } from "@playwright/test";

const loaded = (page: Page, selector: string) =>
  page
    .locator(selector)
    .evaluate(
      (img: HTMLImageElement) => img.complete && img.naturalWidth > 100,
    );

test("public product site, interactive preview and searchable docs", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  // The tools open the page: the heading, the two buttons, and the first picture already in view.
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: /开源的论文阅读工作台，\s*助手全程参与。/,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "开始阅读", exact: true }),
  ).toBeInViewport();
  const groups = page.getByRole("tablist", { name: "功能分类" });
  await expect(groups).toBeInViewport();
  await expect(groups.getByRole("tab").first()).toHaveText("助手");
  await expect(
    page.locator("#feature-detail .product-screenshot img"),
  ).toHaveAttribute("src", /^\/assets\/showcase\/chat\.webp\?v=[a-f0-9]{12}$/);
  await expect
    .poll(() => loaded(page, "#feature-detail .product-screenshot img"))
    .toBeTruthy();
  await expect(page.locator("#feature-detail")).toBeInViewport();
  await page
    .getByRole("button", { name: "放大截图：同一篇论文，接着聊", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.screenshot({
    path: "../test-results/product-home-desktop.png",
    fullPage: true,
  });

  // Layout translation: the original and the translated page share one frame
  // and the divider moves with the keyboard as well as the pointer.
  const slider = page.getByRole("slider", { name: "拖动对比原文与译文" });
  await slider.scrollIntoViewIfNeeded();
  const before = Number(await slider.inputValue());
  await slider.focus();
  await page.keyboard.press("ArrowLeft");
  expect(Number(await slider.inputValue())).toBeLessThan(before);
  const frame = (await page.locator(".lp-compare").boundingBox())!;
  await page.mouse.move(
    frame.x + frame.width * 0.5,
    frame.y + frame.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    frame.x + frame.width * 0.2,
    frame.y + frame.height / 2,
    { steps: 4 },
  );
  await page.mouse.up();
  expect(Number(await slider.inputValue())).toBeLessThan(30);
  await page.getByRole("tab", { name: "图表页", exact: true }).click();
  await expect
    .poll(() => loaded(page, ".lp-compare .lp-compare-after"))
    .toBeTruthy();

  // Every feature in the explorer has a picture that actually loads.
  const names = await groups.getByRole("tab").allInnerTexts();
  expect(names.length).toBeGreaterThanOrEqual(7);
  expect(names[0]).toBe("助手");
  let pictures = 0;
  for (const name of names) {
    await groups.getByRole("tab", { name, exact: true }).click();
    const items = page.locator(".lp-feature-list button");
    for (let i = 0; i < (await items.count()); i++) {
      await items.nth(i).click();
      await expect
        .poll(() => loaded(page, "#feature-detail .product-screenshot img"))
        .toBeTruthy();
      await expect(
        page.locator("#feature-detail .lp-detail-how"),
      ).toContainText("怎么用");
      pictures++;
    }
  }
  expect(pictures).toBeGreaterThanOrEqual(33);

  await page
    .getByRole("navigation", { name: "产品导航" })
    .getByRole("link", { name: "功能", exact: true })
    .click();
  // The tools are the top of the page: the link brings the heading back into view.
  await expect(
    page.getByRole("heading", { level: 1, name: /开源的论文阅读工作台/ }),
  ).toBeInViewport();
  await page.screenshot({ path: "../test-results/product-features.png" });
  await page
    .getByRole("navigation", { name: "产品导航" })
    .getByRole("link", { name: "文档", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "开始使用", exact: true }),
  ).toBeVisible();
  await page.getByLabel("搜索文档").fill("联动");
  await page
    .getByRole("complementary", { name: "文档导航" })
    .getByRole("link", { name: "翻译与双语对照", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "翻译与双语对照", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "../test-results/product-docs-desktop.png",
    fullPage: true,
  });

  for (const width of [390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/#home");
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: /开源的论文阅读工作台，\s*助手全程参与。/,
      }),
    ).toBeVisible();
    expect(
      await page
        .locator(".product-site")
        .evaluate((e) => e.scrollWidth <= e.clientWidth),
    ).toBeTruthy();
  }
  await page.screenshot({
    path: "../test-results/product-home-mobile.png",
    fullPage: true,
  });
  await page.getByRole("link", { name: "开始阅读", exact: true }).click();
  await expect(page.getByLabel("用户名", { exact: true })).toBeVisible();
});
