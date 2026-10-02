import { test, expect, Page } from "@playwright/test";

// A one-page PDF whose real title is the largest upright text, plus an arXiv stamp.
function paperPdf(title: string, stamp = "arXiv:2601.06966v2 [cs.CL]") {
  const stream = [
    `BT /F1 24 Tf 60 720 Td (${title}) Tj ET`,
    "BT /F1 10 Tf 60 690 Td (A short line of body text under the title.) Tj ET",
    `BT /F1 9 Tf 60 40 Td (${stamp}) Tj ET`,
  ].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, i) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf +=
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("") +
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf);
}

async function login(page: Page) {
  await page.goto("/#dashboard");
  await page.getByLabel("用户名", { exact: true }).fill("alice");
  await page
    .getByLabel("密码", { exact: true })
    .fill(process.env.E2E_TEST_PASSWORD!);
  await page.getByRole("button", { name: "登录空间", exact: true }).click();
  await expect(page.getByRole("heading", { name: "最近" })).toBeVisible();
}

// Drop real files onto the page the way a browser would.
async function dropFiles(
  page: Page,
  files: { name: string; type: string; base64: string }[],
  { release = true }: { release?: boolean } = {},
) {
  await page.evaluate(
    ({ files, release }) => {
      const dt = new DataTransfer();
      for (const f of files) {
        const bytes = Uint8Array.from(atob(f.base64), (c) => c.charCodeAt(0));
        dt.items.add(new File([bytes], f.name, { type: f.type }));
      }
      const fire = (type: string) =>
        document.body.dispatchEvent(
          new DragEvent(type, {
            dataTransfer: dt,
            bubbles: true,
            cancelable: true,
          }),
        );
      fire("dragenter");
      fire("dragover");
      if (release) fire("drop");
    },
    { files, release },
  );
}

const file = (name: string, buffer: Buffer, type = "application/pdf") => ({
  name,
  type,
  base64: buffer.toString("base64"),
});

