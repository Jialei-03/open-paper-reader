# 第 1 阶段「地基」实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给新界面打地基：一套设计令牌（深色、浅色）、一组自己写的基础组件、中英文案表框架，以及第 9 节稳定性测试要用的故障注入假模型和「难导入」样本集。

**Architecture:** 新界面层放在 `frontend/src/ui/`（令牌、组件、主题）和 `frontend/src/i18n/`（文案表），样式用 Vite 原生的 CSS Modules，令牌全部带 `--ui-` 前缀，和旧界面（Tailwind、shadcn 的 `--accent`、`--primary` 等全局变量）互不干扰，可以并存到第 3 阶段删掉旧界面为止。组件在一个只在开发时存在的演示页 `frontend/ui-kit.html` 上用 Playwright 在真实浏览器里测（键盘、焦点、对比度、截图），纯逻辑用 Vitest 测。浮层用浏览器原生的 `<dialog>` 和 `popover` 顶层机制，不自己管 z-index 和 portal。

**Tech Stack:** React 19.1、TypeScript 5.9、Vite 6.4、CSS Modules、lucide-react 0.468、Vitest 3.2.4（新增，仅开发依赖）、Playwright 1.63；后端 Python 3.13、FastAPI、pytest。

**Spec:** `docs/superpowers/specs/2026-10-18-open-paper-reader/design.md`（第 7 节视觉语言、第 8 节技术做法、第 9 节稳定性、第 10 节第 1 阶段）。样稿 `docs/superpowers/specs/2026-10-18-open-paper-reader/mockup-reader.html` 里的取值是令牌的来源。

## Global Constraints

- 新组件不得引入 shadcn/ui、Radix、Tailwind 类名、class-variance-authority、tailwind-merge、cmdk、sonner；只允许用 React、lucide-react 和浏览器原生能力。`clsx` 可以用（旧代码已在用，很小）。
- 新样式只用 `--ui-*` 令牌，不写零散的颜色、圆角、字号、时长数值（令牌文件本身除外）。
- 浅色、深色两套主题里，正文类文字与底色的对比度 ≥ 4.5:1（WCAG AA）。
- 中文只用 400 和 600 两个字重；字号只用令牌里的整数阶梯。
- 动效只动 `transform`、`opacity`、颜色；系统开启「减少动态效果」时时长令牌归零。
- 组件里的所有可见文字和无障碍名称走文案表，不写死中文或英文。
- 字体随包发布（`@fontsource-variable/*`），不连外网字体服务；宋体不随包，只用系统字体。
- 旧界面在本阶段外观和行为不变：现有 `frontend/e2e/` 整套必须照常通过。
- 提交作者用仓库配置的 Jialei 身份，提交说明里不加 Co-Authored-By；改动走分支和 PR，CI 全绿后 squash 合并。
- 借用 claude-web（MIT，Copyright (c) 2026 ypyik0669）的令牌结构和取值，要在 `NOTICE.md` 注明并附许可证原文。

## Review Focus

1. **浮层叠在对话框里**：对话框里打开菜单，按一次 Esc 只关菜单、焦点回到菜单按钮，再按一次才关对话框。→ Task 6 的 `menu inside dialog: Escape closes the menu first`。
2. **浮层贴着窗口边缘**：在窗口右下角打开菜单或提示，它要翻到上方、整体留在窗口里，不被裁掉。→ Task 5 的 `placeFloating` 单元测试和 `tooltip near the viewport edge stays inside`。
3. **主题跟随系统时系统切换外观**：设置为「跟随系统」，系统从浅色切到深色，界面立即切换，不用刷新。→ Task 1 的 `system appearance follows the OS live`。
4. **长文案和英文更长**：英文文案比中文长得多，按钮、分段控件、侧栏条目里的文字不能换行撑破或溢出容器，要截断并能看到全文（提示）。→ Task 10 的 `long English labels truncate without overflow`。
5. **出错提示不自动消失**：错误提示停留到用户关掉或点了重试，不会 5 秒后自己消失让人来不及看。→ Task 9 的 `error toasts stay until dismissed`。

---

## 文件结构

```
frontend/
  ui-kit.html                     演示页入口（只在开发服务器上存在，不进生产构建）
  playwright.ui.config.ts         演示页的 Playwright 配置（端口 5174）
  e2e-ui/                         演示页上的组件测试
    helpers.ts
    tokens.spec.ts  i18n.spec.ts  button.spec.ts  field.spec.ts
    tooltip.spec.ts menu.spec.ts  dialog.spec.ts  segmented.spec.ts
    toast.spec.ts   shell.spec.ts screens.spec.ts
  src/ui/
    index.ts                      对外出口：组件、主题、令牌样式（不含 reset）
    reset.css                     新界面的基础重置（只由新入口引入）
    tokens.css                    设计令牌
    theme.ts  theme.test.ts       外观：跟随系统/浅色/深色
    shortcut.ts shortcut.test.ts  快捷键的显示和匹配
    position.ts position.test.ts  浮层定位的纯计算
    toast-store.ts toast-store.test.ts
    Button.tsx Button.module.css  IconButton.tsx  Spinner.tsx  Kbd.tsx  Kbd.module.css
    Field.tsx Field.module.css    (TextField、TextArea)
    Floating.tsx Floating.module.css  Tooltip.tsx
    Menu.tsx Menu.module.css
    Dialog.tsx Dialog.module.css
    SegmentedControl.tsx SegmentedControl.module.css
    Toaster.tsx Toaster.module.css
    Shell.tsx Shell.module.css    (Shell、Card、CardHeader)
    Sidebar.tsx Sidebar.module.css
  src/i18n/
    messages/en.ts  messages/zh.ts
    i18n.ts  i18n.test.ts         纯函数：语言检测、翻译、复数
    I18nProvider.tsx              React 上下文
  src/ui-kit/
    main.tsx  KitApp.tsx  KitApp.module.css
  src/components/Appearance.tsx   改为使用 src/ui/theme.ts（单一来源）
scripts/fake_model/               故障注入假模型（见 Task 11）
backend/tests/                    故障与难导入测试（见 Task 12、13）
```

---

### Task 1: 设计令牌、主题、演示页和测试工具

**Files:**
- Create: `frontend/src/ui/tokens.css`, `frontend/src/ui/reset.css`, `frontend/src/ui/index.ts`, `frontend/src/ui/theme.ts`, `frontend/src/ui/theme.test.ts`
- Create: `frontend/ui-kit.html`, `frontend/src/ui-kit/main.tsx`, `frontend/src/ui-kit/KitApp.tsx`, `frontend/src/ui-kit/KitApp.module.css`
- Create: `frontend/playwright.ui.config.ts`, `frontend/e2e-ui/helpers.ts`, `frontend/e2e-ui/tokens.spec.ts`
- Modify: `frontend/package.json`（依赖和脚本）, `frontend/vite.config.ts`（Vitest 配置）, `frontend/src/components/Appearance.tsx`, `frontend/scripts/copy-docs.mjs`, `.github/workflows/verify.yml`, `NOTICE.md`
- Create: `docs/licenses/claude-web-MIT.txt`, `docs/licenses/JetBrains-Mono-OFL.txt`

**Interfaces:**
- Produces（`frontend/src/ui/theme.ts`）：
  - `type Appearance = "system" | "light" | "dark"`，`type Theme = "light" | "dark"`
  - `const APPEARANCE_KEY = "paper-appearance"`（沿用旧界面的键，用户已有的选择继续有效）
  - `resolveTheme(mode: Appearance, systemDark: boolean): Theme`
  - `parseAppearance(value: string | null): Appearance`（非法值返回 `"system"`）
  - `applyTheme(theme: Theme, root?: HTMLElement): void`：设 `data-theme`、切换 `.dark` 类（旧界面用）、设 `style.colorScheme`
  - `setAppearance(mode: Appearance): void`、`getAppearance(): Appearance`
  - `useAppearance(): { mode: Appearance; theme: Theme; setMode(mode: Appearance): void }`
- Produces：令牌名（见 Step 3），后续所有任务只用这些名字。
- Produces：演示页 `KitApp` 的骨架——顶部工具栏有「主题」（浅色/深色）和「语言」（中文/English）两个原生 `<select>`，`aria-label` 分别为 `Kit theme`、`Kit locale`；下面每个组件一个 `<section aria-labelledby>`，标题是组件名（英文，演示页自身的文字不进文案表）。后续任务往里加 section。

- [ ] **Step 1: 装依赖、加脚本**

在 `frontend/` 下：`npm install @fontsource-variable/jetbrains-mono@5.3.0` 和 `npm install -D vitest@3.2.4`。`package.json` 的 scripts 加：
```json
"test:unit": "vitest run",
"test:ui": "playwright test -c playwright.ui.config.ts"
```
`format`、`check` 两个脚本里的路径列表加上 `e2e-ui`。`vite.config.ts` 顶部加 `/// <reference types="vitest/config" />`，配置里加 `test: { include: ["src/**/*.test.ts"], environment: "node" }`。

- [ ] **Step 2: 写主题的失败测试** `frontend/src/ui/theme.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { parseAppearance, resolveTheme } from "./theme";

describe("resolveTheme", () => {
  it("follows the OS only in system mode", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
});
describe("parseAppearance", () => {
  it("keeps valid values and falls back to system", () => {
    expect(parseAppearance("dark")).toBe("dark");
    expect(parseAppearance("light")).toBe("light");
    expect(parseAppearance("sepia")).toBe("system");
    expect(parseAppearance(null)).toBe("system");
  });
});
```
Run: `npm --prefix frontend run test:unit` → FAIL（`./theme` 不存在）。

- [ ] **Step 3: 写 `tokens.css`**

结构照 claude-web：每个主题只定义原色，其余用 `color-mix(in oklab, …)` 推导。`:root` 放浅色和所有不随主题变的阶梯，`:root[data-theme="dark"]` 覆盖深色原色。另加一段无脚本时的兜底：`@media (prefers-color-scheme: dark) { :root:not([data-theme]) { color-scheme: dark; background: #12110f; } }`（只防首屏闪白）。

原色（浅色 / 深色）：

| 令牌 | 浅色 | 深色 | 用途 |
| --- | --- | --- | --- |
| `--ui-bg` | `#fefdfc` | `#1b1a18` | 卡片 |
| `--ui-bg-1` | `#f7f6f2` | `#12110f` | 窗口底色（shell） |
| `--ui-bg-2` | `#f0eeea` | `#252321` | 内嵌块、用户气泡 |
| `--ui-bg-3` | `#e6e4df` | `#302f2c` | 更深的内嵌 |
| `--ui-elev` | `#ffffff` | `#272623` | 菜单、输入框、对话框 |
| `--ui-desk` | `#f0eeea` | `#161513` | PDF 纸面后面的桌面 |
| `--ui-fg` | `#1c1917` | `#eeedea` | 正文 |
| `--ui-fg-1` | `#47433f` | `#c4c2be` | 次要文字 |
| `--ui-fg-2` | `#67625f` | `#a5a39e` | 说明文字 |
| `--ui-fg-3` | `#726e6a` | `#93918c` | 占位、元信息（样稿值 `#7f7b77`、`#868480` 对比度不够，已加深/提亮） |
| `--ui-accent` | `#eb7f3b` | `#f5914f` | 只做填充和点缀 |
| `--ui-accent-text` | `#a94900` | `#f9a56e` | 橙色文字（引用页码、上下文标签） |
| `--ui-primary` | `#1c1917` | `#eeedea` | 主按钮底 |
| `--ui-primary-fg` | `#fefdfc` | `#1b1a18` | 主按钮字 |
| `--ui-danger` | `#d93036` | `#e5484d` | 危险操作的填充 |
| `--ui-danger-text` | `#b42318` | `#ff8b8b` | 错误文字 |
| `--ui-success-text` | `#12773d` | `#69d98d` | 成功、完成的勾 |
| `--ui-warning-text` | `#8a5a00` | `#f0b450` | 警告 |
| `--ui-highlight` | `rgba(235,127,59,.24)` | `rgba(245,145,79,.30)` | 论文高亮 |
| `--ui-selection` | `rgba(28,99,191,.18)` | `rgba(128,182,251,.32)` | 文字选区 |
| `--ui-page-filter` | `none` | `brightness(.86) contrast(.97)` | 深色下压暗 PDF 纸面 |
| `--ui-shade` | `40 30 20` | `0 0 0` | 投影颜色（rgb 三元组） |
| `--ui-shadow-k` | `1` | `3` | 投影强度系数 |
| `--ui-edge-k1` / `--ui-edge-k2` | `6%` / `10%` | `7%` / `11%` | 两档边线的混合比例 |

