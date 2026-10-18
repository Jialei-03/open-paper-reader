import { expect, test, type Page } from "@playwright/test";
import {
  createPaperWithPdf,
  openReader,
  saveHighlight,
  signIn,
} from "./fixtures";

// The interface follows the browser's language; most of these read it in Chinese.
test.use({ locale: "zh-CN" });

// The side panel is the page's only complementary landmark, whatever the language.
const panel = (page: Page) => page.getByRole("complementary");
// The note's text is the only text field in the panel.
const editor = (page: Page) =>
  panel(page).getByRole("textbox", { name: /^(笔记正文|Note text)$/ });
const saveStatus = (page: Page) =>
  panel(page)
    .getByRole("status")
    .filter({ hasText: /已保存|正在保存|Saved|Saving/ });
const pageInput = (page: Page) =>
  page.getByRole("main").getByRole("textbox", { name: "页码", exact: true });
const scroller = (page: Page) =>
  page.getByRole("region", { name: "论文页面", exact: true });
const pdfPage = (page: Page, number: number) =>
  page.locator(`[data-page="${number}"]`);

async function openNotes(page: Page, name = "笔记") {
  await panel(page).getByRole("tab", { name, exact: true }).click();
  await expect(editor(page)).toBeVisible();
}

/** A write to the API as the signed-in user, the way the old live-note spec makes them. */
async function write(
  page: Page,
  path: string,
  data: unknown,
  method = "POST",
  revision?: number,
) {
  const csrf = (await page.context().cookies()).find(
    (cookie) => cookie.name === "paper_csrf",
  )!.value;
  const response = await page.request.fetch("/api/v1" + path, {
    method,
    data,
    headers: {
      "X-CSRF-Token": csrf,
      "Idempotency-Key": crypto.randomUUID(),
      ...(revision ? { "If-Match": String(revision) } : {}),
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}

type Note = { id: string; title: string; body: string; revision: number };

/** The notes the paper has, the most recently changed first. */
async function notesOf(page: Page, paperId: string): Promise<Note[]> {
  const response = await page.request.get(
    `/api/v1/items?kind=note&paper_id=${paperId}`,
  );
  expect(response.ok()).toBeTruthy();
  return response.json();
}

/** Sets the text of the note the paper starts with (someone else writing to it, from the note's point of view). */
async function setNote(page: Page, paperId: string, body: string) {
  const [note] = await notesOf(page, paperId);
  return (await write(
    page,
    `/items/${note.id}`,
    {
      kind: "note",
      paper_id: paperId,
      title: note.title,
      body,
      status: "open",
      tags: [],
      paper_ids: [],
      evidence_ids: [],
      locator: null,
    },
    "PUT",
    note.revision,
  )) as Note;
}

test("what is typed in the note is kept, and is there after a reload", async ({
  page,
}) => {
  await signIn(page);
  const { paperId } = await createPaperWithPdf(page);
  await openReader(page, { paperId });
  await openNotes(page);
  await expect(
    panel(page).getByRole("textbox", { name: "笔记正文", exact: true }),
  ).toBeVisible();

  await editor(page).click();
  await page.keyboard.type("## Reading plan");
  await page.keyboard.press("Enter");
  await page.keyboard.type("- compare the baselines");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("The method is **simple**.");

  // Written as it will read.
  await expect(
    editor(page).getByRole("heading", { level: 2, name: "Reading plan" }),
  ).toBeVisible();
  await expect(editor(page).getByRole("listitem")).toHaveText(
    "compare the baselines",
  );
  await expect(editor(page).locator("strong")).toHaveText("simple");
  // Kept, and said so quietly.
  await expect(saveStatus(page)).toHaveText("已保存");
  await expect
    .poll(async () => (await notesOf(page, paperId))[0].body)
    .toContain("The method is **simple**.");
  const [note] = await notesOf(page, paperId);
  expect(note.body).toContain("## Reading plan");
  expect(note.body).toContain("- compare the baselines");

  await page.reload();
  await openNotes(page);
  await expect(
    editor(page).getByRole("heading", { level: 2, name: "Reading plan" }),
  ).toBeVisible();
  await expect(editor(page)).toContainText("The method is simple.");
});

test("a paper without a note gets one when the first thing is written, not before", async ({
  page,
}) => {
  await signIn(page);
  const { paperId, title } = await createPaperWithPdf(page);
  // Papers start with a note; this one has none.
  const [started] = await notesOf(page, paperId);
  await write(
    page,
    `/items/${started.id}`,
    undefined,
    "DELETE",
    started.revision,
  );
  expect(await notesOf(page, paperId)).toEqual([]);

  await openReader(page, { paperId });
  await openNotes(page);
  await expect(editor(page)).toHaveText("");
  await page.waitForTimeout(500);
  expect(await notesOf(page, paperId)).toEqual([]);

  await editor(page).click();
  await page.keyboard.type("A first thought.");
  await expect.poll(async () => (await notesOf(page, paperId)).length).toBe(1);
  await expect
    .poll(async () => (await notesOf(page, paperId))[0].body)
    .toContain("A first thought.");
  const [made] = await notesOf(page, paperId);
  expect(made.title).toBe(`${title} · 笔记`);
  await expect(saveStatus(page)).toHaveText("已保存");
  // Typing on goes into the same note.
  await page.keyboard.type(" And a second.");
  await expect
    .poll(async () => (await notesOf(page, paperId))[0].body)
    .toContain("A first thought. And a second.");
  expect(await notesOf(page, paperId)).toHaveLength(1);
});

test("the highlights of the PDF are listed, and each leads back to its place", async ({
  page,
}) => {
  await signIn(page);
  const { paperId, fileId } = await createPaperWithPdf(page, { pages: 4 });
  const quote =
    "The second page says something long enough to run over more than two lines of the narrow side panel, so that the list has to cut it off after the second line and the rest is only a click away.";
  await saveHighlight(page, fileId, {
    page: 3,
    quote,
    rects: [{ x: 0.1, y: 0.1, w: 0.3, h: 0.02 }],
    color: "#FACC15",
    comment: "Check this against Table 2",
  });
  await saveHighlight(page, fileId, {
    page: 2,
    quote: "A plain highlight.",
    rects: [{ x: 0.1, y: 0.3, w: 0.3, h: 0.02 }],
    color: "#93C5FD",
  });
  await openReader(page, { paperId, fileId, page: 1 });
  await openNotes(page);

  await expect(
    panel(page).getByRole("heading", { name: "高亮与批注 · 2" }),
  ).toBeVisible();
  const items = panel(page).getByRole("list").getByRole("button");
  await expect(items).toHaveCount(2);
  // In the order of the paper; each with its quote, its comment if it has one, and its page.
  await expect(items.nth(0)).toContainText("A plain highlight.");
  await expect(items.nth(0)).toContainText("第 2 页");
  await expect(items.nth(1)).toContainText("Check this against Table 2");
  await expect(items.nth(1)).toContainText("第 3 页");

  // The quote is cut after two lines.
  const long = items.nth(1).getByText("The second page says", { exact: false });
  const lines = await long.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      clamp: style.getPropertyValue("-webkit-line-clamp"),
      lines:
        element.getBoundingClientRect().height / parseFloat(style.lineHeight),
    };
  });
  expect(lines.clamp).toBe("2");
  expect(lines.lines).toBeLessThanOrEqual(2.05);

  await expect(pageInput(page)).toHaveValue("1");
  await items.nth(1).click();
  await expect(pageInput(page)).toHaveValue("3");
  await expect(page).toHaveURL(new RegExp(`#read/${paperId}\\?.*page=3`));
  await expect
    .poll(async () => {
      const [desk, sheet] = await Promise.all([
        scroller(page).boundingBox(),
        pdfPage(page, 3).boundingBox(),
      ]);
      return (
        !!desk &&
        !!sheet &&
        sheet.y < desk.y + desk.height &&
        sheet.y + sheet.height > desk.y
      );
    })
    .toBe(true);
});

