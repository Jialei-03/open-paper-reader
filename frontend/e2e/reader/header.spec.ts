import { expect, test, type Page } from "@playwright/test";
import {
  createPaperWithPdf,
  openReader,
  signIn,
  type OutlineItem,
} from "./fixtures";
import type { ReaderRoute } from "../../src/reader/route";

// The interface follows the browser's language; these specs read it in Chinese.
test.use({ locale: "zh-CN" });

const PAGES = 40;

const main = (page: Page) => page.getByRole("main");
const scroller = (page: Page) =>
  page.getByRole("region", { name: "论文页面", exact: true });
const pdfPage = (page: Page, number: number) =>
  page.locator(`[data-page="${number}"]`);
const pageInput = (page: Page) =>
  main(page).getByRole("textbox", { name: "页码", exact: true });
const announcement = (page: Page) => main(page).locator('[aria-live="polite"]');
const zoomButton = (page: Page) =>
  main(page).getByRole("button", { name: /^缩放/ });
const moreButton = (page: Page) =>
  main(page).getByRole("button", { name: "更多", exact: true });
const outlineButton = (page: Page) =>
  main(page).getByRole("button", { name: "目录与页面", exact: true });
const findRegion = (page: Page) =>
  page.getByRole("search", { name: "论文全文查找" });
const findInput = (page: Page) =>
  page.getByRole("textbox", { name: "查找论文内容", exact: true });
const highlights = (page: Page) =>
  page.locator('[data-testid="pdf-search-highlight"] span');

/** Sign in and open a paper of 40 pages; wait for the first page to be drawn. */
async function open(
  page: Page,
  made: Parameters<typeof createPaperWithPdf>[1] = {},
  route: Partial<ReaderRoute> = {},
) {
  await signIn(page);
  const paper = await createPaperWithPdf(page, { pages: PAGES, ...made });
  await openReader(page, { paperId: paper.paperId, ...route });
  await expect(pdfPage(page, 1)).toHaveAttribute("data-rendered", "true");
  return paper;
}

/** Through the page field, as a person does; resolves once the page is at the top of the desk. */
async function jumpTo(page: Page, number: number) {
  await pageInput(page).fill(String(number));
  await pageInput(page).press("Enter");
  await expect(pageInput(page)).toHaveValue(String(number));
  await expectAtTop(page, number);
}

/** The page's top is just under the top of the desk (the desk pads the first page by 20px). */
async function expectAtTop(page: Page, number: number) {
  await expect
    .poll(async () => {
      const [sheet, desk] = await Promise.all([
        pdfPage(page, number).boundingBox(),
        scroller(page).boundingBox(),
      ]);
      return Math.abs(sheet!.y - desk!.y - 20);
    })
    .toBeLessThan(6);
}

/** The page under the middle of the desk, worked out from where the pages are. */
const underMiddle = (page: Page) =>
  page.evaluate(() => {
    const desk = document
      .querySelector('[role="region"][data-file]')!
      .getBoundingClientRect();
    const middle = desk.top + desk.height / 2;
    const sheets = [...document.querySelectorAll<HTMLElement>("[data-page]")];
    for (const [index, sheet] of sheets.entries()) {
      const box = sheet.getBoundingClientRect();
      const end = sheets[index + 1]?.getBoundingClientRect().top ?? box.bottom;
      if (end > middle) return Number(sheet.dataset.page);
    }
    return sheets.length;
  });

/** Wait for every running transition, so that rectangles are the settled ones. */
const settled = (page: Page) =>
  page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation instanceof CSSTransition)
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  );

async function chooseZoom(page: Page, name: string) {
  await zoomButton(page).click();
  await page
    .getByRole("menu", { name: "缩放", exact: true })
    .getByRole("menuitem", { name, exact: true })
    .click();
}

