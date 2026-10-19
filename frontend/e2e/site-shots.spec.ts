import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { en } from "../src/i18n/messages/en";
import { zh } from "../src/i18n/messages/zh";
import { openReader, saveHighlight, signIn } from "./reader/fixtures";

/*
 * Takes the pictures of the reader that the public page shows (the README banner is made from them):
 * the guide, a selection with its menu, the assistant's answer with citations,
 * and 对照 mode, each in light and dark, in both languages.
 * It is not part of the suite: `SITE_SHOTS=1 npx playwright test e2e/site-shots.spec.ts`
 * rewrites frontend/public/assets/site/.
 */
test.skip(!process.env.SITE_SHOTS, "only when the pictures are being remade");
test.use({ viewport: { width: 1440, height: 900 } });

const OUT = resolve(process.cwd(), "public/assets/site");

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
    guide: {
      cited: true,
      keywords: ["长上下文", "检索头", "稀疏注意力"],
      summary: [
        "长文档阅读里，真正被反复查找的内容很集中。",
        '不到 5% 的注意力头承担了大部分查找，称为检索头。[[p1: "Retrieval heads account for under 5% of attention heads but carry most of the lookups."]]',
        '只让检索头看完整上下文，质量下降不到一个点，显存降到四分之一。[[p2: "by a factor of four on the longest inputs."]]',
      ],
      sections: [
        {
          title: "研究问题",
          body: '长上下文的大部分开销花在查找**从未用到**的文字上。[[p1: "text that is never used."]]',
          pages: [1],
        },
        {
          title: "方法",
          body: '按“是否复制远处的内容”给每个头打分，高分的头组成检索集。[[p2: "Heads above a threshold form the retrieval set."]]',
          pages: [2],
        },
        {
          title: "适用边界",
          body: '只在英文文本上验证；需要整篇聚合的任务可能要保留更多头。[[p3: "The retrieval set is found on English text; we have not tested other scripts."]]',
          pages: [3],
        },
      ],
    },
  },
  en: {
    words: en,
    ask: "Why can it keep so few heads without losing quality?",
    answer: (link: string) =>
      `Because the lookups that long context needs are concentrated. The paper finds that retrieval heads are under 5% of all heads but carry most of the lookups ${link}. Letting only those see the full context, while the rest see a short window, costs under one point of quality and cuts memory fourfold.`,
    cite: "p.1",
    guide: {
      cited: true,
      keywords: ["long context", "retrieval heads", "sparse attention"],
      summary: [
        "In long documents, the text that gets looked up again and again is concentrated.",
        'Under 5% of attention heads do most of the lookups: the retrieval heads.[[p1: "Retrieval heads account for under 5% of attention heads but carry most of the lookups."]]',
        'Letting only them see the full context costs under one point of quality and cuts memory fourfold.[[p2: "by a factor of four on the longest inputs."]]',
      ],
      sections: [
        {
          title: "The question",
          body: 'Most of the cost of long context goes to looking up text that is **never used**.[[p1: "text that is never used."]]',
          pages: [1],
        },
        {
          title: "Method",
          body: 'Score each head by how often it copies from far away; the top scorers form the retrieval set.[[p2: "Heads above a threshold form the retrieval set."]]',
          pages: [2],
        },
        {
          title: "Limits",
          body: 'Tested on English only; tasks that aggregate the whole document may need more heads.[[p3: "The retrieval set is found on English text; we have not tested other scripts."]]',
          pages: [3],
        },
      ],
    },
  },
} as const;

/** What 对照 shows beside page 1 and 2 (in Chinese, whichever language the interface is in). */
const TRANSLATED: Record<
  number,
  { kind: string; original: string; translation: string }[]
> = {
  1: [
    {
      kind: "heading",
      original: "Sparse Retrieval Heads for Long-Context Reading",
      translation: "面向长上下文阅读的稀疏检索头",
    },
    {
      kind: "text",
      original:
        "Long documents are read by models that must decide which earlier passages matter.",
      translation:
        "模型阅读长文档时，必须判断前文中哪些段落重要。我们发现，一小部分注意力头承担了这项工作的大部分，只通过这些头来路由查询，就能让阅读更快、更忠实。",
    },
    {
      kind: "heading",
      original: "1 Introduction",
      translation: "1 引言",
    },
    {
      kind: "text",
      original: "Reading a paper means moving back and forth.",
      translation:
        "读论文意味着来回翻看：讨论里的一个结论会把读者带到某张表，而这张表又指向三页之前的一个定义。语言模型在每个词上都面临同样的问题。",
    },
    {
      kind: "text",
      original:
        "Retrieval heads account for under 5% of attention heads but carry most of the lookups.",
      translation: "检索头占全部注意力头不到 5%，却承担了大部分查找。",
    },
  ],
  2: [
    { kind: "heading", original: "3 Method", translation: "3 方法" },
    {
      kind: "text",
      original:
        "We score a head by running the model on passages with a repeated needle.",
      translation:
        "我们让模型阅读带有重复片段的文字，统计某个头有多频繁地关注更早的那一份，来给它打分；高于阈值的头组成检索集。",
    },
  ],
};