两套主题还要分别设 `color-scheme: light` / `dark`。

推导（写在 `:root`，两套共用）：
```css
--ui-edge-subtle: color-mix(in oklab, var(--ui-fg) var(--ui-edge-k1), transparent);
--ui-edge: color-mix(in oklab, var(--ui-fg) var(--ui-edge-k2), transparent);
--ui-hover: color-mix(in oklab, var(--ui-fg) 5%, transparent);
--ui-selected: color-mix(in oklab, var(--ui-fg) 8%, transparent);
--ui-fill: color-mix(in oklab, var(--ui-fg) 4%, transparent);
--ui-accent-soft: color-mix(in oklab, var(--ui-accent) 16%, transparent);
--ui-danger-soft: color-mix(in oklab, var(--ui-danger) 14%, transparent);
--ui-focus-ring: 0 0 0 2px var(--ui-bg), 0 0 0 4px color-mix(in oklab, var(--ui-accent) 70%, transparent);
--ui-elev-1: 0 0 0 1px var(--ui-edge-subtle), 0 1px 2px rgb(var(--ui-shade) / calc(.05 * var(--ui-shadow-k)));
--ui-elev-2: 0 0 0 1px var(--ui-edge), 0 4px 12px -2px rgb(var(--ui-shade) / calc(.09 * var(--ui-shadow-k))), 0 14px 36px -10px rgb(var(--ui-shade) / calc(.14 * var(--ui-shadow-k)));
--ui-elev-composer: 0 0 0 1px var(--ui-edge), 0 2px 4px rgb(var(--ui-shade) / calc(.04 * var(--ui-shadow-k))), 0 12px 28px -12px rgb(var(--ui-shade) / calc(.16 * var(--ui-shadow-k)));
```

阶梯（不随主题变）：
- 圆角：`--ui-r-4` `--ui-r-6` `--ui-r-8` `--ui-r-10` `--ui-r-12` `--ui-r-16` `--ui-r-20` `--ui-r-24`（值即名字的像素数），`--ui-r-pill: 999px`。
- 间距：`--ui-space-2` `-4` `-6` `-8` `-10` `-12` `-16` `-20` `-24` `-32` `-40` `-48`（值即名字的像素数）。
- 字号：`--ui-text-11` `-12` `-13` `-14` `-15` `-16` `-18` `-20` `-24` `-30`（值即名字的像素数）；行高 `--ui-leading-tight: 1.3`、`--ui-leading: 1.55`、`--ui-leading-loose: 1.7`（论文、长回答用）。
- 字重：`--ui-weight-regular: 400`、`--ui-weight-strong: 600`（没有 500）。
- 字体：`--ui-font-sans: "Inter Variable", -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC Variable", sans-serif;`、`--ui-font-mono: "JetBrains Mono Variable", ui-monospace, "SF Mono", Menlo, Consolas, monospace;`、`--ui-font-display: "Songti SC", STSong, "Source Han Serif SC", "Noto Serif CJK SC", "Noto Serif SC", SimSun, Georgia, serif;`
- 控件高度：`--ui-control-sm: 28px`、`--ui-control-md: 32px`、`--ui-control-lg: 36px`。
- 动效：`--ui-dur-1: 120ms`、`--ui-dur-2: 180ms`、`--ui-dur-3: 260ms`、`--ui-ease-out: cubic-bezier(.2, 0, 0, 1)`、`--ui-ease-in-out: cubic-bezier(.4, 0, .2, 1)`；`@media (prefers-reduced-motion: reduce) { :root { --ui-dur-1: 0.01ms; --ui-dur-2: 0.01ms; --ui-dur-3: 0.01ms; } }`。

文件头注释写明「结构与取值改编自 claude-web（MIT），见 NOTICE.md」。

- [ ] **Step 4: 写 `reset.css`、`index.ts`、`theme.ts`**

`reset.css`（只由新入口引入；旧界面已有 Tailwind 的 preflight，本阶段不动它）：`*, *::before, *::after { box-sizing: border-box; margin: 0; }`、`html, body { height: 100%; }`、`body { background: var(--ui-bg-1); color: var(--ui-fg); font: var(--ui-text-13)/var(--ui-leading) var(--ui-font-sans); -webkit-font-smoothing: antialiased; }`、`button, input, textarea, select { font: inherit; color: inherit; }`、`::selection { background: var(--ui-selection); }`、`:focus-visible { outline: none; box-shadow: var(--ui-focus-ring); }`。

`index.ts`：`import "@fontsource-variable/inter"; import "@fontsource-variable/jetbrains-mono"; import "./tokens.css";`，并导出后续任务的组件（每个任务完成时往这里加一行导出）和 `theme.ts` 的全部导出。

`theme.ts`：实现 Interfaces 里的函数。模块加载时读一次存储并 `applyTheme`；「跟随系统」时监听 `matchMedia("(prefers-color-scheme: dark)")` 的 `change` 立即切换；监听 `storage` 事件同步别的标签页。存储读写包在 try/catch 里（隐私模式不能报错）。本阶段默认值仍是 `"system"`（和旧界面一致）。

- [ ] **Step 5: 让旧界面用同一个主题来源**

`frontend/src/components/Appearance.tsx` 删掉自己的存储、`apply`、监听逻辑，改为从 `../ui/theme`（直接引这个文件，不经过 `../ui/index.ts`，免得把令牌和字体带进旧界面）取 `useAppearance`，并原样转出 `useAppearance`，`main.tsx` 等调用方不用改；`AppearanceSettings` 组件的外观和文字不变。这样旧界面切换外观时，`data-theme` 也一起变。

- [ ] **Step 6: 演示页骨架和 Playwright 配置**

`ui-kit.html`：最小 HTML，`<html lang="zh-CN">`，`<div id="root">`，`<script type="module" src="/src/ui-kit/main.tsx">`。`main.tsx` 依次引入 `../ui/reset.css`、`../ui`，渲染 `<KitApp/>`。生产构建的入口只有 `index.html`，不需要改 Vite 的 build 配置；加一条检查：`npm run build` 后 `dist/` 里没有 `ui-kit.html`。

`playwright.ui.config.ts`：`testDir: "./e2e-ui"`、`workers: 2`、`use.baseURL: "http://127.0.0.1:5174"`、`viewport 1280×800`、`webServer: { command: "npx vite --port 5174 --strictPort", url: "http://127.0.0.1:5174/ui-kit.html", reuseExistingServer: !process.env.CI }`，报告输出到 `../test-results/ui-kit/`。

`e2e-ui/helpers.ts`：
- `openKit(page, { theme?: "light" | "dark"; locale?: "zh" | "en" })`：打开 `/ui-kit.html`，用两个 select 设好主题和语言。
- `contrast(page, fgCss: string, bgCss: string, baseCss?: string): Promise<number>`：在页面里用 1×1 canvas 依次画 `baseCss`（给出时）、`bgCss`、`fgCss`，用 `getImageData` 取前景合成前后的两个像素，再按 WCAG 公式算对比度（这样 `color-mix` 和半透明色都按浏览器真实结果算）。参数是 CSS 颜色值。
- `contrastOfTokens(page, fgToken: string, bgToken: string, baseToken?: string): Promise<number>`：先用 `getComputedStyle(document.documentElement).getPropertyValue(token)` 取出令牌值，再调 `contrast`。

- [ ] **Step 7: 写令牌测试** `frontend/e2e-ui/tokens.spec.ts`

```ts
for (const theme of ["light", "dark"] as const) {
  test(`text tokens meet WCAG AA in ${theme}`, async ({ page }) => {
    await openKit(page, { theme });
    const pairs: [string, string[]][] = [
      ["--ui-fg", ["--ui-bg", "--ui-bg-1", "--ui-bg-2", "--ui-elev"]],
      ["--ui-fg-1", ["--ui-bg", "--ui-bg-1", "--ui-bg-2", "--ui-elev"]],
      ["--ui-fg-2", ["--ui-bg", "--ui-bg-1", "--ui-bg-2", "--ui-elev"]],
      ["--ui-fg-3", ["--ui-bg", "--ui-bg-1", "--ui-elev"]],
      ["--ui-accent-text", ["--ui-bg", "--ui-bg-1", "--ui-elev"]],
      ["--ui-danger-text", ["--ui-bg", "--ui-elev"]],
      ["--ui-success-text", ["--ui-bg", "--ui-elev"]],
      ["--ui-warning-text", ["--ui-bg", "--ui-elev"]],
      ["--ui-primary-fg", ["--ui-primary"]],
    ];
    for (const [fg, bgs] of pairs)
      for (const bg of bgs)
        expect(await contrastOfTokens(page, fg, bg), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    // 橙色文字放在橙色淡底上（上下文标签）
    expect(await contrastOfTokens(page, "--ui-accent-text", "--ui-accent-soft", "--ui-bg")).toBeGreaterThanOrEqual(4.5);
  });
}
test("system appearance follows the OS live", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/ui-kit.html");
  await page.evaluate(() => localStorage.setItem("paper-appearance", "system"));
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("html")).toHaveClass(/\bdark\b/);
});
test("reduced motion zeroes the duration tokens", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openKit(page);
  const dur = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--ui-dur-2").trim());
  expect(dur).toBe("0.01ms");
});
```
Run: `npm --prefix frontend run test:ui -- tokens.spec.ts` → 先确认在 Step 3、4 完成前会失败，完成后 PASS。

- [ ] **Step 8: 跑全部检查**

Run: `npm --prefix frontend run test:unit` → PASS；`npm --prefix frontend run check` → 通过；`npm --prefix frontend run build && test ! -e frontend/dist/ui-kit.html` → 通过。旧界面的 `frontend/e2e/` 整套在 Task 10 结束时统一跑一遍。

- [ ] **Step 9: CI、许可证**

