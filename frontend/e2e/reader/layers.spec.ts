import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  AFTER_LINKS,
  createPaperWithPdf,
  openReader,
  saveHighlight,
  saveStroke,
  signIn,
} from "./fixtures";

// The interface follows the browser's language; these specs read it in Chinese.
test.use({ locale: "zh-CN" });

const main = (page: Page) => page.getByRole("main");
const scroller = (page: Page) =>
  page.getByRole("region", { name: "论文页面", exact: true });
const pdfPage = (page: Page, number: number) =>
  page.locator(`[data-page="${number}"]`);
const pageInput = (page: Page) =>
  main(page).getByRole("textbox", { name: "页码", exact: true });
const backButton = (page: Page) =>
  main(page).getByRole("button", { name: "返回跳转前的位置", exact: true });
const tooltip = (page: Page, text: string) =>
  page.locator('[role="tooltip"]', { hasText: text });

/** Where a point of a page is in the window: `x` and `y` are fractions of the page from its top left. */
async function onPage(sheet: Locator, x: number, y: number) {
  const box = (await sheet.boundingBox())!;
  return { x: box.x + x * box.width, y: box.y + y * box.height };
}

/** A point as the mouse takes it. */
const xy = (point: { x: number; y: number }): [number, number] => [
  point.x,
  point.y,
];

/**
 * A point for the mouse, in whole pixels, as a real mouse gives them: Chromium
 * starts no text selection from a press at a fraction of a pixel that is then
 * dragged (seen with Playwright; a point at x.3 selects nothing, at x.0 it does).
 */
const whole = ({ x, y }: { x: number; y: number }) => ({
  x: Math.round(x),
  y: Math.round(y),
});

/**
 * The middle of an element, for the mouse. The link boxes let the pointer
 * through to the text (Playwright would refuse to click them as elements):
 * they are pointed at.
 */
