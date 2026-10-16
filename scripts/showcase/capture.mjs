// Takes the homepage's product screenshots from the demo workspace, scene by
// scene:  node scripts/showcase/capture.mjs <out-dir> <content.json> [scene ...]
// Every scene performs the real interaction in the real interface. Answers the
// model gave (see real_content.py) are written back by fill_ai.py at the moment
// the interface asks, so the screenshots show what a reader actually gets.
// Scenes leave marks in the workspace (a highlight stays a highlight): run them
// in the order below after reset_demo.sh, which is what "all scenes" does.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { launch, paperId, openReader, panel, selectPassage, passageEnds, ZETTEL_START, ZETTEL_END, BASE } from "./lib.mjs";

const [outDir, content, ...only] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const DEMO = process.env.DEMO_DIR || "/tmp/zhijian-demo";
const env = {
  ...process.env,
  DATABASE_URL: `sqlite:///${DEMO}/platform.db`,
  STORAGE_DIR: `${DEMO}/files`,
  PLATFORM_MODEL_CONFIG: `${DEMO}/platform-model.json`,
  DEMO_API: process.env.DEMO_API || "http://127.0.0.1:8791",
};
const python = new URL("../../.venv/bin/python", import.meta.url).pathname;
const fill = new URL("./fill_ai.py", import.meta.url).pathname;
const complete = (kind) => execFileSync(python, [fill, "patch", kind, content], { env, stdio: "pipe" });

const menu = (page) => page.getByRole("dialog", { name: "选中文字操作" });
const regionMenu = (page) => page.getByRole("dialog", { name: "选区操作" });
const card = (page) => page.getByTestId("reading-activity-card").first();

// The "scroll to end" arrow floats over the text while a thread is not at its
// bottom; it is a control, not content, so it stays out of the pictures.
const shot = async (page, name, options = {}) => {
  await page.evaluate(() => {
    for (const button of document.querySelectorAll("button")) {
      if (button.textContent.trim() === "Scroll to end") button.style.visibility = "hidden";
    }
  });
  return page.screenshot({ path: `${outDir}/${name}.png`, ...options });
};

const AMEM = "2502.12110";
// What the reader asks the assistant to do with three papers and their notes
// (the same words real_content.py gave the model).
const ORGANIZE =
  "请读一下 MemGPT、Mem0 和 A-MEM 三篇论文，把它们在「记忆怎么写入、怎么组织」上的差异整理成一小节对照笔记，追加到《A-MEM 阅读笔记》末尾，并链接到另外两篇论文。";
async function reader(page, pageNumber = 2, arxiv = AMEM, options = {}) {
  const id = await paperId(page, arxiv);
  await openReader(page, id, { pageNumber, ...options });
  return id;
}

