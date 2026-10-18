import { expect, test, type Page } from "@playwright/test";
import { signIn } from "../reader/fixtures";

// The screens follow the browser's language; these specs read them in Chinese.
test.use({ locale: "zh-CN" });

/** A one-page PDF whose real title is the largest upright text, plus an arXiv stamp. */
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

// Home asks for a model first while there is none: these specs have one.
test.beforeEach(async ({ page }) => {
  await page.route("**/api/v1/translation-settings", (route) =>
    route.fulfill({
      json: {
        active_id: "model-1",
        configured: true,
        models: [{ id: "model-1" }],
      },
    }),
  );
});

type Paper = {
  id: string;
  title: string;
  external_id?: string;
  revision: number;
};
const papers = async (page: Page): Promise<Paper[]> =>
  (await page.request.get("/api/v1/papers")).json();

/** Drops PDFs on the page the way a browser would, as the screen's own drop zone takes them. */
async function dropFiles(
  page: Page,
  files: { name: string; type: string; buffer: Buffer }[],
) {
  const data = await page.evaluateHandle(
    (list) => {
      const transfer = new DataTransfer();
      for (const file of list)
        transfer.items.add(
          new File(
            [Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0))],
            file.name,
            {
              type: file.type,
            },
          ),
        );
      return transfer;
    },
    files.map((f) => ({
      name: f.name,
      type: f.type,
      base64: f.buffer.toString("base64"),
    })),
  );
  for (const type of ["dragenter", "dragover", "drop"])
    await page.dispatchEvent("main h1", type, { dataTransfer: data });
}

async function remove(page: Page, paper: Paper) {
  const csrf = (await page.context().cookies()).find(
    (c) => c.name === "paper_csrf",
  )!.value;
  const fresh = await (
    await page.request.get(`/api/v1/papers/${paper.id}`)
  ).json();
  const response = await page.request.delete(`/api/v1/papers/${paper.id}`, {
    headers: {
      "X-CSRF-Token": csrf,
      "If-Match": String(fresh.revision),
      "X-Confirm-Delete": paper.id,
    },
  });
  expect(response.ok()).toBeTruthy();
}

test("an uploaded PDF takes its title and arXiv id from the file, and is kept as one PDF", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/#library");
  await page
    .getByRole("main")
    .getByRole("button", { name: "导入", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "导入论文" })
    .getByTestId("import-file-input")
    .setInputFiles({
      name: "scan_0042.pdf",
      mimeType: "application/pdf",
      buffer: paperPdf("Adaptive Retrieval for Long Context Reading"),
    });
  await expect(page).toHaveURL(/#read\/[a-zA-Z0-9-]+$/);
  const created = (await papers(page)).find(
    (p) => p.title === "Adaptive Retrieval for Long Context Reading",
  )!;
  expect(created.external_id).toBe("arxiv:2601.06966v2");
  const files = await (
    await page.request.get(`/api/v1/papers/${created.id}/files`)
  ).json();
  expect(files).toHaveLength(1);
  expect(files[0]).toMatchObject({ mime: "application/pdf", pages: 1 });
  await remove(page, created);
});

test("several dropped PDFs are all imported and the library lists them without the files' own names", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/#library");
  await expect(
    page.getByRole("main").getByRole("heading", { name: "文库" }),
  ).toBeVisible();
  const titles = [
    "First Dropped Paper About Memory",
    "Second Dropped Paper About Agents",
  ];
  await dropFiles(page, [
    {
      name: "raw_scan_a.pdf",
      type: "application/pdf",
      buffer: paperPdf(titles[0], "arXiv:2602.00001"),
    },
    {
      name: "raw_scan_b.pdf",
      type: "application/pdf",
      buffer: paperPdf(titles[1], "arXiv:2602.00002"),
    },
  ]);
  const main = page.getByRole("main");
  for (const title of titles)
    await expect(
      main.getByRole("link", { name: new RegExp(title) }),
    ).toBeVisible();
  // Nothing of the files' own names is shown.
  await expect(main).not.toContainText("raw_scan");
  for (const paper of await papers(page))
    if (titles.includes(paper.title)) await remove(page, paper);
});

test("a PDF without a readable title is named after its file", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/#library");
  await dropFiles(page, [
    {
      name: "field_notes_2026.pdf",
      type: "application/pdf",
      buffer: paperPdf("Hi", "no stamp here"),
    },
  ]);
  await expect(page).toHaveURL(/#read\/[a-zA-Z0-9-]+$/);
  const created = (await papers(page)).find(
    (p) => p.title === "field notes 2026",
  );
  expect(created).toBeTruthy();
  await remove(page, created!);
});

test("arXiv html and abstract links with navigation parameters import the same paper", async ({
  page,
}) => {
  await signIn(page);
  let url = "";
  for (const link of [
    "https://arxiv.org/html/9901.00001v1#S1",
    "https://arxiv.org/abs/9901.00001?utm_source=share",
  ]) {
    await page.goto("/#home");
    const home = page.getByRole("main");
    await home.getByRole("textbox", { name: "arXiv 链接或编号" }).fill(link);
    await home.getByRole("button", { name: "导入", exact: true }).click();
    await expect(page).toHaveURL(/#read\/[a-zA-Z0-9-]+$/);
    if (url) expect(page.url()).toBe(url);
    url = page.url();
  }
  // The account is shared with other specs: do not leave this paper in it.
  const id = url.split("#read/")[1].split(/[/?]/)[0];
  const paper = await (await page.request.get(`/api/v1/papers/${id}`)).json();
  await remove(page, paper);
});