async function centre(element: Locator) {
  const box = (await element.boundingBox())!;
  return whole({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
}

/** The middle of character `index` of `text` on the page, as its text layer has it. */
const charAt = async (sheet: Locator, text: string, index: number) =>
  whole(
    await sheet.evaluate(
      (element, { text, index }) => {
        const walker = document.createTreeWalker(
          element.querySelector(".textLayer")!,
          NodeFilter.SHOW_TEXT,
        );
        while (walker.nextNode()) {
          const node = walker.currentNode as Text;
          const at = node.data.indexOf(text);
          if (at < 0) continue;
          const range = document.createRange();
          range.setStart(node, at + index);
          range.setEnd(node, at + index + 1);
          const box = range.getBoundingClientRect();
          return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
        }
        throw new Error(`"${text}" is not on the page`);
      },
      { text, index },
    ),
  );

/** The text selected on the page. */
const selected = (page: Page) =>
  page.evaluate(() => window.getSelection()?.toString() ?? "");

/** Press at `from`, move to `to` and let go, as a person selects text. */
async function drag(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
}

/** A point given in PDF units (from the bottom left of a letter page), in the window. */
const pdfPoint = (sheet: Locator, x: number, y: number) =>
  onPage(sheet, x / 612, 1 - y / 792);

/**
 * The color of one pixel of the window as it is shown: the page composited
 * (the canvas, what is laid over it, the dark theme's filter), read back from a
 * screenshot through a canvas.
 */
async function pixel(page: Page, point: { x: number; y: number }) {
  const shot = await page.screenshot({
    clip: {
      x: Math.round(point.x),
      y: Math.round(point.y),
      width: 1,
      height: 1,
    },
  });
  return page.evaluate(async (data) => {
    const image = new Image();
    image.src = "data:image/png;base64," + data;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d")!;
    context.drawImage(image, 0, 0);
    return [...context.getImageData(0, 0, 1, 1).data.slice(0, 3)];
  }, shot.toString("base64"));
}

const distance = (a: number[], b: number[]) =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** How far the middle of `element` is from the middle of the desk, up or down, in px (endless while it is not there). */
async function offCentre(page: Page, element: Locator) {
  const [box, desk] = await Promise.all([
    element.boundingBox(),
    scroller(page).boundingBox(),
  ]);
  if (!box || !desk) return Infinity;
  return Math.abs(box.y + box.height / 2 - (desk.y + desk.height / 2));
}

/** Whether all of `element` is inside the desk's view. */
async function inDesk(page: Page, element: Locator) {
  const [box, desk] = await Promise.all([
    element.boundingBox(),
    scroller(page).boundingBox(),
  ]);
  return (
    !!box &&
    !!desk &&
    box.y >= desk.y &&
    box.y + box.height <= desk.y + desk.height &&
    box.x >= desk.x &&
    box.x + box.width <= desk.x + desk.width
  );
}

test("saved highlights are visible in both themes", async ({ page }) => {
  await signIn(page);
  const paper = await createPaperWithPdf(page, { pages: 2 });
  const plain = await saveHighlight(page, paper.fileId, {
    page: 1,
    quote: "Page 1 of 2",
    rects: [{ x: 0.1, y: 0.4, w: 0.4, h: 0.03 }],
    color: "#FACC15",
  });
  const noted = await saveHighlight(page, paper.fileId, {
    page: 1,
    quote: "Page 1 of 2",
    rects: [
      { x: 0.1, y: 0.5, w: 0.5, h: 0.03 },
      { x: 0.1, y: 0.54, w: 0.3, h: 0.03 },
    ],
    color: "#86EFAC",
    comment: "Worth reading twice.",
  });
  await openReader(page, { paperId: paper.paperId });
  const first = pdfPage(page, 1);
  await expect(first).toHaveAttribute("data-rendered", "true");
  await expect(first.locator("[data-annotation-id]")).toHaveCount(2);
  await expect(
    first.locator(`[data-annotation-id="${noted.id}"] [data-annotation-rect]`),
  ).toHaveCount(2);

  // Only the highlight with a comment has the dot, 6px across, at its top right.
  await expect(first.locator("[data-annotation-comment]")).toHaveCount(1);
  const dot = first.locator(
    `[data-annotation-id="${noted.id}"] [data-annotation-comment]`,
  );
  const [dotBox, lineBox] = await Promise.all([
    dot.boundingBox(),
    first
      .locator(`[data-annotation-id="${noted.id}"] [data-annotation-rect]`)
      .first()
      .boundingBox(),
  ]);
  expect(Math.round(dotBox!.width)).toBe(6);
  expect(Math.round(dotBox!.height)).toBe(6);
  expect(
    Math.abs(dotBox!.x + dotBox!.width / 2 - (lineBox!.x + lineBox!.width)),
  ).toBeLessThanOrEqual(4);
  expect(Math.abs(dotBox!.y + dotBox!.height / 2 - lineBox!.y)).toBeLessThan(4);

  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await expect(page.locator("html")).toHaveAttribute("data-theme", scheme);
    for (const { id, row } of [
      { id: plain.id, row: 0.415 },
      { id: noted.id, row: 0.515 },
    ]) {
      const block = first
        .locator(`[data-annotation-id="${id}"] [data-annotation-rect]`)
        .first();
      const box = (await block.boundingBox())!;
      const mark = await pixel(page, {
        x: box.x + box.width / 2,
        y: box.y + box.height / 2,
      });
      // The same line of the page, right of the highlight, where there is only paper.
      const blank = await pixel(page, await onPage(first, 0.8, row));
      expect(
        distance(mark, blank),
        `${scheme}: highlight ${mark} against paper ${blank}`,
      ).toBeGreaterThanOrEqual(30);
    }
  }
  await page.emulateMedia({ colorScheme: "light" });

  // Resting on the highlight with a comment shows the comment; the other has none to show.
  await page.mouse.move(...xy(await onPage(first, 0.2, 0.515)));
  await expect(tooltip(page, "Worth reading twice.")).toBeVisible();
  await page.mouse.move(...xy(await onPage(first, 0.8, 0.7)));
  await expect(tooltip(page, "Worth reading twice.")).toBeHidden();
  await page.mouse.move(...xy(await onPage(first, 0.2, 0.415)));
  await page.waitForTimeout(700);
  await expect(page.locator('[role="tooltip"]')).toHaveCount(0);

  // The text under a highlight can still be selected.
  const line = first.locator(".textLayer span", { hasText: "Page 1 of 2" });
  const text = (await line.boundingBox())!;
  await page.mouse.move(text.x + 2, text.y + text.height / 2);
  await page.mouse.down();
  await page.mouse.move(text.x + text.width - 2, text.y + text.height / 2, {
    steps: 6,
  });
  await page.mouse.up();
  expect(
    (await page.evaluate(() => window.getSelection()?.toString() ?? "")).trim()
      .length,
  ).toBeGreaterThan(3);
});

test("existing ink is shown read-only", async ({ page }) => {
  await signIn(page);
  const paper = await createPaperWithPdf(page, { pages: 2 });
  const stroke = await saveStroke(page, paper.fileId, {
    page: 1,
    color: "#e11d48",
    width: 3,
    points: [
      [0.2, 0.6, 0.5],
      [0.35, 0.62, 0.5],
      [0.5, 0.6, 0.5],
    ],
  });
  const writes: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/ink") && request.method() !== "GET")
      writes.push(`${request.method()} ${request.url()}`);
  });
  await openReader(page, { paperId: paper.paperId });
  const first = pdfPage(page, 1);
  await expect(first).toHaveAttribute("data-rendered", "true");
  const path = first.locator(`svg path[data-stroke="${stroke.id}"]`);
  await expect(path).toHaveCount(1);
  await expect(path).toHaveAttribute("stroke", "#e11d48");
  const drawn = await path.getAttribute("d");
  // It is drawn where it was written: its box starts at 20% across and ends at 50%.
  const [box, sheet] = await Promise.all([
    path.boundingBox(),
    first.boundingBox(),
  ]);
  expect(Math.abs(box!.x - (sheet!.x + 0.2 * sheet!.width))).toBeLessThan(4);
  expect(
    Math.abs(box!.x + box!.width - (sheet!.x + 0.5 * sheet!.width)),
  ).toBeLessThan(4);

  // Pressing on the stroke and dragging across it changes nothing.
  await page.mouse.move(...xy(await onPage(first, 0.35, 0.62)));
  await page.mouse.down();
  await page.mouse.move(...xy(await onPage(first, 0.6, 0.7)), { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  await expect(first.locator("svg path[data-stroke]")).toHaveCount(1);
  expect(await path.getAttribute("d")).toBe(drawn);
  expect(writes).toEqual([]);
  expect(
    await first
      .locator("svg:has(path[data-stroke])")
      .evaluate((svg) => getComputedStyle(svg).pointerEvents),
  ).toBe("none");
});

test("internal links jump and come back", async ({ page }) => {
  await signIn(page);
  const paper = await createPaperWithPdf(page, {
    pages: 8,
    links: [{ from: 2, to: 5 }],
  });
  await openReader(page, { paperId: paper.paperId, page: 2 });
  await expect(pdfPage(page, 2)).toHaveAttribute("data-rendered", "true");
  await expect(pageInput(page)).toHaveValue("2");
  await expect(backButton(page)).toHaveCount(0);

  // A little way down the page, as a reader would be.
  await scroller(page).evaluate((desk) => {
    desk.scrollTop += 30;
  });
  await page.waitForTimeout(200);
  const before = await scroller(page).evaluate((desk) => desk.scrollTop);

  const link = pdfPage(page, 2).getByRole("button", {
    name: "跳到链接的位置",
    exact: true,
  });
  await expect(link).toHaveCount(1);
  // The link is a clear box over the page, tinted while the pointer is on it, and the hand shows.
  const resting = await link.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );
  const spot = await centre(link);
  await page.mouse.move(spot.x, spot.y);
  await expect
    .poll(() =>
      link.evaluate((element) => getComputedStyle(element).backgroundColor),
    )
    .not.toBe(resting);
  expect(
    await page.evaluate(
      ({ x, y }) => getComputedStyle(document.elementFromPoint(x, y)!).cursor,
      spot,
    ),
  ).toBe("pointer");
  await page.mouse.click(spot.x, spot.y);
  await expect(pageInput(page)).toHaveValue("5");
  await expect(pdfPage(page, 5)).toBeInViewport();
  await expect(backButton(page)).toBeVisible();

  await backButton(page).click();
  await expect(pageInput(page)).toHaveValue("2");
  await expect
    .poll(() => scroller(page).evaluate((desk) => desk.scrollTop))
    .toBeCloseTo(before, 0);
  await expect(backButton(page)).toHaveCount(0);

  // The keyboard reaches the link (Tab) and follows it (Enter), with the same way back.
  await link.focus();
  await page.keyboard.press("Enter");
  await expect(pageInput(page)).toHaveValue("5");
  await backButton(page).click();
  await expect(pageInput(page)).toHaveValue("2");
  await expect(backButton(page)).toHaveCount(0);

  // Going somewhere by the page field leaves no way back.
  await pageInput(page).fill("7");
  await pageInput(page).press("Enter");
  await expect(pageInput(page)).toHaveValue("7");
  await page.waitForTimeout(300);
  await expect(backButton(page)).toHaveCount(0);
});

