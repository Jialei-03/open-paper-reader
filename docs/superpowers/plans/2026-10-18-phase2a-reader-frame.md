# 第 2 阶段（一）「阅读器框架」实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在新界面里把一篇论文打开、读顺：窗口外壳、论文卡片、PDF 显示（翻页、缩放、查找、目录与缩略图）、已有的高亮与手写批注、PDF 内链接与悬停预览、从链接跳到原文那一句，以及右侧面板的空壳。

**Architecture:** 新阅读器是一个独立的屏幕 `ReaderScreen`，挂在 `#read/<paperId>`（只能直接输入地址打开，旧界面不链接它），等第 2 阶段第 4 个 PR 再把 `#paper/` 切过来并删除旧阅读器。PDF 显示是从旧 `PdfView.tsx` 移植出来的一个「引擎」（文档加载、懒渲染页面、文字层、滚动定位、缩放），放在 `frontend/src/reader/engine/`，只依赖 pdf.js 和旧代码里**不含界面**的 hook 与工具函数；所有界面用 `frontend/src/ui/` 的组件和 `--ui-*` 令牌重写。旧 `PdfView` 在这个 PR 里不动。

**不在本 PR：** 划选菜单、浮动输入框、助手、导读、笔记、「原文 / 对照 / 译文」（第 2 阶段后面三个 PR）；阅读状态（在读 / 已读）放到第 3 阶段的文库；旋转页面不再保留。

**Tech Stack:** React 19、TypeScript、pdfjs-dist 5.4.149、CSS Modules；测试：Playwright（旧整套的后端服务器 `scripts/e2e_server.py`，新规格放 `frontend/e2e/reader/`）、Vitest。

**Spec:** `docs/superpowers/specs/2026-10-18-open-paper-reader/design.md`（第 6.3 节阅读器、第 7 节视觉语言、第 9 节稳定性、第 10 节第 2 阶段）。第 1 阶段遗留事项：`docs/superpowers/specs/2026-10-18-open-paper-reader/phase1-carryover.md`。

## Global Constraints

- 新代码不引入 shadcn/ui、Radix、Tailwind 类名、class-variance-authority、tailwind-merge、cmdk、sonner；界面只用 `frontend/src/ui/` 的组件（需要新组件时加到 `frontend/src/ui/`，并在演示页加一节、加测试）。
- 可以复用旧代码里**不渲染界面**的模块：`lib/pdf-render-retention.ts`、`lib/pdf-selection.ts`、`lib/pdf-rotation.ts`、`lib/pdf-region.ts`、`lib/reference.ts`、`lib/use-pdf-zoom.ts`、`lib/use-pdf-touch-pan.ts`、`lib/recent-papers.ts`、`lib/file-download.ts`、`lib/paper-file-name.ts`，以及 `features/` 里只导出 hook 和纯函数的部分（`usePdfSearch`、`usePdfSearchHighlight`、`usePdfLinks`、`followPdfLink`、`safePdfUrl`、`usePdfAnnotations`、`usePdfInk`）。凡是导入了 `@/components/ui`、`sonner`、`../components/ReaderControls` 的组件一律不复用，照它的逻辑在新代码里重写。
- 样式只用 `--ui-*` 令牌（组件专属的尺寸按规则 R4 写成模块顶部的局部变量）；中文只用 400、600 字重；动效只动位移、透明度、颜色。
- 所有可见文字和无障碍名称走文案表（`frontend/src/i18n/messages/{en,zh}.ts`），中英都写。后端返回的中文错误文字可以原样显示。
- 文字对比度在深浅两套主题下 ≥ 4.5:1；`--ui-fg-3` 只用在纯色底上（规则 R6）。
- 旧界面（`#paper/` 的旧阅读器及其他页面）外观和行为不变，旧 `frontend/e2e/` 整套照常通过。新阅读器不出现在旧界面的任何链接里。
- 新阅读器不加载 `ui/reset.css`（旧界面靠 Tailwind 的 preflight，全局 reset 会改变旧界面）；基础样式由新屏幕的根元素自己设（见 Task 1）。
- 提交身份用仓库配置的 Jialei；不加 Co-Authored-By；只 `git add` 本任务的文件；走分支和 PR，CI 全绿后 squash 合并。
- 生产环境是 Python 3.11（本 PR 把 CI 也改到 3.11，见 Task 7）。

