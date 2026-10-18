import { expect, test, type Locator, type Page } from "@playwright/test";
import { contrastOfTokens, openKit } from "./helpers";

const section = (page: Page) =>
  page.getByRole("region", { name: "Segmented", exact: true });
const tab = (page: Page, name: string) =>
  section(page).getByRole("tab", { name, exact: true });
const radio = (page: Page, name: string) =>
  section(page).getByRole("radio", { name, exact: true });
const tablist = (page: Page) =>
  section(page).getByRole("tablist", { name: "Reading panels" });
const theme = (page: Page) =>
  section(page).getByRole("radiogroup", { name: "Theme" });
const pageFit = (page: Page) =>
  section(page).getByRole("radiogroup", { name: "Page fit" });
const narrow = (page: Page) =>
  section(page).getByRole("radiogroup", { name: "Narrow" });

/** The sliding thumb: the one hidden span of a control (its icons are svg). */
const thumbOf = (control: Locator) =>
  control.locator('span[aria-hidden="true"]');

const boxOf = (locator: Locator) =>
  locator.evaluate((element) => {
    const { left, right, top, bottom } = element.getBoundingClientRect();
    return { left, right, top, bottom };
  });
const heightOf = async (locator: Locator) => {
  const { top, bottom } = await boxOf(locator);
  return bottom - top;
};

/** The thumb has come to rest under the item, to within a pixel on both sides. */
async function expectThumbUnder(thumb: Locator, item: Locator) {
  await expect
    .poll(async () => {
      const [a, b] = [await boxOf(thumb), await boxOf(item)];
      return Math.max(Math.abs(a.left - b.left), Math.abs(a.right - b.right));
    })
    .toBeLessThanOrEqual(1);
}

/** Every transition that starts on a thumb is written to `window.thumbRuns`. */
async function recordThumbTransitions(page: Page) {
  await page.addInitScript(() => {
    const runs: string[] = [];
    Object.assign(window, { thumbRuns: runs });
    document.addEventListener(
      "transitionrun",
      (event) => {
        const target = event.target as HTMLElement;
        if (target.matches('span[aria-hidden="true"]'))
          runs.push(event.propertyName);
      },
      true,
    );
  });
}
const thumbRuns = (page: Page) =>
  page.evaluate(() => (window as unknown as { thumbRuns: string[] }).thumbRuns);
const animationsOf = (locator: Locator) =>
  locator.evaluate((element) => element.getAnimations().length);

/** The roving tabindex: this item is the only tab stop of its control. */
async function expectOnlyTabStop(control: Locator, item: Locator) {
  await expect(control.locator('[tabindex="0"]')).toHaveCount(1);
  await expect(item).toHaveAttribute("tabindex", "0");
}

test("tabs expose the tab pattern", async ({ page }) => {
  await openKit(page);
  const assistant = tab(page, "Assistant");
  await expect(tablist(page)).toBeVisible();
  await expect(assistant).toHaveAttribute("aria-selected", "false");

  await assistant.click();
  await expect(assistant).toHaveAttribute("aria-selected", "true");
  await expect(tab(page, "Guide")).toHaveAttribute("aria-selected", "false");

  // The tab points at its panel, and the panel back at the tab.
  const panel = section(page).getByRole("tabpanel", { name: "Assistant" });
  await expect(panel).toBeVisible();
  const [tabId, panelId] = [
    await assistant.getAttribute("id"),
    await panel.getAttribute("id"),
  ];
  expect(panelId).toBeTruthy();
  expect(tabId).toBe(`${panelId}-tab`);
  await expect(assistant).toHaveAttribute("aria-controls", panelId!);
  await expect(panel).toHaveAttribute("aria-labelledby", tabId!);
  // Only the chosen panel is on show.
  await expect(section(page).getByRole("tabpanel")).toHaveCount(1);
});

test("arrow keys move and select with wrap", async ({ page }) => {
  await openKit(page);
  const list = tablist(page);
  const [guide, translation, notes] = ["Guide", "Translation", "Notes"].map(
    (name) => tab(page, name),
  );

  await notes.click();
  await expectOnlyTabStop(list, notes);
  // Past the end: round to the start, selected at once, and the focus goes with it.
  await page.keyboard.press("ArrowRight");
  await expect(guide).toHaveAttribute("aria-selected", "true");
  await expect(guide).toBeFocused();
  await expect(notes).toHaveAttribute("aria-selected", "false");
  await expectOnlyTabStop(list, guide);
  await expect(
    section(page).getByRole("tabpanel", { name: "Guide" }),
  ).toBeVisible();

  // Before the start: round to the end.
  await page.keyboard.press("ArrowLeft");
  await expect(notes).toHaveAttribute("aria-selected", "true");
  await expect(notes).toBeFocused();
  await expectOnlyTabStop(list, notes);

  await page.keyboard.press("Home");
  await expect(guide).toHaveAttribute("aria-selected", "true");
  await expect(guide).toBeFocused();
  await page.keyboard.press("End");
  await expect(notes).toHaveAttribute("aria-selected", "true");
  await expect(notes).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(translation).toHaveAttribute("aria-selected", "true");
  await expect(translation).toBeFocused();
});