test("unsafe links are not followed", async ({ page }) => {
  await signIn(page);
  // The shared test PDF: on page 1, a link to page 2, a web link and a javascript: link.
  const paper = await createPaperWithPdf(page);
  await openReader(page, { paperId: paper.paperId });
  const first = pdfPage(page, 1);
  await expect(first).toHaveAttribute("data-rendered", "true");

  const web = first.getByRole("link");
  await expect(web).toHaveCount(1);
  await expect(web).toHaveAttribute("href", "https://example.org/paper");
  await expect(web).toHaveAttribute("target", "_blank");
  await expect(web).toHaveAttribute("rel", "noopener noreferrer");
  await expect(
    first.getByRole("button", { name: "跳到链接的位置", exact: true }),
  ).toHaveCount(1);

  // Where the javascript: link is there is no box, the pointer is no hand, and a click does nothing.
  const unsafe = await pdfPoint(first, 120, 615);
  expect(
    await first.locator("a, button").evaluateAll(
      (boxes, { x, y }) =>
        boxes.some((box) => {
          const r = box.getBoundingClientRect();
          return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
        }),
      unsafe,
    ),
  ).toBe(false);
  await page.mouse.move(unsafe.x, unsafe.y);
  expect(
    await first.evaluate((sheet) =>
      sheet.hasAttribute("data-link-under-pointer"),
    ),
  ).toBe(false);
  let popups = 0;
  page.context().on("page", () => popups++);
  const address = page.url();
  await page.mouse.click(unsafe.x, unsafe.y);
  await page.waitForTimeout(800);
  expect(popups).toBe(0);
  expect(page.url()).toBe(address);
  await expect(pageInput(page)).toHaveValue("1");
});