test("the page field jumps, takes the nearest page, and the buttons and [ ] step", async ({
  page,
}) => {
  await open(page);
  const previous = main(page).getByRole("button", {
    name: "上一页",
    exact: true,
  });
  const next = main(page).getByRole("button", { name: "下一页", exact: true });

  await expect(pageInput(page)).toHaveValue("1");
  await expect(main(page).getByText("/ 40", { exact: true })).toBeVisible();
  // At the first page there is nowhere to go back to.
  await expect(previous).toHaveAttribute("aria-disabled", "true");
  await expect(next).not.toHaveAttribute("aria-disabled", "true");

  await jumpTo(page, 12);
  await expect(previous).not.toHaveAttribute("aria-disabled", "true");
  // A page past the end is the last one; Tab leaving the field is as good as Enter.
  await pageInput(page).fill("999");
  await pageInput(page).press("Enter");
  await expect(pageInput(page)).toHaveValue("40");
  await expect(pdfPage(page, 40)).toBeInViewport();
  await expect(next).toHaveAttribute("aria-disabled", "true");
  await pageInput(page).fill("0");
  await pageInput(page).press("Tab");
  await expect(pageInput(page)).toHaveValue("1");
  await expectAtTop(page, 1);
  // What is not a number is let go: the field shows the page again.
  await pageInput(page).fill("ab");
  await pageInput(page).press("Enter");
  await expect(pageInput(page)).toHaveValue("1");

  await next.click();
  await expect(pageInput(page)).toHaveValue("2");
  await expectAtTop(page, 2);
  await next.click();
  await expect(pageInput(page)).toHaveValue("3");
  await previous.click();
  await expect(pageInput(page)).toHaveValue("2");

  // The keys work with the keyboard in the paper...
  await scroller(page).focus();
  await page.keyboard.press("]");
  await expect(pageInput(page)).toHaveValue("3");
  await expectAtTop(page, 3);
  await page.keyboard.press("[");
  await expect(pageInput(page)).toHaveValue("2");
  // ...and are only keys when it is not text being typed.
  await pageInput(page).focus();
  await page.keyboard.press("]");
  await page.waitForTimeout(300);
  await expect(pageInput(page)).toHaveValue("2");
  await expect(announcement(page)).toHaveText("第 2 页 / 共 40 页");
});

test("Esc in the page field takes the typing back, and Enter goes there once", async ({
  page,
}) => {
  await open(page);
  // Counts what sets the desk's scroll position: a jump to a page is one set.
  await page.evaluate(() => {
    const desk = document.querySelector<HTMLElement>(
      '[role="region"][data-file]',
    )!;
    const own = Object.getOwnPropertyDescriptor(
      Element.prototype,
      "scrollTop",
    )!;
    const counted = window as unknown as { deskSets: number };
    counted.deskSets = 0;
    Object.defineProperty(desk, "scrollTop", {
      configurable: true,
      get() {
        return own.get!.call(this);
      },
      set(value: number) {
        counted.deskSets++;
        own.set!.call(this, value);
      },
    });
  });
  const sets = () =>
    page.evaluate(() => (window as unknown as { deskSets: number }).deskSets);

  // Typed, then given up: the field shows the page again and the paper did not move.
  await pageInput(page).fill("25");
  await pageInput(page).press("Escape");
  await expect(pageInput(page)).toHaveValue("1");
  await expect(scroller(page)).toBeFocused();
  await page.waitForTimeout(400);
  await expect(pageInput(page)).toHaveValue("1");
  await expect(announcement(page)).toHaveText("第 1 页 / 共 40 页");
  expect(await sets()).toBe(0);

  // Typed, then Enter: one jump, not one for Enter and another for the field losing the keyboard.
  await pageInput(page).fill("25");
  await pageInput(page).press("Enter");
  await expect(pageInput(page)).toHaveValue("25");
  await expectAtTop(page, 25);
  await page.waitForTimeout(400);
  expect(await sets()).toBe(1);
  await expect(scroller(page)).toBeFocused();
});

