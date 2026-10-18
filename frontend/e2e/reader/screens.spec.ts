import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { en } from "../../src/i18n/messages/en";
import { zh } from "../../src/i18n/messages/zh";
import {
  createPaperWithPdf,
  openReader,
  signIn,
  type OutlineItem,
} from "./fixtures";

// The sign-in form is read in Chinese (the fixtures sign in through it); the reader is then set
// to each language and each look by what the browser has stored, as a person's choice is.
test.use({ locale: "zh-CN", viewport: { width: 1440, height: 900 } });

type Locale = "zh" | "en";
type Appearance = "light" | "dark";
const catalogs = { zh, en };
const words = (locale: Locale, key: keyof typeof en) => catalogs[locale][key];

/** Where copies of the screenshots go as files, besides the report (for looking at them without opening it). */
const SCREENS_DIR = process.env.READER_SCREENS_DIR;

/** The CJK Unified Ideographs: none of them may be in the English interface. */
const CHINESE = /[一-鿿]/;

const OUTLINE: OutlineItem[] = [
  { title: "Introduction", page: 1 },
  {
    title: "Method",
    page: 3,
    children: [
      { title: "Training", page: 4 },
      { title: "Evaluation", page: 6 },
    ],
  },
  { title: "Results", page: 8 },
  { title: "Conclusion", page: 11 },
];
/** The word the find bar looks for, on three of the twelve pages. */
const WORD = "attention";

/** Whatever the page logs as an error or throws, from here on. */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

/** Wait for every transition and entrance that is running (not the ones that go on for ever), so that the picture is the settled one. */
const settled = (page: Page) =>
  page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter(
          (animation) =>
            animation.effect?.getComputedTiming().iterations !== Infinity,
        )
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  );

/** The window as it is, attached to the report and, if a folder is given, saved there too. */
async function shoot(
  page: Page,
  attach: (name: string, body: Buffer) => Promise<void>,
  name: string,
) {
  await settled(page);
  const body = await page.screenshot();
  await attach(name, body);
  if (SCREENS_DIR) {
    mkdirSync(SCREENS_DIR, { recursive: true });
    writeFileSync(path.join(SCREENS_DIR, `${name}.png`), body);
  }
}

/** All that a region gives a person or a screen reader: its text, and the names and hints it carries. */
const wordsIn = (region: Locator) =>
  region.evaluate((root) => {
    const found = [root.innerText];
    const marked = [root, ...root.querySelectorAll("*")];
    for (const element of marked)
      for (const attribute of ["aria-label", "title", "placeholder", "alt"]) {
        const value = element.getAttribute(attribute);
        if (value) found.push(value);
      }
    return found.join("\n");
  });

/** No Chinese in what the region says (the paper's own title is not ours to translate, and is left out). */
async function expectNoChinese(region: Locator, title: string, what: string) {
  const text = (await wordsIn(region)).split(title).join("");
  expect(text.match(CHINESE)?.[0] ?? null, `Chinese in ${what}: ${text}`).toBe(
    null,
  );
}

const pdfPage = (page: Page, number: number) =>
  page.locator(`[data-page="${number}"]`);

/** Sign in, make a paper of twelve pages, and open it in this language and look, from a full load. */
async function open(
  page: Page,
  {
    locale,
    appearance,
    size,
  }: {
    locale: Locale;
    appearance: Appearance;
    /** The window's size when the paper is opened; the usual one if left out. */
    size?: { width: number; height: number };
  },
) {
  await signIn(page);
  const paper = await createPaperWithPdf(page, {
    pages: 12,
    outline: OUTLINE,
    words: { 2: WORD, 5: WORD, 9: WORD },
  });
  await page.evaluate(
    ([language, look]) => {
      localStorage.setItem("paper-locale", language);
      localStorage.setItem("paper-appearance", look);
    },
    [locale, appearance],
  );
  if (size) await page.setViewportSize(size);
  // A full load, so that the choices are read at the start, as they are when someone comes back.
  await page.goto("about:blank");
  const errors = watchErrors(page);
  await openReader(page, { paperId: paper.paperId });
  await expect(page.locator("html")).toHaveAttribute("data-theme", appearance);
  await expect(pdfPage(page, 1)).toHaveAttribute("data-rendered", "true");
  await expect(
    page.getByRole("main").getByRole("heading", { level: 1 }),
  ).toHaveText(paper.title);
  return { ...paper, errors };
}