test("Tab enters on the selected item and leaves past the control", async ({
  page,
}) => {
  await openKit(page);
  await tab(page, "Translation").click();
  // The last button before the section, so that the next Tab goes to the control.
  await page.getByRole("button", { name: "Open wide dialog" }).focus();
  await page.keyboard.press("Tab");
  await expect(tab(page, "Translation")).toBeFocused();
  // One more Tab goes on, over the other tabs.
  await page.keyboard.press("Tab");
  await expect(tablist(page).locator(":focus")).toHaveCount(0);
  await page.keyboard.press("Shift+Tab");
  await expect(tab(page, "Translation")).toBeFocused();
});

test("shortcuts of the browser are left alone", async ({ page }) => {
  await openKit(page);
  await tab(page, "Assistant").click();
  // Alt+ArrowLeft is "back" in a browser; it is not for the control.
  await page.keyboard.press("Alt+ArrowLeft");
  await page.keyboard.press("Control+ArrowRight");
  await page.keyboard.press("Meta+ArrowRight");
  await expect(tab(page, "Assistant")).toHaveAttribute("aria-selected", "true");
  await expect(tab(page, "Assistant")).toBeFocused();
});

test("radio kind uses radio roles", async ({ page }) => {
  await openKit(page);
  await expect(theme(page)).toBeVisible();
  // It is not a tab list.
  await expect(theme(page).getByRole("tab")).toHaveCount(0);
  await expect(radio(page, "Dark")).toHaveAttribute("aria-checked", "true");

  await radio(page, "Light").click();
  await expect(radio(page, "Light")).toHaveAttribute("aria-checked", "true");
  await expect(radio(page, "Dark")).toHaveAttribute("aria-checked", "false");
  await expect(radio(page, "System")).toHaveAttribute("aria-checked", "false");
  await expectOnlyTabStop(theme(page), radio(page, "Light"));
  // No panel belongs to a radio.
  await expect(radio(page, "Light")).not.toHaveAttribute("aria-controls");
  await expect(radio(page, "Light")).not.toHaveAttribute("id");

  await page.keyboard.press("ArrowRight");
  await expect(radio(page, "System")).toHaveAttribute("aria-checked", "true");
  await expect(radio(page, "System")).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(radio(page, "Dark")).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("ArrowLeft");
  await expect(radio(page, "System")).toHaveAttribute("aria-checked", "true");
});

test("thumb follows the selection", async ({ page }) => {
  // The thumb takes 180ms to slide; with reduced motion it is there at once.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openKit(page);
  const thumb = thumbOf(tablist(page));
  await expect(thumb).toBeVisible();
  await expectThumbUnder(thumb, tab(page, "Guide"));

  await tab(page, "Translation").click();
  await expectThumbUnder(thumb, tab(page, "Translation"));
  await tab(page, "Notes").click();
  await expectThumbUnder(thumb, tab(page, "Notes"));
  await page.keyboard.press("ArrowRight");
  await expectThumbUnder(thumb, tab(page, "Guide"));

  // Items differ in width, and the thumb takes the width as well as the place.
  const [guide, translation] = [
    await boxOf(tab(page, "Guide")),
    await boxOf(tab(page, "Translation")),
  ];
  expect(translation.right - translation.left).toBeGreaterThan(
    guide.right - guide.left + 8,
  );

  // A radio group has one too, as tall as its items.
  const group = thumbOf(theme(page));
  await expectThumbUnder(group, radio(page, "Dark"));
  await radio(page, "System").click();
  await expectThumbUnder(group, radio(page, "System"));
  const [shape, item] = [
    await boxOf(group),
    await boxOf(radio(page, "System")),
  ];
  expect(shape.top).toBeCloseTo(item.top, 0);
  expect(shape.bottom).toBeCloseTo(item.bottom, 0);
});