test("the zoom menu sets the zoom and shows it; mod+0 fits the width again", async ({
  page,
}) => {
  await open(page);
  const first = pdfPage(page, 1);
  await expect(zoomButton(page)).toHaveText("100%");

  await zoomButton(page).click();
  const menu = page.getByRole("menu", { name: "缩放", exact: true });
  for (const name of [
    "适合宽度",
    "实际大小",
    "放大",
    "缩小",
    "50%",
    "75%",
    "100%",
    "125%",
    "150%",
    "200%",
    "300%",
  ])
    await expect(
      menu.getByRole("menuitem", { name, exact: true }),
    ).toBeVisible();
  // The keys that do the same are on the rows.
  await expect(
    menu.getByRole("menuitem", { name: "适合宽度", exact: true }),
  ).toHaveAttribute("aria-keyshortcuts", /^(Control|Meta)\+0$/);
  await expect(
    menu.getByRole("menuitem", { name: "放大", exact: true }),
  ).toHaveAttribute("aria-keyshortcuts", /^(Control|Meta)\+=$/);
  await expect(
    menu.getByRole("menuitem", { name: "缩小", exact: true }),
  ).toHaveAttribute("aria-keyshortcuts", /^(Control|Meta)\+-$/);

  await menu.getByRole("menuitem", { name: "200%", exact: true }).click();
  await expect(first).toHaveAttribute("data-scale", "2");
  await expect(first).toHaveAttribute("data-rendered", "true");
  expect(Math.abs((await first.boundingBox())!.width - 612 * 2)).toBeLessThan(
    2,
  );
  await expect(zoomButton(page)).toHaveText("200%");

  // The menu's own steps, and then the keys, from wherever the keyboard is in the card.
  await chooseZoom(page, "缩小");
  await expect(zoomButton(page)).toHaveText("190%");
  await page.keyboard.press("ControlOrMeta+0");
  await expect(first).not.toHaveAttribute("data-scale", "1.9");
  await expect(first).toHaveAttribute("data-rendered", "true");
  const room = await scroller(page).evaluate((element) => {
    const style = getComputedStyle(element.firstElementChild!);
    return (
      element.clientWidth -
      parseFloat(style.paddingLeft) -
      parseFloat(style.paddingRight)
    );
  });
  await expect
    .poll(async () => Math.abs((await first.boundingBox())!.width - room))
    .toBeLessThan(2);
  // Fit to width is a number too, and the button says it.
  const fitted = Math.round((room / 612) * 100);
  await expect(zoomButton(page)).toHaveText(`${fitted}%`);

  await chooseZoom(page, "实际大小");
  await expect(first).toHaveAttribute("data-scale", "1");
  await expect(zoomButton(page)).toHaveText("100%");
});

test("the page number survives a zoom and a resize", async ({ page }) => {
  await open(page);
  await jumpTo(page, 12);

  await chooseZoom(page, "200%");
  await expect(pdfPage(page, 12)).toHaveAttribute("data-scale", "2");
  await expect(pdfPage(page, 12)).toHaveAttribute("data-rendered", "true");
  await page.waitForTimeout(500);
  await expect(pageInput(page)).toHaveValue("12");
  await expect(announcement(page)).toHaveText("第 12 页 / 共 40 页");

  await page.setViewportSize({ width: 1200, height: 900 });
  await expect(pdfPage(page, 12)).toHaveAttribute("data-rendered", "true");
  await page.waitForTimeout(500);
  await expect(pageInput(page)).toHaveValue("12");
  await expect(announcement(page)).toHaveText("第 12 页 / 共 40 页");
});

test("a wheel zoom out re-reads the page, and a stale jump does not outlive it", async ({
  page,
}) => {
  await open(page);
  await jumpTo(page, 12);

  // Zoom out with the pointer at the top of the desk: the top of page 12 stays where it was, the middle of the view moves on to a later page.
  const desk = (await scroller(page).boundingBox())!;
  await page.mouse.move(desk.x + desk.width / 2, desk.y + 30);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, 100);
  await page.keyboard.up("Control");
  await expect
    .poll(async () =>
      Number(await pdfPage(page, 12).getAttribute("data-scale")),
    )
    .toBeLessThan(0.6);
  await expect(pdfPage(page, 12)).toHaveAttribute("data-rendered", "true");
  await expect.poll(() => underMiddle(page)).toBeGreaterThan(12);
  await expect
    .poll(async () => Number(await pageInput(page).inputValue()))
    .toBe(await underMiddle(page));

  // A resize afterwards does not pull the view back to where the jump put it.
  const before = await underMiddle(page);
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.waitForTimeout(600);
  expect(await underMiddle(page)).toBeGreaterThanOrEqual(before - 1);
  await expect
    .poll(async () => Number(await pageInput(page).inputValue()))
    .toBe(await underMiddle(page));
});