## Review Focus

1. **很长的论文**（几百页）：打开不卡，只渲染看得到附近的页，内存不会随翻页一直涨。→ Task 2 的 `only nearby pages keep a rendered canvas`。
2. **窗口很窄或很宽、缩放到 300% 再缩回来**：页面不错位，当前页码不跳，文字层和画布对齐。→ Task 2 的 `text layer stays aligned with the canvas after zooming` 和 Task 3 的 `page number survives zoom`。
3. **加载失败**（文件丢了、网络断了、PDF 损坏）：卡片里说明原因并能重试，整个屏幕不白。→ Task 1 的 `a failing region shows a retry instead of a blank screen` 和 Task 2 的 `a PDF that fails to load explains and retries`。
4. **从链接打开时带着引用**：地址里的 `quote` 找不到（文字层里没有这句）时，至少跳到那一页，不报错。→ Task 4 的 `a quote that cannot be found still lands on its page`。
5. **深色模式下读论文**：纸面压暗但文字清楚，高亮颜色在深色纸面上仍然看得出。→ Task 2 的 `dark theme dims the paper` 和 Task 4 的 `saved highlights are visible in both themes`。

---

## 文件结构

```
frontend/src/reader/
  ReaderScreen.tsx  ReaderScreen.module.css   屏幕：外壳 + 侧栏 + 论文卡片 + 右侧面板
  ReaderSidebar.tsx                            侧栏内容（文库、正在读、设置）
  RegionBoundary.tsx                           区块级错误边界（不白屏）
  usePaper.ts                                  读论文、文件、记住最近阅读和上次读到的页
  PaperHeader.tsx  PaperHeader.module.css      卡片头：标题、页码、缩放、查找、目录、更多
  FindBar.tsx  FindBar.module.css
  OutlinePanel.tsx  OutlinePanel.module.css    目录 / 页面缩略图
  RightPanel.tsx  RightPanel.module.css        导读 / 助手 / 笔记 分段切换的空壳
  route.ts  route.test.ts                      #read/ 地址的解析与生成（纯函数）
  engine/
    usePdfDocument.ts                          加载文档与进度
    PdfPages.tsx  PdfPages.module.css          滚动容器、页面列表、页码跟踪、控制器
    PdfPageView.tsx                            单页：画布、文字层、各种覆盖层
    layers/AnnotationLayer.tsx  layers/InkLayer.tsx  layers/LinkLayer.tsx  layers/layers.module.css
    LinkPreview.tsx  LinkPreview.module.css    链接悬停预览
    pdf-engine.css                             文字层、引用高亮等用固定类名的样式（作用域 .opr-pdf）
    page-memory.ts  page-memory.test.ts        每台设备记住每篇论文读到的页
frontend/src/ui/
  ErrorBoundary.tsx  ErrorBoundary.module.css  通用错误边界（RegionBoundary 用它）
frontend/src/Workspace.tsx                     加 #read/ 分支
frontend/src/i18n/messages/en.ts  zh.ts       新文案
frontend/e2e/reader/                            新阅读器的浏览器测试
  fixtures.ts  open.spec.ts  engine.spec.ts  header.spec.ts  layers.spec.ts  screens.spec.ts
.github/workflows/verify.yml                    Python 3.11
docs/DEVELOPMENT.md                              说明 #read/ 和新规格目录
```

---

### Task 1: `#read/` 路由、屏幕骨架、错误边界

**Files:**
- Create: `frontend/src/reader/route.ts`, `frontend/src/reader/route.test.ts`, `frontend/src/reader/ReaderScreen.tsx`, `frontend/src/reader/ReaderScreen.module.css`, `frontend/src/reader/ReaderSidebar.tsx`, `frontend/src/reader/RegionBoundary.tsx`, `frontend/src/reader/usePaper.ts`, `frontend/src/reader/RightPanel.tsx`, `frontend/src/reader/RightPanel.module.css`, `frontend/src/ui/ErrorBoundary.tsx`, `frontend/src/ui/ErrorBoundary.module.css`, `frontend/e2e/reader/fixtures.ts`, `frontend/e2e/reader/open.spec.ts`
- Modify: `frontend/src/Workspace.tsx`, `frontend/src/ui/index.ts`, `frontend/src/ui-kit/KitApp.tsx`（ErrorBoundary 演示）, `frontend/src/i18n/messages/{en,zh}.ts`

