import { expect, test, type Locator, type Page } from "@playwright/test";
import { contrast, openKit } from "./helpers";

const section = (page: Page) =>
  page.getByRole("region", { name: "Toast", exact: true });
const opener = (page: Page, name: string) =>
  section(page).getByRole("button", { name, exact: true });
const toaster = (page: Page) =>
  page.getByRole("region", { name: "Notifications", exact: true });
const copied = (page: Page) => page.getByText("Copied", { exact: true });
const failed = (page: Page) => toaster(page).getByRole("alert");
const status = (page: Page) => toaster(page).getByRole("status");
const dismiss = (toast: Locator) =>
  toast.getByRole("button", { name: "Dismiss" });
const retried = (page: Page) => section(page).locator("output");
const dialogOpener = (page: Page, name: string) =>
  page
    .getByRole("region", { name: "Dialog", exact: true })
    .getByRole("button", { name, exact: true });
const rename = (page: Page) =>
  page.getByRole("dialog", { name: "Rename paper" });

/** Wait for every running transition, so rectangles are the settled ones. */
const settled = (page: Page) =>
  page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation instanceof CSSTransition)
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  );

/** Focus a button the way a keyboard user arrives: so `:focus-visible` matches. */
async function focusWithKeyboard(page: Page, button: Locator) {
  await button.focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(button).toBeFocused();
}

/**
 * Time is the test's: it stands still until `runFor`, so a countdown is exactly
 * as far along as the test has moved it, however slow the machine is.
 */
test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date("2026-01-01T00:00:00Z") });
  await openKit(page, { locale: "en" });
  await page.clock.pauseAt(new Date("2026-01-01T00:01:00Z"));
});

test("info toasts expire after five seconds", async ({ page }) => {
  await opener(page, "Show info").click();
  await expect(copied(page)).toBeVisible();
  await expect(status(page)).toHaveText("Copied");

  await page.clock.runFor(4900);
  await expect(copied(page)).toBeVisible();
  await page.clock.runFor(200);
  await expect(copied(page)).toHaveCount(0);
  // With none left the stack is gone altogether, not an empty box.
  await expect(toaster(page)).toBeHidden();
});

test("error toasts stay until dismissed", async ({ page }) => {
  await opener(page, "Show error").click();
  const toast = failed(page);
  await expect(toast).toContainText("Import failed");
  await expect(toast).toContainText("The file is not a PDF.");

  await page.clock.runFor(60000);
  await expect(toast).toBeVisible();
  await dismiss(toast).click();
  await expect(toast).toHaveCount(0);
});

test("action runs and closes the toast", async ({ page }) => {
  await opener(page, "Show error").click();
  await expect(retried(page)).toHaveText("idle");
  await failed(page)
    .getByRole("button", { name: "Retry", exact: true })
    .click();
  await expect(retried(page)).toHaveText("Retried");
  await expect(failed(page)).toHaveCount(0);
});

test("hover pauses the countdown", async ({ page }) => {
  await opener(page, "Show info").click();
  await expect(copied(page)).toBeVisible();
  await page.clock.runFor(3000);

  await copied(page).hover();
  await page.clock.runFor(10000);
  await expect(copied(page)).toBeVisible();

  // It goes on from the two seconds it had left, not from five.
  await page.mouse.move(0, 0);
  await page.clock.runFor(1900);
  await expect(copied(page)).toBeVisible();
  await page.clock.runFor(200);
  await expect(copied(page)).toHaveCount(0);
});

test("hover pauses the countdown from the start", async ({ page }) => {
  await opener(page, "Show info").click();
  await copied(page).hover();
  await page.clock.runFor(10000);
  await expect(copied(page)).toBeVisible();
  await page.mouse.move(0, 0);
  await page.clock.runFor(5100);
  await expect(copied(page)).toHaveCount(0);
});

test("pointing at one toast holds the countdown of the others too", async ({
  page,
}) => {
  await opener(page, "Show info").click();
  await opener(page, "Show error").click();
  await expect(failed(page)).toBeVisible();
  await failed(page).hover();
  await page.clock.runFor(10000);
  await expect(copied(page)).toBeVisible();
  await page.mouse.move(0, 0);
  await page.clock.runFor(5100);
  await expect(copied(page)).toHaveCount(0);
  await expect(failed(page)).toBeVisible();
});