`.github/workflows/verify.yml`：`acceptance` 任务在 `npm --prefix frontend run check` 后加 `- run: npm --prefix frontend run test:unit`；`browser` 任务在 `npx playwright install …` 后加一步，只在第 1 片跑：
```yaml
      - if: matrix.shard == 1
        run: npx playwright test -c playwright.ui.config.ts
        working-directory: frontend
```
`frontend/scripts/copy-docs.mjs` 的许可证列表加 `["@fontsource-variable/jetbrains-mono/LICENSE", "JetBrains-Mono-OFL.txt"]`。`docs/licenses/` 放 claude-web 的 MIT 原文（`gh api repos/ypyik0669/claude-web/contents/LICENSE` 取）和 JetBrains Mono 的 OFL。`NOTICE.md` 第一张表加一行 claude-web（`frontend/src/ui/tokens.css`，MIT，Copyright (c) 2026 ypyik0669，「设计令牌的结构和取值改编自它的 tokens.css」），字体那行加 JetBrains Mono，依赖表的 OFL 行加 `@fontsource-variable/jetbrains-mono`、开发依赖加 Vitest（MIT）。

- [ ] **Step 10: Commit**

```bash
git add frontend .github/workflows/verify.yml NOTICE.md docs/licenses
git commit -m "新界面的设计令牌、主题和组件演示页"
```

---

### Task 2: 文案表框架（中英）

**Files:**
- Create: `frontend/src/i18n/messages/en.ts`, `frontend/src/i18n/messages/zh.ts`, `frontend/src/i18n/i18n.ts`, `frontend/src/i18n/i18n.test.ts`, `frontend/src/i18n/I18nProvider.tsx`, `frontend/e2e-ui/i18n.spec.ts`
- Modify: `frontend/src/ui-kit/KitApp.tsx`（语言 select 接到 Provider）, `frontend/src/ui/index.ts`（不导出 i18n；i18n 是独立模块）

**Interfaces:**
- Produces（`i18n.ts`）：
  - `type Locale = "zh" | "en"`，`const LOCALES: readonly Locale[]`，`const LOCALE_KEY = "paper-locale"`
  - `type MessageKey = keyof typeof en`（`en` 用 `as const` 声明，是文案的唯一来源；`zh` 的类型是 `{ [K in MessageKey]: string }`，少键、多键都编译不过）
  - `detectLocale(stored: string | null, languages: readonly string[]): Locale`：`stored` 合法就用它；否则取 `languages` 里第一个以 `zh` 或 `en` 开头的；都没有返回 `"en"`
  - `createTranslator(locale: Locale): Translator`
  - `interface Translator { locale: Locale; t(key: MessageKey, params?: Record<string, string | number>): string; tn(key: PluralBase, count: number, params?: Record<string, string | number>): string }`
  - 复数：文案表里写成 `"x.y#one"`、`"x.y#other"` 两个键，`type PluralBase` 是所有带 `#other` 后缀的键去掉后缀；`tn` 用 `Intl.PluralRules(locale)` 选，选不到用 `#other`，并自动把 `count` 放进参数。
  - 占位符写成 `{name}`；参数缺失时原样保留 `{name}`（不抛错，方便发现）。`zh` 里某个值为空字符串时回退到 `en`。
- Produces（`I18nProvider.tsx`）：`I18nProvider({ children, locale?: Locale })`、`useI18n(): Translator & { setLocale(locale: Locale): void }`。没有 Provider 时 `useI18n` 返回按 `detectLocale(存储, navigator.languages)` 建的默认翻译器（组件在旧界面里单独使用也能工作）。Provider 切换语言时写存储、设 `document.documentElement.lang` 为 `zh-CN` 或 `en`。
- 本任务先放进文案表的键（后续组件任务用）：`common.close`（关闭 / Close）、`common.cancel`（取消 / Cancel）、`common.confirm`（确定 / OK）、`common.retry`（重试 / Retry）、`common.loading`（正在加载 / Loading）、`common.dismiss`（关掉提示 / Dismiss）、`toast.region`（通知 / Notifications）、`sidebar.collapse`（收起侧栏 / Collapse sidebar）、`sidebar.expand`（展开侧栏 / Expand sidebar）、`kit.sample.pages#one`（读了 {count} 页 / Read {count} page）、`kit.sample.pages#other`（读了 {count} 页 / Read {count} pages）。

- [ ] **Step 1: 写失败测试** `frontend/src/i18n/i18n.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { createTranslator, detectLocale } from "./i18n";
import { en } from "./messages/en";
import { zh } from "./messages/zh";

describe("detectLocale", () => {
  it("prefers the stored choice, then the browser, then English", () => {
    expect(detectLocale("en", ["zh-CN"])).toBe("en");
    expect(detectLocale(null, ["zh-TW", "en"])).toBe("zh");
    expect(detectLocale("fr", ["de-DE", "en-GB"])).toBe("en");
    expect(detectLocale(null, ["ja"])).toBe("en");
  });
});
describe("translator", () => {
  it("interpolates and pluralizes per locale", () => {
    const e = createTranslator("en"), z = createTranslator("zh");
    expect(e.tn("kit.sample.pages", 1)).toBe("Read 1 page");
    expect(e.tn("kit.sample.pages", 3)).toBe("Read 3 pages");
    expect(z.tn("kit.sample.pages", 1)).toBe("读了 1 页");
    expect(e.t("common.close")).toBe("Close");
  });
  it("leaves a missing parameter visible", () => {
    expect(createTranslator("en").t("kit.sample.pages#other")).toBe("Read {count} pages");
  });
});
describe("catalogs", () => {
  const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  it("zh has every key, non-empty, with the same placeholders as en", () => {
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(zh[key], key).toBeTruthy();
      expect(holes(zh[key]), key).toEqual(holes(en[key]));
    }
  });
});
```
Run: `npm --prefix frontend run test:unit` → FAIL。

- [ ] **Step 2: 实现 `i18n.ts`、两份文案表、`I18nProvider.tsx`**，按 Interfaces。
- [ ] **Step 3: 跑单元测试** → PASS。
- [ ] **Step 4: 演示页接语言并写浏览器测试** `frontend/e2e-ui/i18n.spec.ts`

演示页加一个 section「I18n」，显示 `tn("kit.sample.pages", 1)` 和 `tn(…, 3)`。测试：选 English 后显示 `Read 1 page`、`Read 3 pages`，`html` 的 `lang` 是 `en`；刷新后仍是 English（存储生效）；选中文后显示 `读了 1 页`，`lang` 是 `zh-CN`。
Run: `npm --prefix frontend run test:ui -- i18n.spec.ts` → PASS。

- [ ] **Step 5: Commit** `git commit -m "中英文案表框架"`（只加本任务的文件）。

---

### Task 3: 按钮、图标按钮、加载圈、快捷键标签

**Files:**
- Create: `frontend/src/ui/shortcut.ts`, `frontend/src/ui/shortcut.test.ts`, `frontend/src/ui/Button.tsx`, `frontend/src/ui/Button.module.css`, `frontend/src/ui/IconButton.tsx`, `frontend/src/ui/Spinner.tsx`, `frontend/src/ui/Kbd.tsx`, `frontend/src/ui/Kbd.module.css`, `frontend/e2e-ui/button.spec.ts`
- Modify: `frontend/src/ui/index.ts`, `frontend/src/ui-kit/KitApp.tsx`

**Interfaces:**
- Produces（`shortcut.ts`）：
  - `isMacPlatform(platform: string): boolean`（`/Mac|iPhone|iPad/`）
  - `formatShortcut(spec: string, mac: boolean): string`。`spec` 用小写、`+` 连接：`mod`（Mac 为 ⌘、其他为 Ctrl）、`shift`、`alt`、`enter`、`escape`、单个字母或数字。Mac 输出符号紧排（`mod+k` → `⌘K`，`shift+enter` → `⇧↵`，`alt+e` → `⌥E`）；其他系统用 `+` 连接单词（`Ctrl+K`、`Shift+Enter`、`Alt+E`）；单键两边都是大写字母（`e` → `E`），`enter` 单独时两边都是 `↵`。
  - `matchesShortcut(event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">, spec: string, mac: boolean): boolean`：修饰键必须完全一致（多按了也不算）；字母比较不分大小写。
- Produces（组件）：
  - `Button(props: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger"; size?: "sm" | "md"; icon?: LucideIcon; loading?: boolean; ref?: Ref<HTMLButtonElement> })`，默认 `secondary`、`md`、`type="button"`。
  - `IconButton(props: Omit<ButtonProps, "children" | "icon"> & { icon: LucideIcon; label: string; shortcut?: string; variant?: "ghost" | "secondary" })`：`aria-label={label}`；悬停或键盘聚焦时显示提示（Task 5 完成后接上 `Tooltip`；本任务先只设 `aria-label`）。
  - `Spinner({ size?: 14 | 16 })`：`aria-hidden`，转圈动画用 `--ui-dur-3` 的倍数，减少动态效果时停转、改为呼吸透明度。
  - `Kbd({ shortcut: string })`：按当前平台 `formatShortcut`，`aria-hidden="true"`（无障碍名称由使用方用 `aria-keyshortcuts` 提供）。

外观（`Button.module.css`）：
- `md`：高 `--ui-control-md`、左右 `--ui-space-12`、字号 `--ui-text-13`、圆角 `--ui-r-10`；`sm`：高 `--ui-control-sm`、左右 `--ui-space-10`、字号 `--ui-text-12`、圆角 `--ui-r-8`。图标 16px（sm 14px），图标和字间距 `--ui-space-6`。字重 `--ui-weight-strong`。文字单行，超出省略。
- `primary`：底 `--ui-primary`、字 `--ui-primary-fg`；悬停 `color-mix(in oklab, var(--ui-primary) 88%, var(--ui-bg))`。
- `secondary`：底 `--ui-fill`、字 `--ui-fg`、`box-shadow: inset 0 0 0 1px var(--ui-edge-subtle)`；悬停底 `--ui-selected`。
- `ghost`：透明底、字 `--ui-fg-1`；悬停底 `--ui-hover`、字 `--ui-fg`。
- `danger`：底 `--ui-danger-soft`、字 `--ui-danger-text`；悬停 `color-mix(in oklab, var(--ui-danger) 22%, transparent)`。
- 按下 `transform: scale(.98)`；过渡 `--ui-dur-1` `--ui-ease-out`；`:focus-visible` 用 `--ui-focus-ring`；禁用 `opacity: .45; cursor: not-allowed`，没有悬停变化。
- `IconButton`：正方形 30px（`sm` 26px），圆角 `--ui-r-10`，默认 `ghost`，图标色 `--ui-fg-2`、悬停 `--ui-fg`。

- [ ] **Step 1: 写快捷键的失败测试** `shortcut.test.ts`

```ts
it("formats per platform", () => {
  expect(formatShortcut("mod+k", true)).toBe("⌘K");
  expect(formatShortcut("mod+k", false)).toBe("Ctrl+K");
  expect(formatShortcut("shift+enter", true)).toBe("⇧↵");
  expect(formatShortcut("shift+enter", false)).toBe("Shift+Enter");
  expect(formatShortcut("e", false)).toBe("E");
  expect(formatShortcut("enter", false)).toBe("↵");
});
it("matches modifiers exactly", () => {
  const ev = (key: string, m: Partial<Record<"metaKey" | "ctrlKey" | "shiftKey" | "altKey", boolean>> = {}) =>
    ({ key, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...m });
  expect(matchesShortcut(ev("k", { metaKey: true }), "mod+k", true)).toBe(true);
  expect(matchesShortcut(ev("K", { ctrlKey: true }), "mod+k", false)).toBe(true);
  expect(matchesShortcut(ev("k", { ctrlKey: true }), "mod+k", true)).toBe(false);
  expect(matchesShortcut(ev("e", { shiftKey: true }), "e", false)).toBe(false);
  expect(matchesShortcut(ev("Enter"), "enter", false)).toBe(true);
});
```
Run → FAIL；实现 `shortcut.ts` → PASS。