**Interfaces:**
- Produces（`route.ts`，纯函数）：
  - `type ReaderRoute = { paperId: string; fileId?: string; page?: number; quote?: string; prefix?: string; rect?: string }`
  - `parseReaderRoute(hash: string): ReaderRoute | null`：接受 `read/<id>?file=…&page=…&quote=…&prefix=…&rect=…`（不带 `#`），`id` 必须符合 `^[a-zA-Z0-9-]{1,64}$`，`page` 取正整数，其他参数原样（URL 解码）；不是 `read/` 开头返回 `null`。
  - `readerHash(route: ReaderRoute): string`：反过来生成 `#read/...`，只写有值的参数，顺序固定 `file, page, quote, prefix, rect`。
- Produces（`usePaper.ts`）：`usePaper(paperId: string): { paper: Paper | null; files: SourceFile[]; pdf: SourceFile | null; error: string; loading: boolean; retry(): void }`。请求 `api<Paper>("/papers/" + id)` 和 `api<SourceFile[]>("/papers/" + id + "/files")`（`frontend/src/api.ts` 的 `api`）。`pdf` = 路由指定的文件，否则第一个 `mime === "application/pdf"` 的文件。404 时 `error` 用文案 `reader.notFound`。
- Produces（`ui/ErrorBoundary.tsx`）：`ErrorBoundary({ children, label: string, onReset?: () => void })`：子树抛错时显示一张小卡片（`role="alert"`），文字 `t("errorBoundary.title", { label })`（「{label}出了问题」/ "{label} ran into a problem"）和「重试」按钮（`t("common.retry")`）；点重试时重新挂载子树并调用 `onReset`。错误写到 `console.error` 一次（开发时可见）。
- Produces（`ReaderScreen.tsx`）：`ReaderScreen({ paperId: string; route: ReaderRoute; go: (hash: string) => void; owner: string; papers: Paper[] })`。布局：`Shell`（侧栏 = `ReaderSidebar`）里两张卡片：论文卡片（Task 2–5 填内容，本任务先放标题和占位）和右侧面板 `RightPanel`。三个区块（侧栏、论文卡片、右侧面板）各包一层 `RegionBoundary`。
- Produces（`RightPanel.tsx`）：`RightPanel({ paperId: string })`：顶部 `SegmentedControl kind="tabs"`，三个标签「导读 / 助手 / 笔记」（`reader.tab.guide|assistant|notes`），面板里先放一句「这里将显示……」的占位说明（文案表里写清楚，第 2 阶段后续 PR 替换）。宽度 400px（局部变量），窗口宽度 < 1100px 时右侧面板收起成卡片头里的一个按钮（本任务先实现收起显示的切换按钮，点开后右侧面板浮在论文卡片上方，`Esc` 或再点关闭）。

根元素的基础样式（不能用 `ui/reset.css`，见全局约束）：`ReaderScreen.module.css` 的 `.root` 设 `font: var(--ui-text-13)/var(--ui-leading) var(--ui-font-sans); color: var(--ui-fg); background: var(--ui-bg-1); height: 100dvh;`，并用 `:where(.root) :focus-visible { outline: none; box-shadow: var(--ui-focus-ring); }`。

`Workspace.tsx`：`section === "read"` 时在最外层直接返回 `<I18nProvider><ReaderScreen …/><Toaster/></I18nProvider>`（不渲染旧的侧栏、旧助手面板和 sonner），`ReaderScreen` 用 `lazy()` 单独分包；`owner` 用当前用户 id，`papers` 用 Workspace 已有的论文列表。进入时调用 `rememberPaper(owner, paperId)`（和旧阅读器一样）。

`ReaderSidebar`：顶部一行（52px）只有收起按钮；「文库」（链接 `#library`）；分组「正在读」列出 `recentPapers(owner)` 里最近 5 篇（标题来自 `papers`，当前这篇 `active` 并带圆点）；底部「设置」（`#settings`）。条目点击用 `go`。

- [ ] **Step 1: 写 `route.test.ts`（失败）**