test("the focus inside holds the countdown, and leaving it lets it go on", async ({
  page,
}) => {
  await opener(page, "Show info").click();
  await expect(copied(page)).toBeVisible();
  await page.clock.runFor(3000);
  await focusWithKeyboard(page, dismiss(status(page)));
  await page.clock.runFor(10000);
  await expect(copied(page)).toBeVisible();

  await page.keyboard.press("Tab");
  await page.clock.runFor(1900);
  await expect(copied(page)).toBeVisible();
  await page.clock.runFor(200);
  await expect(copied(page)).toHaveCount(0);
});

test("a toast dismissed with the pointer does not leave the others held", async ({
  page,
}) => {
  await opener(page, "Show info").click();
  await opener(page, "Show error").click();
  await expect(failed(page)).toBeVisible();
  await dismiss(failed(page)).click();
  await expect(failed(page)).toHaveCount(0);
  await page.mouse.move(0, 0);
  // The button that was pressed is gone and the focus did not go anywhere in the stack: nothing holds the countdown.
  expect(
    await page.evaluate(
      () => !!document.activeElement?.closest("[data-toaster]"),
    ),
  ).toBe(false);
  await page.clock.runFor(5100);
  await expect(copied(page)).toHaveCount(0);
});

test("a toast dismissed from the keyboard hands the focus to the next one", async ({
  page,
}) => {
  await opener(page, "Show error").click();
  await opener(page, "Show info").click();
  await expect(copied(page)).toBeVisible();
  await focusWithKeyboard(page, dismiss(failed(page)));
  await page.keyboard.press("Enter");
  await expect(failed(page)).toHaveCount(0);
  await expect(dismiss(status(page))).toBeFocused();

  // It has the focus, so it is held; and the last one gives it to what is left before it.
  await page.clock.runFor(10000);
  await expect(copied(page)).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(copied(page)).toHaveCount(0);
});

test("the last toast dismissed from the keyboard leaves the focus where the browser puts it", async ({
  page,
}) => {
  await opener(page, "Show info").click();
  await expect(copied(page)).toBeVisible();
  await focusWithKeyboard(page, dismiss(status(page)));
  await page.keyboard.press("Enter");
  await expect(copied(page)).toHaveCount(0);
  expect(await page.evaluate(() => document.activeElement?.tagName)).toBe(
    "BODY",
  );
});

test("the same toast is not stacked twice", async ({ page }) => {
  await opener(page, "Show info").click();
  await opener(page, "Show info").click();
  await expect(status(page)).toHaveCount(1);
});

test("it sits at the bottom centre of the window, 24px up, with 8px between toasts", async ({
  page,
}) => {
  await opener(page, "Show info").click();
  await opener(page, "Show error").click();
  await expect(failed(page)).toBeVisible();
  await settled(page);
  const layout = await toaster(page).evaluate((stack) => {
    const box = stack.getBoundingClientRect();
    const [first, second] = [...stack.children].map((toast) =>
      toast.getBoundingClientRect(),
    );
    return {
      centre: box.x + box.width / 2 - document.documentElement.clientWidth / 2,
      gapBelow: window.innerHeight - box.bottom,
      between: second.top - first.bottom,
      // Narrower toasts are stretched to the widest, so the stack reads as one.
      widths: [first.width, second.width],
    };
  });
  expect(Math.abs(layout.centre)).toBeLessThan(1);
  expect(layout.gapBelow).toBeCloseTo(24, 1);
  expect(layout.between).toBeCloseTo(8, 1);
  expect(layout.widths[0]).toBe(layout.widths[1]);
});

test("it is at most 420px wide, and always inside the window", async ({
  page,
}) => {
  await opener(page, "Show error").click();
  const stack = toaster(page);
  const widest = () => stack.evaluate((el) => getComputedStyle(el).maxWidth);
  expect(await widest()).toBe("420px");

  await page.setViewportSize({ width: 360, height: 640 });
  expect(await widest()).toBe("328px");
  const box = await stack.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(16);
  expect(box!.x + box!.width).toBeLessThanOrEqual(360 - 16);
});

