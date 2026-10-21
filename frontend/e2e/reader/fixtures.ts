import { expect, type Page } from "@playwright/test";
import { readerHash, type ReaderRoute } from "../../src/reader/route";
import { testPdf } from "../fixtures/pdf";

/**
 * This worker's own account: alice for the first, alice1, alice2, ... for the
 * others (scripts/e2e_server.py makes one pair per worker), so tests running
 * in parallel never share papers, notes or the one task an account may run.
 */
export function who(name: "alice" | "bob") {
  const index = Number(process.env.TEST_PARALLEL_INDEX ?? 0);
  return index ? `${name}${index}` : name;
}

/** Sign in as alice through the sign-in form, in whichever language the browser asks for. */
export async function signIn(page: Page) {
  await page.goto("/#dashboard");
  const username = page.getByLabel(/^(用户名|Username)$/);
  await username.fill(who("alice"));
  await page
    .getByLabel(/^(密码|Password)$/)
    .fill(process.env.E2E_TEST_PASSWORD!);
  await page.getByRole("button", { name: /^(登录空间|Sign in)$/ }).click();
  // Signed in: the app's first screen (home, or the setup while there is no model).
  await expect(page.locator("[data-app-screen]")).toBeVisible();
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
 * A citation, as a paper typeset with hyperref has one: in a line of text on
 * page `from` (`See [n] for details.`, the n-th citation, at 40 × 570 points
 * and 24 points lower for each citation before it), a link over `[n]` to the
 * destination named `cite.<key>`, which is the start of `entry`, a line of the
 * reference list on page `to` (at 40, 390).
 */
export type Citation = { from: number; to: number; key: string; entry: string };

/**
 * A link to a web address in a line of text: `before`, then `label` (the link)
 * then `after`, on `page` at 40 × 450 points (24 points lower for each web link
 * before it).
 */
export type WebLink = {
  page: number;
  url: string;
  before: string;
  label: string;
  after: string;
};

/** The words of a page that has links in its lines go on after them, on this line (at 40 × 330). */
export const AFTER_LINKS = "Text after the links.";

/** Helvetica's advance widths (its AFM), in thousandths of the font size, for laying a link over its words. */
const HELVETICA: [number, string][] = [
  [222, "ijl"],
  [278, " !,./:;[]ftI"],
  [333, "-r"],
  [500, "ckJsvxyz"],
  [556, "abdeghnopqu0123456789#?_L"],
  [611, "FTZ"],
  [667, "ABEKPSVXY&"],
  [722, "CDHNRUw"],
  [778, "GOQ"],
  [833, "mM"],
  [944, "W"],
];
const widthOf = (char: string) =>
  HELVETICA.find(([, chars]) => chars.includes(char))?.[0] ?? 556;
/** How wide `text` is in Helvetica at `size` points. */
const helvetica = (text: string, size: number) =>
  ([...text].reduce((sum, char) => sum + widthOf(char), 0) * size) / 1000;

/** A line of 12-point text at `y` with a link box over its middle part, as PDF content and the box. */
function linkedLine(y: number, before: string, label: string, after: string) {
  const left = 40 + helvetica(before, 12);
  return {
    content: ` BT /F1 12 Tf 40 ${y} Td (${before}${label}${after}) Tj ET`,
    rect: `[${left.toFixed(2)} ${y - 4} ${(left + helvetica(label, 12)).toFixed(2)} ${y + 12}]`,
  };
}

/**
 * A PDF of `pages` pages, each saying which one it is. `links` are internal
 * links: a box near the top of page `from` that jumps to page `to`. `outline` is
 * the PDF's own table of contents; `words` puts a word on a page (a second line
 * under the one that says which page it is), to search for; `size` is a page's
 * width and height in points (a letter page, 612 × 792, unless given);
 * `citations` are links to entries of a reference list, by name; `webLinks`
 * links to addresses. A page with either in its lines has a last line after
 * them (`AFTER_LINKS`).
 */
export function pdfWithPages(
  pages: number,
  links: { from: number; to: number }[] = [],
  options: {
    outline?: OutlineItem[];
    words?: Record<number, string>;
    size?: [number, number];
    citations?: Citation[];
    webLinks?: WebLink[];
  } = {},
): Buffer {
  const [width, height] = options.size ?? [612, 792];
  const citations = options.citations ?? [];
  const webLinks = options.webLinks ?? [];
  const cited = citations.map((_, index) =>
    linkedLine(570 - 24 * index, "See ", `[${index + 1}]`, " for details."),
  );
  const linked = webLinks.map((link, index) =>
    linkedLine(450 - 24 * index, link.before, link.label, link.after),
  );
  // 1 catalog, 2 page tree, 3 font; then a page and its content per page; then the links; then the
  // outline; then the citations' links, and the name tree of their destinations; then the web links.
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
  const webObject = (index: number) =>
    namesObject + (citations.length ? 1 : 0) + index;

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
    const lines = [
      ...cited.filter((_, index) => citations[index].from === page),
      ...linked.filter((_, index) => webLinks[index].page === page),
    ];
    const stream =
      `BT /F1 20 Tf 40 ${height - 72} Td (Page ${page} of ${pages}) Tj${word ? ` 0 -40 Td (${word}) Tj` : ""} ET${entries}` +
      lines.map((line) => line.content).join("") +
      (lines.length ? ` BT /F1 12 Tf 40 330 Td (${AFTER_LINKS}) Tj ET` : "");
    const annots = [
      ...links.map((link, index) =>
        link.from === page ? linkObject(index) : 0,
      ),
      ...citations.map((citation, index) =>
        citation.from === page ? citationObject(index) : 0,
      ),
      ...webLinks.map((link, index) =>
        link.page === page ? webObject(index) : 0,
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
  citations.forEach((citation, index) =>
    objects.push(
      `<< /Type /Annot /Subtype /Link /Rect ${cited[index].rect} /Border [0 0 0] /Dest (cite.${citation.key}) >>`,
    ),
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
  webLinks.forEach((link, index) =>
    objects.push(
      `<< /Type /Annot /Subtype /Link /Rect ${linked[index].rect} /Border [0 0 0] /A << /S /URI /URI (${link.url}) >> >>`,
    ),
  );
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
    /** Links to web addresses, in lines of text. */
    webLinks?: WebLink[];
    /** The file as it is, instead of one made from the options above. */
    buffer?: Buffer;
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
  const buffer = options.buffer
    ? options.buffer
    : options.pages === undefined &&
        !options.links &&
        !options.outline &&
        !options.words &&
        !options.size &&
        !options.citations &&
        !options.webLinks
      ? testPdf()
      : pdfWithPages(options.pages ?? 2, options.links, {
          outline: options.outline,
          words: options.words,
          size: options.size,
          citations: options.citations,
          webLinks: options.webLinks,
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

/**
 * These tests have no worker to finish the tasks they start. Stop whatever an
 * earlier test left, so it is not still queued when the next test looks at the
 * account's tasks (and so a limit that is switched back on cannot refuse it).
 */
export async function cancelActiveRuns(page: Page) {
  const csrf = (await page.context().cookies()).find(
    (cookie) => cookie.name === "paper_csrf",
  )!.value;
  const sessions = await (
    await page.request.get("/api/v1/agent/sessions")
  ).json();
  for (const session of sessions) {
    const runs = await (
      await page.request.get(`/api/v1/agent/sessions/${session.id}/runs`)
    ).json();
    for (const run of runs)
      if (["queued", "running"].includes(run.status))
        await page.request.post(`/api/v1/agent/runs/${run.id}/cancel`, {
          headers: {
            "X-CSRF-Token": csrf,
            "Idempotency-Key": crypto.randomUUID(),
          },
          data: {},
        });
  }
}