```ts
it("parses a reader route with its reference", () => {
  expect(parseReaderRoute("read/p-1?file=f-2&page=3&quote=Attention%20is&prefix=x")).toEqual({
    paperId: "p-1", fileId: "f-2", page: 3, quote: "Attention is", prefix: "x",
  });
});
it("rejects other routes and bad ids", () => {
  expect(parseReaderRoute("paper/p-1")).toBeNull();
  expect(parseReaderRoute("read/../x")).toBeNull();
});
it("ignores a page that is not a positive integer", () => {
  expect(parseReaderRoute("read/p?page=0")).toEqual({ paperId: "p" });
  expect(parseReaderRoute("read/p?page=2.5")).toEqual({ paperId: "p" });
});
it("round-trips through readerHash", () => {
  const route = { paperId: "p", fileId: "f", page: 4, quote: "a & b", prefix: "c" };
  expect(parseReaderRoute(readerHash(route).slice(1))).toEqual(route);
});
```
Run: `npm --prefix frontend run test:unit` → FAIL；实现 `route.ts` → PASS。

- [ ] **Step 2: 写浏览器测试 `e2e/reader/fixtures.ts` 和 `open.spec.ts`（失败）**

`fixtures.ts` 导出 `signIn(page)`（照现有规格的登录方式，用 `E2E_TEST_PASSWORD` 登录 alice）、`createPaperWithPdf(page, { title, pages, links? }): Promise<{ paperId: string; fileId: string }>`（用 `frontend/e2e/fixtures/pdf.ts` 的 `testPdf` 生成 PDF，经 `POST /api/v1/papers` 和 `POST /api/v1/papers/{id}/files` 上传；请求带 CSRF/Idempotency-Key 的方式照现有规格），以及 `openReader(page, route)`。

`open.spec.ts`：
- `opens a paper in the new reader`：打开 `#read/<id>`，看到 `main` 里的论文标题（标题文字等于创建时的标题），侧栏 `navigation` 里有「文库」，右侧面板有三个 `tab`（导读、助手、笔记），控制台没有 `error`、没有 `pageerror`。
- `an unknown paper explains and links back`：`#read/does-not-exist` → 显示 `reader.notFound` 的文字和回到文库的链接。
- `a failing region shows a retry instead of a blank screen`：用 `page.route("**/api/v1/papers/<id>/files", r => r.fulfill({ status: 200, body: "not json" }))` 让论文卡片抛错 → 论文卡片区显示 `role="alert"` 和「重试」按钮，侧栏和右侧面板仍然可见；取消拦截后点重试 → 正常显示。
- `the old reader is untouched`：打开 `#paper/<id>` 仍是旧阅读器（旧页面的某个特征元素可见，例如 `.reader-page`）。
- `the right panel folds away on a narrow window`：视口 1000×800 → 右侧面板不可见，卡片头有展开按钮；点开 → 面板出现；`Esc` → 收起。

Run: `npm --prefix frontend run build && cd frontend && npx playwright test e2e/reader/open.spec.ts` → FAIL。

- [ ] **Step 3: 实现** `ErrorBoundary`（并在演示页加一节，一个按钮让子组件抛错）、`RegionBoundary`（`ErrorBoundary` 的薄包装，`label` 用文案）、`usePaper`、`ReaderSidebar`、`RightPanel`、`ReaderScreen`、`Workspace.tsx` 分支、文案。

- [ ] **Step 4: 跑测试** → `open.spec.ts` PASS；`npm --prefix frontend run test:unit`、`test:ui`、`check` 通过。

- [ ] **Step 5: Commit** `git commit -m "新阅读器：#read 路由、屏幕骨架和区块错误边界"`

---

### Task 2: PDF 引擎（加载、懒渲染、文字层、页码跟踪、缩放）

**Files:**
- Create: `frontend/src/reader/engine/usePdfDocument.ts`, `frontend/src/reader/engine/PdfPages.tsx`, `frontend/src/reader/engine/PdfPages.module.css`, `frontend/src/reader/engine/PdfPageView.tsx`, `frontend/src/reader/engine/pdf-engine.css`, `frontend/e2e/reader/engine.spec.ts`
- Modify: `frontend/src/reader/ReaderScreen.tsx`