test("hovering a web link shows its site and title", async ({ page }) => {
  await signIn(page);
  const paper = await createPaperWithPdf(page);
  await page.route("**/api/v1/papers/*/link-preview?**", (route) =>
    route.fulfill({
      json: {
        url: "https://example.org/paper",
        title: "An Example Paper",
        description: "",
      },
    }),
  );
  await openReader(page, { paperId: paper.paperId });
  const first = pdfPage(page, 1);
  await expect(first).toHaveAttribute("data-rendered", "true");
  const spot = await centre(first.getByRole("link"));
  await page.mouse.move(spot.x, spot.y);
  const preview = tooltip(page, "An Example Paper");
  await expect(preview).toBeVisible();
  await expect(preview).toContainText("example.org");
  await page.mouse.move(5, 5);
  await expect(preview).toBeHidden();
});

/** The first page's lines with a link in their middle (see the fixtures' citations and web links). */
const CITING = "See [1] for details.";
const WEB = "Read example.org/paper online.";

/** A paper whose first page has a citation and a web link in the middle of lines of text. */
async function openLinkedLines(page: Page) {
  await signIn(page);
  const paper = await createPaperWithPdf(page, {
    pages: 2,
    citations: [
      {
        from: 1,
        to: 2,
        key: "smith2001",
        entry: "J. Smith. A study of links. 2001.",
      },
    ],
    webLinks: [
      {
        page: 1,
        url: "https://example.org/paper",
        before: "Read ",
        label: "example.org/paper",
        after: " online.",
      },
    ],
  });
  // Whatever the previews ask stays here.
  await page.route("**/api/v1/citations/lookup?**", (route) =>
    route.fulfill({ json: { item: null } }),
  );
  await page.route("**/api/v1/papers/*/link-preview?**", (route) =>
    route.fulfill({ json: { title: "" } }),
  );
  await openReader(page, { paperId: paper.paperId });
  const first = pdfPage(page, 1);
  await expect(first).toHaveAttribute("data-rendered", "true");
  // The fixture lays the links over their words.
  const [cite, web] = await Promise.all([
    centre(first.getByRole("button", { name: "跳到所引文献", exact: true })),
    centre(first.getByRole("link")),
  ]);
  const [bracket, address] = await Promise.all([
    charAt(first, CITING, 5),
    charAt(first, WEB, 13),
  ]);
  expect(Math.abs(cite.x - bracket.x)).toBeLessThan(4);
  expect(Math.abs(web.y - address.y)).toBeLessThan(4);
  return first;
}