/** Drag a box over part of a page (fractions of the page, top-left origin). */
async function box(page, pageNumber, [fx, fy, fw, fh]) {
  const rect = await page.evaluate((n) => {
    const r = document.querySelector(`[data-pdf-page="${n}"] canvas`).getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  }, pageNumber);
  await page.mouse.move(rect.x + rect.w * fx, rect.y + rect.h * fy);
  await page.mouse.down();
  await page.mouse.move(rect.x + rect.w * (fx + fw), rect.y + rect.h * (fy + fh), { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(900);
}
const FIGURE_RECT = [0.17, 0.083, 0.66, 0.131];
const FORMULA_RECT = [0.4, 0.57, 0.26, 0.056];
const TABLE_RECT = [0.172, 0.098, 0.655, 0.0765];

/** Scroll the side panel so that its last card is whole on screen. */
async function scrollPanel(page) {
  await page.locator(".reader-panel-scroll").first().evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
  await page.waitForTimeout(700);
}

async function route(page, hash, wait = 1800) {
  await page.goto(BASE + `/#${hash}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(wait);
}

const scenes = {
  // ---- the library -------------------------------------------------------
  async "library-list"(page) {
    await route(page, "library");
    await page.getByLabel("详细列表", { exact: true }).click();
    await page.getByText("研究方向", { exact: true }).first().click();
    await page.waitForTimeout(900);
    await shot(page, "library-list");
  },

  async "library-filter"(page) {
    await route(page, "library");
    await page.getByRole("button", { name: "筛选与排序", exact: true }).click();
    await page.waitForTimeout(900);
    await shot(page, "library-filter");
  },

  async "library-batch"(page) {
    await route(page, "library");
    await page.getByRole("button", { name: "批量管理", exact: true }).click();
    await page.waitForTimeout(600);
    const boxes = page.getByRole("checkbox");
    for (const n of [1, 2, 4]) await boxes.nth(n).click();
    await page.waitForTimeout(700);
    await shot(page, "library-batch");
  },

  async "library-search"(page) {
    await route(page, "library");
    await page.keyboard.press("Meta+k");
    await page.waitForTimeout(500);
    await page.keyboard.type("记忆");
    await page.waitForTimeout(1200);
    await shot(page, "library-search");
  },

  async "library-import"(page) {
    await route(page, "library");
    await page.getByRole("button", { name: /导入论文/ }).first().click();
    await page.waitForTimeout(1000);
    await shot(page, "library-import");
  },

  async "library-graph"(page) {
    await route(page, "graph", 6000);
    await shot(page, "library-graph");
  },

  async "library-graph-focus"(page) {
    const id = await paperId(page, AMEM);
    await route(page, `graph?focus=paper/${id}`, 6000);
    await shot(page, "library-graph-focus");
  },

  async "settings-models"(page) {
    await route(page, "settings");
    await page.getByRole("button", { name: /添加模型/ }).click();
    await page.waitForTimeout(1000);
    await shot(page, "settings-models");
  },

  // ---- the assistant -----------------------------------------------------
  async "agent-chat"(page) {
    await reader(page, 3);
    await panel(page, "AI");
    const composer = page.getByLabel("给 Agent 的消息");
    await composer.fill("A-MEM 和 MemGPT 在记忆的组织方式上有什么不同？");
    await composer.press("Enter");
    await page.waitForTimeout(1800);
    complete("chat");
    await page.getByText("核心差别", { exact: false }).first().waitFor({ timeout: 20000 });
    await page.waitForTimeout(2000);
    // The list of operations stays folded (it is one click away); the question goes to the top of the thread.
    await page.getByText("A-MEM 和 MemGPT 在记忆的组织方式上有什么不同？").last().evaluate((el) => el.scrollIntoView({ block: "start" }));
    await page.waitForTimeout(900);
    await shot(page, "agent-chat");
  },

  async "agent-organize"(page) {
    await reader(page, 3);
    await panel(page, "AI");
    const composer = page.getByLabel("给 Agent 的消息");
    await composer.fill(ORGANIZE);
    await composer.press("Enter");
    await page.waitForTimeout(1800);
    complete("organize");
    await page.getByText("已追加到", { exact: false }).first().waitFor({ timeout: 20000 });
    await page.waitForTimeout(2000);
    await page.getByText(ORGANIZE.slice(0, 16), { exact: false }).last().evaluate((el) => el.scrollIntoView({ block: "start" }));
    await page.waitForTimeout(900);
    await shot(page, "agent-organize");
    // The same note, opened: what the assistant added is there to read.
    await panel(page, "笔记");
    await page.waitForTimeout(1500);
    await page.getByRole("heading", { name: /对照：MemGPT/ }).first().evaluate((el) => el.scrollIntoView({ block: "start" }));
    await page.waitForTimeout(1200);
    await shot(page, "agent-notes");
  },

  async "agent-permission"(page) {
    await reader(page, 3);
    await panel(page, "AI");
    await page.getByRole("button", { name: "对话设置", exact: true }).click();
    await page.waitForTimeout(900);
    await shot(page, "agent-permission");
  },

  async "agent-capabilities"(page) {
    await route(page, "library");
    await page.getByRole("button", { name: "打开研究助手" }).first().click();
    await page.waitForTimeout(1500);
    await page.getByRole("button", { name: "能力范围", exact: true }).click();
    await page.waitForTimeout(1200);
    await shot(page, "agent-capabilities");
  },

  // ---- reading -----------------------------------------------------------
  async "reader-select"(page) {
    await reader(page);
    await selectPassage(page, ZETTEL_START, ZETTEL_END);
    await shot(page, "reader-select");
  },

  async "reader-palette"(page) {
    await reader(page);
    await selectPassage(page, ZETTEL_START, ZETTEL_END);
    await menu(page).getByRole("button", { name: "高亮颜色" }).click();
    await page.waitForTimeout(700);
    await shot(page, "reader-palette");
  },

  async "reader-explain"(page) {
    await reader(page);
    await selectPassage(page, ZETTEL_START, ZETTEL_END);
    await menu(page).getByRole("button", { name: "解释", exact: true }).click();
    await page.waitForTimeout(1500);
    complete("explain");
    await card(page).getByText("Zettelkasten").first().waitFor({ timeout: 20000 });
    await page.waitForTimeout(1500);
    await card(page).hover();
    await page.waitForTimeout(900);
    await shot(page, "reader-explain");
  },

  async "reader-translate"(page) {
    await reader(page, 2);
    await panel(page, "翻译");
    await page.getByRole("button", { name: "打开对照", exact: true }).click();
    await page.waitForTimeout(2500);
    await page.getByRole("button", { name: "收起阅读侧栏" }).click();
    await page.waitForTimeout(1500);
    // One sentence of the translation: the matching original sentence lights up.
    await page.getByTestId("translation-passage").filter({ hasText: "卡片盒" }).first().hover();
    await page.waitForTimeout(1200);
    await shot(page, "reader-translate");
  },

  async "reader-translate-selection"(page) {
    await reader(page);
    await selectPassage(page, ZETTEL_START, ZETTEL_END);
    await menu(page).getByRole("button", { name: "翻译", exact: true }).click();
    await page.waitForTimeout(2500);
    await shot(page, "reader-translate-quick");
    await page.getByRole("button", { name: "用 AI 精译", exact: true }).click();
    await page.waitForTimeout(1500);
    complete("translate");
    await page.getByText("互联的信息网络", { exact: false }).first().waitFor({ timeout: 20000 });
    await page.waitForTimeout(1500);
    await scrollPanel(page);
    await shot(page, "reader-translate-selection");
  },

  async "reader-region"(page) {
    await reader(page);
    await page.getByRole("radio", { name: "框选图表或公式", exact: true }).click();
    await box(page, 2, FIGURE_RECT);
    await shot(page, "reader-region");
  },

  async "reader-figure"(page) {
    await reader(page);
    await page.getByRole("radio", { name: "框选图表或公式", exact: true }).click();
    await box(page, 2, FIGURE_RECT);
    await regionMenu(page).getByRole("button", { name: "解释图表或选区", exact: true }).click();
    await page.waitForTimeout(1500);
    complete("figure");
    await card(page).getByText("agentic memory", { exact: false }).first().waitFor({ timeout: 20000 });
    await page.waitForTimeout(1500);
    await shot(page, "reader-figure");
  },

  async "reader-formula"(page) {
    await reader(page, 4);
    await page.getByRole("radio", { name: "框选图表或公式", exact: true }).click();
    await box(page, 4, FORMULA_RECT);
    await regionMenu(page).getByRole("button", { name: "解释公式", exact: true }).click();
    await page.waitForTimeout(1500);
    complete("formula");
    await card(page).getByText("公式转写").first().waitFor({ timeout: 20000 });
    await page.waitForTimeout(2000);
    await shot(page, "reader-formula");
  },

  async "reader-table"(page) {
    await reader(page, 7);
    await page.getByRole("radio", { name: "框选图表或公式", exact: true }).click();
    await box(page, 7, TABLE_RECT);
    await shot(page, "reader-table-region");
    await regionMenu(page).getByRole("button", { name: "翻译选区文字", exact: true }).click();
    await page.waitForTimeout(1500);
    complete("table");
    await page.getByText("SBERT 相似度").first().waitFor({ timeout: 20000 });
    await page.waitForTimeout(2000);
    await scrollPanel(page);
    await shot(page, "reader-table");
  },

  async "reader-chat"(page) {
    await reader(page);
    await panel(page, "AI");
    const composer = page.getByLabel("给 Agent 的消息");
    await composer.fill("A-MEM 和 MemGPT 在记忆的组织方式上有什么不同？");
    await composer.press("Enter");
    await page.waitForTimeout(1800);
    complete("chat");
    await page.getByText("核心差别", { exact: false }).first().waitFor({ timeout: 20000 });
    await page.waitForTimeout(2000);
    await shot(page, "reader-chat");
  },

  async "reader-guide"(page) {
    await reader(page, 1);
    await panel(page, "AI");
    await page.waitForTimeout(1200);
    await page.locator(".reading-insights").first().evaluate((el) => el.scrollIntoView({ block: "start" }));
    await page.waitForTimeout(600);
    await shot(page, "reader-guide");
  },

  async "reader-quiz"(page) {
    await reader(page, 1);
    await panel(page, "测验");
    await page.waitForTimeout(800);
    // Answer from the stored key: all right but the fourth, like a real attempt.
    const quizzes = JSON.parse(readFileSync(content, "utf8")).artifacts.filter((a) => a.kind === "quiz");
    const heading = (await page.locator(".insights-question h3").first().innerText()).replace(/^\d+\.\s*/, "");
    const quiz = quizzes.find((a) => a.result.questions[0].question === heading);
    if (!quiz) throw new Error("no stored quiz matches: " + heading);
    const questions = quiz.result.questions;
    for (let q = 0; q < questions.length; q++) {
      const pick = q === 3 ? (questions[q].answer + 1) % questions[q].options.length : questions[q].answer;
      await page.getByRole("group", { name: `第 ${q + 1} 题选项` }).getByRole("button").nth(pick).click();
    }
    await page.getByRole("button", { name: "提交并查看解析", exact: true }).click();
    await page.waitForTimeout(600);
    await page.locator(".reading-insights").evaluate((el) => {
      for (let node = el; node; node = node.parentElement) node.scrollTop = 0;
    });
    await page.waitForTimeout(500);
    await shot(page, "reader-quiz");
  },

  async "reader-figures"(page) {
    await reader(page, 2);
    await panel(page, "图表");
    await shot(page, "reader-figures");
  },

  async "reader-citations"(page) {
    await reader(page, 1);
    await panel(page, "引用文献");
    await page.getByRole("tab", { name: "参考文献", exact: true }).click();
    await page.waitForTimeout(6000);
    await shot(page, "reader-citations");
  },

  async "reader-layout"(page) {
    await reader(page, 1);
    await panel(page, "翻译");
    await page.getByRole("tab", { name: "并排查看", exact: true }).click();
    await page.waitForTimeout(3500);
    // The demo's finished job was inserted without paragraph alignment data, so
    // the toolbar notes that this version cannot locate paragraphs. A job made
    // by the product carries the alignment: leave that one hint out.
    await page.evaluate(() => {
      for (const el of document.querySelectorAll("span, p")) {
        if (el.children.length === 0 && el.textContent.trim() === "此版本暂无可靠段落对应") el.style.visibility = "hidden";
      }
    });
    await shot(page, "reader-layout");
  },

  async "reader-outline"(page) {
    await reader(page, 1, "1706.03762");
    await page.getByRole("button", { name: "论文目录", exact: true }).click();
    await page.waitForTimeout(1500);
    await shot(page, "reader-outline");
  },

  async "reader-search"(page) {
    await reader(page, 1);
    await page.getByRole("button", { name: "查找论文", exact: true }).click();
    await page.getByLabel("查找论文内容").fill("Zettelkasten");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(1200);
    await shot(page, "reader-search");
  },

  async "reader-cite"(page) {
    await reader(page);
    const marker = page.locator('[data-pdf-page="2"]').getByRole("button", { name: "跳转论文引用位置" }).first();
    const at = await marker.boundingBox();
    await page.mouse.move(at.x + at.width / 2, at.y + at.height / 2);
    await page.getByText("引用与章节预览", { exact: false }).first().waitFor({ timeout: 15000 });
    await page.waitForTimeout(1500);
    await shot(page, "reader-cite");
  },

  async "reader-info"(page) {
    await reader(page, 1);
    await page.getByRole("button", { name: "论文信息", exact: true }).click();
    await page.waitForTimeout(1200);
    await shot(page, "reader-info");
  },

  async "reader-export"(page) {
    await reader(page, 1);
    await page.getByRole("button", { name: "下载 PDF", exact: true }).click();
    await page.waitForTimeout(900);
    await shot(page, "reader-export");
  },

  async "reader-share"(page) {
    await reader(page, 1);
    await page.getByRole("button", { name: "分享论文", exact: true }).click();
    await page.waitForTimeout(1000);
    await shot(page, "reader-share");
  },

  async "reader-notes"(page) {
    await reader(page, 1, AMEM, { nav: true });
    await shot(page, "reader-notes");
  },

  // ---- marking up (these leave highlights, a comment and ink behind) ------

  async "reader-comment"(page) {
    await reader(page);
    await selectPassage(page, "Our system introduces an agentic memory architecture", "attributes including");
    await menu(page).getByRole("button", { name: "评论", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "添加评论" });
    await dialog.getByRole("textbox").fill("链接由模型判断：成本和延迟要看第 6 页的对比实验。");
    await page.waitForTimeout(600);
    await shot(page, "reader-comment");
  },

  async "reader-annotate"(page) {
    await reader(page);
    // A yellow highlight, a blue one, and a comment: what a first pass leaves behind.
    await selectPassage(page, ZETTEL_START, ZETTEL_END);
    await menu(page).getByRole("button", { name: "高亮", exact: true }).click();
    await page.waitForTimeout(1500);
    await selectPassage(page, "We conduct comprehensive evaluations", "organization of our agentic memory system.");
    await menu(page).getByRole("button", { name: "高亮颜色" }).click();
    await menu(page).getByRole("button", { name: "蓝色" }).click(); // picking a colour highlights
    await page.waitForTimeout(1500);
    await selectPassage(page, "Our system introduces an agentic memory architecture", "attributes including");
    await menu(page).getByRole("button", { name: "评论", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "添加评论" });
    await dialog.getByRole("textbox").fill("链接由模型判断：成本和延迟要看第 6 页的对比实验。");
    await dialog.getByRole("button", { name: "保存评论" }).click();
    await page.waitForTimeout(1200);
    await page.evaluate(() => getSelection().removeAllRanges());
    await panel(page, "批注");
    await page.waitForTimeout(1200);
    await shot(page, "reader-annotate");
  },

  async "reader-ai-highlights"(page) {
    await reader(page, 1);
    await panel(page, "批注");
    await page.getByText("AI 重点建议", { exact: true }).first().click();
    await page.waitForTimeout(1200);
    await page.getByRole("checkbox", { name: "在论文上显示重点" }).check();
    await page.waitForTimeout(1800);
    await shot(page, "reader-ai-highlights");
  },

  async "reader-ink"(page) {
    await reader(page);
    await page.getByRole("radio", { name: "手写笔", exact: true }).click();
    const rect = await page.evaluate(() => {
      const r = document.querySelector('[data-pdf-page="2"] canvas').getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    });
    const at = (fx, fy) => [rect.x + rect.w * fx, rect.y + rect.h * fy];
    const stroke = async (points) => {
      await page.mouse.move(...points[0]);
      await page.mouse.down();
      for (const point of points.slice(1)) await page.mouse.move(...point, { steps: 3 });
      await page.mouse.up();
    };
    // A loop around the proposed memory in the figure, then an underline beneath
    // the sentence about the Zettelkasten method.
    const loop = Array.from({ length: 40 }, (_, i) => {
      const t = (i / 39) * Math.PI * 2.15 - Math.PI / 2;
      return at(0.737 + 0.078 * Math.cos(t), 0.112 + 0.036 * Math.sin(t));
    });
    await stroke(loop);
    await page.waitForTimeout(500);
    await stroke([at(0.177, 0.3725), at(0.28, 0.3745), at(0.4, 0.3725), at(0.594, 0.3735)]);
    await page.waitForTimeout(700);
    await page.getByRole("button", { name: "手写设置", exact: true }).click();
    await page.waitForTimeout(900);
    await shot(page, "reader-ink");
  },
};

const wide = {
  // Three papers picked in the library, compared by the assistant in a window
  // wide enough for its tables.
  async "agent-compare"(page) {
    const userId = await page.evaluate(async () => (await (await fetch("/api/v1/auth/me")).json()).user.id);
    await page.evaluate((id) => localStorage.setItem("agent-window:" + id, JSON.stringify({ x: 396, y: 24, width: 868, height: 752 })), userId);
    await page.reload({ waitUntil: "networkidle" });
    await route(page, "library");
    await page.getByRole("button", { name: "批量管理", exact: true }).click();
    await page.waitForTimeout(600);
    const boxes = page.getByRole("checkbox");
    for (const n of [6, 7, 8]) await boxes.nth(n).click();
    await page.getByRole("button", { name: "比较论文", exact: true }).click();
    await page.waitForTimeout(1500);
    await page.getByRole("button", { name: "切换为悬浮窗", exact: true }).click();
    await page.waitForTimeout(900);
    await page.getByLabel("给 Agent 的消息").press("Enter");
    await page.waitForTimeout(1800);
    complete("compare");
    await page.getByText("横向比较", { exact: false }).first().waitFor({ timeout: 20000 });
    await page.waitForTimeout(2500);
    // From the line that says how long it took: how many operations it made, and the answer.
    await page.getByText(/对话结束/).last().evaluate((el) => el.scrollIntoView({ block: "start" }));
    await page.locator("[data-slot=message-scroller-viewport]").first().evaluate((el) => el.scrollBy(0, -16));
    await page.waitForTimeout(900);
    await shot(page, "agent-compare");
    // The same answer with its list of operations opened: what was actually read.
    await page.locator("details.agent-steps").last().evaluate((el) => (el.open = true));
    await page.getByText(/对话结束/).last().evaluate((el) => el.scrollIntoView({ block: "start" }));
    await page.locator("[data-slot=message-scroller-viewport]").first().evaluate((el) => el.scrollBy(0, -16));
    await page.waitForTimeout(900);
    await shot(page, "agent-ops");
    // Further down the same answer: results with the page each number comes from.
    await page.locator("details.agent-steps").last().evaluate((el) => (el.open = false));
    await page.getByText("五、实验结果", { exact: true }).first().evaluate((el) => el.scrollIntoView({ block: "start" }));
    await page.locator("[data-slot=message-scroller-viewport]").first().evaluate((el) => el.scrollBy(0, -16));
    await page.waitForTimeout(900);
    await shot(page, "agent-results");
  },
};

const dark = {
  async "dark-reader"(page) {
    await reader(page, 2);
    await panel(page, "AI");
    await shot(page, "dark-reader");
  },
};

const groups = [
  [scenes, {}],
  [wide, {}],
  [dark, { dark: true }],
];
const all = Object.fromEntries(groups.flatMap(([set, options]) => Object.keys(set).map((name) => [name, [set[name], options]])));
const names = only.length ? only : Object.keys(all);
for (const name of names) {
  const [run, options] = all[name];
  const { browser, page } = await launch(options);
  try {
    await run(page);
    console.log("ok", name);
  } catch (error) {
    console.log("FAILED", name, String(error).split("\n")[0]);
    await shot(page, name + "-failed").catch(() => {});
  }
  await browser.close();
}