**Interfaces:**
- Produces：
  - `usePdfDocument(fileId: string | null): { doc: PDFDocumentProxy | null; progress: { loaded: number; total: number }; error: string; retry(): void }`。加载参数照搬旧 `PdfView.tsx:491-502`（`url: "/api/v1/files/" + id + "/content"`、`withCredentials`、`isEvalSupported: false`、`disableAutoFetch`、`disableStream`、`rangeChunkSize: 256 * 1024`、cmap/字体/wasm 路径），worker 路径照搬 `:487-490`；卸载时 `destroy()`。
  - `type PdfZoom = "auto" | "fit" | number`
  - `type PdfController = { scrollToPage(page: number, offset?: number): void; position(): number; zoomIn(): void; zoomOut(): void; setZoom(zoom: PdfZoom): void; zoom: PdfZoom; percent: number; root: HTMLElement | null }`
  - `PdfPages(props: { doc: PDFDocumentProxy; file: SourceFile; page: number; onPageChange(page: number): void; controllerRef: Ref<PdfController>; pageOverlays?: (page: number, geometry: PageGeometry) => ReactNode; textLayerRef?: (page: number, element: HTMLDivElement | null, rendered: boolean) => void; onPageRendered?: (page: number) => void })`。
  - `type PageGeometry = { width: number; height: number; scale: number; rotation: number }`
  - `PdfPageView`：内部组件；props 是 `PdfPages` 传下来的单页数据。
- 行为：
  - 连续滚动，所有页先按「宽度 × 原始比例」占位，`IntersectionObserver`（`rootMargin: 800px`）进入视野才渲染画布和文字层，离开后用 `PdfRenderRetention(3)` 保留最近 3 页、其余释放（照旧 `PdfPage` 的做法）。画布像素上限照搬 `ratio = min(dpr, 2, sqrt(16e6 / (w*h)))`。
  - 页码跟踪：滚动时取视口垂直中线所在的页（照旧 `trackPage`），用 `requestAnimationFrame` 合并；外部改 `page` 时滚到那页顶部（留 20px），自己滚动引起的页码变化不反向触发滚动。
  - 缩放复用 `lib/use-pdf-zoom.ts`；`Ctrl/⌘ + 滚轮` 和触控板捏合缩放、`Ctrl/⌘ + =`、`Ctrl/⌘ + -`、`Ctrl/⌘ + 0`（适合宽度）；缩放时保持当前阅读位置。
  - 外观：滚动区背景 `--ui-desk`，页之间 `--ui-space-16`，纸面阴影 `--ui-elev-1`，纸面 `filter: var(--ui-page-filter)`（深色下压暗），文字选区颜色 `--ui-selection`。
  - `pdf-engine.css`：根元素加类名 `opr-pdf`；把 pdf.js 文字层需要的规则（照旧 `app.css:692-723`）改写成 `.opr-pdf .textLayer …`；不依赖 `app.css`。
  - 加载中显示进度（已下载 / 总大小，`Spinner` + 文字）；失败显示原因和「重试」（调用 `retry`）。

- [ ] **Step 1: 写 `engine.spec.ts`（失败）**，用 Task 1 的 fixtures 生成 40 页的 PDF：
  - `first page renders and text is selectable`：第 1 页画布非空白（`canvas` 的 `toDataURL()` 不等于同尺寸空白画布，或抽样像素有非白点）；`textLayer` 里有文字；用 `page.mouse` 拖选一段后 `window.getSelection().toString()` 非空。
  - `scrolling updates the page number`：滚到中间 → 页码显示变成那一页（`PaperHeader` 还没做，本任务先让 `ReaderScreen` 在卡片头显示 `aria-live="polite"` 的 `第 N 页`）。
  - `only nearby pages keep a rendered canvas`：滚到第 30 页后，`[data-page] canvas[width]` 里宽度大于 0 的数量 ≤ 8。
  - `text layer stays aligned with the canvas after zooming`：放大到 200% 再回到适合宽度，第 1 页文字层的 `getBoundingClientRect()` 与画布的宽高差 ≤ 1px。
  - `dark theme dims the paper`：深色主题下纸面的 `filter` 不是 `none`；浅色下是 `none`。
  - `a PDF that fails to load explains and retries`：拦截 `/api/v1/files/<id>/content` 返回 500 → 卡片里显示错误和「重试」；取消拦截点重试 → 第 1 页渲染。
- [ ] **Step 2: 实现引擎，接进 `ReaderScreen`** → PASS。
- [ ] **Step 3: Commit** `git commit -m "新阅读器：PDF 引擎"`

---

### Task 3: 卡片头（标题、页码、缩放、查找、目录、更多）

