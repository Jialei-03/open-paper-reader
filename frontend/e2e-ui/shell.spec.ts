import { expect, test, type Locator, type Page } from "@playwright/test";
import { contrast, openKit } from "./helpers";

const LONG = "A Remarkably Long Paper Title That Will Not Fit In The Sidebar";

const sidebar = (page: Page) =>
  page.getByRole("navigation", { name: "Workspace" });
const item = (page: Page, name: string) =>
  sidebar(page).getByRole("button", { name });
const tooltip = (page: Page) => page.locator('[role="tooltip"]');
const middle = (page: Page) => page.getByRole("main");
const side = (page: Page) =>
  page.getByRole("complementary", { name: "Assistant" });

const boxOf = (locator: Locator) =>
  locator.evaluate((element) => {
    const { left, top, right, bottom, width } = element.getBoundingClientRect();
    return { left, top, right, bottom, width };
  });
const widthOf = async (locator: Locator) => (await boxOf(locator)).width;
const cssOf = (locator: Locator, property: string) =>
  locator.evaluate(
    (element, name) => getComputedStyle(element).getPropertyValue(name),
    property,
  );

/** Wait for every running color or move transition, so colors are the settled ones. */
const settled = (page: Page) =>
  page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation instanceof CSSTransition)
        .map((animation) => animation.finished),
    ),
  );

test("cards float on the shell with an 8px gap", async ({ page }) => {
  await openKit(page);
  const [nav, card, panel] = await Promise.all([
    boxOf(sidebar(page)),
    boxOf(middle(page)),
    boxOf(side(page)),
  ]);
  // The two cards are 8px apart, and so are the sidebar and the first card.
  expect(panel.left - card.right).toBeCloseTo(8, 1);
  expect(card.left - nav.right).toBeCloseTo(8, 1);
  // The shell keeps 8px round the window.
  const viewport = page.viewportSize()!;
  expect(card.top).toBeCloseTo(8, 1);
  expect(viewport.height - card.bottom).toBeCloseTo(8, 1);
  expect(viewport.width - panel.right).toBeCloseTo(8, 1);
  expect(panel.width).toBeCloseTo(400, 1);

  for (const card of [middle(page), side(page)]) {
    await expect(card).toHaveCSS("border-radius", "16px");
    // Lifted off the shell: a surface of its own, and a shadow.
    expect(await cssOf(card, "background-color")).not.toBe(
      await cssOf(page.locator("body"), "background-color"),
    );
    expect(await cssOf(card, "box-shadow")).not.toBe("none");
  }
  // The sidebar sits on the shell itself.
  await expect(sidebar(page)).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(sidebar(page)).toHaveCSS("background-image", "none");
});

test("the window does not scroll; the middle card does", async ({ page }) => {
  await openKit(page);
  const overflow = await page.evaluate(() => {
    const root = document.documentElement;
    return { page: root.scrollHeight - root.clientHeight };
  });
  expect(overflow.page).toBe(0);
  const scroller = await middle(page).evaluate((card) => {
    const inner = [...card.querySelectorAll<HTMLElement>("*")].find(
      (element) =>
        /auto|scroll/.test(getComputedStyle(element).overflowY) &&
        element.scrollHeight > element.clientHeight,
    );
    return inner
      ? { scrollable: true, inside: card.contains(inner) }
      : { scrollable: false, inside: false };
  });
  expect(scroller).toEqual({ scrollable: true, inside: true });
  // The header stays where it is while the sections scroll.
  const heading = page.getByRole("heading", { name: "Toast", exact: true });
  await heading.scrollIntoViewIfNeeded();
  await expect(
    middle(page).getByRole("heading", { level: 1 }),
  ).toBeInViewport();
});