test("find: mod+f opens the bar, finds across pages, steps, and Esc goes back", async ({
  page,
}) => {
  await open(page, { words: { 3: "zebra", 7: "zebra" } });
  await jumpTo(page, 5);
  const home = await scroller(page).evaluate((element) => element.scrollTop);
  // Whether the page took mod+f (then the browser's own find is not opened).
  await page.evaluate(() => {
    const seen: boolean[] = [];
    (window as unknown as { findKeys: boolean[] }).findKeys = seen;
    document.addEventListener("keydown", (event) => {
      if (event.key.toLowerCase() === "f" && (event.ctrlKey || event.metaKey))
        seen.push(event.defaultPrevented);
    });
  });

  await scroller(page).focus();
  await page.keyboard.press("ControlOrMeta+f");
  await expect(findRegion(page)).toBeVisible();
  await expect(findInput(page)).toBeFocused();
  expect(
    await page.evaluate(
      () => (window as unknown as { findKeys: boolean[] }).findKeys,
    ),
  ).toEqual([true]);
  const count = findRegion(page).getByRole("status");

  await findInput(page).fill("zebra");
  await expect(count).toHaveText("1 / 2");
  await expect(pageInput(page)).toHaveValue("3");
  const mark = pdfPage(page, 3).locator(
    '[data-testid="pdf-search-highlight"] span',
  );
  await expect(mark.first()).toBeVisible();
  // The mark is on the word, and the word is brought to the middle of the desk.
  const word = (await pdfPage(page, 3)
    .locator(".textLayer span", { hasText: "zebra" })
    .boundingBox())!;
  const marked = (await mark.first().boundingBox())!;
  expect(Math.abs(marked.x - word.x)).toBeLessThan(4);
  expect(Math.abs(marked.y - word.y)).toBeLessThan(6);
  const desk = (await scroller(page).boundingBox())!;
  expect(
    Math.abs(marked.y + marked.height / 2 - (desk.y + desk.height / 2)),
  ).toBeLessThan(60);

  await findInput(page).press("Enter");
  await expect(count).toHaveText("2 / 2");
  await expect(pageInput(page)).toHaveValue("7");
  await expect(
    pdfPage(page, 7)
      .locator('[data-testid="pdf-search-highlight"] span')
      .first(),
  ).toBeVisible();
  await expect(highlights(page)).toHaveCount(1);
  // Past the last match is the first; Shift+Enter goes the other way round.
  await findInput(page).press("Enter");
  await expect(count).toHaveText("1 / 2");
  await expect(pageInput(page)).toHaveValue("3");
  await findInput(page).press("Shift+Enter");
  await expect(count).toHaveText("2 / 2");
  await findRegion(page)
    .getByRole("button", { name: "上一个匹配", exact: true })
    .click();
  await expect(count).toHaveText("1 / 2");
  await findRegion(page)
    .getByRole("button", { name: "下一个匹配", exact: true })
    .click();
  await expect(count).toHaveText("2 / 2");

  await findInput(page).fill("qqqq-not-there");
  await expect(count).toHaveText("无匹配");
  await expect(highlights(page)).toHaveCount(0);

  await findInput(page).fill("zebra");
  await expect(count).toHaveText("1 / 2");
  await findInput(page).press("Escape");
  await expect(findRegion(page)).toHaveCount(0);
  await expect(highlights(page)).toHaveCount(0);
  // Back where the reading was before the search, with the keyboard in the paper again.
  await expect(pageInput(page)).toHaveValue("5");
  await expect
    .poll(() => scroller(page).evaluate((element) => element.scrollTop))
    .toBeLessThan(home + 3);
  expect(
    Math.abs(
      (await scroller(page).evaluate((element) => element.scrollTop)) - home,
    ),
  ).toBeLessThan(3);
  await expect(scroller(page)).toBeFocused();

  // The button opens it too, and closing it by its own button goes back as well.
  await main(page)
    .getByRole("button", { name: "查找论文", exact: true })
    .click();
  await expect(findInput(page)).toBeFocused();
  await findInput(page).fill("Page 1 ");
  await expect(count).toHaveText("1 / 11");
  await findRegion(page)
    .getByRole("button", { name: "关闭查找", exact: true })
    .click();
  await expect(findRegion(page)).toHaveCount(0);
  await expect(pageInput(page)).toHaveValue("5");
});