test("it comes in with a short fade and a rise of 8px", async ({ page }) => {
  const motion = await opener(page, "Show info").evaluate(async (button) => {
    button.click();
    // React draws the toast a moment after the click, before anything else runs.
    let toast: Element | null = null;
    for (let turn = 0; turn < 50 && !toast; turn++) {
      await Promise.resolve();
      toast = document.querySelector('[data-toaster] [role="status"]');
    }
    return (toast?.getAnimations() ?? []).map((animation) => {
      const transition = animation as CSSTransition;
      const keyframes = transition.effect!.getKeyframes();
      return {
        property: transition.transitionProperty,
        duration: transition.effect!.getTiming().duration,
        from: String(keyframes[0][transition.transitionProperty as "opacity"]),
      };
    });
  });
  expect(motion).toEqual(
    expect.arrayContaining([
      { property: "opacity", duration: 180, from: "0" },
      { property: "transform", duration: 180, from: "translateY(8px)" },
    ]),
  );
});

test("a toast raised again does not start the others over", async ({
  page,
}) => {
  await opener(page, "Show error").click();
  await expect(failed(page)).toBeVisible();
  await settled(page);
  await failed(page).evaluate((toast) => {
    const counted = window as unknown as { runs: number };
    counted.runs = 0;
    toast.addEventListener("transitionrun", () => counted.runs++);
  });
  await opener(page, "Show info").click();
  await expect(status(page)).toBeVisible();
  await settled(page);
  expect(
    await page.evaluate(() => (window as unknown as { runs: number }).runs),
  ).toBe(0);
});