**Files:**
- Create: `frontend/src/reader/PaperHeader.tsx`, `frontend/src/reader/PaperHeader.module.css`, `frontend/src/reader/FindBar.tsx`, `frontend/src/reader/FindBar.module.css`, `frontend/src/reader/OutlinePanel.tsx`, `frontend/src/reader/OutlinePanel.module.css`, `frontend/e2e/reader/header.spec.ts`
- Modify: `frontend/src/reader/ReaderScreen.tsx`, `frontend/src/reader/engine/PdfPages.tsx`（查找高亮）, `frontend/src/i18n/messages/{en,zh}.ts`

**Interfaces:**
- Consumes：`PdfController`（Task 2）、`usePdfSearch`、`usePdfSearchHighlight`、`downloadFile`、`paperFileName`、`send`（PATCH 收藏，带 `If-Match: paper.revision`）。
- Produces：`PaperHeader({ paper, file, doc, page, pages, controller, onNavigate(page), onFind(), onOutline(), panelToggle? })`。

卡片头（`CardHeader`，52px）从左到右：
- 标题：`--ui-font-display`、`--ui-text-15`、`--ui-weight-strong`，单行省略，截断时悬停 `Tooltip` 显示全文。
- 页码：一个 48px 宽的 `TextField`（`hideLabel`，标签 `reader.page.input`）显示当前页，后面 `/ 40`；回车或失焦时跳页（越界取边界值）；左右各一个 `IconButton`（上一页、下一页，快捷键 `[` 和 `]` 写在 `shortcut` 里，阅读区有焦点时生效）。
- 缩放：一个 `Menu`，触发按钮显示当前百分比；项：适合宽度（`mod+0`）、实际大小、放大（`mod+=`）、缩小（`mod+-`）、50% / 75% / 100% / 125% / 150% / 200% / 300%。
- 查找按钮（`mod+f`）、目录按钮、更多 `Menu`：下载原文、导出带批注的 PDF（`GET /files/{id}/annotated-pdf`，文件名 `paperFileName(title, "-批注")`；失败用 `toast` 报错）、收藏 / 取消收藏（`PATCH /papers/{id} {favorite}`，`If-Match` 为 `paper.revision`，成功后更新本地 paper；409/412 提示刷新）。
- 窄窗口（论文卡片宽 < 560px）时缩放、查找收进更多菜单。

查找条 `FindBar`：卡片头下方滑出（`translateY` + 透明度），`TextField`（标签 `reader.find.label`）、匹配计数「2 / 15」、上一个 / 下一个、关闭；`Enter` 下一个、`Shift+Enter` 上一个、`Esc` 关闭并回到打开前的位置；当前匹配用 `usePdfSearchHighlight` 在页面上标出（样式写在 `pdf-engine.css`，用 `--ui-highlight`）。

目录面板 `OutlinePanel`：目录按钮锚定的 `Floating`（宽 320px、最高 70vh，可滚动），顶部 `SegmentedControl kind="tabs"`：「目录 / 页面」。目录取 `doc.getOutline()`，把目标解析成页码（照旧 `PdfView.jumpLink` 解析 dest 的做法），层级缩进；没有目录时直接显示「页面」并说明「这篇 PDF 没有自带目录」。页面是缩略图网格（两列，懒渲染 0.2 倍画布，带页码），当前页有选中样式。点一项跳页并关闭面板。

- [ ] **Step 1: 写 `header.spec.ts`（失败）**：输入页码跳转、越界取边界值；上一页 / 下一页按钮和 `[` `]`；缩放菜单选 200% 后页面变宽、`mod+0` 回到适合宽度；`page number survives zoom`（在第 12 页缩放后仍显示第 12 页）；`mod+f` 打开查找、输入一个在第 3 页的词 → 跳到第 3 页、计数正确、`Enter` 到下一个匹配、`Esc` 关闭后回到原来的页；目录面板（用带目录的测试 PDF——给 `testPdf` 加可选的 outline，若它不支持就在 `fixtures.ts` 里补一个生成带 `/Outlines` 的 PDF 的函数）列出条目并跳转；没有目录的 PDF 直接显示缩略图；导出带批注的 PDF 触发下载（`page.waitForEvent("download")`，文件名以 `-批注.pdf` 结尾）；收藏后 `GET /papers/<id>` 的 `favorite` 为 `true`。
- [ ] **Step 2: 实现** → PASS。
- [ ] **Step 3: Commit** `git commit -m "新阅读器：卡片头、查找和目录"`

