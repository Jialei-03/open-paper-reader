// Shared helpers for the homepage screenshot scenes. Everything here drives the
// real interface of the demo workspace; nothing is composed or retouched.
import { existsSync, readFileSync } from "node:fs";
import { chromium } from "../../frontend/node_modules/playwright/index.mjs";

export const BASE = process.env.DEMO_WEB || "http://127.0.0.1:5174";
// The demo account's password is made up by build_demo.sh for each workspace.
const DEMO_DIR = process.env.DEMO_DIR || "/tmp/zhijian-demo";
const password = () => process.env.DEMO_PASSWORD || readFileSync(`${DEMO_DIR}/password`, "utf8").trim();
export const USER = { name: "linyu", get password() { return password(); } };
export const ZETTEL_START = "Our approach draws inspiration";
export const ZETTEL_END = "flexible linking mechanisms.";

const STATE = process.env.DEMO_STATE || `${process.env.DEMO_DIR || "/tmp/zhijian-demo"}.session.json`;

export async function launch({ width = 1280, height = 800, dpr = 2, dark = false, mobile = false } = {}) {
  const browser = await chromium.launch();
  const options = {
    viewport: { width, height },
    deviceScaleFactor: dpr,
    isMobile: mobile,
    hasTouch: mobile,
    locale: "zh-CN",
    colorScheme: dark ? "dark" : "light",
    reducedMotion: "reduce",
  };
  // Signing in for every scene trips the login rate limit: sign in once, reuse the session.
  let ctx = await browser.newContext(existsSync(STATE) ? { ...options, storageState: STATE } : options);
  let page = await ctx.newPage();
  await page.goto(BASE + "/#dashboard", { waitUntil: "networkidle" });
  const signedOut = await page.getByLabel("用户名", { exact: true }).isVisible().catch(() => false);
  if (signedOut) {
    await page.getByLabel("用户名", { exact: true }).fill(USER.name);
    await page.getByLabel("密码", { exact: true }).fill(USER.password);
    await page.getByRole("button", { name: "登录空间", exact: true }).click();
    await page.waitForTimeout(1500);
    await ctx.storageState({ path: STATE });
  }
  return { browser, ctx, page };
}

export async function paperId(page, arxiv) {
  return page.evaluate(async (arxiv) => {
    const rows = await (await fetch("/api/v1/papers")).json();
    return rows.find((p) => p.external_id.includes(arxiv)).id;
  }, arxiv);
}

export async function openReader(page, id, { pageNumber = 1, nav = false } = {}) {
  await page.goto(BASE + `/#paper/${id}`, { waitUntil: "networkidle" });
  await page.getByTestId("pdf-canvas").first().waitFor();
  await page.waitForTimeout(1500);
  const trigger = page.getByRole("button", { name: "收起导航", exact: true });
  if (!nav && (await trigger.isVisible().catch(() => false))) await trigger.click();
  await page.waitForTimeout(500);
  if (pageNumber > 1) {
    const input = page.getByLabel("PDF 页码", { exact: true });
    await input.fill(String(pageNumber));
    await input.press("Enter");
    await page.waitForTimeout(1500);
  }
}

export async function panel(page, name) {
  const tab = page.getByRole("button", { name, exact: true });
  if ((await tab.getAttribute("aria-pressed")) !== "true") await tab.click();
  await page.waitForTimeout(1200);
}

/** Rectangle of the words that start and end a passage on the visible text layer. */
export async function passageEnds(page, start, end) {
  return page.evaluate(
    ([start, end]) => {
      const find = (needle, atEnd) => {
        const walker = document.createTreeWalker(document.querySelector(".pdf-sheet"), NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const at = node.textContent.indexOf(needle);
          if (at < 0 || !node.parentElement.closest(".textLayer")) continue;
          const range = document.createRange();
          range.setStart(node, atEnd ? at + needle.length - 1 : at);
          range.setEnd(node, atEnd ? at + needle.length : at + 1);
          const r = range.getBoundingClientRect();
          if (r.width && r.height) return { x: r.x, y: r.y, w: r.width, h: r.height };
        }
        return null;
      };
      return { first: find(start, false), last: find(end, true) };
    },
    [start, end],
  );
}

export async function selectPassage(page, start, end) {
  const { first, last } = await passageEnds(page, start, end);
  if (!first || !last) throw new Error("passage not on screen");
  await page.mouse.move(first.x + 1, first.y + first.h / 2);
  await page.mouse.down();
  await page.mouse.move(last.x + last.w - 1, last.y + last.h / 2, { steps: 14 });
  await page.mouse.up();
  await page.waitForTimeout(700);
}