test("the outline lists the PDF's own contents, nested, and a click goes there", async ({
  page,
}) => {
  const outline: OutlineItem[] = [
    { title: "Introduction", page: 2 },
    {
      title: "Methods",
      page: 8,
      children: [
        { title: "Datasets", page: 12 },
        {
          title: "Training",
          page: 15,
          children: [{ title: "Schedules", page: 16 }],
        },
      ],
    },
    // Its destination leads nowhere: the title stays, there is nothing to press.
    { title: "Broken entry", page: 1, dest: "(nowhere)" },
    { title: "Results", page: 30 },
  ];
  await open(page, { outline });

  await outlineButton(page).click();
  const panel = page.getByRole("dialog", { name: "目录与页面", exact: true });
  await expect(panel).toBeVisible();
  await expect(
    panel.getByRole("tab", { name: "目录", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  // The keyboard starts on the tabs.
  await expect(
    panel.getByRole("tab", { name: "目录", exact: true }),
  ).toBeFocused();

  const entry = (title: string) =>
    panel.getByRole("button", { name: new RegExp(`^${title}`) });
  for (const title of [
    "Introduction",
    "Methods",
    "Datasets",
    "Training",
    "Schedules",
    "Results",
  ])
    await expect(entry(title)).toBeVisible();
  // The levels are indented.
  const left = async (title: string) => (await entry(title).boundingBox())!.x;
  const textLeft = async (title: string) =>
    (await entry(title).locator("span").first().boundingBox())!.x;
  expect(await textLeft("Datasets")).toBeGreaterThan(await textLeft("Methods"));
  expect(await textLeft("Schedules")).toBeGreaterThan(
    await textLeft("Datasets"),
  );
  expect(
    Math.abs((await left("Methods")) - (await left("Datasets"))),
  ).toBeLessThan(2);
  // An entry that leads nowhere is its title only.
  await expect(panel.getByText("Broken entry", { exact: true })).toBeVisible();
  await expect(entry("Broken entry")).toHaveCount(0);
  // Where each entry leads is on its row.
  await expect(entry("Datasets")).toContainText("12");

  await entry("Datasets").click();
  await expect(panel).toHaveCount(0);
  await expect(pageInput(page)).toHaveValue("12");
  await expectAtTop(page, 12);
  await expect(scroller(page)).toBeFocused();

  // Esc closes it and the keyboard goes back to the button.
  await outlineButton(page).click();
  await expect(panel).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(outlineButton(page)).toBeFocused();
});

test("without an outline the panel shows the pages, as thumbnails, two to a row", async ({
  page,
}) => {
  await open(page);
  await jumpTo(page, 5);

  await outlineButton(page).click();
  const panel = page.getByRole("dialog", { name: "目录与页面", exact: true });
  await expect(panel).toBeVisible();
  await expect(
    panel.getByRole("tab", { name: "页面", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(panel.getByText("这篇 PDF 没有自带目录。")).toBeVisible();

  const thumb = (number: number) =>
    panel.getByRole("button", { name: `转到第 ${number} 页`, exact: true });
  // The current page is marked, and its picture is drawn; far pages wait until they are near.
  await expect(thumb(5)).toHaveAttribute("aria-current", "page");
  await expect(thumb(5)).toHaveAttribute("data-rendered", "true");
  await expect(thumb(1)).not.toHaveAttribute("aria-current", "page");
  const canvas = thumb(5).locator("canvas");
  expect(
    await canvas.evaluate((element: HTMLCanvasElement) => {
      const { data } = element
        .getContext("2d")!
        .getImageData(0, 0, element.width, element.height);
      for (let i = 0; i < data.length; i += 4)
        if (data[i] < 160 && data[i + 1] < 160 && data[i + 2] < 160)
          return true;
      return false;
    }),
  ).toBe(true);
  await expect(thumb(40)).not.toHaveAttribute("data-rendered", "true");

  // Two columns: neighbours side by side, the next pair under them.
  const [five, six, seven] = await Promise.all(
    [5, 6, 7].map(async (number) => (await thumb(number).boundingBox())!),
  );
  expect(Math.abs(five.y - six.y)).toBeLessThan(2);
  expect(six.x).toBeGreaterThan(five.x + five.width - 2);
  expect(seven.y).toBeGreaterThan(five.y + five.height - 2);
  expect(Math.abs(seven.x - five.x)).toBeLessThan(2);

  // Scrolling the panel to its end draws the pages that come near, and a click goes to one.
  await thumb(40).scrollIntoViewIfNeeded();
  await expect(thumb(40)).toHaveAttribute("data-rendered", "true");
  await thumb(40).click();
  await expect(panel).toHaveCount(0);
  await expect(pageInput(page)).toHaveValue("40");
  await expect(scroller(page)).toBeFocused();
});

test("the thumbnails open at the current page of a PDF that is not letter-sized", async ({
  page,
}) => {
  // A4: its cells are not the shape the list guesses before it has read the first page.
  await open(page, { size: [595, 842] });
  // Chromium and Firefox anchor the scroll when cells change height; Safari does not, and must come out right too.
  await page.addStyleTag({
    content: "* { overflow-anchor: none !important; }",
  });
  await jumpTo(page, 30);

  await outlineButton(page).click();
  const panel = page.getByRole("dialog", { name: "目录与页面", exact: true });
  await expect(
    panel.getByRole("tab", { name: "页面", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  const current = panel.getByRole("button", {
    name: "转到第 30 页",
    exact: true,
  });
  await expect(current).toHaveAttribute("aria-current", "page");
  // In the middle of what the panel shows, and drawn.
  await expect
    .poll(async () => {
      const [cell, area] = await Promise.all([
        current.boundingBox(),
        panel.getByRole("tabpanel").evaluate((element) => {
          const { y, height } = element.parentElement!.getBoundingClientRect();
          return { y, height };
        }),
      ]);
      return Math.abs(cell!.y + cell!.height / 2 - (area.y + area.height / 2));
    })
    .toBeLessThan(40);
  await expect(current).toHaveAttribute("data-rendered", "true");
  // The cells are A4-shaped.
  const sheet = (await current.locator("canvas").boundingBox())!;
  expect(Math.abs(sheet.width / sheet.height - 595 / 842)).toBeLessThan(0.02);
});

test("the panel is 320px wide, at most 70% of the window high, and shows the thumbnails of a long PDF", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 700 });
  await open(page, { pages: 60 });
  await outlineButton(page).click();
  const panel = page.getByRole("dialog", { name: "目录与页面", exact: true });
  await expect(panel).toBeVisible();
  await settled(page);
  const box = (await panel.boundingBox())!;
  expect(Math.round(box.width)).toBe(320);
  expect(box.height).toBeLessThanOrEqual(700 * 0.7 + 1);
  expect(box.height).toBeGreaterThan(300);
  // It reaches its end by scrolling inside itself.
  expect(
    await panel.evaluate((element) => {
      const scrolling = [...element.querySelectorAll("*")].find(
        (child) => child.scrollHeight > child.clientHeight + 10,
      );
      return !!scrolling;
    }),
  ).toBe(true);
});

test("the more menu's download dialog saves the original and the annotated PDF, and favorites", async ({
  page,
}) => {
  const { paperId, title } = await open(page, { pages: 3 });
  const menu = page.getByRole("menu", { name: "更多", exact: true });

  const dialog = page.getByRole("dialog", { name: "下载", exact: true });
  const choose = async (name: string) => {
    await moreButton(page).click();
    await menu.getByRole("menuitem", { name: "下载…", exact: true }).click();
    await dialog.getByRole("radio", { name, exact: true }).check();
    const [saved] = await Promise.all([
      page.waitForEvent("download"),
      dialog.getByRole("button", { name: "下载", exact: true }).click(),
    ]);
    await expect(dialog).toBeHidden();
    return saved;
  };
  expect((await choose("原文 PDF")).suggestedFilename()).toBe(`${title}.pdf`);
  expect((await choose("带批注的 PDF")).suggestedFilename()).toBe(
    `${title}-批注.pdf`,
  );

  const favorite = async () =>
    (await (await page.request.get(`/api/v1/papers/${paperId}`)).json())
      .favorite;
  expect(await favorite()).toBe(false);
  await moreButton(page).click();
  await menu.getByRole("menuitem", { name: "收藏", exact: true }).click();
  await expect(page.getByText("已收藏", { exact: true })).toBeVisible();
  expect(await favorite()).toBe(true);
  // The local paper has the new revision, so the next change is not a conflict.
  await moreButton(page).click();
  await menu.getByRole("menuitem", { name: "取消收藏", exact: true }).click();
  await expect(page.getByText("已取消收藏", { exact: true })).toBeVisible();
  expect(await favorite()).toBe(false);
});

test("a download that fails, and a favorite that conflicts, say so", async ({
  page,
}) => {
  await open(page, { pages: 3 });
  await page.route("**/api/v1/files/*/annotated-pdf", (route) =>
    route.fulfill({
      status: 500,
      json: { detail: "批注 PDF 导出失败；原文件与批注仍已保留" },
    }),
  );
  await page.route("**/api/v1/papers/*", (route) =>
    route.request().method() === "PATCH"
      ? route.fulfill({
          status: 409,
          json: { detail: "Revision conflict; reload before editing" },
        })
      : route.fallback(),
  );
  const menu = page.getByRole("menu", { name: "更多", exact: true });

  await moreButton(page).click();
  await menu.getByRole("menuitem", { name: "下载…", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "下载", exact: true });
  await dialog
    .getByRole("radio", { name: "带批注的 PDF", exact: true })
    .check();
  await dialog.getByRole("button", { name: "下载", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "批注 PDF 导出失败" }),
  ).toBeVisible();

  await moreButton(page).click();
  await menu.getByRole("menuitem", { name: "收藏", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "刷新" }),
  ).toBeVisible();
  // Nothing changed: it still offers to favorite.
  await moreButton(page).click();
  await expect(
    menu.getByRole("menuitem", { name: "收藏", exact: true }),
  ).toBeVisible();
});

test("in a narrow card zoom and find move into the more menu", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1000, height: 900 });
  await open(page);
  await expect(zoomButton(page)).toBeVisible();
  await expect(
    main(page).getByRole("button", { name: "查找论文", exact: true }),
  ).toBeVisible();

  // The card is under 560px wide (the sidebar is a 56px rail below 900px, so that takes a window under 640px).
  await page.setViewportSize({ width: 600, height: 900 });
  await expect(zoomButton(page)).toHaveCount(0);
  await expect(
    main(page).getByRole("button", { name: "查找论文", exact: true }),
  ).toHaveCount(0);
  await expect(pageInput(page)).toBeVisible();
  await expect(outlineButton(page)).toBeVisible();

  const menu = page.getByRole("menu", { name: "更多", exact: true });
  await moreButton(page).click();
  for (const name of ["查找论文", "适合宽度", "放大", "缩小", "下载…"])
    await expect(
      menu.getByRole("menuitem", { name, exact: true }),
    ).toBeVisible();
  const before = (await pdfPage(page, 1).boundingBox())!.width;
  await menu.getByRole("menuitem", { name: "放大", exact: true }).click();
  await expect
    .poll(async () => (await pdfPage(page, 1).boundingBox())!.width)
    .toBeGreaterThan(before + 5);

  await moreButton(page).click();
  await menu.getByRole("menuitem", { name: "查找论文", exact: true }).click();
  await expect(findInput(page)).toBeFocused();

  // Wide again: they come back out.
  await page.setViewportSize({ width: 1000, height: 900 });
  await expect(zoomButton(page)).toBeVisible();
});

test("the long title is cut, and its tooltip gives all of it", async ({
  page,
}) => {
  const title = `A very long title of a paper that goes on and on ${"and on ".repeat(12)}until it ends`;
  await open(page, { title, pages: 2 });
  const heading = main(page).getByRole("heading", { level: 1 });
  await expect(heading).toHaveText(title);
  expect(
    await heading.evaluate(
      (element) => element.scrollWidth > element.clientWidth,
    ),
  ).toBe(true);
  expect(
    await heading.evaluate((element) => getComputedStyle(element).textOverflow),
  ).toBe("ellipsis");
  await heading.hover();
  await expect(page.locator('[role="tooltip"]')).toHaveText(title);
});

test("a short title has no tooltip", async ({ page }) => {
  await open(page, { title: "Short one", pages: 2 });
  await main(page).getByRole("heading", { level: 1 }).hover();
  await page.waitForTimeout(700);
  await expect(page.locator('[role="tooltip"]')).toHaveCount(0);
});

test("the paper takes the keyboard on opening, so the zoom keys work at once", async ({
  page,
}) => {
  await open(page);
  await expect(scroller(page)).toBeFocused();
  await page.keyboard.press("ControlOrMeta+=");
  await expect
    .poll(async () => Number(await pdfPage(page, 1).getAttribute("data-scale")))
    .toBeGreaterThan(1);
  // It shows that it has the keyboard, inside its own edge.
  await page.keyboard.press("PageDown");
  const ring = await scroller(page).evaluate((element) => ({
    visible: element.matches(":focus-visible"),
    shadow: getComputedStyle(element).boxShadow,
  }));
  expect(ring.visible).toBe(true);
  expect(ring.shadow).toContain("inset");
});

test("a link to a quote gives the paper the keyboard once it is there, and wherever the keyboard was put it stays", async ({
  page,
}) => {
  // The address names no page, so the quote is looked for on page 1 (layers.spec.ts has the rest).
  await open(page, {}, { quote: "Page 3 of 40" });
  await expect(scroller(page)).toBeFocused();
  await expectAtTop(page, 1);

  // Typing somewhere else while the PDF is still coming in: the PDF waits.
  const slow = "**/api/v1/files/*/content";
  await page.route(slow, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 800));
    await route.fallback();
  });
  const paper = await createPaperWithPdf(page, { pages: 3 });
  await openReader(page, { paperId: paper.paperId });
  await page.evaluate(() => {
    const field = document.createElement("input");
    field.id = "probe";
    document.body.append(field);
    field.focus();
  });
  await expect(pdfPage(page, 1)).toHaveAttribute("data-rendered", "true");
  await page.waitForTimeout(300);
  await expect(page.locator("#probe")).toBeFocused();

  // Nor does a button the keyboard was put on (the side panel's tab, say) lose it to the PDF arriving.
  const other = await createPaperWithPdf(page, { pages: 3 });
  await openReader(page, { paperId: other.paperId });
  const tab = page.getByRole("tab", { name: "助手" });
  await tab.focus();
  await expect(tab).toBeFocused();
  await expect(pdfPage(page, 1)).toHaveAttribute("data-rendered", "true");
  await page.waitForTimeout(300);
  await expect(tab).toBeFocused();
  await page.unroute(slow);
});