for (const [platform, keys] of [
  ["Linux x86_64", "Control+\\"],
  ["MacIntel", "Meta+\\"],
] as const) {
  test(`sidebar collapses with the button and the shortcut (${platform})`, async ({
    page,
  }) => {
    await page.addInitScript((value) => {
      Object.defineProperty(navigator, "platform", { get: () => value });
    }, platform);
    await openKit(page, { locale: "en" });
    const nav = sidebar(page);
    const navWidth = () => widthOf(nav);
    expect(await navWidth()).toBe(220);
    await expect(item(page, "Library")).toBeVisible();
    await expect(nav.getByText("Library", { exact: true })).toBeVisible();
    await expect(item(page, "Library")).toHaveAccessibleName("Library 128");

    const collapse = page.getByRole("button", { name: "Collapse sidebar" });
    await expect(collapse).toHaveAttribute("aria-expanded", "true");
    await expect(collapse).toHaveAttribute(
      "aria-keyshortcuts",
      platform === "MacIntel" ? "Meta+\\" : "Control+\\",
    );
    await collapse.click();
    await expect.poll(navWidth).toBe(56);
    const expand = page.getByRole("button", { name: "Expand sidebar" });
    await expect(expand).toHaveAttribute("aria-expanded", "false");
    // Only the icons are left; the items are still there, with the same names.
    await expect(nav.getByText("Library", { exact: true })).toBeHidden();
    await expect(nav.getByText("Papers", { exact: true })).toBeHidden();
    await expect(item(page, "Library")).toBeVisible();
    await expect(item(page, "Reading")).toHaveAttribute("aria-current", "page");
    await expect(item(page, "Library")).toHaveAccessibleName("Library 128");
    // The window grew: the card took the room.
    expect(await widthOf(middle(page))).toBeGreaterThan(628);

    await page.keyboard.press(keys);
    await expect.poll(navWidth).toBe(220);
    await expect(nav.getByText("Library", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Collapse sidebar" }),
    ).toBeVisible();

    await page.keyboard.press(keys);
    await expect.poll(navWidth).toBe(56);
    await page.keyboard.press(keys);
    await expect.poll(navWidth).toBe(220);

    // The other platform's modifier does nothing.
    await page.keyboard.press(
      platform === "MacIntel" ? "Control+\\" : "Meta+\\",
    );
    await page.waitForTimeout(400);
    expect(await navWidth()).toBe(220);
  });
}

test("the shortcut is left alone in a text field and while composing", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "platform", {
      get: () => "Linux x86_64",
    });
  });
  await openKit(page, { locale: "en" });
  const nav = sidebar(page);
  await page.getByRole("textbox", { name: "Notes" }).focus();
  await page.keyboard.press("Control+\\");
  await page.waitForTimeout(400);
  expect(await widthOf(nav)).toBe(220);

  // An input method that is composing owns the keys.
  await page.getByRole("button", { name: "Show Guide" }).focus();
  const composing = await page.evaluate(() => {
    const event = new KeyboardEvent("keydown", {
      key: "\\",
      ctrlKey: true,
      isComposing: true,
      bubbles: true,
      cancelable: true,
    });
    document.activeElement!.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(composing).toBe(false);
  await page.waitForTimeout(400);
  expect(await widthOf(nav)).toBe(220);

  // Anywhere else it works, and it takes the key from the browser.
  const handled = await page.evaluate(() => {
    const event = new KeyboardEvent("keydown", {
      key: "\\",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    document.activeElement!.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(handled).toBe(true);
  await expect.poll(() => widthOf(nav)).toBe(56);
});

test("collapsed items show their name in a tooltip on the right", async ({
  page,
}) => {
  await openKit(page, { locale: "en" });
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect.poll(() => widthOf(sidebar(page))).toBe(56);
  await page.mouse.move(0, 0);
  const library = item(page, "Library");
  await library.hover();
  await expect(tooltip(page)).toBeVisible();
  await expect(tooltip(page)).toHaveText("Library");
  const [tip, button] = await Promise.all([
    boxOf(tooltip(page)),
    boxOf(library),
  ]);
  expect(tip.left).toBeGreaterThanOrEqual(button.right);
});

test("active item is marked as current", async ({ page }) => {
  await openKit(page);
  await expect(item(page, "Reading")).toHaveAttribute("aria-current", "page");
  await expect(sidebar(page).locator("[aria-current]")).toHaveCount(1);
  // The dot says what is being read, and says nothing to a screen reader.
  const dot = item(page, "Reading").locator('[aria-hidden="true"]:not(svg)');
  await expect(dot).toHaveCount(1);
  expect(await boxOf(dot)).toMatchObject({ width: 6 });
  await expect(dot).toHaveCSS("box-shadow", /0px 0px 0px 3px/);
});

for (const locale of ["en", "zh"] as const) {
  test(`long English labels truncate without overflow (${locale})`, async ({
    page,
  }) => {
    await openKit(page, { locale });
    const nav = sidebar(page);
    const long = item(page, LONG);
    const label = long.getByText(LONG, { exact: true });
    const fits = (locator: Locator) =>
      locator.evaluate((element) => ({
        over: element.scrollWidth > element.clientWidth,
        height: element.getBoundingClientRect().height,
      }));
    // The text is cut ...
    expect((await fits(label)).over).toBe(true);
    // ... and nothing sticks out of the item or the sidebar.
    expect((await fits(long)).over).toBe(false);
    expect(
      await nav.evaluate(
        (element) => element.scrollWidth - element.clientWidth,
      ),
    ).toBe(0);
    // One line, as high as every other item.
    expect((await fits(long)).height).toBe(
      (await fits(item(page, "Import"))).height,
    );

    // The whole title is one hover away.
    await long.hover();
    await expect(tooltip(page)).toBeVisible({ timeout: 900 });
    await expect(tooltip(page)).toHaveText(LONG);

    // A label that fits has nothing more to say.
    await page.mouse.move(0, 0);
    await expect(tooltip(page)).toBeHidden();
    await item(page, "Import").hover();
    await page.waitForTimeout(700);
    await expect(tooltip(page)).toHaveCount(0);

    // And the demo has no text that grows its box: one line in every button and tab.
    const tall = await page.evaluate(() =>
      [
        ...document.querySelectorAll<HTMLElement>(
          'main button, aside button, [role="tab"], [role="radio"]',
        ),
      ]
        .filter((element) => element.scrollHeight > element.clientHeight + 1)
        .map((element) => element.textContent),
    );
    expect(tall).toEqual([]);
  });
}

for (const theme of ["light", "dark"] as const) {
  test(`sidebar text meets WCAG AA in ${theme}`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openKit(page, { theme, locale: "en" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    const nav = sidebar(page);
    const shell = await cssOf(page.locator("body"), "background-color");
    const colorOf = (locator: Locator) => cssOf(locator, "color");
    const backgroundOf = (locator: Locator) =>
      cssOf(locator, "background-color");
    const ratio = async (
      text: Locator,
      surface: Locator | null,
    ): Promise<number> =>
      contrast(
        page,
        await colorOf(text),
        surface ? await backgroundOf(surface) : shell,
        shell,
      );

    const library = item(page, "Library");
    const meta = library.getByText("128", { exact: true });
    const title = nav.getByText("Papers", { exact: true });
    const idle = item(page, "Import");
    // On the shell itself.
    expect(await ratio(title, null)).toBeGreaterThanOrEqual(4.5);
    expect(await ratio(idle.getByText("Import"), null)).toBeGreaterThanOrEqual(
      4.5,
    );
    expect(await ratio(meta, null)).toBeGreaterThanOrEqual(4.5);
    // On a hovered row: the meta is stronger than on the shell.
    await library.hover();
    await settled(page);
    expect(await ratio(meta, library)).toBeGreaterThanOrEqual(4.5);
    expect(
      await ratio(library.getByText("Library", { exact: true }), library),
    ).toBeGreaterThanOrEqual(4.5);
    // On the current row.
    const reading = item(page, "Reading");
    await page.mouse.move(0, 0);
    await settled(page);
    expect(
      await ratio(reading.getByText("Reading", { exact: true }), reading),
    ).toBeGreaterThanOrEqual(4.5);
  });
}