/** Counts the pages the browser opens from here on. */
function countOpened(page: Page) {
  const opened: Page[] = [];
  page.context().on("page", (other) => opened.push(other));
  return opened;
}

test("a selection dragged across a link covers just that text", async ({
  page,
}) => {
  const first = await openLinkedLines(page);
  const opened = countOpened(page);
  // From inside "See" to inside "details", over the citation.
  await drag(
    page,
    await charAt(first, CITING, 1),
    await charAt(first, CITING, 15),
  );
  const across = (await selected(page)).trim();
  expect(across).toContain("[1] for de");
  expect(CITING).toContain(across);
  // Nothing was followed or previewed on the way.
  await page.waitForTimeout(600);
  await expect(pageInput(page)).toHaveValue("1");
  await expect(page.locator('[role="tooltip"]')).toHaveCount(0);

  // From the line below up onto the citation: the text between, and nothing after it.
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  await drag(page, await charAt(first, WEB, 8), await charAt(first, CITING, 5));
  const upward = await selected(page);
  expect(upward).toContain("for details.");
  expect(upward).toContain("Read exa");
  expect(upward).not.toContain(AFTER_LINKS.slice(0, 10));
  expect(upward).not.toContain("Page 1 of");
  await page.waitForTimeout(600);
  await expect(pageInput(page)).toHaveValue("1");
  expect(opened).toHaveLength(0);
});

test("a selection can start on a link and go past it", async ({ page }) => {
  const first = await openLinkedLines(page);
  const opened = countOpened(page);
  // From the citation's number to the end of its line.
  await drag(
    page,
    await charAt(first, CITING, 5),
    await charAt(first, CITING, 17),
  );
  const fromCitation = (await selected(page)).trim();
  expect(fromCitation).toContain("] for deta");
  expect(CITING).toContain(fromCitation);
  // From inside the web address to the word after it.
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  await drag(page, await charAt(first, WEB, 9), await charAt(first, WEB, 26));
  const fromAddress = (await selected(page)).trim();
  expect(fromAddress).toContain("org/paper onl");
  expect(WEB).toContain(fromAddress);
  await page.waitForTimeout(600);
  await expect(pageInput(page)).toHaveValue("1");
  expect(opened).toHaveLength(0);
});

test("double-clicking a link's text selects a word and opens nothing", async ({
  page,
}) => {
  const first = await openLinkedLines(page);
  const opened = countOpened(page);
  const word = await charAt(first, WEB, 7);
  await page.mouse.dblclick(word.x, word.y);
  await page.waitForTimeout(800);
  const picked = (await selected(page)).trim();
  expect(picked.length).toBeGreaterThan(0);
  expect("example.org/paper").toContain(picked);
  expect(opened).toHaveLength(0);

  // The citation's number too: selected, and the paper stays where it is.
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  const number = await charAt(first, CITING, 5);
  await page.mouse.dblclick(number.x, number.y);
  await page.waitForTimeout(800);
  // A word of "[1]" (Chromium takes "1" or a bracket, by which side of the digit is nearer).
  const cited = (await selected(page)).trim();
  expect(cited.length).toBeGreaterThan(0);
  expect("[1]").toContain(cited);
  await expect(pageInput(page)).toHaveValue("1");
  await expect(backButton(page)).toHaveCount(0);
});

test("a click on a link in a line follows it", async ({ page }) => {
  const first = await openLinkedLines(page);
  await page.context().route("https://example.org/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<title>Example</title>",
    }),
  );
  const opened = countOpened(page);
  // The web link: one new tab, which cannot reach back to the reader.
  const popup = page.context().waitForEvent("page");
  const address = await charAt(first, WEB, 10);
  await page.mouse.click(address.x, address.y);
  const tab = await popup;
  await tab.waitForLoadState();
  expect(tab.url()).toBe("https://example.org/paper");
  expect(await tab.evaluate(() => window.opener)).toBeNull();
  await page.waitForTimeout(600);
  expect(opened).toHaveLength(1);
  await tab.close();

  // The citation: to its entry, with a way back.
  const number = await charAt(first, CITING, 5);
  await page.mouse.click(number.x, number.y);
  await expect(pageInput(page)).toHaveValue("2");
  await expect(backButton(page)).toBeVisible();
});