test("Upload a PDF in one step: title and arXiv id come from the file, then it opens", async ({
  page,
}) => {
  await login(page);
  await page.getByRole("button", { name: "导入论文", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "导入论文" });
  await expect(dialog.getByText("上传 PDF", { exact: true })).toBeVisible();
  await page.getByTestId("pdf-file-input").setInputFiles({
    name: "scan_0042.pdf",
    mimeType: "application/pdf",
    buffer: paperPdf("Adaptive Retrieval for Long Context Reading"),
  });
  await expect(page).toHaveURL(/#paper\//);
  await expect(
    page.getByRole("heading", {
      name: "Adaptive Retrieval for Long Context Reading",
    }),
  ).toBeVisible();
  const papers = await page.evaluate(async () =>
    (await fetch("/api/v1/papers")).json(),
  );
  const created = papers.find(
    (p: any) => p.title === "Adaptive Retrieval for Long Context Reading",
  );
  expect(created.external_id).toBe("arxiv:2601.06966v2");
  const files = await page.evaluate(
    async (id) => (await fetch(`/api/v1/papers/${id}/files`)).json(),
    created.id,
  );
  expect(files).toHaveLength(1);
  expect(files[0]).toMatchObject({ mime: "application/pdf", pages: 1 });
});

test("Dropping PDFs anywhere shows a drop target, imports each file and lands in the library", async ({
  page,
}) => {
  await login(page);
  await page.goto("/#library");
  await expect(page.getByRole("heading", { name: "我的文库" })).toBeVisible();
  const first = paperPdf(
    "First Dropped Paper About Memory",
    "arXiv:2602.00001",
  );
  const second = paperPdf(
    "Second Dropped Paper About Agents",
    "arXiv:2602.00002",
  );
  await dropFiles(page, [file("a.pdf", first), file("b.pdf", second)], {
    release: false,
  });
  await expect(page.getByText("松开即可导入 PDF")).toBeVisible();
  await dropFiles(page, [file("a.pdf", first), file("b.pdf", second)]);
  await expect(page.getByText("已导入 2 篇论文")).toBeVisible();
  await expect(page).toHaveURL(/#library/);
  await expect(
    page.getByText("First Dropped Paper About Memory"),
  ).toBeVisible();
  await expect(
    page.getByText("Second Dropped Paper About Agents"),
  ).toBeVisible();
  await expect(page.getByText("松开即可导入 PDF")).toHaveCount(0);
});

test("Non-PDF drops are refused with a clear message and create nothing", async ({
  page,
}) => {
  await login(page);
  const before = await page.evaluate(
    async () =>
      ((await (await fetch("/api/v1/papers")).json()) as unknown[]).length,
  );
  await dropFiles(page, [
    file("notes.txt", Buffer.from("hello"), "text/plain"),
  ]);
  await expect(page.getByText("目前只能导入 PDF 文件")).toBeVisible();
  const after = await page.evaluate(
    async () =>
      ((await (await fetch("/api/v1/papers")).json()) as unknown[]).length,
  );
  expect(after).toBe(before);
});

test("A PDF without a readable title falls back to the file name", async ({
  page,
}) => {
  await login(page);
  await page.goto("/#library");
  await dropFiles(page, [
    file("field_notes_2026.pdf", paperPdf("Hi", "no stamp here")),
  ]);
  await expect(page).toHaveURL(/#paper\//);
  await expect(
    page.getByRole("heading", { name: "field notes 2026" }),
  ).toBeVisible();
});

test("Readers never see file names: no file picker, no raw name in info, share or downloads", async ({
  page,
}) => {
  await login(page);
  await page.goto("/#library");
  await page.getByRole("button", { name: "导入论文", exact: true }).click();
  await page.getByTestId("pdf-file-input").setInputFiles({
    name: "raw_scan_0042.pdf",
    mimeType: "application/pdf",
    buffer: paperPdf("A Study of Names That Readers Never Need To See"),
  });
  await expect(page).toHaveURL(/#paper\//);
  await expect(
    page.getByRole("heading", {
      name: "A Study of Names That Readers Never Need To See",
    }),
  ).toBeVisible();

  await page.getByRole("button", { name: "论文信息", exact: true }).click();
  const info = page.getByRole("dialog", { name: "论文信息" });
  await expect(info).toBeVisible();
  await expect(page.getByLabel("预览文件")).toHaveCount(0);
  // What a reader actually sees (innerText skips the collapsed advanced section).
  const seen = await info.evaluate((el) => (el as HTMLElement).innerText);
  expect(seen).not.toContain("raw_scan_0042");
  expect(seen).not.toContain(".pdf");
  // Version and attachment management still exists, but tucked away.
  const advanced = info.getByText("高级 · 补充材料与版本");
  await expect(advanced).toBeVisible();
  await expect(info.getByRole("button", { name: "上传附件" })).toBeHidden();
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "分享论文", exact: true }).click();
  const share = page.getByRole("dialog", { name: "分享论文" });
  await expect(share).toContainText(
    "A Study of Names That Readers Never Need To See",
  );
  await expect(share).not.toContainText("raw_scan_0042");
  await share.getByRole("button", { name: "创建分享链接" }).click();
  await expect(share.getByText("仅论文")).toBeVisible();
  await expect(share).not.toContainText("raw_scan_0042");
});

test("Library covers are stored for return visits and forgotten on sign-out", async ({
  page,
}) => {
  await login(page);
  await page.goto("/#library");
  await page.getByRole("button", { name: "导入论文", exact: true }).click();
  await page.getByTestId("pdf-file-input").setInputFiles({
    name: "cover-cache.pdf",
    mimeType: "application/pdf",
    buffer: paperPdf("A Cover That Is Remembered Between Visits"),
  });
  await expect(page).toHaveURL(/#paper\//);
  await page.goto("/#library?view=grid");
  await expect(
    page.locator('.paper-cover[data-ready="true"]').first(),
  ).toBeVisible();
  const stored = () =>
    page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          const open = indexedDB.open("paper-covers", 1);
          open.onerror = () => resolve(-1);
          open.onsuccess = () => {
            const count = open.result
              .transaction("covers")
              .objectStore("covers")
              .count();
            count.onsuccess = () => resolve(count.result);
          };
        }),
    );
  await expect.poll(stored).toBeGreaterThan(0);

  await page.getByRole("button", { name: "alice" }).click();
  await page.getByRole("menuitem", { name: "退出登录" }).click();
  await expect(page.getByLabel("用户名", { exact: true })).toBeVisible();
  await expect.poll(stored).toBe(0);
});

test("arXiv HTML and abstract links with navigation parameters import the same paper", async ({
  page,
}) => {
  await login(page);
  let paperUrl = "";
  for (const link of [
    "https://arxiv.org/html/9901.00001v1#S1",
    "https://arxiv.org/abs/9901.00001?utm_source=share",
  ]) {
    await page.goto("/#library");
    await page.getByRole("button", { name: "导入论文", exact: true }).click();
    await page.getByLabel("从 arXiv 导入", { exact: true }).fill(link);
    await page.getByRole("button", { name: "获取论文", exact: true }).click();
    await expect(page).toHaveURL(/#paper\//);
    await expect(
      page.getByRole("heading", {
        name: "Synthetic discovery memory paper",
        exact: true,
      }),
    ).toBeVisible();
    if (paperUrl) expect(page.url()).toBe(paperUrl);
    paperUrl = page.url();
  }
  // The account is shared with the other specs, and discovery leaves out papers that
  // are already in the library: do not leave this one behind for the discovery spec.
  const id = paperUrl.split("#paper/")[1].split(/[/?]/)[0];
  const csrf = (await page.context().cookies()).find(
    (c) => c.name === "paper_csrf",
  )!.value;
  const paper = await (await page.request.get(`/api/v1/papers/${id}`)).json();
  const removed = await page.request.delete(`/api/v1/papers/${id}`, {
    headers: {
      "X-CSRF-Token": csrf,
      "If-Match": String(paper.revision),
      "X-Confirm-Delete": id,
    },
  });
  expect(removed.ok()).toBeTruthy();
});