for (const appearance of ["light", "dark"] as const)
  for (const locale of ["zh", "en"] as const)
    test(`${appearance}, ${locale}: the first page, the outline and the find bar`, async ({
      page,
    }, testInfo) => {
      const { title, errors } = await open(page, { locale, appearance });
      const attach = (name: string, body: Buffer) =>
        testInfo.attach(name, { body, contentType: "image/png" });
      const say = (key: keyof typeof en) => words(locale, key);
      const header = page.getByRole("main").locator("header");
      const nav = page.getByRole("navigation");
      const panel = page.getByRole("complementary");
      const english = locale === "en";
      await expect(page.locator("html")).toHaveAttribute(
        "lang",
        new RegExp(`^${locale}`),
      );

      // The first page.
      await shoot(page, attach, `${appearance}-${locale}`);
      if (english)
        for (const [region, name] of [
          [header, "the card's header"],
          [nav, "the sidebar"],
          [panel, "the right panel"],
        ] as const)
          await expectNoChinese(region, title, name);

      // The menus of the header: the same words, in the same language.
      for (const menu of ["reader.zoom.menu", "reader.more.menu"] as const) {
        await header
          .getByRole("button", { name: new RegExp(say(menu)) })
          .click();
        const list = page.getByRole("menu");
        await expect(list).toBeVisible();
        if (english) await expectNoChinese(list, title, `the ${menu} menu`);
        await page.keyboard.press("Escape");
        await expect(list).toHaveCount(0);
      }

      // The outline open.
      await header
        .getByRole("button", { name: say("reader.outline.open"), exact: true })
        .click();
      const outline = page.getByRole("dialog", {
        name: say("reader.outline.open"),
        exact: true,
      });
      await expect(outline.getByText("Introduction")).toBeVisible();
      await expect(outline.getByText("Training")).toBeVisible();
      await shoot(page, attach, `${appearance}-${locale}-outline-open`);
      if (english) await expectNoChinese(outline, title, "the outline");
      await page.keyboard.press("Escape");
      await expect(outline).toHaveCount(0);

      // The find bar open, with something found.
      await header
        .getByRole("button", { name: say("reader.find.open"), exact: true })
        .click();
      const find = page.getByRole("search", {
        name: say("reader.find.region"),
        exact: true,
      });
      await expect(find).toBeVisible();
      await page
        .getByRole("textbox", { name: say("reader.find.label"), exact: true })
        .fill(WORD);
      await expect(find.getByRole("status")).toHaveText("1 / 3");
      await shoot(page, attach, `${appearance}-${locale}-find-open`);
      if (english) await expectNoChinese(find, title, "the find bar");

      // Nothing was logged as an error in all that.
      expect(errors).toEqual([]);
    });

test("a 600x800 window: the rail, and the sidebar opened over the card", async ({
  page,
}, testInfo) => {
  const { errors } = await open(page, {
    locale: "zh",
    appearance: "light",
    size: { width: 600, height: 800 },
  });
  const attach = (name: string, body: Buffer) =>
    testInfo.attach(name, { body, contentType: "image/png" });

  await shoot(page, attach, "narrow-600");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: zh["sidebar.expand"] })
    .click();
  await expect(
    page.getByRole("navigation").getByRole("button", {
      name: zh["sidebar.collapse"],
    }),
  ).toBeVisible();
  await shoot(page, attach, "narrow-600-sidebar-open");
  expect(errors).toEqual([]);
});