- [ ] **Step 2: 实现四个组件**，演示页加 section「Button」：四种 variant × 两种 size、带图标、`loading`、禁用、一个 IconButton（`label="Search"`，图标 `Search`）。

- [ ] **Step 3: 写浏览器测试** `button.spec.ts`
  - `loading button is busy and inert`：`aria-busy="true"`、`disabled`，点击不触发 `onClick`（演示页用一个计数器显示点击次数）。
  - `icon button exposes its label`：`getByRole("button", { name: "Search" })` 可见。
  - `focus ring only for keyboard`：鼠标点击后 `box-shadow` 为 `none`；按 Tab 聚焦后 `box-shadow` 不为 `none`。
  - `primary text contrast`：两套主题下 primary 按钮的文字色对比其底色 ≥ 4.5（用 `contrast` helper 取计算后的 `color`、`background-color`）。
  Run: `npm --prefix frontend run test:ui -- button.spec.ts` → PASS。

- [ ] **Step 4: Commit** `git commit -m "新界面的按钮和快捷键标签"`

---

### Task 4: 输入框

**Files:**
- Create: `frontend/src/ui/Field.tsx`, `frontend/src/ui/Field.module.css`, `frontend/e2e-ui/field.spec.ts`
- Modify: `frontend/src/ui/index.ts`, `frontend/src/ui-kit/KitApp.tsx`

**Interfaces:**
- Produces：
  - `TextField(props: InputHTMLAttributes<HTMLInputElement> & { label: string; hideLabel?: boolean; description?: string; error?: string; ref?: Ref<HTMLInputElement> })`
  - `TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; hideLabel?: boolean; description?: string; error?: string; autoGrow?: boolean; maxRows?: number; ref?: Ref<HTMLTextAreaElement> })`：`autoGrow` 时随内容长高，到 `maxRows`（默认 8）后出现滚动条。
  - 两者都用 `useId` 关联：`<label htmlFor>`；`aria-describedby` 指向说明和错误；有 `error` 时 `aria-invalid="true"`。`hideLabel` 时标签视觉隐藏但仍可读。

外观：标签 `--ui-text-12`、`--ui-fg-1`、和输入框间距 `--ui-space-6`；输入框高 `--ui-control-lg`、左右 `--ui-space-12`、圆角 `--ui-r-10`、底 `--ui-fill`、`inset 0 0 0 1px var(--ui-edge-subtle)`；悬停边线换 `--ui-edge`；聚焦 `--ui-focus-ring`；占位文字 `--ui-fg-3`；说明 `--ui-text-12` `--ui-fg-2`；错误时边线 `--ui-danger`、错误文字 `--ui-danger-text`。

- [ ] **Step 1: 演示页加 section「Field」**：一个带说明的 TextField（label `Base URL`）、一个 `error="This address is not reachable"` 的 TextField（label `API key`）、一个 `autoGrow` 的 TextArea（label `Question`）。
- [ ] **Step 2: 写浏览器测试** `field.spec.ts`
  - `label and description are wired`：`getByLabel("Base URL")` 能找到；它的 `aria-describedby` 指向的元素文字是说明。
  - `error marks the field invalid`：`getByLabel("API key")` 有 `aria-invalid="true"`，`toHaveAccessibleDescription(/not reachable/)`。
  - `textarea grows then scrolls`：输入 3 行后高度变大；输入 20 行后高度等于 8 行的高度且 `scrollHeight > clientHeight`。
  Run → 先 FAIL。
- [ ] **Step 3: 实现 `Field.tsx`** → PASS。
- [ ] **Step 4: Commit** `git commit -m "新界面的输入框"`

---

### Task 5: 浮层定位与提示

**Files:**
- Create: `frontend/src/ui/position.ts`, `frontend/src/ui/position.test.ts`, `frontend/src/ui/Floating.tsx`, `frontend/src/ui/Floating.module.css`, `frontend/src/ui/Tooltip.tsx`, `frontend/e2e-ui/tooltip.spec.ts`
- Modify: `frontend/src/ui/IconButton.tsx`（接上 Tooltip）, `frontend/src/ui/index.ts`, `frontend/src/ui-kit/KitApp.tsx`

**Interfaces:**
- Produces（`position.ts`，纯函数）：
  - `type Side = "top" | "bottom" | "left" | "right"`，`type Align = "start" | "center" | "end"`，`interface Placement { side: Side; align: Align }`
  - `interface Rect { x: number; y: number; width: number; height: number }`
  - `placeFloating(anchor: Rect, size: { width: number; height: number }, viewport: { width: number; height: number }, want: Placement, offset = 6, padding = 8): { x: number; y: number; placement: Placement }`
  - 算法：先按想要的一侧放；这一侧放不下而对侧空间更大时翻到对侧；再把交叉轴夹在 `[padding, viewport - size - padding]` 内；主轴也放不下时夹到窗口内作为最后手段。
- Produces（`Floating.tsx`）：
  - `Floating(props: { open: boolean; anchor: HTMLElement | Rect | null; placement?: Placement; offset?: number; onDismiss?: (reason: "escape" | "outside") => void; ignore?: HTMLElement | null; role?: string; id?: string; className?: string; style?: CSSProperties; children: ReactNode; ref?: Ref<HTMLDivElement> })`
  - 用 `<div popover="manual">` 放进浏览器顶层（不用 portal，不设 z-index），打开时 `showPopover()`、关闭时 `hidePopover()`；`position: fixed; inset: auto; margin: 0`，用 `left/top` 摆位置。
  - 打开时、窗口 resize、任意滚动（捕获阶段监听）、浮层自身尺寸变化（`ResizeObserver`）时重新计算位置（用 `requestAnimationFrame` 合并）。
  - 打开的 Floating 维护一个模块级栈：`Escape` 只交给最上面的那个处理，处理时 `preventDefault()` + `stopPropagation()`（这样外面的 `<dialog>` 不会同时被关掉）；在浮层和 `ignore` 元素之外按下指针时 `onDismiss("outside")`。
  - 进场：`opacity` 0→1、`translateY(4px)`→0，`--ui-dur-1`，用 `@starting-style`；退场不做动画。
- Produces（`Tooltip.tsx`）：`Tooltip({ content: string; shortcut?: string; placement?: Placement; children: ReactElement })`。用 `<span style="display: contents">` 包住子元素来接收冒泡的 `pointerover/pointerout/focus/blur`，锚点取 `span.firstElementChild`。悬停 400ms 后出现、离开立即消失；键盘聚焦（`:focus-visible` 成立）时立即出现；`Escape` 隐藏。提示本身 `role="tooltip"`、`aria-hidden="true"`（子元素必须自带无障碍名称，比如 IconButton 的 `aria-label`）。外观：底 `--ui-fg`、字 `--ui-bg`、`--ui-text-12`、圆角 `--ui-r-8`、内距 `--ui-space-4` `--ui-space-8`，快捷键用 `Kbd`，颜色 `color-mix(in oklab, var(--ui-bg) 60%, transparent)`。

- [ ] **Step 1: 写定位的失败测试** `position.test.ts`

```ts
const vp = { width: 1000, height: 800 };
const size = { width: 200, height: 100 };
it("places below, aligned to the start, when it fits", () => {
  expect(placeFloating({ x: 100, y: 100, width: 80, height: 30 }, size, vp, { side: "bottom", align: "start" }))
    .toEqual({ x: 100, y: 136, placement: { side: "bottom", align: "start" } });
});
it("flips to the top near the bottom edge", () => {
  const r = placeFloating({ x: 100, y: 740, width: 80, height: 30 }, size, vp, { side: "bottom", align: "start" });
  expect(r.placement.side).toBe("top");
  expect(r.y).toBe(740 - 6 - 100);
});
it("shifts left to stay inside the right edge", () => {
  const r = placeFloating({ x: 950, y: 100, width: 40, height: 30 }, size, vp, { side: "bottom", align: "start" });
  expect(r.x).toBe(1000 - 200 - 8);
});
it("centers on the anchor", () => {
  expect(placeFloating({ x: 400, y: 100, width: 100, height: 30 }, size, vp, { side: "top", align: "center" }).x).toBe(350);
});
it("keeps the preferred side when neither side fits better", () => {
  const tall = { width: 200, height: 790 };
  expect(placeFloating({ x: 100, y: 10, width: 80, height: 30 }, tall, vp, { side: "bottom", align: "start" }).placement.side).toBe("bottom");
});
```
Run → FAIL；实现 → PASS。

- [ ] **Step 2: 实现 `Floating`、`Tooltip`，IconButton 接上 Tooltip**（`content={label}`、`shortcut`）。演示页加 section「Tooltip」：一个普通 IconButton，和一个固定在演示页右下角（`position: fixed; right: 4px; bottom: 4px`）的 IconButton（label `Corner`）。
- [ ] **Step 3: 写浏览器测试** `tooltip.spec.ts`
  - `hover shows the tooltip after a delay`：悬停后 200ms 内不可见，600ms 内可见，文字等于按钮的名称；移开后消失。
  - `keyboard focus shows it immediately and Escape hides it`。
  - `tooltip near the viewport edge stays inside`：悬停 `Corner`，提示的 `getBoundingClientRect()` 完全在窗口内，并且在按钮上方。
  Run → PASS。
- [ ] **Step 4: Commit** `git commit -m "新界面的浮层定位和提示"`

---

### Task 6: 菜单

**Files:**
- Create: `frontend/src/ui/Menu.tsx`, `frontend/src/ui/Menu.module.css`, `frontend/e2e-ui/menu.spec.ts`
- Modify: `frontend/src/ui/index.ts`, `frontend/src/ui-kit/KitApp.tsx`

**Interfaces:**
- Consumes：`Floating`、`Placement`（Task 5），`Kbd`（Task 3）。
- Produces：
  - `type MenuEntry = { kind?: "item"; id: string; label: string; icon?: LucideIcon; shortcut?: string; danger?: boolean; disabled?: boolean; onSelect: () => void } | { kind: "separator"; id: string }`
  - `MenuList(props: { label: string; items: MenuEntry[]; onClose: (reason: "select" | "escape" | "tab") => void; autoFocus?: "first" | "last" | "none"; orientation?: "vertical" | "horizontal" })`：只负责列表和键盘，第 2 阶段的划选菜单（横排）直接用它配 `Floating`。
  - `Menu(props: { label: string; items: MenuEntry[]; placement?: Placement; trigger: (props: MenuTriggerProps) => ReactNode })`，`MenuTriggerProps = { ref: RefCallback<HTMLElement>; "aria-haspopup": "menu"; "aria-expanded": boolean; "aria-controls": string; onClick: () => void; onKeyDown: (e: KeyboardEvent) => void }`，调用方把它展开到 `Button` 上。