test("a link in the note into a paper opens in the reader on Mod-click", async ({
  page,
}) => {
  await signIn(page);
  const { paperId, fileId } = await createPaperWithPdf(page, { pages: 4 });
  await setNote(
    page,
    paperId,
    `Back to [the method](#paper/${paperId}?file=${fileId}&page=3) and [the setup](#read/${paperId}?file=${fileId}&page=2).`,
  );
  await openReader(page, { paperId, fileId, page: 1 });
  await openNotes(page);
  const method = editor(page).getByRole("link", { name: "the method" });
  const setup = editor(page).getByRole("link", { name: "the setup" });
  await expect(method).toBeVisible();

  // A plain click puts the caret in the link, and goes nowhere.
  await method.click();
  await expect(pageInput(page)).toHaveValue("1");
  expect(page.url()).toContain(`#read/${paperId}`);
  expect(page.url()).not.toContain("page=3");

  // Mod-click opens it, in the new reader (the old reader's `#paper/` address is converted).
  await method.click({ modifiers: ["ControlOrMeta"] });
  await expect(pageInput(page)).toHaveValue("3");
  expect(page.url()).toContain(`#read/${paperId}?file=${fileId}&page=3`);
  expect(page.url()).not.toContain("#paper/");
  await expect
    .poll(async () => {
      const [desk, sheet] = await Promise.all([
        scroller(page).boundingBox(),
        pdfPage(page, 3).boundingBox(),
      ]);
      return !!desk && !!sheet && Math.abs(sheet.y - desk.y) < 60;
    })
    .toBe(true);

  await setup.click({ modifiers: ["ControlOrMeta"] });
  await expect(pageInput(page)).toHaveValue("2");
  expect(page.url()).toContain(`#read/${paperId}?file=${fileId}&page=2`);
});