test("Escape leaves the toasts alone", async ({ page }) => {
  await opener(page, "Show error").click();
  await expect(failed(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(failed(page)).toBeVisible();
});

test("tones: an error and a success have an icon in their color, an info toast none", async ({
  page,
}) => {
  await opener(page, "Show info").click();
  await opener(page, "Show error").click();
  await opener(page, "Show over dialog").click();
  await page.keyboard.press("Escape");
  const info = status(page).filter({ hasText: "Copied" });
  const success = status(page).filter({ hasText: "Over the dialog" });
  await expect(info).toBeVisible();
  await expect(failed(page)).toBeVisible();
  await expect(success).toBeVisible();

  const iconColor = (toast: Locator) =>
    toast
      .locator("svg")
      .first()
      .evaluate((icon) => getComputedStyle(icon).color);
  const token = (name: string) =>
    page.evaluate((property) => {
      const probe = document.createElement("div");
      probe.style.color = `var(${property})`;
      document.body.append(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    }, name);
  // The only svg in an info toast is the one in its dismiss button.
  await expect(info.locator("svg")).toHaveCount(1);
  await expect(failed(page).locator("svg")).toHaveCount(2);
  expect(await iconColor(failed(page))).toBe(await token("--ui-danger-text"));
  expect(await iconColor(success)).toBe(await token("--ui-success-text"));
});

test("its text is legible in both themes", async ({ page }) => {
  for (const theme of ["light", "dark"]) {
    await page.getByLabel("Kit theme").selectOption(theme);
    await opener(page, "Show error").click();
    await expect(failed(page)).toBeVisible();
    await settled(page);
    const colors = await failed(page).evaluate((toast) => {
      const color = (selector: string) =>
        getComputedStyle(toast.querySelector(selector)!).color;
      return {
        background: getComputedStyle(toast).backgroundColor,
        message: color("p:first-of-type"),
        description: color("p:last-of-type"),
        icon: color("svg"),
      };
    });
    for (const part of ["message", "description", "icon"] as const) {
      expect(
        await contrast(page, colors[part], colors.background),
        `${part} in ${theme}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
    await dismiss(failed(page)).click();
    await expect(failed(page)).toHaveCount(0);
  }
});

test("the region and the dismiss button are named in the interface language", async ({
  page,
}) => {
  await page.getByLabel("Kit locale").selectOption("zh");
  await opener(page, "Show info").click();
  const stack = page.getByRole("region", { name: "通知", exact: true });
  await expect(stack).toBeVisible();
  await stack.getByRole("button", { name: "关掉提示" }).click();
  await expect(stack).toBeHidden();
});

test("toast appears above an open dialog and is clickable", async ({
  page,
}) => {
  await opener(page, "Show over dialog").click();
  const dialog = page.getByRole("dialog", { name: "Under the toast" });
  await expect(dialog).toBeVisible();
  const toast = status(page);
  await expect(toast).toHaveText("Over the dialog");

  await dismiss(toast).click();
  await expect(toast).toHaveCount(0);
  // The press was the toast's: the dialog did not take it for one on its backdrop.
  await page.waitForTimeout(300);
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveJSProperty("open", true);
});

test("a toast that is already showing follows a dialog that opens over it", async ({
  page,
}) => {
  await opener(page, "Show error").click();
  await expect(failed(page)).toBeVisible();
  await dialogOpener(page, "Open dialog").click();
  await expect(rename(page)).toBeVisible();

  // The browser shuts everything outside a modal dialog, so the stack moved inside it.
  await expect(rename(page).locator("[data-toaster]")).toBeVisible();
  await failed(page)
    .getByRole("button", { name: "Retry", exact: true })
    .click();
  await expect(retried(page)).toHaveText("Retried");
  await expect(failed(page)).toHaveCount(0);
  await page.waitForTimeout(300);
  await expect(rename(page)).toBeVisible();
});

test("a toast does not keep the backdrop from closing the dialog, and is outside it again after", async ({
  page,
}) => {
  await opener(page, "Show error").click();
  await dialogOpener(page, "Open dialog").click();
  await expect(rename(page)).toBeVisible();
  await expect(rename(page).locator("[data-toaster]")).toBeVisible();

  await page.mouse.click(8, 8);
  await expect(rename(page)).toBeHidden();
  await expect(failed(page)).toBeVisible();
  await expect(page.locator("dialog [data-toaster]")).toHaveCount(0);
  // And it works out here too.
  await dismiss(failed(page)).click();
  await expect(failed(page)).toHaveCount(0);
});

test("with dialogs on top of each other the toast is in the one on top", async ({
  page,
}) => {
  await opener(page, "Show error").click();
  const wide = page.getByRole("dialog", { name: "Paper details" });
  const locked = page.getByRole("dialog", { name: "Discard changes?" });
  await dialogOpener(page, "Open wide dialog").click();
  await expect(wide.locator("[data-toaster]")).toBeVisible();

  await wide.getByRole("button", { name: "Discard changes" }).click();
  await expect(locked).toBeVisible();
  await expect(locked.locator("[data-toaster]")).toBeVisible();
  await expect(wide.locator("[data-toaster]")).toHaveCount(0);

  await locked.getByRole("button", { name: "Keep editing" }).click();
  await expect(locked).toBeHidden();
  await expect(wide.locator("[data-toaster]")).toBeVisible();
});

test("Tab and Shift+Tab wrap round a dialog that has a toast in it", async ({
  page,
}) => {
  await opener(page, "Show error").click();
  await dialogOpener(page, "Open dialog").click();
  await expect(rename(page).locator("[data-toaster]")).toBeVisible();

  // The toast's buttons come last in the dialog: Tab goes on to the first, and Shift+Tab back to the last.
  const close = rename(page).getByRole("button", { name: "Close" });
  const last = dismiss(failed(page));
  await last.focus();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(last).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
});

test("a toast dismissed from the keyboard in a dialog leaves the focus in the dialog", async ({
  page,
}) => {
  await opener(page, "Show error").click();
  await opener(page, "Show info").click();
  await expect(copied(page)).toBeVisible();
  await dialogOpener(page, "Open dialog").click();
  await expect(rename(page)).toBeVisible();
  const field = rename(page).getByRole("textbox", { name: "Name" });

  await focusWithKeyboard(page, dismiss(failed(page)));
  await page.keyboard.press("Enter");
  await expect(failed(page)).toHaveCount(0);
  // The next toast first...
  await expect(dismiss(status(page))).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(copied(page)).toHaveCount(0);
  // ...then, with none left, back into the dialog where it starts, not out on the page.
  await expect(field).toBeFocused();
  await expect(rename(page)).toBeVisible();
});

test("an action chosen from the keyboard in a dialog leaves the focus in the dialog too", async ({
  page,
}) => {
  await opener(page, "Show error").click();
  await dialogOpener(page, "Open dialog").click();
  await expect(rename(page)).toBeVisible();
  const retry = failed(page).getByRole("button", {
    name: "Retry",
    exact: true,
  });
  await focusWithKeyboard(page, retry);
  await page.keyboard.press("Enter");
  await expect(retried(page)).toHaveText("Retried");
  await expect(failed(page)).toHaveCount(0);
  await expect(
    rename(page).getByRole("textbox", { name: "Name" }),
  ).toBeFocused();
});