行为：
- 触发按钮：点击切换；`ArrowDown`、`Enter`、`Space` 打开并聚焦第一项；`ArrowUp` 打开并聚焦最后一项。
- 列表 `role="menu"`、`aria-label`、`aria-orientation`；项 `role="menuitem"`，`tabIndex=-1`，禁用项 `aria-disabled="true"`；分隔线 `role="separator"`；有快捷键时项上加 `aria-keyshortcuts`，右侧显示 `Kbd`。
- 方向键（竖排上下、横排左右）在可用项之间移动，首尾循环；`Home`/`End`；按字母时跳到下一个以该字母开头的项（500ms 内连续输入拼成前缀）。
- `Enter`/`Space`/点击：执行 `onSelect` 后关闭，焦点回触发按钮；`Escape`：关闭并回到触发按钮；`Tab`：关闭，不拦截默认的焦点移动；点外面：关闭，不移动焦点。
- 外观：容器底 `--ui-elev`、`--ui-elev-2`、圆角 `--ui-r-16`、内距 `--ui-space-4`、最小宽 180px；项高 `--ui-control-md`、左右 `--ui-space-10`、圆角 `--ui-r-10`、字 `--ui-fg-1`；当前项（聚焦或悬停）底 `--ui-selected`、字 `--ui-fg`；危险项字 `--ui-danger-text`；分隔线 `1px` `--ui-edge-subtle`，上下 `--ui-space-4`。

- [ ] **Step 1: 演示页加 section「Menu」**：一个 `More` 按钮的菜单，项依次是 `Rename`（shortcut `r`）、`Duplicate`、`Archive`（disabled）、分隔线、`Delete`（danger）；选中后在页面上显示 `Selected: <label>`。再加一个按钮 `Open dialog`，打开的对话框里也放一个同样的菜单（Task 7 完成后再补这条测试，见下）。
- [ ] **Step 2: 写浏览器测试** `menu.spec.ts`
  - `opens with the keyboard and focuses the first item`：聚焦 `More`，按 `ArrowDown`，`menuitem` `Rename` 获得焦点，触发按钮 `aria-expanded="true"`。
  - `arrow keys skip disabled items and wrap`：从 `Duplicate` 按 `ArrowDown` 到 `Delete`；再按到 `Rename`。
  - `typeahead jumps to the matching item`：按 `d` 到 `Duplicate`，再按 `d`（500ms 后）到 `Delete`。
  - `Enter selects, closes and returns focus`：显示 `Selected: Rename`，菜单不可见，焦点在 `More`。
  - `Escape closes and returns focus`；`click outside closes without moving focus to the trigger`。
  - `shortcut is announced`：`Rename` 有 `aria-keyshortcuts="r"`。
  Run → 先 FAIL；实现 → PASS。
- [ ] **Step 3: Commit** `git commit -m "新界面的菜单"`

---

### Task 7: 对话框

**Files:**
- Create: `frontend/src/ui/Dialog.tsx`, `frontend/src/ui/Dialog.module.css`, `frontend/e2e-ui/dialog.spec.ts`
- Modify: `frontend/src/ui/index.ts`, `frontend/src/ui-kit/KitApp.tsx`, `frontend/e2e-ui/menu.spec.ts`

**Interfaces:**
- Consumes：`IconButton`（关闭按钮，`label = t("common.close")`）、`useI18n`。
- Produces：`Dialog(props: { open: boolean; onClose: () => void; title: string; description?: string; children?: ReactNode; footer?: ReactNode; size?: "sm" | "md" | "lg"; dismissible?: boolean; initialFocus?: RefObject<HTMLElement | null> })`。

行为：
- 用原生 `<dialog>`：`open` 变真时 `showModal()`，变假时 `close()`。浏览器负责顶层、背景不可操作和焦点不出框。
- 打开时记下 `document.activeElement`，关闭后把焦点还给它（元素还在页面上时）。初始焦点：`initialFocus` → 对话框里第一个带 `data-autofocus` 的元素 → 第一个可聚焦元素。
- `Escape` 触发的 `cancel` 事件一律 `preventDefault()`，`dismissible`（默认 true）时调用 `onClose()`；点击背景（`event.target === dialog` 且落在内容框外）同理。`dismissible=false` 时两者都不关。
- 打开期间锁住页面滚动（`document.documentElement.style.overflow = "hidden"`，多个对话框叠开时用计数，全部关闭才恢复）。
- `aria-labelledby` 指向标题，`aria-describedby` 指向说明。
- 外观：宽 `sm` 400px、`md` 520px、`lg` 720px，最大 `calc(100vw - 32px)`；底 `--ui-elev`、`--ui-elev-2`、圆角 `--ui-r-20`；头部内距 `--ui-space-20` `--ui-space-20` `--ui-space-8`，标题 `--ui-text-16` `--ui-weight-strong`，说明 `--ui-text-13` `--ui-fg-2`；正文内距 `--ui-space-8` `--ui-space-20`；底部右对齐、按钮间距 `--ui-space-8`、内距 `--ui-space-16` `--ui-space-20` `--ui-space-20`。背景 `::backdrop` 为 `rgb(var(--ui-shade) / calc(.18 * var(--ui-shadow-k)))`。进场 `opacity` + `scale(.98)`→1，`--ui-dur-2` `--ui-ease-out`，用 `@starting-style` 和 `transition-behavior: allow-discrete`；退场 `--ui-dur-1`。

- [ ] **Step 1: 演示页加 section「Dialog」**：`Open dialog` 打开 `title="Rename paper"`、`description="The new name appears in your library."`，内容是 TextField（label `Name`），底部 `Cancel`（secondary）和 `Save`（primary）；另一个按钮 `Open locked dialog` 打开 `dismissible={false}` 的对话框，只有底部按钮能关。对话框里放 Task 6 的菜单。
- [ ] **Step 2: 写浏览器测试** `dialog.spec.ts`
  - `opens modally with an accessible name`：`getByRole("dialog", { name: "Rename paper" })` 可见，有说明；页面背景上的 `More` 按钮点不到（`click({ trial: true })` 超时或 `elementFromPoint` 落在 `::backdrop` 上）。
  - `focus starts inside and returns to the opener`：打开后焦点在 `Name`；按 `Escape` 关闭后焦点回 `Open dialog`。
  - `Tab stays inside the dialog`：连按 Tab 6 次，焦点始终在对话框里。
  - `backdrop click closes; locked dialog ignores Escape and backdrop`。
  - `page scroll is locked while open`。
  在 `menu.spec.ts` 加：`menu inside dialog: Escape closes the menu first` —— 对话框里打开菜单，按 `Escape`：菜单关闭、对话框还在、焦点回对话框里的菜单按钮；再按 `Escape`：对话框关闭。
  Run → 先 FAIL；实现 → PASS。
- [ ] **Step 3: Commit** `git commit -m "新界面的对话框"`

---

### Task 8: 分段控件

**Files:**
- Create: `frontend/src/ui/SegmentedControl.tsx`, `frontend/src/ui/SegmentedControl.module.css`, `frontend/e2e-ui/segmented.spec.ts`
- Modify: `frontend/src/ui/index.ts`, `frontend/src/ui-kit/KitApp.tsx`

**Interfaces:**
- Produces：`SegmentedControl<V extends string>(props: { label: string; kind: "tabs" | "radio"; options: { value: V; label: string; icon?: LucideIcon; panelId?: string }[]; value: V; onChange: (value: V) => void; size?: "sm" | "md" })`。
  - `kind="tabs"`：容器 `role="tablist"`，项 `role="tab"`、`aria-selected`、`aria-controls={panelId}`、`id` 固定为 `${panelId}-tab`（面板用 `aria-labelledby` 指回来）。右侧面板的「导读 / 助手 / 翻译 / 笔记」用这个。
  - `kind="radio"`：容器 `role="radiogroup"`，项 `role="radio"`、`aria-checked`。设置里的「深色 / 浅色 / 跟随系统」用这个。
  - 两种都用 roving tabindex：只有选中项 `tabIndex=0`；左右方向键移动并立即选中（首尾循环），`Home`/`End`。
- 外观：容器底 `--ui-fill`、圆角 `--ui-r-pill`、内距 3px（写成 `calc(var(--ui-space-2) + 1px)`）；项高 `md` 28px、`sm` 24px，左右 `--ui-space-12`，字 `--ui-text-13`（`sm` 为 `--ui-text-12`）、`--ui-fg-2`；选中项字 `--ui-fg`，下面垫一块滑动的「滑块」：底 `--ui-elev`、`--ui-elev-1`、圆角 `--ui-r-pill`，用 `transform: translateX()` 和 `width` 跟随选中项，过渡 `--ui-dur-2` `--ui-ease-out`（首次渲染不播动画）。项文字单行省略。

- [ ] **Step 1: 演示页加 section「Segmented」**：一个 tabs（`Guide`、`Assistant`、`Translation`、`Notes`，各带一个面板）和一个 radio（`Dark`、`Light`、`System`）。
- [ ] **Step 2: 写浏览器测试** `segmented.spec.ts`
  - `tabs expose the tab pattern`：`getByRole("tab", { name: "Assistant" })` 点击后 `aria-selected="true"`，对应 `tabpanel` 可见且 `aria-labelledby` 指向它。
  - `arrow keys move and select with wrap`：从 `Notes` 按 `ArrowRight` 选中 `Guide`；只有选中项 `tabindex="0"`。
  - `radio kind uses radio roles`：`getByRole("radio", { name: "Light" })` 选中后 `aria-checked="true"`。
  - `thumb follows the selection`：选中 `Translation` 后，滑块的 `getBoundingClientRect()` 与该项的矩形左右误差 ≤ 1px（等过渡结束：测试里设 `reducedMotion: "reduce"`）。
  Run → 先 FAIL；实现 → PASS。
- [ ] **Step 3: Commit** `git commit -m "新界面的分段控件"`

---

### Task 9: 通知提示（Toast）

**Files:**
- Create: `frontend/src/ui/toast-store.ts`, `frontend/src/ui/toast-store.test.ts`, `frontend/src/ui/Toaster.tsx`, `frontend/src/ui/Toaster.module.css`, `frontend/e2e-ui/toast.spec.ts`
- Modify: `frontend/src/ui/index.ts`, `frontend/src/ui-kit/KitApp.tsx`

**Interfaces:**
- Produces（`toast-store.ts`，不依赖 React 和计时器，便于单元测试）：
  - `type ToastTone = "info" | "success" | "error"`
  - `interface ToastOptions { message: string; description?: string; tone?: ToastTone; action?: { label: string; onClick: () => void }; duration?: number }`
  - `interface ToastItem extends Required<Pick<ToastOptions, "message" | "tone">> { id: string; description?: string; action?: ToastOptions["action"]; duration: number | null }`
  - `createToastStore(): { add(o: ToastOptions): string; dismiss(id: string): void; list(): ToastItem[]; subscribe(fn: () => void): () => void }`
  - 规则：`duration` 默认 info/success 为 5000ms，error 为 `null`（不自动消失）；显式传入的 `duration` 优先；最多保留 3 条，超出时丢掉最旧的**非错误**提示，全是错误时丢最旧的；同一 `message` + `tone` 已在列表里时不重复添加，返回已有的 id。
