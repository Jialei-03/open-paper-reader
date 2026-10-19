import { test, expect, type Page } from "@playwright/test";
import { en } from "../src/i18n/messages/en";
import { zh } from "../src/i18n/messages/zh";

const loaded = (page: Page, selector: string) =>
  page
    .locator(selector)
    .first()
    .evaluate(
      (img: HTMLImageElement) => img.complete && img.naturalWidth > 100,
    );

/** Fails the test on anything the page logs as an error. */
function watchConsole(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}

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
      const errors = watchConsole(page);
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
      // The install command, a button that copies it, and the way to the hosted version.
      await expect(page.locator("main code").first()).toHaveText(
        "uvx open-paper-reader",
      );
      await expect(
        page.getByRole("button", { name: words["site.hero.copy"] }),
      ).toBeVisible();
      await expect(
        page
          .getByRole("main")
          .getByRole("link", {
            name: words["site.hero.start"],
          })
          .first(),
      ).toHaveAttribute("href", "#dashboard");
      expect(errors).toEqual([]);
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

    test("reading modes, local-first and open source say what is true", async ({
      page,
    }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      const errors = watchConsole(page);
      await page.goto("/#home");
      for (const name of ["original", "parallel", "translated"] as const) {
        await expect(
          page.getByRole("heading", {
            level: 3,
            name: words[`site.modes.${name}.title`],
          }),
        ).toBeVisible();
        await expect(
          page.getByText(words[`site.modes.${name}.body`]),
        ).toBeVisible();
      }
      for (const name of ["data", "account", "models", "planned"] as const) {
        await expect(
          page.getByRole("heading", {
            level: 3,
            name: words[`site.local.${name}.title`],
          }),
        ).toBeVisible();
      }
      await expect(
        page.getByRole("heading", { name: words["site.open.title"] }),
      ).toBeVisible();
      await expect(
        page.getByRole("link", { name: words["site.open.source"] }),
      ).toHaveAttribute(
        "href",
        "https://github.com/Jialei-03/open-paper-reader",
      );
      // Nothing on the page names a product from Claude or Anthropic as its own.
      await expect(page.locator("header")).not.toContainText(
        /claude|anthropic/i,
      );
      // Pictures below the first screen are lazy and have their size, so nothing shifts.
      const pictures = page.locator("main img");
      expect(await pictures.count()).toBe(5);
      for (const img of await pictures.all()) {
        await expect(img).toHaveAttribute("width", "1440");
        await expect(img).toHaveAttribute("height", "900");
      }
      await expect(pictures.nth(1)).toHaveAttribute("loading", "lazy");
      await page.locator("#modes").scrollIntoViewIfNeeded();
      await page.locator("#modes img").scrollIntoViewIfNeeded();
      await expect.poll(() => loaded(page, "#modes img")).toBeTruthy();
      expect(errors).toEqual([]);
    });

    test("the install command is copied", async ({ page, context }) => {
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
      await page.goto("/");
      await page.getByRole("button", { name: words["site.hero.copy"] }).click();
      await expect(
        page.getByRole("status").filter({ hasText: words["site.hero.copied"] }),
      ).toBeVisible();
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
        "uvx open-paper-reader",
      );
    });
  });
}

test("the dark reader picture follows the theme", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.goto("/");
  const shot = page.getByRole("img", { name: zh["site.shot.alt"] });
  await expect(shot).toHaveAttribute("src", "/assets/site/reader-dark.png");
  await expect.poll(() => loaded(page, "main figure img")).toBeTruthy();
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
  for (const width of [375, 390, 768]) {
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