for (const language of ["zh", "en"] as const) {
  for (const theme of ["light", "dark"] as const) {
    test(`reader pictures: ${theme}, ${language}`, async ({ browser }) => {
      test.setTimeout(120_000);
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
          localStorage.setItem("paper-translation-language", "zh");
        },
        [language, theme],
      );
      const copy = COPY[language];
      const words = copy.words;
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
      const row = (kind: string, fields: object) => ({
        file_id: fileId,
        kind,
        status: "completed",
        run_id: "run-x",
        session_id: "session-x",
        model_config_id: MODEL.id,
        error: "",
        ...fields,
      });
      const guide = row("guide", {
        id: "guide-1",
        parameters: {},
        result: copy.guide,
      });
      const translation = (n: number) =>
        row("page_translation", {
          id: `pt-${n}`,
          parameters: { page: n, language: "zh" },
          result: { paragraphs: TRANSLATED[n] ?? [] },
        });
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
        (route) => {
          if (route.request().method() === "GET")
            return route.fulfill({
              json: [guide, translation(1), translation(2)],
            });
          const body = route.request().postDataJSON() as {
            kind: string;
            page?: number;
          };
          return route.fulfill({
            json: body.kind === "guide" ? guide : translation(body.page ?? 1),
          });
        },
      );
      await page.route("**/api/v1/reading-artifacts/*", (route) => {
        const id = new URL(route.request().url()).pathname.split("/").at(-1)!;
        return route.fulfill({
          json: id === "guide-1" ? guide : translation(Number(id.slice(3))),
        });
      });
      mkdirSync(OUT, { recursive: true });
      const suffix = `-${theme}${language === "en" ? "-en" : ""}.png`;
      const shoot = async (view: string) => {
        await page.waitForTimeout(900);
        const file = resolve(OUT, view + suffix);
        await page.screenshot({ path: file });
        return file;
      };
      const pageOne = page.locator('[data-page="1"]');
      const tab = (key: "assistant" | "notes") =>
        page
          .getByRole("tablist")
          .getByRole("tab", { name: words[`reader.tab.${key}`] });

      // 1. The guide, written for the paper.
      await openReader(page, { paperId, fileId, page: 1 });
      await expect(pageOne).toHaveAttribute("data-rendered", "true");
      // The guide opens the assistant's view.
      await tab("assistant").click();
      await expect(page.getByText(copy.guide.summary[0])).toBeVisible();
      await shoot("guide");

      // 2. A sentence selected, with its menu.
      const line = pageOne
        .locator(".textLayer span", { hasText: "Retrieval heads account" })
        .first();
      const at = (await line.boundingBox())!;
      await page.mouse.move(
        Math.round(at.x + 2),
        Math.round(at.y + at.height / 2),
      );
      await page.mouse.down();
      await page.mouse.move(
        Math.round(at.x + at.width - 2),
        Math.round(at.y + at.height / 2),
        { steps: 12 },
      );
      await page.mouse.up();
      await expect(
        page.getByRole("menu", { name: words["reader.selection.menu"] }),
      ).toBeVisible();
      await shoot("select");
      await page.keyboard.press("Escape");

      // 3. The assistant's answer, its citation leading to the sentence.
      await openReader(page, { paperId, fileId, page: 1, quote: CLAIM });
      await expect(pageOne).toHaveAttribute("data-rendered", "true");
      await tab("assistant").click();
      await expect(page.getByText(copy.ask)).toBeVisible();
      await shoot("reader");

      // 4. 对照: the translation beside each page.
      await openReader(page, { paperId, fileId, page: 1 });
      await expect(pageOne).toHaveAttribute("data-rendered", "true");
      await page
        .getByRole("radiogroup", { name: words["reader.mode.label"] })
        .getByRole("radio", {
          name: words["reader.mode.parallel"],
          exact: true,
        })
        .click();
      await expect(
        page.getByText("检索头占全部注意力头不到 5%，却承担了大部分查找。"),
      ).toBeVisible();
      await shoot("parallel");
      await context.close();
    });
  }
}
