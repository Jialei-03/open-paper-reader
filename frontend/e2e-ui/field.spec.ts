import { expect, test, type Locator, type Page } from "@playwright/test";
import { contrast, openKit } from "./helpers";

const section = (page: Page) =>
  page.getByRole("region", { name: "Field", exact: true });

const lines = (count: number) =>
  Array.from({ length: count }, (_, index) => `line ${index + 1}`).join("\n");

const height = async (field: Locator) => (await field.boundingBox())!.height;

test("label and description are wired", async ({ page }) => {
  await openKit(page);
  const field = section(page).getByLabel("Base URL");
  await expect(field).toBeVisible();
  await expect(field).not.toHaveAttribute("aria-invalid", /.*/);

  const describedBy = await field.getAttribute("aria-describedby");
  expect(describedBy).toBeTruthy();
  const description = page.locator(`[id="${describedBy}"]`);
  await expect(description).toHaveText(
    "The address of an OpenAI-compatible API",
  );
  await expect(field).toHaveAccessibleDescription(
    "The address of an OpenAI-compatible API",
  );
});

test("error marks the field invalid", async ({ page }) => {
  await openKit(page);
  const field = section(page).getByLabel("API key");
  await expect(field).toHaveAttribute("aria-invalid", "true");
  await expect(field).toHaveAccessibleDescription(/not reachable/);
});

test("a hidden label is still the accessible name, but not seen", async ({
  page,
}) => {
  await openKit(page);
  const field = section(page).getByRole("textbox", { name: "Search papers" });
  await expect(field).toBeVisible();
  const label = section(page).locator("label", { hasText: "Search papers" });
  const box = await label.boundingBox();
  expect(box!.width).toBeLessThanOrEqual(1);
  expect(box!.height).toBeLessThanOrEqual(1);
  // The label takes no room: the field is as tall as a field without one.
  expect(await height(field)).toBe(
    await height(section(page).getByLabel("Base URL")),
  );
});

test("textarea grows then scrolls", async ({ page }) => {
  await openKit(page);
  const area = section(page).getByLabel("Question");
  const measure = () =>
    area.evaluate((element: HTMLTextAreaElement) => {
      const style = getComputedStyle(element);
      return {
        height: element.getBoundingClientRect().height,
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
        eightRows:
          8 * parseFloat(style.lineHeight) +
          parseFloat(style.paddingTop) +
          parseFloat(style.paddingBottom),
      };
    });

  const empty = await measure();
  await area.fill(lines(3));
  const three = await measure();
  expect(three.height).toBeGreaterThan(empty.height);

  await area.fill(lines(20));
  const twenty = await measure();
  expect(twenty.height).toBeCloseTo(twenty.eightRows, 0);
  expect(twenty.scrollHeight).toBeGreaterThan(twenty.clientHeight);

  // It stops at the cap exactly, with no scrollbar before it is reached.
  await area.fill(lines(8));
  const eight = await measure();
  expect(eight.height).toBeCloseTo(eight.eightRows, 0);
  expect(eight.scrollHeight).toBeLessThanOrEqual(eight.clientHeight + 1);

  // And it shrinks again with the content.
  await area.fill("");
  expect((await measure()).height).toBe(empty.height);
});

test("textarea is sized to its initial value on first render", async ({
  page,
}) => {
  await openKit(page);
  const question = section(page).getByLabel("Question");
  const notes = section(page).getByLabel("Notes");
  const empty = await height(question);
  await question.fill(lines(3));
  // "Notes" starts with three lines: it is as tall as three typed ones.
  expect(await height(notes)).toBe(await height(question));
  expect(await height(notes)).toBeGreaterThan(empty);
});

for (const theme of ["light", "dark"] as const) {
  test(`field text meets WCAG AA in ${theme}`, async ({ page }) => {
    await openKit(page, { theme });
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    const fields = section(page);
    const colorOf = (target: Locator) =>
      target.evaluate((element) => getComputedStyle(element).color);
    const input = fields.getByLabel("Base URL");
    const [fill, label, description, error, typed] = await Promise.all([
      input.evaluate((element) => getComputedStyle(element).backgroundColor),
      colorOf(fields.locator("label", { hasText: "Base URL" })),
      colorOf(fields.getByText("The address of an OpenAI-compatible API")),
      colorOf(fields.getByText("This address is not reachable")),
      colorOf(input),
    ]);
    // Fields sit on cards, on the shell, on inset blocks and on dialogs.
    const surfaces = await page.evaluate(() =>
      ["--ui-bg", "--ui-bg-1", "--ui-bg-2", "--ui-elev"].map((token) =>
        getComputedStyle(document.documentElement)
          .getPropertyValue(token)
          .trim(),
      ),
    );
    for (const surface of surfaces) {
      for (const [name, text, behind] of [
        ["label", label, surface],
        ["description", description, surface],
        ["error", error, surface],
      ] as const)
        expect(
          await contrast(page, text, behind),
          `${name} on ${surface}`,
        ).toBeGreaterThanOrEqual(4.5);
      // What is typed is on the field's translucent fill, over the surface.
      expect(
        await contrast(page, typed, fill, surface),
        `typed text on ${surface}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });
}

test("placeholder is the quiet text color", async ({ page }) => {
  await openKit(page);
  const input = section(page).getByLabel("Base URL");
  const [placeholder, quiet] = await input.evaluate((element) => {
    const probe = document.createElement("span");
    probe.style.color = "var(--ui-fg-3)";
    document.body.append(probe);
    const quiet = getComputedStyle(probe).color;
    probe.remove();
    return [getComputedStyle(element, "::placeholder").color, quiet];
  });
  expect(placeholder).toBe(quiet);
  expect(placeholder).not.toBe(
    await input.evaluate((element) => getComputedStyle(element).color),
  );
});
