import { expect, test, type Locator, type Page } from "@playwright/test";
import { contrast, openKit } from "./helpers";

const section = (page: Page) =>
  page.getByRole("region", { name: "Tooltip", exact: true });
const tooltip = (page: Page) => page.locator('[role="tooltip"]');
const cssOf = (locator: Locator, property: string) =>
  locator.evaluate(
    (element, name) => getComputedStyle(element).getPropertyValue(name),
    property,
  );

/** Wait for every running color or move transition, so rectangles and colors are the settled ones. */
const settled = (page: Page) =>
  page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation instanceof CSSTransition)
        .map((animation) => animation.finished),
    ),
  );

const boxOf = (locator: Locator) =>
  locator.evaluate((element) => {
    const { left, top, right, bottom } = element.getBoundingClientRect();
    return { left, top, right, bottom };
  });

/** Focus a button the way a keyboard user arrives: so `:focus-visible` matches. */
async function focusWithKeyboard(page: Page, button: Locator) {
  await button.focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(button).toBeFocused();
}

test("hover shows the tooltip after a delay", async ({ page }) => {
  await openKit(page);
  const button = section(page).getByRole("button", { name: "Find" });
  await button.hover();
  // Within 200ms it is not there; within 600ms it is, and says what the button is called.
  await expect(tooltip(page)).toBeHidden();
  await page.waitForTimeout(150);
  await expect(tooltip(page)).toBeHidden();
  await expect(tooltip(page)).toBeVisible({ timeout: 450 });
  await expect(tooltip(page)).toHaveText("Find");

  await page.mouse.move(0, 0);
  await expect(tooltip(page)).toBeHidden();
});

test("leaving before the delay is over shows nothing", async ({ page }) => {
  await openKit(page);
  await section(page).getByRole("button", { name: "Find" }).hover();
  await page.waitForTimeout(150);
  await page.mouse.move(0, 0);
  await page.waitForTimeout(500);
  await expect(tooltip(page)).toBeHidden();
});

test("keyboard focus shows it immediately and Escape hides it", async ({
  page,
}) => {
  await openKit(page);
  // Arrive from the field above, by Tab, as a keyboard user does.
  await page.getByLabel("Notes").focus();
  await page.keyboard.press("Tab");
  const first = section(page).getByRole("button", { name: "Add bookmark" });
  await expect(first).toBeFocused();
  // Well under the hover delay.
  await expect(tooltip(page)).toBeVisible({ timeout: 300 });
  await expect(tooltip(page)).toContainText("Add bookmark");

  // Moving on to the next button swaps it.
  await page.keyboard.press("Tab");
  await expect(tooltip(page)).toHaveText("Find");

  await page.keyboard.press("Escape");
  await expect(tooltip(page)).toBeHidden();
  // It only closes the tooltip; the focus stays.
  await expect(
    section(page).getByRole("button", { name: "Find" }),
  ).toBeFocused();
});

test("blur hides it", async ({ page }) => {
  await openKit(page);
  const button = section(page).getByRole("button", { name: "Find" });
  await focusWithKeyboard(page, button);
  await expect(tooltip(page)).toBeVisible();
  await button.blur();
  await expect(tooltip(page)).toBeHidden();
});

test("Escape is taken by the tooltip, and only while it is shown", async ({
  page,
}) => {
  await openKit(page);
  await page.evaluate(() => {
    const seen: { key: string; prevented: boolean }[] = [];
    Object.assign(window, { seen });
    // The bubbling end of the window: what an enclosing dialog or page would see.
    window.addEventListener("keydown", (event) =>
      seen.push({ key: event.key, prevented: event.defaultPrevented }),
    );
  });
  const seen = () =>
    page.evaluate(() => (window as unknown as { seen: unknown[] }).seen);

  await focusWithKeyboard(
    page,
    section(page).getByRole("button", { name: "Find" }),
  );
  await expect(tooltip(page)).toBeVisible();
  const before = (await seen()).length;
  await page.keyboard.press("Escape");
  await expect(tooltip(page)).toBeHidden();
  // Stopped on the way: nothing outside saw it.
  expect(await seen()).toHaveLength(before);

  // With nothing shown, Escape passes through untouched.
  await page.keyboard.press("Escape");
  expect((await seen()).slice(before)).toEqual([
    { key: "Escape", prevented: false },
  ]);
});

test("pressing the button hides the tooltip", async ({ page }) => {
  await openKit(page);
  const button = section(page).getByRole("button", { name: "Find" });
  await button.hover();
  await expect(tooltip(page)).toBeVisible();
  await page.mouse.down();
  await expect(tooltip(page)).toBeHidden();
  await page.mouse.up();
  // A click focuses the button without `:focus-visible`: nothing comes back.
  await page.waitForTimeout(500);
  await expect(tooltip(page)).toBeHidden();
});

test("pressing before the delay is over cancels the tooltip", async ({
  page,
}) => {
  await openKit(page);
  const button = section(page).getByRole("button", { name: "Find" });
  await button.hover();
  await page.waitForTimeout(100);
  await page.mouse.down();
  // Well past the delay, and with the pointer still on the button.
  await page.waitForTimeout(600);
  await expect(tooltip(page)).toBeHidden();
  await page.mouse.up();
  await page.waitForTimeout(500);
  await expect(tooltip(page)).toBeHidden();

  // Hovering is not suppressed for good: leave and return, and it shows again.
  await page.mouse.move(0, 0);
  await button.hover();
  await expect(tooltip(page)).toBeVisible({ timeout: 700 });
});