test("a paper opened from the sidebar takes the keyboard too, so the zoom keys work at once", async ({
  page,
}) => {
  await signIn(page);
  const first = await createPaperWithPdf(page, { pages: 3 });
  const second = await createPaperWithPdf(page, { pages: 3 });
  await openReader(page, { paperId: first.paperId });
  await expect(pdfPage(page, 1)).toHaveAttribute("data-rendered", "true");
  await openReader(page, { paperId: second.paperId });
  await expect(
    main(page).getByRole("heading", { level: 1, name: second.title }),
  ).toBeVisible();

  // The sidebar stays mounted when the paper changes: the link that was clicked keeps the keyboard
  // until the next paper's PDF is in, and the paper must still take it from there.
  await page
    .getByRole("navigation")
    .getByRole("group", { name: "正在读" })
    .getByRole("link", { name: first.title })
    .click();
  await expect(
    main(page).getByRole("heading", { level: 1, name: first.title }),
  ).toBeVisible();
  await expect(pdfPage(page, 1)).toHaveAttribute("data-rendered", "true");
  await expect(scroller(page)).toBeFocused();
  await expect(zoomButton(page)).toHaveText("100%");
  await page.keyboard.press("ControlOrMeta+=");
  await expect
    .poll(async () => parseInt(await zoomButton(page).innerText()))
    .toBeGreaterThan(100);
});

