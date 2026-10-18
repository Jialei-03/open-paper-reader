import { test, expect, type Page } from "@playwright/test";
import { en } from "../src/i18n/messages/en";
import { zh } from "../src/i18n/messages/zh";

const loaded = (page: Page, selector: string) =>
  page
    .locator(selector)
    .evaluate(
      (img: HTMLImageElement) => img.complete && img.naturalWidth > 100,
    );

for (const [locale, words] of [
  ["zh-CN", zh],
  ["en-US", en],
] as const) {
  test.describe(`public site in ${locale}`, () => {
    test.use({ locale });

    test("the first screen says what it does, with the real reader", async ({
      page,
    }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto("/");
      await expect(
        page.getByRole("heading", {
          level: 1,
          name: words["site.hero.title"],
        }),
      ).toBeVisible();
      await expect(page.getByText(words["site.hero.lead"])).toBeVisible();
      await expect(
        page
          .getByRole("main")
          .getByRole("link", { name: words["site.hero.start"] })
          .first(),
      ).toBeInViewport();
      const shot = page.getByRole("img", { name: words["site.shot.alt"] });
      await expect(shot).toHaveAttribute(
        "src",
        /^\/assets\/site\/reader-light(-en)?\.png$/,
      );
      await expect
        .poll(() =>
          shot.evaluate(
            (img: HTMLImageElement) => img.complete && img.naturalWidth > 100,
          ),
        )
        .toBeTruthy();
      await expect(page).toHaveTitle(/^open-paper-reader/);
      await page.screenshot({
        path: `../test-results/product-home-${locale}.png`,
        fullPage: true,
      });
    });

    test("the four steps, and the way into the app", async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto("/#home");
      await page
        .getByRole("navigation", { name: words["site.nav"] })
        .getByRole("link", { name: words["site.nav.how"] })
        .click();
      await expect(
        page.getByRole("heading", { name: words["site.how.title"] }),
      ).toBeInViewport();
      for (const step of ["import", "guide", "select", "ask"] as const) {
        await expect(
          page.getByRole("heading", {
            level: 3,
            name: words[`site.how.${step}.title`],
          }),
        ).toBeVisible();
        await expect(
          page.getByText(words[`site.how.${step}.body`]),
        ).toBeVisible();
      }
      await page
        .getByRole("navigation", { name: words["site.nav"] })
        .getByRole("link", { name: words["site.nav.start"] })
        .click();
      await expect(
        page.getByLabel(words["login.username"], { exact: true }),
      ).toBeVisible();
    });
  });
}

test("the dark reader picture follows the theme", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.goto("/");
  const shot = page.getByRole("img", { name: zh["site.shot.alt"] });
  await expect(shot).toHaveAttribute("src", "/assets/site/reader-dark.png");
  await expect.poll(() => loaded(page, "main img")).toBeTruthy();
});

test("the language switch changes the page and is remembered", async ({
  page,
}) => {
  await page.goto("/");
  const switcher = page.getByRole("radiogroup", { name: zh["site.language"] });
  await switcher.getByRole("radio", { name: "English" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: en["site.hero.title"] }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.reload();
  await expect(
    page.getByRole("heading", { level: 1, name: en["site.hero.title"] }),
  ).toBeVisible();
});

test("narrow screens do not scroll sideways and the header stays on one line", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const width of [390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/#home");
    await expect(
      page.getByRole("heading", { level: 1, name: zh["site.hero.title"] }),
    ).toBeVisible();
    expect(
      await page.locator("main").evaluate((e) => {
        const site = e.parentElement!;
        return site.scrollWidth <= site.clientWidth;
      }),
    ).toBeTruthy();
    for (const link of await page.locator("header a:visible").all()) {
      const box = await link.boundingBox();
      expect(box!.height).toBeLessThan(48);
    }
    await page.screenshot({
      path: `../test-results/product-home-${width}.png`,
      fullPage: true,
    });
  }
});
