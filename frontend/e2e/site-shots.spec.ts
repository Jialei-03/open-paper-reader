import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, copyFileSync } from "node:fs";
import { resolve } from "node:path";
import { en } from "../src/i18n/messages/en";
import { zh } from "../src/i18n/messages/zh";
import { openReader, saveHighlight, signIn } from "./reader/fixtures";

/*
 * Takes the pictures of the reader that the public page and the README show.
 * It is not part of the suite: `SITE_SHOTS=1 npx playwright test e2e/site-shots.spec.ts`
 * rewrites frontend/public/assets/site/ and docs/assets/reader.png.
 */
test.skip(!process.env.SITE_SHOTS, "only when the pictures are being remade");
test.use({ viewport: { width: 1440, height: 900 } });

const OUT = resolve(process.cwd(), "public/assets/site");
const README = resolve(process.cwd(), "../docs/assets/reader.png");

type Line = { y: number; text: string; size?: number; bold?: boolean };

/** Lines of text on a letter page, from the top: a paper's first pages, drawn with the standard fonts. */
const PAGES: Line[][] = [
  [
    {
      y: 700,
      text: "Sparse Retrieval Heads for Long-Context Reading",
      size: 20,
      bold: true,
    },
    { y: 672, text: "Mira Okafor, Daniel Reyes, Hana Sato", size: 11 },
    { y: 650, text: "Northlake Institute for Machine Reading", size: 10 },
    { y: 612, text: "Abstract", size: 12, bold: true },
    {
      y: 594,
      text: "Long documents are read by models that must decide which earlier passages matter. We show",
    },
    {
      y: 580,
      text: "that a small set of attention heads does most of this work, and that reading can be made",
    },
    {
      y: 566,
      text: "faster and more faithful by routing queries through those heads alone. Across five",
    },
    {
      y: 552,
      text: "benchmarks our method keeps answer quality while using a fraction of the memory.",
    },
    { y: 516, text: "1  Introduction", size: 13, bold: true },
    {
      y: 496,
      text: "Reading a paper means moving back and forth: a claim in the discussion sends the reader to",
    },
    {
      y: 482,
      text: "a table, and the table sends them to a definition three pages earlier. Language models face",
    },
    {
      y: 468,
      text: "the same problem at every token, and most of the cost of long context goes to looking up",
    },
    { y: 454, text: "text that is never used." },
    {
      y: 430,
      text: "Retrieval heads account for under 5% of attention heads but carry most of the lookups.",
    },
    {
      y: 416,
      text: "Removing them breaks long-range recall; keeping only them preserves it. This suggests that",
    },
    {
      y: 402,
      text: "long-context reading is sparse, and that the sparsity can be found without any retraining.",
    },
    {
      y: 372,
      text: "Contributions. We (1) define a simple test that scores each head by how often it copies",
    },
    {
      y: 358,
      text: "from far away, (2) show that the highest-scoring heads are stable across tasks, and (3)",
    },
    {
      y: 344,
      text: "release a reader that uses only those heads at inference time.",
    },
    { y: 300, text: "2  Related work", size: 13, bold: true },
    {
      y: 280,
      text: "Earlier work compresses the key-value cache by dropping old tokens. Others train retrieval",
    },
    {
      y: 266,
      text: "modules from scratch. Our approach needs neither: the heads already exist in the model.",
    },
  ],
  [
    { y: 700, text: "3  Method", size: 13, bold: true },
    {
      y: 680,
      text: "We score a head by running the model on passages with a repeated needle and counting how",
    },
    {
      y: 666,
      text: "often the head attends to the earlier copy. Heads above a threshold form the retrieval set.",
    },
    {
      y: 642,
      text: "At inference time, queries from all other heads attend only to a short window, while queries",
    },
    { y: 628, text: "from retrieval heads attend to the full context." },
    { y: 596, text: "4  Experiments", size: 13, bold: true },
    {
      y: 576,
      text: "We evaluate on five long-context benchmarks. Table 1 reports answer quality and peak memory",
    },
    {
      y: 562,
      text: "for the full model and for our reader. Quality drops by under one point while memory falls",
    },
    { y: 548, text: "by a factor of four on the longest inputs." },
  ],
  [
    { y: 700, text: "5  Limitations", size: 13, bold: true },
    {
      y: 680,
      text: "The retrieval set is found on English text; we have not tested other scripts. Tasks that need",
    },
    {
      y: 666,
      text: "dense aggregation over the whole document may need more heads than we keep.",
    },
  ],
];

const CLAIM =
  "Retrieval heads account for under 5% of attention heads but carry most of the lookups.";
const ABSTRACT_LINE =
  "faster and more faithful by routing queries through those heads alone. Across five";