test.describe("in English", () => {
  test.use({ locale: "en-US" });

  test("the header speaks English", async ({ page }) => {
    await open(page, { pages: 3, outline: [{ title: "Intro", page: 2 }] });
    await expect(
      main(page).getByRole("textbox", { name: "Page number", exact: true }),
    ).toHaveValue("1");
    await expect(
      main(page).getByRole("button", { name: "Previous page", exact: true }),
    ).toBeVisible();
    await expect(
      main(page).getByRole("button", { name: "Next page", exact: true }),
    ).toBeVisible();
    await expect(main(page).getByRole("button", { name: /^Zoom/ })).toHaveText(
      "100%",
    );
    await main(page)
      .getByRole("button", { name: "Find in paper", exact: true })
      .click();
    await expect(
      page.getByRole("search", { name: "Search the paper" }),
    ).toBeVisible();
    await page
      .getByRole("textbox", { name: "Find in the paper's text", exact: true })
      .fill("zzz");
    await expect(page.getByRole("status")).toHaveText("No matches");
    await page.keyboard.press("Escape");
    await main(page)
      .getByRole("button", { name: "Outline and pages", exact: true })
      .click();
    await expect(
      page.getByRole("dialog", { name: "Outline and pages", exact: true }),
    ).toContainText("Intro");
    await page.keyboard.press("Escape");
    await main(page).getByRole("button", { name: "More", exact: true }).click();
    await expect(
      page.getByRole("menuitem", { name: "Download…", exact: true }),
    ).toBeVisible();
    // Nothing of the header is left in Chinese.
    expect(await main(page).innerText()).not.toMatch(/[一-鿿]/);
  });
});