- Produces（`Toaster.tsx`）：`toast: { show(o: ToastOptions): string; dismiss(id: string): void }`（模块级单例 store）、`Toaster()` 组件。
  - 容器 `popover="manual"`，每次新增提示时 `hidePopover()` 再 `showPopover()`，保证它在对话框之上；容器 `role="region"`、`aria-label={t("toast.region")}`。
  - 每条：error 为 `role="alert"`，其余 `role="status"`；右侧有关闭 IconButton（`label = t("common.dismiss")`）；有 `action` 时显示一个 `sm` secondary 按钮，点了执行并关闭这条。
  - 计时：鼠标悬停在容器上或焦点在容器里时暂停所有倒计时，离开后按剩余时间继续。
  - 位置：窗口底部居中，距底 `--ui-space-24`，条与条间距 `--ui-space-8`。外观：底 `--ui-elev`、`--ui-elev-2`、圆角 `--ui-r-16`、内距 `--ui-space-12` `--ui-space-16`、最大宽 420px；error 左侧图标 `CircleAlert` 用 `--ui-danger-text`，success 用 `Check` `--ui-success-text`。进场 `translateY(8px)`→0 + 淡入，`--ui-dur-2`。

- [ ] **Step 1: 写 store 的失败测试** `toast-store.test.ts`

```ts
it("errors do not expire by default", () => {
  const s = createToastStore();
  s.add({ message: "Import failed", tone: "error" });
  s.add({ message: "Saved", tone: "success" });
  expect(s.list().map((t) => t.duration)).toEqual([null, 5000]);
});
it("keeps at most three, dropping the oldest non-error first", () => {
  const s = createToastStore();
  s.add({ message: "e1", tone: "error" });
  s.add({ message: "i1" }); s.add({ message: "i2" }); s.add({ message: "i3" });
  expect(s.list().map((t) => t.message)).toEqual(["e1", "i2", "i3"]);
});
it("does not stack duplicates", () => {
  const s = createToastStore();
  const a = s.add({ message: "Offline", tone: "error" });
  expect(s.add({ message: "Offline", tone: "error" })).toBe(a);
  expect(s.list()).toHaveLength(1);
});
```
Run → FAIL；实现 → PASS。

- [ ] **Step 2: 实现 `Toaster`**，在 `KitApp` 根部挂一个 `<Toaster/>`；演示页加 section「Toast」：按钮 `Show info`（message `Copied`）、`Show error`（message `Import failed`，description `The file is not a PDF.`，action `Retry`，点了在页面上显示 `Retried`）、`Show over dialog`（先打开一个对话框再弹提示）。
- [ ] **Step 3: 写浏览器测试** `toast.spec.ts`（用 `page.clock.install()` 控制时间）
  - `info toasts expire after five seconds`：`Copied` 出现，`clock.runFor(4900)` 后还在，再 `runFor(200)` 后消失。
  - `error toasts stay until dismissed`：`Import failed` 是 `role="alert"`，`runFor(60000)` 后还在；点关闭按钮后消失。
  - `action runs and closes the toast`：点 `Retry` 后显示 `Retried`，提示消失。
  - `hover pauses the countdown`：悬停在提示上 `runFor(10000)` 后还在；移开后 `runFor(5100)` 消失。
  - `toast appears above an open dialog and is clickable`：`Show over dialog` 后提示的关闭按钮能点到（`click()` 成功，不被 `::backdrop` 挡住）。
  Run → PASS。
- [ ] **Step 4: Commit** `git commit -m "新界面的通知提示"`

---

### Task 10: 窗口外壳、卡片、侧栏，以及整页截图

**Files:**
- Create: `frontend/src/ui/Shell.tsx`, `frontend/src/ui/Shell.module.css`, `frontend/src/ui/Sidebar.tsx`, `frontend/src/ui/Sidebar.module.css`, `frontend/e2e-ui/shell.spec.ts`, `frontend/e2e-ui/screens.spec.ts`
- Modify: `frontend/src/ui/index.ts`, `frontend/src/ui-kit/KitApp.tsx`, `frontend/src/ui-kit/KitApp.module.css`

**Interfaces:**
- Consumes：`IconButton`、`Tooltip`、`SegmentedControl`、`useI18n`。
- Produces：
  - `Shell({ sidebar?: ReactNode; children: ReactNode })`：整窗口，`display: flex; gap: var(--ui-space-8); padding: var(--ui-space-8); height: 100dvh; background: var(--ui-bg-1)`；`children` 区域 `flex: 1; min-width: 0; display: flex; gap: var(--ui-space-8)`。
  - `Card({ as?: "section" | "div" | "main" | "aside"; className?: string; style?: CSSProperties; children: ReactNode; "aria-label"?: string; "aria-labelledby"?: string })`：底 `--ui-bg`、圆角 `--ui-r-16`、`--ui-elev-1`、`overflow: hidden`、`display: flex; flex-direction: column; min-width: 0`。
  - `CardHeader({ children: ReactNode })`：高 52px、左右 `--ui-space-16`、元素间距 `--ui-space-10`、`align-items: center`、不收缩。
  - `Sidebar({ label: string; collapsed: boolean; onCollapsedChange: (collapsed: boolean) => void; header?: ReactNode; footer?: ReactNode; children: ReactNode })`：`<nav aria-label={label}>`，宽 220px，收起后 56px（宽度过渡 `--ui-dur-3` `--ui-ease-in-out`），**没有自己的底色**（坐在 shell 上）。收起/展开按钮是 IconButton（`PanelLeftClose` / `PanelLeftOpen`，label 用 `sidebar.collapse` / `sidebar.expand`），`aria-expanded={!collapsed}`；快捷键 `mod+\`（Mac ⌘\，其他 Ctrl+\）。
  - `SidebarSection({ title?: string; children: ReactNode })`：标题 `--ui-text-12` `--ui-fg-3`，上内距 `--ui-space-16`；收起时标题隐藏。
  - `SidebarItem({ icon: LucideIcon; label: string; meta?: string; active?: boolean; dot?: boolean; onClick?: () => void; href?: string })`：高 `--ui-control-md`、左右 `--ui-space-8`、圆角 `--ui-r-8`、字 `--ui-fg-1`、图标 16px；悬停 `--ui-hover`；`active` 时底 `--ui-selected`、字 `--ui-fg`、`aria-current="page"`；`dot` 是 6px 的 `--ui-accent` 圆点带 3px `--ui-accent-soft` 光圈（「正在读」）；`meta` 在右侧 `--ui-text-12` `--ui-fg-3`。收起时只剩图标，`label` 进 Tooltip，无障碍名称不变。标签单行省略，被截断时悬停显示 Tooltip 全文。

- [ ] **Step 1: 演示页改成一个完整的示例窗口**：页面主体用 `Shell`，左边 `Sidebar`（项：`Import`、`Search`、`Reading`（dot、active）、`Library`、一个很长的英文标题 `A Remarkably Long Paper Title That Will Not Fit In The Sidebar`、底部 `Settings`），中间一张 `Card`（CardHeader 放论文标题和一个 IconButton），右边一张 400px 的 `Card`（顶部是 Task 8 的 tabs）。之前各任务的 section 移进中间卡片的可滚动区域。
- [ ] **Step 2: 写浏览器测试** `shell.spec.ts`
  - `cards float on the shell with an 8px gap`：两张卡片之间的水平间距等于 8px；卡片的 `border-radius` 为 `16px`；侧栏的背景是透明的。
  - `sidebar collapses with the button and the shortcut`：点收起后 `nav` 宽 56px、项只剩图标、`getByRole("button", { name: "Library" })` 仍可找到（演示页的条目都用 `onClick`，渲染成按钮）；按 `Control+\`（Linux CI）展开回 220px。
  - `active item is marked as current`：`Reading` 有 `aria-current="page"`。
  - `long English labels truncate without overflow`：切到 English 后，长标题那一项的 `scrollWidth > clientWidth`（被截断），但所在 `nav` 的 `scrollWidth === clientWidth`（没溢出）；悬停后 Tooltip 显示全文。另外，演示页的每个 `Button` 和每个分段项都满足 `scrollHeight <= clientHeight + 1`（文字不换行撑高）。
  Run → 先 FAIL；实现 → PASS。
- [ ] **Step 3: 写整页截图** `screens.spec.ts`

对 `light`/`dark` × `zh`/`en` 四种组合各截一张 1280×800 的整页图，再打开菜单、对话框、错误提示各截一张，用 `testInfo.attach()` 附到报告里（不做像素比对，供人工检查和 PR 描述使用）。同时断言页面上没有 `console.error` 和未捕获的异常（`page.on("pageerror")`、`page.on("console")`）。
Run: `npm --prefix frontend run test:ui` → 全部 PASS。

- [ ] **Step 4: 旧界面回归**

Run: `npm --prefix frontend run build` 后在后台跑 `cd frontend && npx playwright test`（整套约 5–8 分钟；单 worker；不要在跑的过程中再 build）→ 与 main 上的结果一致（全部通过）。

- [ ] **Step 5: Commit** `git commit -m "新界面的窗口外壳、卡片和侧栏"`

---

### Task 11: 故障注入假模型

**Files:**
- Create: `backend/devtools/__init__.py`（空）, `backend/devtools/fake_model.py`, `backend/tests/test_fake_model.py`

**Interfaces:**
- Produces（`backend/devtools/fake_model.py`）：
  - `class FakeModel`：OpenAI 兼容的本机假模型服务，给测试和本机手动验证用。
    - `__init__(self, reply: str | Callable[[list[dict]], str] = "ok", *, fault: Callable[[dict], str | None] | None = None, chunk_size: int = 8, chunk_delay: float = 0.0, slow_delay: float = 0.2, hang_seconds: float = 3600.0)`
    - `fault`：按请求体决定故障模式。返回一个模式名（如 `"fake-drop"`）时用它代替请求里的 `model`，返回 `None` 时照常按 `model` 处理。用来在同一个模型配置下只让某一类请求出错（比如只让导读请求断开）。
    - `start(self, port: int = 0) -> None`、`stop(self) -> None`，并支持 `with FakeModel(...) as fake:`。用 `http.server.ThreadingHTTPServer` 绑 `127.0.0.1`，在守护线程里跑。
    - `base_url: str`（`http://127.0.0.1:{port}/v1`）、`requests: list[dict]`（按顺序记下每个请求的 JSON 体）。
  - 路由：`POST /v1/chat/completions`（`stream: true` 时回 SSE，否则回普通 JSON），`GET /v1/models`（列出所有模式名）。
  - 故障模式由请求里的 `model` 决定（无状态配置，测试只要把模型名设成对应值）：

| `model` | 行为 |
| --- | --- |
| `fake-ok` | 正常回答 `reply`。流式：按 `chunk_size` 切成多个 `delta.content`，最后一块带 `finish_reason: "stop"` 和 `usage`，再发 `data: [DONE]` |
| `fake-slow` | 同上，每块之间等 `slow_delay` 秒 |
| `fake-hang` | 读完请求后 `hang_seconds` 秒内什么都不发 |
| `fake-drop` | 流式：发出前一半的块后直接关连接（没有 `finish_reason`、没有 `[DONE]`）；非流式：声明的 `Content-Length` 比实际发出的正文长，然后关连接 |
| `fake-malformed` | 流式：发一块正常内容后发一行 `data: {not json`；非流式：200、`content-type: application/json`，正文是 `<html>oops</html>` |
| `fake-429` / `fake-500` / `fake-401` / `fake-404` | 对应 HTTP 状态码，JSON 错误体；429 带 `Retry-After: 1` |
| `fake-length` | 正常内容，但 `finish_reason: "length"` |
| `fake-empty` | 内容为空字符串，`finish_reason: "stop"` |

  - 后缀 `x<N>`（如 `fake-429x2`、`fake-dropx1`）：同一个 `FakeModel` 实例上，这个模型名的前 N 次请求出故障，之后按 `fake-ok` 回答。用来测重试。
  - 命令行：`python -m backend.devtools.fake_model --port 8899 [--reply TEXT]`，打印 `base_url` 后一直运行（本机手动看界面怎么处理故障时用）。