test("thumb is placed without a slide and moves with one", async ({ page }) => {
  await recordThumbTransitions(page);
  await openKit(page);
  const thumb = thumbOf(tablist(page));
  await expect(thumb).toBeVisible();
  await expectThumbUnder(thumb, tab(page, "Guide"));
  // The first place is where it is born, not a slide in from the corner.
  expect(await thumbRuns(page)).toEqual([]);
  expect(await animationsOf(thumb)).toBe(0);

  await tab(page, "Translation").click();
  await expect.poll(() => thumbRuns(page)).toContain("transform");
  expect(await thumbRuns(page)).toContain("width");
  const [property, duration, easing] = await thumb.evaluate((element) => {
    const style = getComputedStyle(element);
    return [
      style.transitionProperty,
      style.transitionDuration,
      style.transitionTimingFunction,
    ];
  });
  expect(property).toBe("transform, width");
  expect(duration).toBe("0.18s, 0.18s");
  expect(easing).toContain("cubic-bezier(0.2, 0, 0, 1)");
  await expectThumbUnder(thumb, tab(page, "Translation"));
});

test("thumb snaps without a slide when the items resize", async ({ page }) => {
  await recordThumbTransitions(page);
  await openKit(page);
  const list = tablist(page);
  const thumb = thumbOf(list);
  await tab(page, "Translation").click();
  await expectThumbUnder(thumb, tab(page, "Translation"));
  // Let the slide of the click end, so that what follows is counted on its own.
  await expect.poll(() => animationsOf(thumb)).toBe(0);
  const before = (await thumbRuns(page)).length;

  // As longer labels would: every item grows, and the ones in front push the selected one on.
  await list.evaluate((element) => {
    for (const item of element.querySelectorAll<HTMLElement>('[role="tab"]'))
      item.style.paddingInline = "28px";
  });
  await expectThumbUnder(thumb, tab(page, "Translation"));
  expect(await thumbRuns(page)).toHaveLength(before);
  expect(await animationsOf(thumb)).toBe(0);
});

test("a value set from outside moves the thumb and the tab stop", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openKit(page);
  await tab(page, "Notes").click();
  await section(page).getByRole("button", { name: "Show Guide" }).click();
  await expect(tab(page, "Guide")).toHaveAttribute("aria-selected", "true");
  await expectOnlyTabStop(tablist(page), tab(page, "Guide"));
  await expectThumbUnder(thumbOf(tablist(page)), tab(page, "Guide"));
  await expect(
    section(page).getByRole("tabpanel", { name: "Guide" }),
  ).toBeVisible();
});

test("a narrow box cuts the labels and the control stays inside it", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openKit(page);
  const group = narrow(page);
  await expect(group).toBeVisible();
  const [outer, inner] = [
    await boxOf(group.locator("xpath=..")),
    await boxOf(group),
  ];
  expect(inner.right).toBeLessThanOrEqual(outer.right);
  expect(inner.left).toBeGreaterThanOrEqual(outer.left);
  expect(
    await group.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);

  // Each label is one line cut with an ellipsis, and the items keep their height.
  const items = group.getByRole("radio");
  await expect(items).toHaveCount(3);
  for (let index = 0; index < 3; index++) {
    const item = items.nth(index);
    expect(await heightOf(item)).toBe(28);
    expect(
      await item.evaluate(
        (element) => element.scrollHeight <= element.clientHeight + 1,
      ),
    ).toBe(true);
  }
  const [wrap, overflow, cut] = await items
    .first()
    .locator("span")
    .evaluate((element) => {
      const style = getComputedStyle(element);
      return [
        style.whiteSpace,
        style.textOverflow,
        element.scrollWidth > element.clientWidth,
      ];
    });
  expect([wrap, overflow, cut]).toEqual(["nowrap", "ellipsis", true]);

  // The thumb sits under the selected item when the items had to shrink.
  await expectThumbUnder(thumbOf(group), items.first());
  await items.nth(1).click();
  await expectThumbUnder(thumbOf(group), items.nth(1));
});

test("sizes: items are 28 and 24 high in a 3px frame", async ({ page }) => {
  await openKit(page);
  const metrics = (control: Locator) =>
    control.evaluate((element) => {
      const item = element.querySelector<HTMLElement>("[role]")!;
      const frame = getComputedStyle(element);
      const text = getComputedStyle(item);
      const [outer, inner] = [
        element.getBoundingClientRect(),
        item.getBoundingClientRect(),
      ];
      return {
        item: inner.height,
        frame: outer.height,
        padding: [frame.paddingTop, frame.paddingLeft],
        offset: inner.left - outer.left,
        fontSize: text.fontSize,
        itemPadding: [text.paddingLeft, text.paddingRight],
        radius: parseFloat(frame.borderTopLeftRadius),
      };
    });

  const md = await metrics(theme(page));
  expect(md).toMatchObject({
    item: 28,
    frame: 34,
    padding: ["3px", "3px"],
    offset: 3,
    fontSize: "13px",
    itemPadding: ["12px", "12px"],
  });
  expect(md.radius).toBeGreaterThan(100);
  expect(await metrics(pageFit(page))).toMatchObject({
    item: 24,
    frame: 30,
    padding: ["3px", "3px"],
    fontSize: "12px",
    itemPadding: ["12px", "12px"],
  });
});

