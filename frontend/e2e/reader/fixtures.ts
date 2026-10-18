import { expect, type Page } from "@playwright/test";
import { readerHash, type ReaderRoute } from "../../src/reader/route";
import { testPdf } from "../fixtures/pdf";

/** Sign in as alice through the sign-in form, the way every other spec does. */
export async function signIn(page: Page) {
  await page.goto("/#dashboard");
  await page.getByLabel("用户名", { exact: true }).fill("alice");
  await page
    .getByLabel("密码", { exact: true })
    .fill(process.env.E2E_TEST_PASSWORD!);
  await page.getByRole("button", { name: "登录空间", exact: true }).click();
  await expect(page.getByRole("heading", { name: "最近" })).toBeVisible();
}

/** The headers a write to the API needs: the session's CSRF token and a fresh idempotency key. */
async function writeHeaders(page: Page) {
  const csrf = (await page.context().cookies()).find(
    (cookie) => cookie.name === "paper_csrf",
  )?.value;
  expect(csrf, "sign in first").toBeTruthy();
  return {
    "X-CSRF-Token": csrf!,
    "Idempotency-Key": crypto.randomUUID(),
  };
}

/** An entry of a PDF's own table of contents, with the entries under it. */
export type OutlineItem = {
  title: string;
  /** The page it leads to, from 1. */
  page: number;
  children?: OutlineItem[];
  /** The destination as the PDF writes it, instead of one to `page`: e.g. `(nowhere)`, a name nothing defines. */
  dest?: string;
};

/**
 * A citation, as a paper typeset with hyperref has one: a link on page `from`
 * (under the page's lines, at 40–200 × 560–590 points) to the destination named
 * `cite.<key>`, which is the start of `entry`, a line of the reference list on
 * page `to` (at 40, 390).
 */
export type Citation = { from: number; to: number; key: string; entry: string };

/**
 * A PDF of `pages` pages, each saying which one it is. `links` are internal
 * links: a box near the top of page `from` that jumps to page `to`. `outline` is
 * the PDF's own table of contents; `words` puts a word on a page (a second line
 * under the one that says which page it is), to search for; `size` is a page's
 * width and height in points (a letter page, 612 × 792, unless given);
 * `citations` are links to entries of a reference list, by name.
 */
export function pdfWithPages(
  pages: number,
  links: { from: number; to: number }[] = [],
  options: {
    outline?: OutlineItem[];
    words?: Record<number, string>;
    size?: [number, number];
    citations?: Citation[];
  } = {},
): Buffer {
  const [width, height] = options.size ?? [612, 792];
  const citations = options.citations ?? [];
  // 1 catalog, 2 page tree, 3 font; then a page and its content per page; then the links; then the
  // outline; then the citations' links, and the name tree of their destinations.
  const pageObject = (page: number) => 4 + 2 * (page - 1);
  const linkObject = (index: number) => 4 + 2 * pages + index;
  const outlineRoot = 4 + 2 * pages + links.length;

  // The outline, flattened in the order its objects are written: parent, then its children.
  type Flat = { item: OutlineItem; parent: number | null; children: number[] };
  const flat: Flat[] = [];
  const walk = (items: OutlineItem[], parent: number | null): number[] =>
    items.map((item) => {
      const index = flat.length;
      flat.push({ item, parent, children: [] });
      flat[index].children = walk(item.children ?? [], index);
      return index;
    });
  const top = walk(options.outline ?? [], null);
  const objectOf = (index: number) => outlineRoot + 1 + index;
  const citationObject = (index: number) =>
    outlineRoot + (top.length ? 1 + flat.length : 0) + index;
  const namesObject = citationObject(citations.length);

  const objects: string[] = [
    `<< /Type /Catalog /Pages 2 0 R${top.length ? ` /Outlines ${outlineRoot} 0 R` : ""}${citations.length ? ` /Names << /Dests ${namesObject} 0 R >>` : ""} >>`,
    `<< /Type /Pages /Kids [${Array.from({ length: pages }, (_, i) => `${pageObject(i + 1)} 0 R`).join(" ")}] /Count ${pages} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  for (let page = 1; page <= pages; page++) {
    const word = options.words?.[page];
    const entries = citations
      .filter((citation) => citation.to === page)
      .map(({ entry }) => ` BT /F1 12 Tf 40 390 Td (${entry}) Tj ET`)
      .join("");
    const stream = `BT /F1 20 Tf 40 ${height - 72} Td (Page ${page} of ${pages}) Tj${word ? ` 0 -40 Td (${word}) Tj` : ""} ET${entries}`;
    const annots = [
      ...links.map((link, index) =>
        link.from === page ? linkObject(index) : 0,
      ),
      ...citations.map((citation, index) =>
        citation.from === page ? citationObject(index) : 0,
      ),
    ]
      .filter(Boolean)
      .map((object) => `${object} 0 R`)
      .join(" ");
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageObject(page) + 1} 0 R${annots ? ` /Annots [${annots}]` : ""} >>`,
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    );
  }
  for (const link of links)
    objects.push(
      `<< /Type /Annot /Subtype /Link /Rect [40 640 260 700] /Border [0 0 0] /Dest [${pageObject(link.to)} 0 R /XYZ 40 720 null] >>`,
    );
  if (top.length) {
    objects.push(
      `<< /Type /Outlines /First ${objectOf(top[0])} 0 R /Last ${objectOf(top.at(-1)!)} 0 R /Count ${top.length} >>`,
    );
    flat.forEach(({ item, parent, children }, index) => {
      const siblings = parent === null ? top : flat[parent].children;
      const at = siblings.indexOf(index);
      objects.push(
        `<< /Title (${item.title}) /Parent ${parent === null ? outlineRoot : objectOf(parent)} 0 R` +
          (at > 0 ? ` /Prev ${objectOf(siblings[at - 1])} 0 R` : "") +
          (at < siblings.length - 1
            ? ` /Next ${objectOf(siblings[at + 1])} 0 R`
            : "") +
          (children.length
            ? ` /First ${objectOf(children[0])} 0 R /Last ${objectOf(children.at(-1)!)} 0 R /Count ${children.length}`
            : "") +
          ` /Dest ${item.dest ?? `[${pageObject(item.page)} 0 R /XYZ 40 720 null]`} >>`,
      );
    });
  }
  for (const citation of citations)
    objects.push(
      `<< /Type /Annot /Subtype /Link /Rect [40 560 200 590] /Border [0 0 0] /Dest (cite.${citation.key}) >>`,
    );
  if (citations.length) {
    // A name tree lists its names in order.
    const named = [...citations]
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
      .map(
        (citation) =>
          `(cite.${citation.key}) [${pageObject(citation.to)} 0 R /XYZ 40 404 null]`,
      );
    objects.push(`<< /Names [${named.join(" ")}] >>`);
  }
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf +=
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets
      .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
      .join("") +
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf);
}