test("the tooltip is decoration for pointers: hidden from assistive technology and inert", async ({
  page,
}) => {
  await openKit(page);
  const button = section(page).getByRole("button", { name: "Find" });
  await expect(button).toHaveAttribute("aria-label", "Find");
  await button.hover();
  await expect(tooltip(page)).toBeVisible();
  await expect(tooltip(page)).toHaveAttribute("aria-hidden", "true");
  expect(await cssOf(tooltip(page), "pointer-events")).toBe("none");
  // It sits in the top layer, so no z-index is needed to be above the page.
  expect(
    await tooltip(page).evaluate((el) => el.matches(":popover-open")),
  ).toBe(true);
  await expect(page.getByRole("tooltip")).toHaveCount(0);
});

for (const [platform, shortcut] of [
  ["MacIntel", "⌘D"],
  ["Linux x86_64", "Ctrl+D"],
] as const) {
  test(`a shortcut is shown after the name (${platform})`, async ({ page }) => {
    await page.addInitScript((value) => {
      Object.defineProperty(navigator, "platform", { get: () => value });
    }, platform);
    await openKit(page);
    await section(page).getByRole("button", { name: "Add bookmark" }).hover();
    await expect(tooltip(page)).toBeVisible();
    await expect(tooltip(page)).toHaveText(`Add bookmark${shortcut}`);
    await expect(tooltip(page).locator("kbd")).toHaveText(shortcut);
  });
}

test("tooltip near the viewport edge stays inside", async ({ page }) => {
  await openKit(page);
  const corner = page.getByRole("button", { name: "Corner" });
  await corner.hover();
  await expect(tooltip(page)).toBeVisible();
  await settled(page);

  const [tip, button, viewport] = await Promise.all([
    boxOf(tooltip(page)),
    boxOf(corner),
    page.evaluate(() => ({
      width: document.documentElement.clientWidth,
      height: document.documentElement.clientHeight,
    })),
  ]);
  expect(tip.left).toBeGreaterThanOrEqual(0);
  expect(tip.top).toBeGreaterThanOrEqual(0);
  expect(tip.right).toBeLessThanOrEqual(viewport.width);
  expect(tip.bottom).toBeLessThanOrEqual(viewport.height);
  // No room below the button: it went above it.
  expect(tip.bottom).toBeLessThanOrEqual(button.top);
  // And it keeps off the edge by its padding.
  expect(Math.abs(viewport.width - 8 - tip.right)).toBeLessThanOrEqual(1);
});

test("the tooltip follows its button on scroll and resize", async ({
  page,
}) => {
  await openKit(page);
  const find = section(page).getByRole("button", { name: "Find" });
  // The kit page ends at the buttons; room below them lets the page scroll further.
  await page.evaluate(() => {
    const spacer = document.createElement("div");
    spacer.style.height = "1500px";
    document.querySelector("main")!.after(spacer);
  });
  await find.evaluate((element) => {
    const { top } = element.getBoundingClientRect();
    window.scrollBy(0, top - 400);
  });
  await focusWithKeyboard(page, find);
  await expect(tooltip(page)).toBeVisible();
  await settled(page);
  const gap = async () =>
    (await boxOf(tooltip(page))).top - (await boxOf(find)).bottom;
  const startTop = (await boxOf(find)).top;
  const startGap = await gap();

  await page.evaluate(() => window.scrollBy(0, 150));
  await expect.poll(async () => (await boxOf(find)).top).toBe(startTop - 150);
  await expect.poll(gap).toBe(startGap);

  // A corner button, then a smaller window: it ends up elsewhere, and so does its tooltip.
  await page.keyboard.press("Tab");
  const corner = page.getByRole("button", { name: "Corner" });
  await expect(corner).toBeFocused();
  await expect(tooltip(page)).toHaveText("Corner");
  await page.setViewportSize({ width: 640, height: 420 });
  await expect
    .poll(async () => {
      const [tip, button] = await Promise.all([
        boxOf(tooltip(page)),
        boxOf(corner),
      ]);
      return tip.bottom <= button.top && tip.right <= 640 && tip.bottom <= 420;
    })
    .toBe(true);
});

for (const theme of ["light", "dark"] as const) {
  test(`tooltip text and shortcut meet WCAG AA in ${theme}`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openKit(page, { theme });
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await section(page).getByRole("button", { name: "Add bookmark" }).hover();
    await expect(tooltip(page)).toBeVisible();
    await settled(page);
    const background = await cssOf(tooltip(page), "background-color");
    const text = await cssOf(tooltip(page), "color");
    const key = await cssOf(tooltip(page).locator("kbd"), "color");
    // The shortcut is fainter than the name, but not under the line.
    expect(await contrast(page, text, background)).toBeGreaterThanOrEqual(4.5);
    expect(await contrast(page, key, background)).toBeGreaterThanOrEqual(4.5);
    expect(key).not.toBe(text);
  });
}