function pdf(): Buffer {
  const objects: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${PAGES.map((_, i) => `${5 + 2 * i} 0 R`).join(" ")}] /Count ${PAGES.length} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
  ];
  PAGES.forEach((lines, index) => {
    const stream = lines
      .map(
        ({ y, text, size = 10, bold }) =>
          `BT /${bold ? "F2" : "F1"} ${size} Tf 40 ${y} Td (${text.replace(/[()\\]/g, "\\$&")}) Tj ET`,
      )
      .join("\n");
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${6 + 2 * index} 0 R >>`,
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    );
  });
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(out));
    out += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out);
  out +=
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("") +
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out);
}

async function headers(page: Page) {
  const csrf = (await page.context().cookies()).find(
    (cookie) => cookie.name === "paper_csrf",
  )!.value;
  return { "X-CSRF-Token": csrf, "Idempotency-Key": crypto.randomUUID() };
}

async function makePaper(page: Page) {
  const created = await page.request.post("/api/v1/papers", {
    headers: await headers(page),
    data: {
      title: "Sparse Retrieval Heads for Long-Context Reading",
      authors: "M. Okafor; D. Reyes; H. Sato",
      tags: [],
      abstract: "",
    },
  });
  const paper = await created.json();
  const uploaded = await page.request.post(`/api/v1/papers/${paper.id}/files`, {
    headers: await headers(page),
    multipart: {
      version_id: paper.current_version,
      file: { name: "paper.pdf", mimeType: "application/pdf", buffer: pdf() },
    },
  });
  expect(uploaded.ok()).toBeTruthy();
  const file = await uploaded.json();
  return { paperId: paper.id as string, fileId: file.id as string };
}

/** A line of a page as a rectangle in fractions of the page (a line at `y`, `text` wide in 10-point Helvetica). */
const rect = (y: number, text: string) => ({
  x: 40 / 612,
  y: (792 - y - 9) / 792,
  w: Math.min((text.length * 4.95) / 612, 0.86),
  h: 12 / 792,
});

const SESSION = "site-shots-session";
const MODEL = { id: "shots-model", name: "Model", model: "model" };

const COPY = {
  zh: {
    words: zh,
    ask: "为什么只保留这些注意力头，质量还不掉？",
    answer: (link: string) =>
      `因为长上下文里真正被反复查找的内容很集中。论文发现，检索头占全部注意力头不到 5%，却承担了大部分查找${link}。只让它们看完整上下文，其余的头只看短窗口，质量下降不到一个点，显存降到四分之一。`,
    cite: "p.1",
  },
  en: {
    words: en,
    ask: "Why can it keep so few heads without losing quality?",
    answer: (link: string) =>
      `Because the lookups that long context needs are concentrated. The paper finds that retrieval heads are under 5% of all heads but carry most of the lookups ${link}. Letting only those see the full context, while the rest see a short window, costs under one point of quality and cuts memory fourfold.`,
    cite: "p.1",
  },
} as const;

for (const language of ["zh", "en"] as const) {
  for (const theme of ["light", "dark"] as const) {
    test(`reader picture: ${theme}, ${language}`, async ({ browser }) => {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 1.5,
        locale: language === "zh" ? "zh-CN" : "en-US",
        colorScheme: theme,
      });
      const page = await context.newPage();
      await page.addInitScript(
        ([lang, mode]) => {
          localStorage.setItem("paper-locale", lang);
          localStorage.setItem("paper-appearance", mode);
        },
        [language, theme],
      );
      const copy = COPY[language];
      await signIn(page);
      const { paperId, fileId } = await makePaper(page);
      await saveHighlight(page, fileId, {
        page: 1,
        quote: ABSTRACT_LINE,
        rects: [rect(566, ABSTRACT_LINE)],
        color: "#f6d365",
      });
      const link = `[${copy.cite}](#paper/${paperId}?file=${fileId}&page=1&quote=${encodeURIComponent(CLAIM)})`;
      const runs = [
        {
          id: "run-1",
          prompt: copy.ask,
          response: copy.answer(link),
          status: "completed",
          error: "",
          writable: false,
          steps: [
            {
              name: "read_file",
              label: "Read the paper",
              status: "completed",
              arguments: { id: fileId, page: 1, pages: 3 },
              result: { summary: "{}", truncated: false },
            },
          ],
          runtime: {},
        },
      ];
      await page.route("**/api/v1/translation-settings", (route) =>
        route.fulfill({
          json: { active_id: MODEL.id, configured: true, models: [MODEL] },
        }),
      );
      await page.route("**/api/v1/papers/*/discussion", (route) =>
        route.fulfill({ json: { id: SESSION, title: "Discussion" } }),
      );
      await page.route(`**/api/v1/agent/sessions/${SESSION}/runs`, (route) =>
        route.fulfill({ json: runs }),
      );
      await page.route(`**/api/v1/papers/${paperId}/preparation`, (route) =>
        route.fulfill({
          json: {
            enabled: true,
            status: "completed",
            stage: "",
            error: "",
            completed: 0,
            total: 0,
            guide_status: "completed",
            translation_status: "waiting",
            layout_status: "waiting",
          },
        }),
      );
      await page.route(
        `**/api/v1/papers/${paperId}/reading-artifacts`,
        (route) => route.fulfill({ json: [] }),
      );
      await openReader(page, { paperId, fileId, page: 1, quote: CLAIM });
      await expect(page.locator('[data-page="1"]')).toHaveAttribute(
        "data-rendered",
        "true",
      );
      await page
        .getByRole("tablist")
        .getByRole("tab", { name: copy.words["reader.tab.assistant"] })
        .click();
      await expect(page.getByText(copy.ask)).toBeVisible();
      await page.waitForTimeout(900);
      mkdirSync(OUT, { recursive: true });
      const name = `reader-${theme}${language === "en" ? "-en" : ""}.png`;
      await page.screenshot({ path: resolve(OUT, name) });
      if (language === "en" && theme === "light")
        copyFileSync(resolve(OUT, name), README);
      await context.close();
    });
  }
}