for (const mode of ["light", "dark"] as const) {
  test(`${mode}: text meets WCAG AA and the thumb is a raised surface`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openKit(page, { theme: mode });
    await expect(page.locator("html")).toHaveAttribute("data-theme", mode);
    const group = theme(page);
    await radio(page, "Light").click();
    await expectThumbUnder(thumbOf(group), radio(page, "Light"));

    /** A CSS value as the browser computes it for the given property. */
    const computed = (property: "color" | "backgroundColor", css: string) =>
      page.evaluate(
        ([name, value]) => {
          const probe = document.createElement("div");
          probe.style.setProperty(
            name === "color" ? "color" : "background",
            value,
          );
          document.body.append(probe);
          const result = getComputedStyle(probe).getPropertyValue(
            name === "color" ? "color" : "background-color",
          );
          probe.remove();
          return result;
        },
        [property, css],
      );
    const colorOf = (item: Locator) =>
      item.evaluate((element) => getComputedStyle(element).color);

    // Selected text is the body color, the others the caption color.
    expect(await colorOf(radio(page, "Light"))).toBe(
      await computed("color", "var(--ui-fg)"),
    );
    expect(await colorOf(radio(page, "Dark"))).toBe(
      await computed("color", "var(--ui-fg-2)"),
    );
    // Caption text on the pill (a fill over the page), body text on the thumb.
    for (const base of ["--ui-bg", "--ui-bg-1"])
      expect(
        await contrastOfTokens(page, "--ui-fg-2", "--ui-fill", base),
      ).toBeGreaterThanOrEqual(4.5);
    expect(
      await contrastOfTokens(page, "--ui-fg", "--ui-elev"),
    ).toBeGreaterThanOrEqual(4.5);

    const thumb = await thumbOf(group).evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        background: style.backgroundColor,
        shadow: style.boxShadow,
        radius: parseFloat(style.borderTopLeftRadius),
      };
    });
    expect(thumb.background).toBe(
      await computed("backgroundColor", "var(--ui-elev)"),
    );
    const shadow = await page.evaluate(() => {
      const probe = document.createElement("div");
      probe.style.boxShadow = "var(--ui-elev-1)";
      document.body.append(probe);
      const result = getComputedStyle(probe).boxShadow;
      probe.remove();
      return result;
    });
    expect(thumb.shadow).toBe(shadow);
    expect(thumb.radius).toBeGreaterThan(100);

    // The pill is the soft fill, fully round.
    const pill = await group.evaluate((element) => {
      const style = getComputedStyle(element);
      return [
        style.backgroundColor,
        parseFloat(style.borderTopLeftRadius),
      ] as const;
    });
    expect(pill[0]).toBe(await computed("backgroundColor", "var(--ui-fill)"));
    expect(pill[1]).toBeGreaterThan(100);
  });
}

test("the focus ring is on the control, and only for the keyboard", async ({
  page,
}) => {
  await openKit(page);
  const group = theme(page);
  const ringOf = (locator: Locator) =>
    locator.evaluate((element) => getComputedStyle(element).boxShadow);
  await radio(page, "Light").click();
  // A press does not show the ring.
  expect(await ringOf(group)).toBe("none");

  await page.keyboard.press("ArrowRight");
  await expect(radio(page, "System")).toBeFocused();
  expect(await ringOf(group)).not.toBe("none");
  // The item itself carries none: it would run over the edge of the pill.
  expect(await ringOf(radio(page, "System"))).toBe("none");
});

test("a press on the thumb reaches the item under it", async ({ page }) => {
  await openKit(page);
  const guide = tab(page, "Guide");
  await guide.scrollIntoViewIfNeeded();
  const box = await boxOf(guide);
  const role = await page.evaluate(
    ([x, y]) =>
      document.elementFromPoint(x, y)?.closest("[role]")?.getAttribute("role"),
    [(box.left + box.right) / 2, (box.top + box.bottom) / 2],
  );
  expect(role).toBe("tab");
});
