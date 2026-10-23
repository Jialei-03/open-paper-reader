import { expect, test, type Locator, type Page } from "@playwright/test";
import { contrast, openKit } from "./helpers";

const section = (page: Page) =>
  page.getByRole("region", { name: "Button", exact: true });
const mdRow = (page: Page) =>
  section(page).getByRole("group", { name: "md", exact: true });
const cssOf = (locator: Locator, property: string) =>
  locator.evaluate(
    (element, name) => getComputedStyle(element).getPropertyValue(name),
    property,
  );

/** Wait for every running color transition, so computed colors are the settled ones. */
const settled = (page: Page) =>
  page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation instanceof CSSTransition)
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  );

async function openThemed(page: Page, theme: "light" | "dark") {
  await openKit(page, { theme });
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  await settled(page);
}

test("loading button is busy and inert", async ({ page }) => {
  await openKit(page);
  const count = section(page).locator("output");
  await expect(count).toHaveText("0");

  const loading = section(page).getByRole("button", { name: "Saving" });
  await expect(loading).toHaveAttribute("aria-busy", "true");
  await expect(loading).toBeDisabled();
  // Force: the click must really reach the button, not wait for it to be enabled.
  await loading.click({ force: true });
  await expect(count).toHaveText("0");

  // A disabled button is just as inert.
  await section(page)
    .getByRole("button", { name: "Disabled", exact: true })
    .click({ force: true });
  await expect(count).toHaveText("0");

  // The counter does count the clicks of a working button.
  await mdRow(page).getByRole("button", { name: "Primary" }).click();
  await expect(count).toHaveText("1");
});

test("icon button exposes its label", async ({ page }) => {
  await openKit(page);
  const search = section(page).getByRole("button", { name: "Search" });
  await expect(search).toBeVisible();
  await expect(search).toHaveAttribute("aria-label", "Search");
  await expect(search).toHaveText("");
});

test("icon button is a 30px square, 26px when small", async ({ page }) => {
  await openKit(page);
  const box = async (name: string) =>
    section(page).getByRole("button", { name }).boundingBox();
  expect(await box("Search")).toMatchObject({ width: 30, height: 30 });
  expect(await box("Adjust")).toMatchObject({ width: 26, height: 26 });
  expect(await box("Bookmark")).toMatchObject({ width: 30, height: 30 });
});

test("focus ring only for keyboard", async ({ page }) => {
  await openKit(page);
  // A ghost button has no shadow of its own, so the ring is the only one.
  const ghost = mdRow(page).getByRole("button", { name: "Ghost" });
  await ghost.click();
  await expect(ghost).toBeFocused();
  expect(await cssOf(ghost, "box-shadow")).toBe("none");

  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(ghost).toBeFocused();
  expect(await cssOf(ghost, "box-shadow")).not.toBe("none");
});

test("buttons keep their label on one line and truncate it", async ({
  page,
}) => {
  await openKit(page);
  const long = section(page).getByRole("button", { name: /^A remarkably/ });
  const box = await long.boundingBox();
  expect(box?.height).toBe(32);
  const label = long.locator("span");
  expect(
    await label.evaluate(
      (element) => element.scrollWidth > element.clientWidth,
    ),
  ).toBe(true);
  expect(await cssOf(label, "text-overflow")).toBe("ellipsis");
  // The button stays inside its box rather than pushing the page wider.
  const parent = await long.locator("xpath=..").boundingBox();
  expect(box!.x + box!.width).toBeLessThanOrEqual(parent!.x + parent!.width);
});

for (const theme of ["light", "dark"] as const) {
  test(`primary text contrast in ${theme}`, async ({ page }) => {
    await openThemed(page, theme);
    const primary = mdRow(page).getByRole("button", { name: "Primary" });
    const [fg, bg] = await Promise.all([
      cssOf(primary, "color"),
      cssOf(primary, "background-color"),
    ]);
    expect(await contrast(page, fg, bg)).toBeGreaterThanOrEqual(4.5);
  });

  test(`every variant's text meets WCAG AA in ${theme}, at rest and hovered`, async ({
    page,
  }) => {
    // Hover colors are checked once settled: with reduced motion they arrive at once.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openThemed(page, theme);
    // Buttons sit on cards, on the shell, on inset blocks and on menus.
    const surfaces = await page.evaluate(() =>
      ["--ui-bg", "--ui-bg-1", "--ui-bg-2", "--ui-elev"].map((token) => [
        token,
        getComputedStyle(document.documentElement)
          .getPropertyValue(token)
          .trim(),
      ]),
    );
    const worstContrast = async (colors: { fg: string; bg: string }) => {
      const ratios = await Promise.all(
        surfaces.map(([, surface]) =>
          contrast(page, colors.fg, colors.bg, surface),
        ),
      );
      return Math.min(...ratios);
    };
    for (const name of ["Primary", "Secondary", "Ghost", "Danger"]) {
      const button = mdRow(page).getByRole("button", { name });
      const read = async () => ({
        fg: await cssOf(button, "color"),
        bg: await cssOf(button, "background-color"),
      });
      const rest = await read();
      expect(
        await worstContrast(rest),
        `${name} at rest`,
      ).toBeGreaterThanOrEqual(4.5);

      await button.hover();
      await expect
        .poll(async () => (await read()).bg, `${name} hover background`)
        .not.toBe(rest.bg);
      await settled(page);
      expect(
        await worstContrast(await read()),
        `${name} hovered`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });
}

test("a disabled button does not react to the pointer", async ({ page }) => {
  await openKit(page);
  const disabled = section(page).getByRole("button", {
    name: "Disabled",
    exact: true,
  });
  const before = await cssOf(disabled, "background-color");
  await disabled.hover({ force: true });
  expect(await cssOf(disabled, "background-color")).toBe(before);
  expect(await cssOf(disabled, "opacity")).toBe("0.45");
  expect(await cssOf(disabled, "cursor")).toBe("not-allowed");
});

test("spinner stops turning and breathes under reduced motion", async ({
  page,
}) => {
  await openKit(page);
  const spinner = section(page)
    .getByRole("button", { name: "Saving" })
    .locator("svg");
  await expect(spinner).toHaveAttribute("aria-hidden", "true");
  expect(await cssOf(spinner, "animation-name")).toMatch(/turn/);

  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(await cssOf(spinner, "animation-name")).toMatch(/breathe/);
});

for (const [platform, expected] of [
  ["MacIntel", ["⌘K", "⇧↵", "⌘\\"]],
  ["Linux x86_64", ["Ctrl+K", "Shift+Enter", "Ctrl+\\"]],
] as const) {
  test(`shortcut labels follow the platform (${platform})`, async ({
    page,
  }) => {
    await page.addInitScript((value) => {
      Object.defineProperty(navigator, "platform", { get: () => value });
    }, platform);
    await openKit(page);
    const keys = section(page).locator("kbd");
    await expect(keys).toHaveText([...expected]);
    for (const key of await keys.all())
      await expect(key).toHaveAttribute("aria-hidden", "true");
  });
}
