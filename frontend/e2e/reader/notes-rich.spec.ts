import { expect, test, type Page } from "@playwright/test";
import { createPaperWithPdf, openReader, signIn } from "./fixtures";

// What a note holds besides words: formulas and pictures. (The words are in notes.spec.ts.)
test.use({ locale: "zh-CN" });

const panel = (page: Page) => page.getByRole("complementary");
const editor = (page: Page) =>
  panel(page).getByRole("textbox", { name: "笔记正文", exact: true });

async function csrf(page: Page) {
  return (await page.context().cookies()).find((c) => c.name === "paper_csrf")!
    .value;
}

type Note = { id: string; title: string; body: string; revision: number };

async function firstNote(page: Page, paperId: string): Promise<Note> {
  const response = await page.request.get(
    `/api/v1/items?kind=note&paper_id=${paperId}`,
  );
  expect(response.ok()).toBeTruthy();
  return (await response.json())[0];
}

async function setBody(page: Page, paperId: string, body: string) {
  const note = await firstNote(page, paperId);
  const response = await page.request.put(`/api/v1/items/${note.id}`, {
    headers: {
      "X-CSRF-Token": await csrf(page),
      "Idempotency-Key": crypto.randomUUID(),
      "If-Match": String(note.revision),
    },
    data: {
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
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return note.id;
}

async function openNotes(page: Page, paperId: string) {
  await openReader(page, { paperId });
  await panel(page).getByRole("tab", { name: "笔记", exact: true }).click();
  await expect(editor(page)).toBeVisible();
}

test("formulas render, code keeps its dollars, and an edited formula is kept as LaTeX", async ({
  page,
}) => {
  await signIn(page);
  const { paperId } = await createPaperWithPdf(page);
  const body = String.raw`行内公式 $E=mc^2$。

$$
\frac{a+b}{c}=\sum_{i=1}^{n} x_i
$$

代码保持原样：

${"```"}text
$$not math$$
${"```"}
`;
  const noteId = await setBody(page, paperId, body);
  await openNotes(page, paperId);
  await expect(editor(page).locator(".katex")).toHaveCount(2);
  await expect(editor(page).locator("pre")).toContainText("$$not math$$");

  await editor(page).locator('[data-type="block-math"]').click();
  await page
    .getByLabel("LaTeX 公式", { exact: true })
    .fill(String.raw`\int_0^1 x^2\,dx=\frac{1}{3}`);
  await page.getByRole("button", { name: "保存公式", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await (await page.request.get(`/api/v1/items/${noteId}`)).json()).body,
    )
    .toContain(String.raw`\int_0^1`);

  await page.reload();
  await panel(page).getByRole("tab", { name: "笔记", exact: true }).click();
  await expect(editor(page).locator(".katex")).toHaveCount(2);
  await expect(
    editor(page).locator('[data-type="block-math"]'),
  ).toHaveAttribute("data-latex", String.raw`\int_0^1 x^2\,dx=\frac{1}{3}`);
  // A formula typed in `$$` is made into one.
  await editor(page).focus();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await editor(page).pressSequentially("$$a^2+b^2=c^2$$");
  await expect(editor(page).locator('[data-type="block-math"]')).toHaveCount(2);
});

test("pictures pasted or dropped into a note are kept with it, and are there after a reload", async ({
  page,
}) => {
  await signIn(page);
  const { paperId } = await createPaperWithPdf(page);
  const noteId = await setBody(
    page,
    paperId,
    "## 实验结果\n\n在这里插入图片。",
  );
  await openNotes(page, paperId);

  const png = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 480;
    canvas.height = 240;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ecfdf5";
    ctx.fillRect(0, 0, 480, 240);
    ctx.fillStyle = "#047857";
    ctx.font = "28px sans-serif";
    ctx.fillText("Experiment A · 42%", 45, 110);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  const paste = (name: string) =>
    editor(page).evaluate(
      (el, { png, name }) => {
        const data = new DataTransfer();
        data.items.add(
          new File([Uint8Array.from(atob(png), (c) => c.charCodeAt(0))], name, {
            type: "image/png",
          }),
        );
        el.dispatchEvent(
          new ClipboardEvent("paste", {
            clipboardData: data,
            bubbles: true,
            cancelable: true,
          }),
        );
      },
      { png, name },
    );

  await editor(page).click();
  await page.keyboard.press("ControlOrMeta+End");
  await paste("clipboard.png");
  await expect(editor(page).locator("img")).toHaveCount(1);
  await expect
    .poll(() =>
      editor(page)
        .locator("img")
        .evaluate((img: HTMLImageElement) => img.naturalWidth),
    )
    .toBe(480);
  await expect(page.getByText("正在上传图片…", { exact: true })).toHaveCount(0);

  await editor(page).evaluate((el, png) => {
    const data = new DataTransfer();
    data.items.add(
      new File(
        [Uint8Array.from(atob(png), (c) => c.charCodeAt(0))],
        "drop.png",
        { type: "image/png" },
      ),
    );
    const rect = el.getBoundingClientRect();
    el.dispatchEvent(
      new DragEvent("drop", {
        dataTransfer: data,
        clientX: rect.x + 20,
        clientY: rect.y + 20,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, png);
  await expect(editor(page).locator("img")).toHaveCount(2);

  await expect
    .poll(async () => {
      const saved = await (
        await page.request.get("/api/v1/items/" + noteId)
      ).json();
      return (saved.body.match(/\/api\/v1\/note-images\//g) || []).length;
    })
    .toBe(2);

  await page.reload();
  await panel(page).getByRole("tab", { name: "笔记", exact: true }).click();
  await expect(editor(page).locator("img")).toHaveCount(2);
  await expect
    .poll(() =>
      editor(page)
        .locator("img")
        .first()
        .evaluate((img: HTMLImageElement) => img.naturalWidth),
    )
    .toBe(480);
});

test("markup in a note is shown as text: no script runs, no unsafe link, no picture from elsewhere", async ({
  page,
}) => {
  await signIn(page);
  const { paperId } = await createPaperWithPdf(page);
  await setBody(
    page,
    paperId,
    '<img src=x onerror="window.__xss=1"><script>window.__xss=2</script>\n\n[unsafe](javascript:alert(1))\n\n![tracking](https://example.invalid/pixel.png)\n\n**Safe bold content**',
  );
  await openNotes(page, paperId);
  await expect(
    editor(page).getByText("Safe bold content", { exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => (window as any).__xss)).toBeUndefined();
  expect(
    await editor(page).locator('script, img, a[href^="javascript:"]').count(),
  ).toBe(0);
});