/** A PDF of `pages` pages with a table of contents of its own. */
export function pdfWithOutline(pages: number, outline: OutlineItem[]): Buffer {
  return pdfWithPages(pages, [], { outline });
}

let made = 0;

/**
 * A paper with a PDF, made through the API as the signed-in user. The title is
 * English and unique unless one is given (the English interface is checked for
 * stray Chinese, and a title is the one thing in it that is not ours). Without
 * `pages` the PDF is the shared `testPdf` (two pages, with links); with it, a
 * PDF of that many pages and the given internal `links`.
 */
export async function createPaperWithPdf(
  page: Page,
  options: {
    title?: string;
    pages?: number;
    links?: { from: number; to: number }[];
    /** The PDF's own table of contents. */
    outline?: OutlineItem[];
    /** Words to find: a word on a page, by page number. */
    words?: Record<number, string>;
    /** The pages' width and height in points; letter-sized if left out. */
    size?: [number, number];
    /** Links to entries of a reference list. */
    citations?: Citation[];
  } = {},
): Promise<{ paperId: string; fileId: string; title: string }> {
  const title =
    options.title ?? `Reader Test Paper ${Date.now().toString(36)}-${++made}`;
  const response = await page.request.post("/api/v1/papers", {
    headers: await writeHeaders(page),
    data: {
      title,
      authors: "A. Author; B. Author",
      tags: [],
      abstract: "A paper made for the reader's browser tests.",
    },
  });
  expect(response.ok()).toBeTruthy();
  const paper = await response.json();
  const buffer =
    options.pages === undefined &&
    !options.links &&
    !options.outline &&
    !options.words &&
    !options.size &&
    !options.citations
      ? testPdf()
      : pdfWithPages(options.pages ?? 2, options.links, {
          outline: options.outline,
          words: options.words,
          size: options.size,
          citations: options.citations,
        });
  const upload = await page.request.post(`/api/v1/papers/${paper.id}/files`, {
    headers: await writeHeaders(page),
    multipart: {
      version_id: paper.current_version,
      file: { name: "paper.pdf", mimeType: "application/pdf", buffer },
    },
  });
  expect(upload.ok()).toBeTruthy();
  const file = await upload.json();
  return { paperId: paper.id, fileId: file.id, title };
}

/** Go to the new reader at a route (the page must already be signed in). */
export async function openReader(page: Page, route: ReaderRoute) {
  await page.goto("/" + readerHash(route));
}

/** A rectangle on a page, in fractions of the page's width and height from its top left. */
export type PageRect = { x: number; y: number; w: number; h: number };

/** A highlight saved through the API, as the old reader saves one (`PUT /files/{id}/annotations/{uuid}`). */
export async function saveHighlight(
  page: Page,
  fileId: string,
  highlight: {
    page: number;
    quote: string;
    rects: PageRect[];
    color: string;
    comment?: string;
  },
): Promise<{ id: string }> {
  const response = await page.request.put(
    `/api/v1/files/${fileId}/annotations/${crypto.randomUUID()}`,
    {
      headers: await writeHeaders(page),
      data: { prefix: "", comment: "", ...highlight },
    },
  );
  expect(response.ok()).toBeTruthy();
  return response.json();
}

/** A stroke of handwriting saved through the API (`PUT /files/{id}/ink/{uuid}`); points are x, y (fractions) and pressure. */
export async function saveStroke(
  page: Page,
  fileId: string,
  stroke: {
    page: number;
    color: string;
    width: number;
    points: [number, number, number][];
  },
): Promise<{ id: string }> {
  const response = await page.request.put(
    `/api/v1/files/${fileId}/ink/${crypto.randomUUID()}`,
    { headers: await writeHeaders(page), data: stroke },
  );
  expect(response.ok()).toBeTruthy();
  return response.json();
}