---

### Task 4: 覆盖层（高亮、手写批注、链接与悬停预览、跳到原文那一句）

**Files:**
- Create: `frontend/src/reader/engine/layers/AnnotationLayer.tsx`, `frontend/src/reader/engine/layers/InkLayer.tsx`, `frontend/src/reader/engine/layers/LinkLayer.tsx`, `frontend/src/reader/engine/layers/layers.module.css`, `frontend/src/reader/engine/LinkPreview.tsx`, `frontend/src/reader/engine/LinkPreview.module.css`, `frontend/e2e/reader/layers.spec.ts`
- Modify: `frontend/src/reader/engine/PdfPages.tsx`, `frontend/src/reader/engine/PdfPageView.tsx`, `frontend/src/reader/engine/pdf-engine.css`, `frontend/src/reader/ReaderScreen.tsx`

**Interfaces:**
- Consumes：`usePdfAnnotations(fileId)`（只读用它的 `rows`；本 PR 不新建、不修改高亮）、`usePdfInk(fileId)`（只读）、`usePdfLinks`、`followPdfLink`、`safePdfUrl`、`useReferenceHighlight`（`lib/reference.ts`）。读 `features/PdfLinkPreview.tsx` 了解预览的数据来源（`GET /papers/{id}/citation-preview?excerpt=`、`GET /papers/{id}/link-preview?url=`）和触发规则，用新组件重写界面。
- Produces：
  - `AnnotationLayer({ annotations: PdfAnnotation[]; page: number; rotation: number })`：每条高亮的每个矩形画成底色 `color` 混 30%（深色主题 40%）的方块；有评论的高亮在右上角一个 6px 的点，悬停用 `Tooltip` 显示评论。
  - `InkLayer({ strokes, page, rotation })`：只读画出已有手写笔迹（SVG），不接收指针事件。
  - `LinkLayer({ links, onInternal(dest), onExternal(url) })`：PDF 内链接的可点区域（透明，悬停显示 `--ui-hover`）。内部链接跳转前把当前位置压进历史栈，卡片头出现「返回」按钮（`reader.link.back`）回到原处；外部链接只放行 `safePdfUrl` 认可的地址，新标签页打开（`rel="noopener noreferrer"`）。
  - `LinkPreview`：悬停内部引用链接 400ms 后在链接旁 `Floating` 显示引用详情（文献标题、作者、年份；拿不到时显示被引用处的那段文字）；外部链接显示域名和网页标题；`Esc` 或移开关闭。
  - 跳到原文那一句：`ReaderRoute` 带 `quote`（可带 `prefix`）时，滚到 `page` 并在那一页用 `useReferenceHighlight` 标出这句（下划线 + 淡底，颜色 `--ui-accent`，样式写在 `pdf-engine.css` 的 `.opr-pdf .pdf-reference-*`），并把那句滚到视口中部；监听现有的 `reference-navigate` 事件，同一地址再次进入时重新标出。带 `rect` 时标出那个框。

- [ ] **Step 1: 写 `layers.spec.ts`（失败）**：
  - `saved highlights are visible in both themes`：先用 API `PUT /files/{id}/annotations/{uuid}` 建两条高亮（一条带评论）→ 页面上出现两个高亮块；深浅两种主题下高亮块与纸面的颜色差（canvas 合成后的 RGB 欧氏距离）≥ 30；悬停带评论的高亮出现评论文字。
  - `existing ink is shown read-only`：用 API `PUT /files/{id}/ink/{id}` 建一笔 → 页面上有对应 SVG 路径；在笔迹上按下拖动不会改变它。
  - `internal links jump and come back`：点测试 PDF 里指向第 5 页的链接 → 到第 5 页；点「返回」→ 回到原来的页和滚动位置。
  - `unsafe links are not followed`：`javascript:` 链接没有可点区域或点了不跳转。
  - `hovering a citation shows a preview`：拦截 `citation-preview` 返回一条固定文献 → 悬停后出现预览，含文献标题；移开后消失。
  - `a reference in the address highlights that sentence`：打开 `#read/<id>?file=<fid>&page=3&quote=<第 3 页的一句>` → 第 3 页出现引用高亮元素，且它在视口内。
  - `a quote that cannot be found still lands on its page`：`quote` 是页面上没有的字 → 停在第 3 页，没有报错（控制台无 error）。
