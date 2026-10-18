// Renders extension/icons/icon.svg to the PNG sizes the browser extension needs.
// Uses the Chromium that the frontend's Playwright already installed.
//   node scripts/make-extension-icons.mjs
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "frontend", "package.json"));
const { chromium } = require("playwright");

const svg = readFileSync(join(root, "extension", "icons", "icon.svg"), "utf8");
const browser = await chromium.launch();
try {
  for (const size of [16, 32, 48, 128]) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(
      `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
    );
    const png = await page.screenshot({ omitBackground: true });
    writeFileSync(join(root, "extension", "icons", `icon-${size}.png`), png);
    await page.close();
    console.log(`icon-${size}.png`);
  }
} finally {
  await browser.close();
}