const SENTENCE = "Evidence stays connected to its source.";

test("a reference in the address highlights that sentence", async ({
  page,
}) => {
  await signIn(page);
  const paper = await createPaperWithPdf(page, {
    pages: 6,
    words: { 3: SENTENCE },
  });
  await openReader(page, {
    paperId: paper.paperId,
    fileId: paper.fileId,
    page: 3,
    quote: SENTENCE,
  });
  const mark = pdfPage(page, 3).locator(
    ".pdf-reference-lines .pdf-reference-underline",
  );
  await expect(mark.first()).toBeVisible();
  await expect(pageInput(page)).toHaveValue("3");
  expect(await inDesk(page, mark.first())).toBe(true);
  // In the middle of the view, and the keyboard is in the paper.
  await expect.poll(() => offCentre(page, mark.first())).toBeLessThan(40);
  await expect(scroller(page)).toBeFocused();

  // Underlined and tinted, in the accent.
  const look = await mark.first().evaluate((element) => {
    const style = getComputedStyle(element);
    return { shadow: style.boxShadow, fill: style.backgroundColor };
  });
  expect(look.shadow).toContain("inset");
  expect(look.fill).not.toBe("rgba(0, 0, 0, 0)");

  // The same address entered again brings the sentence back into the middle.
  await scroller(page).evaluate((desk) => {
    desk.scrollTop = 0;
  });
  await expect(pageInput(page)).toHaveValue("1");
  await page.evaluate(() =>
    window.dispatchEvent(new Event("reference-navigate")),
  );
  await expect(pageInput(page)).toHaveValue("3");
  await expect.poll(() => offCentre(page, mark.first())).toBeLessThan(40);
});

test("a region in the address is outlined", async ({ page }) => {
  await signIn(page);
  const paper = await createPaperWithPdf(page, { pages: 6 });
  await openReader(page, {
    paperId: paper.paperId,
    page: 4,
    rect: "0.1,0.55,0.6,0.2",
  });
  const region = pdfPage(page, 4).locator(".pdf-reference-region");
  await expect(region).toBeVisible();
  await expect(pageInput(page)).toHaveValue("4");
  await expect.poll(() => offCentre(page, region)).toBeLessThan(40);
  const [box, sheet] = await Promise.all([
    region.boundingBox(),
    pdfPage(page, 4).boundingBox(),
  ]);
  expect(Math.abs(box!.x - (sheet!.x + 0.1 * sheet!.width))).toBeLessThan(2);
  expect(Math.abs(box!.width - 0.6 * sheet!.width)).toBeLessThan(2);
  expect(
    await region.evaluate((element) => getComputedStyle(element).boxShadow),
  ).toContain("2px");
});

test("a quote that cannot be found still lands on its page", async ({
  page,
}) => {
  await signIn(page);
  const paper = await createPaperWithPdf(page, {
    pages: 6,
    words: { 3: SENTENCE },
  });
  // From here on: what the reader says (signing in asks for the session first, and is refused).
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await openReader(page, {
    paperId: paper.paperId,
    fileId: paper.fileId,
    page: 3,
    quote: "Words that are nowhere in this paper",
  });
  const third = pdfPage(page, 3);
  await expect(third).toHaveAttribute("data-rendered", "true");
  await expect(third.locator(".textLayer")).toHaveAttribute(
    "data-reference-found",
    "false",
  );
  await expect(pageInput(page)).toHaveValue("3");
  // At the top of the page (the desk pads it by 20px).
  const [sheet, desk] = await Promise.all([
    third.boundingBox(),
    scroller(page).boundingBox(),
  ]);
  expect(Math.abs(sheet!.y - desk!.y - 20)).toBeLessThan(6);
  await expect(page.locator(".pdf-reference-lines")).toHaveCount(0);
  await expect(scroller(page)).toBeFocused();
  await page.waitForTimeout(300);
  expect(errors).toEqual([]);
});