- [ ] **Step 1: 写失败测试** `backend/tests/test_fake_model.py`（直接用 httpx 请求）
  - `test_ok_streams_the_reply_in_chunks_and_finishes`：流式拼起来等于 `reply`，有 `finish_reason == "stop"`，最后一行是 `[DONE]`；非流式 `choices[0].message.content == reply`。
  - `test_retry_suffix_fails_only_the_first_requests`：`fake-429x2` 连续请求三次，状态码依次是 429、429、200。
  - `test_drop_ends_the_stream_without_finishing`：收到至少一块内容、没有 `finish_reason`、没有 `[DONE]`，且收到的文字比 `reply` 短。
  - `test_hang_times_out_the_client`：`httpx.Client(timeout=0.3)` 请求 `fake-hang` 抛 `httpx.ReadTimeout`，耗时 < 2 秒（`hang_seconds` 设成 5，`stop()` 时要能立刻结束，不等它睡完）。
  - `test_requests_are_recorded`：`fake.requests[0]["model"] == "fake-ok"`。
  - `test_fault_hook_overrides_the_model_name`：`FakeModel(fault=lambda body: "fake-500" if body["messages"][0]["content"] == "boom" else None)`，系统消息为 `boom` 的请求得到 500，其他请求照常 200。
  Run: `.venv/bin/python -m pytest -q backend/tests/test_fake_model.py` → FAIL。
- [ ] **Step 2: 实现 `fake_model.py`** → PASS。
- [ ] **Step 3: Commit** `git commit -m "测试用的故障注入假模型"`

---

### Task 12: 模型出错时给出明确原因

**Files:**
- Create: `backend/model_errors.py`, `backend/tests/test_model_faults.py`
- Modify: `backend/translation_settings.py:340-458`（`_post_cancellable`、`_complete`）, `backend/model_stream.py`

**Interfaces:**
- Consumes：`FakeModel`（Task 11）。
- Produces（`backend/model_errors.py`）：
  - `ModelErrorCode = Literal["timeout", "connection", "interrupted", "malformed", "rate_limited", "server_error", "auth", "not_found", "bad_request", "truncated", "empty", "too_long"]`
  - `class ModelError(ValueError)`：`__init__(self, code: ModelErrorCode, message: str)`，属性 `code`。继承 `ValueError`，所以现有所有 `except ValueError` 和 `str(error)` 的用法不变。第 2 阶段会把 `code` 存进数据库、在界面上按文案表显示。
  - `from_status(status: int) -> ModelError`
  - `from_transport(error: Exception) -> ModelError`
- Produces（`translation_settings.py`）：模块常量 `MODEL_TIMEOUT_SECONDS = 300`、`MODEL_CONNECT_SECONDS = 15`，两处 `httpx.Timeout(...)` 都改用它们（测试里改小）。

文案（每条都说清「发生了什么、怎么办」；**带 HTTP 状态码的必须保留 `HTTP {status}` 字样**，因为 `translation_memory.request()`、`preparation_worker` 的重试判断和 `direct_runs.TRANSIENT` 都按这段文字匹配）：

| code | 触发 | 文案 |
| --- | --- | --- |
| `rate_limited` | 429 | `模型服务返回 HTTP 429：请求太频繁或额度用完了，请稍后重试` |
| `auth` | 401、403 | `模型服务返回 HTTP {status}：API 密钥无效或没有权限，请在设置里检查密钥` |
| `not_found` | 404 | `模型服务返回 HTTP 404：找不到这个模型或地址，请在设置里检查模型名称和地址` |
| `server_error` | 5xx；SSE 里出现 `error` | `模型服务返回 HTTP {status}：服务暂时出错，请稍后重试`；SSE 的保持 `模型流式响应失败，请重试` |
| `bad_request` | 其他 4xx | `模型服务返回 HTTP {status}：请求被拒绝，请检查模型配置后重试` |
| `timeout` | `httpx.ReadTimeout`、`WriteTimeout`、`PoolTimeout` | `模型服务超过 {MODEL_TIMEOUT_SECONDS} 秒没有回应，已停止；请稍后重试或换一个模型` |
| `connection` | `httpx.ConnectError`、`ConnectTimeout`、其他 `httpx.TransportError` | `连不上模型服务，请检查地址和网络后重试` |
| `interrupted` | `httpx.RemoteProtocolError`、`httpx.ReadError`；流结束却没有 `finish_reason` | `模型的回答中途断开了，请重试` |
| `malformed` | `json.JSONDecodeError`、`KeyError`、`IndexError`、`TypeError` | `模型服务返回的内容无法识别，请确认地址是 OpenAI 兼容接口后重试` |
| `truncated` | `finish_reason == "length"` / `stop_reason == "max_tokens"` | 保持 `模型输出被截断，请换用支持更长输出的模型` |
| `empty` | 去掉思考段后为空 | `模型返回空内容，请重试或换一个模型` |
| `too_long` | 超过 2,000,000 字符 | 保持 `模型返回内容过长` |

「翻译已停止」（用户主动取消）保持原样的普通 `ValueError`，不归入 `ModelError`（别处按这句文字判断取消）。文案里不再出现异常类名。

- [ ] **Step 1: 写失败测试** `backend/tests/test_model_faults.py`

公共部分：一个 `fake` fixture（`with FakeModel(reply="你好，世界。这是一段测试回答。") as m: yield m`）；一个 `cfg(fake, model)` 返回 `{"base_url": fake.base_url, "model": model, "api_key": "test", "protocol": "openai"}`；`monkeypatch.setattr(translation_settings, "validate_endpoint", lambda v: v.rstrip("/"))`；把 `MODEL_TIMEOUT_SECONDS` 改成 `0.5`。每个用例分别跑非流式（`complete(cfg, "s", "c")`）和流式（`complete(cfg, "s", "c", cancelled=lambda: False, on_delta=deltas.append)`）两种调用，用 `pytest.mark.parametrize("streamed", [False, True])`。

```python
@pytest.mark.parametrize(
    "model, code, needle",
    [
        ("fake-429", "rate_limited", "HTTP 429"),
        ("fake-500", "server_error", "HTTP 500"),
        ("fake-401", "auth", "HTTP 401"),
        ("fake-404", "not_found", "HTTP 404"),
        ("fake-hang", "timeout", "秒没有回应"),
        ("fake-drop", "interrupted", "中途断开"),
        ("fake-malformed", "malformed", "无法识别"),
        ("fake-length", "truncated", "截断"),
        ("fake-empty", "empty", "空内容"),
    ],
)
def test_each_fault_has_a_code_and_a_plain_reason(fake, monkeypatch, streamed, model, code, needle): ...
    # 断言：抛 ModelError，error.code == code，needle in str(error)，
    # re.search(r"[A-Z][a-z]+(Error|Exception|Timeout)", str(error)) is None，耗时 < 3 秒。

def test_a_dropped_stream_has_already_delivered_its_partial_text(fake, monkeypatch): ...
    # 流式 fake-drop：deltas 非空，"".join(deltas) 是 reply 的前缀。

def test_an_unreachable_service_is_a_connection_error(monkeypatch): ...
    # base_url 指向一个刚关闭的端口：code == "connection"。

def test_a_healthy_model_still_answers(fake, monkeypatch, streamed): ...
    # fake-ok 返回 reply；流式时 "".join(deltas) == reply。
```
Run: `.venv/bin/python -m pytest -q backend/tests/test_model_faults.py` → FAIL。

- [ ] **Step 2: 实现 `model_errors.py`，改 `_complete`、`_post_cancellable`、`streamed_post`**：非 200 用 `from_status`；`except` 分支用 `from_transport`；`streamed_post` 流结束没有 `finish_reason` 时抛 `ModelError("interrupted", …)`，SSE `error` 抛 `ModelError("server_error", "模型流式响应失败，请重试")`，过长抛 `ModelError("too_long", …)`，`json.loads` 失败抛 `ModelError("malformed", …)`。
- [ ] **Step 3: 跑新测试** → PASS。
- [ ] **Step 4: 改过文案后跑整套后端测试**

先 `grep -rn "请检查配置、额度或稍后重试\|模型服务连接或响应失败\|模型响应中断\|模型返回空内容" backend frontend/src frontend/e2e`，把依赖旧文字的测试和前端映射改成新文字。
Run: `.venv/bin/python -m pytest -q` → 全部 PASS（特别是 `test_direct_runs.py` 的重试用例：它们靠 `HTTP 5xx`、`HTTP 429` 字样判断）。

- [ ] **Step 5: 用假模型测直译路径（划选翻译、页面翻译）**，加到 `test_model_faults.py`：

用 `backend/tests/test_direct_runs.py` 里的 `selection_run(env)`、`work(app, run_id)`。`backend.agent_worker` 里的 `read_config` 换成返回假模型配置（`base_url`、`model` 指向假模型，其余字段照抄 `configure()` 写入的那份；参照 `backend/tests/test_reading_artifacts.py:73` 的 `run_fixture_model`），`backend.agent_worker`、`backend.direct_runs`、`backend.translation_settings` 三处导入的 `validate_endpoint` 都换成原样返回；`direct_runs.RETRY_SECONDS` 设为 0。
  - `test_selection_translation_that_drops_keeps_the_partial_answer`：模型 `fake-drop` → `AgentRun.status == "failed"`，`error` 含「中途断开」，`response` 非空且是假模型回答的前缀。
  - `test_selection_translation_retries_a_rate_limit_once`：模型 `fake-429x1` → `completed`，`len(fake.requests) == 2`。
  - `test_selection_translation_that_hangs_ends`：模型 `fake-hang`（超时 0.5 秒）→ 状态不是 `queued`/`running`，是 `failed`，`error` 含「秒没有回应」。
  Run → PASS（若某条暴露出现有代码的问题，在本任务里修好，不留 xfail）。

- [ ] **Step 6: Commit** `git commit -m "模型出错时给出明确原因"`

---

### Task 13: 助手（Pi 运行时）和自动导读在故障下都能结束、保留已完成的部分

**Files:**
- Modify: `backend/tests/test_model_faults.py`
- Modify（视测试结果）: `backend/preparation_worker.py`、`backend/agent_worker.py`、`agent-runtime/runner.mjs`

**Interfaces:**
- Consumes：`FakeModel`（Task 11）、`ModelError`（Task 12）。

- [ ] **Step 1: 助手路径的测试**

用 `selection_run(env, action="explain")`（走 Pi 运行时，不是直译），按 `run_fixture_model` 的方式把 `backend.agent_worker.read_config`、`backend.agent_worker.validate_endpoint` 换成假模型（`env` 的 `Settings.testing` 为真，Node 端 `providerFetch` 允许 `http://127.0.0.1`）。
  - `test_agent_answer_that_drops_ends_failed_and_keeps_what_streamed`：`fake-drop` → 状态 `failed`；`error` 非空且不含异常类名、不含堆栈（没有 `at ` 开头的行、没有 `Traceback`）；`response` 是假模型回答的前缀且非空。
  - `test_agent_server_error_ends_failed`：`fake-500` → `failed`，`error` 非空。
  - `test_agent_hang_ends_within_the_budget`：把 `backend.agent_budget.EXECUTION_SECONDS` 改成 3、`WALL_SECONDS` 改成 6，`fake-hang` → `work()` 在 15 秒内返回，状态 `failed`。
  Run → 记录结果。失败的条目就是要修的：在 `agent_worker.py` 或 `runner.mjs` 里修，直到 PASS。