test("a save the service refuses for its revision is tried again with the latest", async ({
  page,
}) => {
  await signIn(page);
  const { paperId } = await createPaperWithPdf(page);
  await openReader(page, { paperId });
  await openNotes(page);

  // The first save of the note is refused as a revision conflict, though nothing has changed on the service.
  let refused = 0;
  await page.route("**/api/v1/items/*", async (route) => {
    if (route.request().method() === "PUT" && refused === 0) {
      refused++;
      await route.fulfill({
        status: 412,
        contentType: "application/json",
        body: JSON.stringify({
          detail: "Revision conflict; reload before editing",
        }),
      });
      return;
    }
    await route.continue();
  });

  await editor(page).click();
  await page.keyboard.type("Typed while the service was unsure.");
  await expect
    .poll(async () => (await notesOf(page, paperId))[0].body)
    .toContain("Typed while the service was unsure.");
  expect(refused).toBe(1);
  await expect(saveStatus(page)).toHaveText("已保存");
  await expect(panel(page).getByRole("alert")).toHaveCount(0);

  await page.reload();
  await openNotes(page);
  await expect(editor(page)).toContainText(
    "Typed while the service was unsure.",
  );
});

test("when both sides changed the same words the person chooses", async ({
  page,
}) => {
  await signIn(page);
  const { paperId } = await createPaperWithPdf(page);
  await setNote(page, paperId, "Alpha");
  await openReader(page, { paperId });
  await openNotes(page);
  await expect(editor(page)).toContainText("Alpha");

  // Someone else rewrites the note; then the person types on the old text.
  await setNote(page, paperId, "Beta");
  await editor(page).locator("p").first().click();
  await page.keyboard.press("End");
  await page.keyboard.type(" gamma");
  const alert = panel(page).getByRole("alert");
  await expect(alert).toContainText("笔记刚在别处改过");
  expect((await notesOf(page, paperId))[0].body).toBe("Beta");

  await alert.getByRole("button", { name: "载入最新", exact: true }).click();
  await expect(editor(page)).toHaveText("Beta");
  await expect(alert).toHaveCount(0);
  await expect(saveStatus(page)).toHaveText("已保存");

  // Again; this time the person's own words stay.
  await setNote(page, paperId, "Gamma");
  await editor(page).locator("p").first().click();
  await page.keyboard.press("End");
  await page.keyboard.type(" delta");
  await expect(alert).toContainText("笔记刚在别处改过");
  await alert.getByRole("button", { name: "保留我的", exact: true }).click();
  await expect(alert).toHaveCount(0);
  await expect
    .poll(async () => (await notesOf(page, paperId))[0].body)
    .toBe("Beta delta");
  await expect(editor(page)).toHaveText("Beta delta");
});

test.describe("in English", () => {
  test.use({ locale: "en-US" });

  test("the notes say everything in English", async ({ page }) => {
    await signIn(page);
    const { paperId, fileId, title } = await createPaperWithPdf(page, {
      pages: 2,
    });
    // The paper starts with a note named in Chinese; one made now is named in English.
    const [started] = await notesOf(page, paperId);
    await write(
      page,
      `/items/${started.id}`,
      undefined,
      "DELETE",
      started.revision,
    );
    await saveHighlight(page, fileId, {
      page: 2,
      quote: "An English quote.",
      rects: [{ x: 0.1, y: 0.1, w: 0.3, h: 0.02 }],
      color: "#FACC15",
    });
    await openReader(page, { paperId, fileId });
    await openNotes(page, "Notes");

    await expect(saveStatus(page)).toHaveText("Saved");
    await expect(
      panel(page).getByRole("heading", { name: "Highlights and comments · 1" }),
    ).toBeVisible();
    await expect(
      panel(page).getByRole("button", { name: /An English quote\./ }),
    ).toContainText("Page 2");

    await editor(page).click();
    await page.keyboard.type("Something in English.");
    await expect
      .poll(async () => (await notesOf(page, paperId))[0]?.title)
      .toBe(`Notes on ${title}`);
    await expect(saveStatus(page)).toHaveText("Saved");
    await expect(panel(page)).not.toContainText(/[一-鿿]/);
  });
});