- [ ] **Step 2: 实现** → PASS。
- [ ] **Step 3: Commit** `git commit -m "新阅读器：高亮、手写批注、链接预览和跳到原文那一句"`

---

### Task 5: 继续阅读

**Files:**
- Create: `frontend/src/reader/engine/page-memory.ts`, `frontend/src/reader/engine/page-memory.test.ts`
- Modify: `frontend/src/reader/usePaper.ts` 或 `ReaderScreen.tsx`, `frontend/e2e/reader/open.spec.ts`

**Interfaces:**
- Produces：`rememberPage(owner: string, paperId: string, page: number): void`、`lastPage(owner: string, paperId: string): number | null`，存在 `localStorage` 的 `paper-last-page:<owner>`（一个 `{ [paperId]: page }` 对象，最多 1000 条，超出时丢掉最旧的；读写都包 try/catch；只接受 1–3000 的整数）。
- 行为：打开论文时地址没有 `page` 就跳到 `lastPage`；页码变化后 1 秒内没有再变化就记一次（节流，不要每次滚动都写）。

- [ ] **Step 1: 单元测试（失败）**：记住再读出；非法值（0、3001、2.5、字符串）读出为 `null`；超过 1000 条时最旧的被删；`localStorage` 抛错时不抛出。
- [ ] **Step 2: 浏览器测试（失败）**：`reopening continues where you left off`：读到第 7 页，刷新页面（地址不带 page）→ 回到第 7 页；地址带 `page=2` 时以地址为准。
- [ ] **Step 3: 实现** → PASS。
- [ ] **Step 4: Commit** `git commit -m "新阅读器：记住每篇论文读到的页"`

---

### Task 6: 截图、文案完整性和整体验收

**Files:**
- Create: `frontend/e2e/reader/screens.spec.ts`
- Modify: `frontend/src/i18n/messages/{en,zh}.ts`（补齐）

- [ ] **Step 1:** `screens.spec.ts`：浅色 / 深色 × 中文 / English 四种组合，各截一张 1440×900 的整屏（打开 12 页的测试论文，第 1 页、目录面板打开、查找条打开各一张），`testInfo.attach` 附到报告；断言没有 `console.error` 和 `pageerror`；English 下卡片头、侧栏、右侧面板里没有中文字符（`/[一-鿿]/` 不出现在这些区域的 `innerText` 里，论文标题除外——测试论文用英文标题）。
- [ ] **Step 2:** 跑新规格两遍（`npx playwright test e2e/reader --repeat-each=2`）全部通过；跑一遍旧整套（`npx playwright test`，后台、约 6–8 分钟），结果与 main 一致。
- [ ] **Step 3: Commit** `git commit -m "新阅读器：四种外观组合的截图与文案检查"`

---

### Task 7: CI 用生产环境的 Python 版本、开发文档

**Files:**
- Modify: `.github/workflows/verify.yml`, `docs/DEVELOPMENT.md`

- [ ] **Step 1:** `verify.yml` 里 `acceptance`、`browser`、`postgres-recovery` 三个任务的 `python-version` 从 `'3.13'` 改成 `'3.11'`（生产服务器是 3.11）。本地先用 `uv venv --python 3.11` 建环境跑一遍 `pytest -q` 确认通过（第 1 阶段上线前已验证过一次）。
- [ ] **Step 2:** `docs/DEVELOPMENT.md` 加两条：新阅读器在 `#read/<论文 id>`（第 2 阶段结束前不出现在界面链接里）、它的浏览器测试在 `frontend/e2e/reader/`；生产环境是 Python 3.11，CI 用同一版本。
- [ ] **Step 3: Commit** `git commit -m "CI 改用生产环境的 Python 3.11；开发文档说明新阅读器"`

---

## 收尾

- [ ] 全部检查：`npm --prefix frontend run test:unit`、`test:ui`、`check`、`build`；`npx playwright test`（旧整套 + `e2e/reader`）；后端 `pytest -q`（3.11）。
- [ ] `CHANGELOG.md` 的「未发布」下「新界面（开发中）」补一句：新阅读器框架（地址 `#read/<论文 id>`，还没有接入解释、翻译、导读和笔记）。
- [ ] 推分支、开 PR（附四张截图），CI 全绿后 squash 合并。本 PR 不改变用户能看到的界面（新阅读器没有入口），合并后可以照常上线，不急。