- [ ] **Step 2: 自动导读路径的测试**

用 `backend/tests/test_paper_preparation.py::test_existing_guide_and_pages_do_not_create_chat_or_repeat_models` 里同样的准备方式（`fixture(env)`、`reconcile`、把 `row.status` 设为 `running` 后 `process(...)`），但不替换 `complete`，而是让 `read_config` 返回假模型配置、`translation_settings.validate_endpoint` 原样返回；`reply` 用一个按系统提示词分派的函数，返回那条测试里的 `guide` 和页面翻译 JSON。
  - `test_preparation_guide_failure_keeps_page_translations`：模型名 `fake-ok`，`fault` 函数在系统提示词不是页面翻译（不以 `Translate each`、`You translate one page` 开头）时返回 `"fake-drop"` → `PaperPreparation.status == "failed"`，`stage == "准备未完成，已完成内容保留"`，`error` 含「中途断开」，页面翻译的 `ReadingArtifact` 已保存。
  - `test_preparation_rate_limit_is_retried`：`fake-429x2` → 最终 `completed`。
  Run → PASS（失败就在 `preparation_worker.py` 里修）。

- [ ] **Step 3: 跑 Node 端测试和整套后端测试**

Run: `npm --prefix agent-runtime test` → PASS；`.venv/bin/python -m pytest -q` → PASS。

- [ ] **Step 4: Commit** `git commit -m "助手和自动导读在模型故障下的收尾测试"`

---

### Task 14: 「难导入」样本集

**Files:**
- Create: `backend/tests/hard_pdfs.py`, `backend/tests/test_hard_imports.py`
- Modify: `backend/media.py`, `backend/main.py:128-159`（`detect`）, `backend/translations.py:96-166`（`import_arxiv_paper`）, `backend/arxiv_import.py`（`download`）, `backend/preparation_worker.py:170-172`, `backend/agent_reading.py:46-48`, `backend/agent_tools.py:510-512`, `backend/requirements.txt`, `frontend/src/api.ts:96-99`, `NOTICE.md`

**Interfaces:**
- Produces（`backend/tests/hard_pdfs.py`，测试时现场生成，不提交二进制文件）：
  - `text_pdf(pages: int = 3) -> bytes`（每页一行 `Evidence on page N`，复用 `backend/tests/test_agents.py:452` 的 `pdf_bytes` 的写法）
  - `image_only_pdf(pages: int = 2) -> bytes`（用 Pillow 画一张带字的图、存成 PDF，没有文字层）
  - `mixed_pdf(text_pages: int = 3, image_page: int = 2) -> bytes`（第 `image_page` 页没有文字层）
  - `owner_locked_pdf(algorithm: str = "AES-128") -> bytes`（只有所有者密码、用户密码为空：出版社 PDF 常见，能直接打开）
  - `password_pdf() -> bytes`（需要用户密码）
  - `truncated_pdf() -> bytes`（正常 PDF 截掉后 40%）
  - `junk_prefixed_pdf() -> bytes`（`%PDF-` 前面有几个字节的垃圾，规范允许在前 1024 字节内）
  - `not_a_pdf() -> bytes`（一段 HTML）
  - `many_pages_pdf(pages: int = 3001) -> bytes`（空白页）
- Produces：上传接口新的 422 文案（英文，前端映射成中文，沿用现有做法）：`"Encrypted PDF"`、`"Unreadable PDF"`、`"Not a PDF"`、`"Too many pages"`；图片等其他媒体仍用原来的 `"Invalid, encrypted, oversized, or unsupported media"`。
- Produces（`arxiv_import.py`）：`class ArxivNotFound(ValueError)`，`download()` 遇到 404、410 时抛它（文案 `arXiv 上找不到这篇论文（或这个版本），请检查编号`），不重试。

期望结果（这张表就是测试的内容）：

| 样本 | 上传结果 | 之后 |
| --- | --- | --- |
| `text_pdf` | 200，`mime == "application/pdf"`，`pages == 3` | 自动准备正常完成 |
| `junk_prefixed_pdf` | 200，PDF | — |
| `owner_locked_pdf("AES-128")`、`owner_locked_pdf("RC4-128")` | 200，PDF | 助手的 `read_file` 能读出文字（`agent_reading` 不再因 `is_encrypted` 拒绝） |
| `password_pdf` | 422 `Encrypted PDF` | — |
| `truncated_pdf` | 422 `Unreadable PDF` | — |
| `not_a_pdf`，文件名 `paper.pdf` | 422 `Not a PDF` | — |
| `not_a_pdf`，文件名 `notes.html` | 200，`application/octet-stream`（附件照旧可存） | — |
| `many_pages_pdf(3001)` | 422 `Too many pages` | — |
| 空文件 | 422 `Empty file`（已有） | — |
| `image_only_pdf` | 200，PDF | 自动准备 `failed`，`error == "这篇论文没有文字层（可能是扫描版），自动导读需要 OCR；原文仍可阅读"`，不会停在 `running` |
| `mixed_pdf` | 200，PDF | 自动准备**完成**：没有文字层的那一页跳过页面翻译，其余页照常；导读照常生成 |

arXiv（用 `monkeypatch.setattr(arxiv_import.httpx, "Client", …)` 换成 `httpx.MockTransport`，按请求路径回应；`arxiv_import.time.sleep` 换成空函数，跳过 3 秒的请求间隔；参照 `backend/tests/test_translation.py:357`）：

| 情况 | 期望 |
| --- | --- |
| 编号不存在（API 返回空结果，`/abs/` 返回 404） | 422，`arXiv 上找不到这篇论文（或这个版本），请检查编号` |
| 版本不存在（`2401.00001v9`，API 返回 v2，`/abs/…v9` 返回 404） | 同上 |
| 元数据阶段网络中断（连续 3 次 `httpx.ConnectError`） | 422，`arXiv 下载连接中断或超时，已重试 3 次，请稍后重试`（把 `ValueError` 的文案原样传出，不再统一成「无法获取 arXiv 论文」） |
| `/pdf/` 返回 404（只有 HTML 版） | 422，`arXiv 没有提供这篇论文的 PDF，可能还在生成或只有网页版` |
| `/pdf/` 连续 503 | 502，`原版 PDF 下载失败，请重试；未保存本次导入`（不变） |
| `/pdf/` 返回 `password_pdf()` | 422 `Encrypted PDF`（现在会被错误地变成 502） |
| 任何失败 | 数据库里没有留下这次导入的论文（回滚） |

- [ ] **Step 1: 写 `hard_pdfs.py` 和失败测试** `test_hard_imports.py`：上传类用 `paper(a)` 建论文，按 `attach()` 的方式发 multipart，但直接断言状态码和 `detail`；自动准备类沿用 Task 13 Step 2 的准备方式（`complete` 用 `test_paper_preparation.py` 里那个分派函数替换即可，这里不需要假模型）；arXiv 类调 `POST /api/v1/import/arxiv`（`{"url": "..."}`）。
Run: `.venv/bin/python -m pytest -q backend/tests/test_hard_imports.py` → 记录哪些 FAIL（预计：owner_locked、junk_prefixed、not_a_pdf、truncated/password/too-many 的具体文案、mixed、image_only 文案、arXiv 404 与加密的几条）。

- [ ] **Step 2: 改实现**
  - `requirements.txt` 加 `cryptography`，钉在发布满两周的最新版（`pip index versions cryptography`，看 PyPI 发布日期）；pypdf 读 AES 加密的 PDF 需要它。`NOTICE.md` 后端依赖表加上（Apache-2.0 OR BSD-3-Clause）。
  - `media.py`：PDF 改用 pypdfium2 检查（`pdfium.PdfDocument(raw)`；报错信息含 `password` 为加密、其余为无法读取；页数不在 1–3000 为页数过多），出错时把原因码（`encrypted`、`unreadable`、`too_many_pages`）写到 stderr 的最后一行，`main.py` 的 `detect` 读这个原因码，分别返回上面的四种 422 文案。资源限制保持不变。
  - `detect`：前 1024 字节里出现 `%PDF-` 就按 PDF 检查；扩展名是 `.pdf` 但不是 PDF 时返回 422 `Not a PDF`。
  - `agent_reading.py`、`agent_tools.py`：`is_encrypted` 只在空密码也解不开时才拒绝（`pdf.decrypt("") == PasswordType.NOT_DECRYPTED`）。
  - `preparation_worker.py:170-172`：所有页都没有文字时才失败（新文案见上表）；部分页没有文字时，只对有文字的页做页面翻译，`total` 按有文字的页数算，导读用全部有文字的页。
  - `arxiv_import.download`：404、410 抛 `ArxivNotFound`；`import_arxiv_paper`：元数据阶段 `ArxivNotFound` → 422 它的文案，其他 `ValueError` → 422 原样文案，其余异常 → 422 原来的「无法获取 arXiv 论文，请检查链接或稍后重试」；PDF 阶段 `ArxivNotFound` → 422「arXiv 没有提供这篇论文的 PDF，可能还在生成或只有网页版」，`HTTPException`（来自 `detect`）原样抛出，`StorageBudgetExceeded` 原样抛出，其余 → 502（不变）。
  - `frontend/src/api.ts` 的错误映射表加四条：`/^encrypted pdf$/i` → `文件已加密，需要密码才能打开；请去掉密码后再导入`，`/^unreadable pdf$/i` → `文件已损坏或不完整，无法读取`，`/^not a pdf$/i` → `这个文件不是 PDF，请确认后重新导入`，`/^too many pages$/i` → `PDF 超过 3000 页，无法导入`。

- [ ] **Step 3: 跑测试**

Run: `.venv/bin/python -m pytest -q backend/tests/test_hard_imports.py` → PASS；`.venv/bin/python -m pytest -q` → 全部 PASS；`npm --prefix frontend run check` → 通过。

- [ ] **Step 4: Commit** `git commit -m "「难导入」样本集，以及它发现的导入问题"`

---

## 收尾

- [ ] 前端：`npm --prefix frontend run test:unit`、`npm --prefix frontend run test:ui`、`npm --prefix frontend run check`、`npm --prefix frontend run build` 全部通过；后台跑一遍旧界面整套 `npx playwright test`，全部通过。
- [ ] 后端：`.venv/bin/python -m pytest -q`、`npm --prefix agent-runtime test`、`.venv/bin/python scripts/verify_lifecycle.py` 全部通过。
- [ ] `CHANGELOG.md` 的「未发布」下记：新界面的地基（只在演示页可见，用户界面没有变化）；导入：只有所有者密码的 PDF 现在能导入，加密、损坏、不是 PDF、页数过多分别给出原因；有个别扫描页的论文也能自动准备；arXiv 编号或版本不存在、只有网页版时给出明确原因；模型出错时说明原因（超时、断开、限流、密钥无效等）。
- [ ] 推分支、开 PR（描述里附 `screens.spec.ts` 的四张整页截图），CI 五项全绿后 squash 合并。本阶段没有用户可见的界面变化，但导入和模型出错的行为变了：合并后按发布流程更新云端版（备份 → 部署 → 健康检查 → 用一份 `owner_locked_pdf` 实测上传）。
