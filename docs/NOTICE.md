# 第三方许可与说明

Open Paper Reader 自己的代码以 [MIT 许可证](../LICENSE) 发布。这份文件列出随仓库分发、或在构建时进入镜像的第三方内容，以及需要特别说明的地方。它是整理，不是法律意见；以各项目自己的许可证文本为准。

## 随仓库分发的第三方代码与资源

| 内容 | 位置 | 许可证 | 说明 |
| --- | --- | --- | --- |
| [LaTeXTrans](https://github.com/NiuTrans/LaTeXTrans) 的解析与重建代码 | `backend/vendor/latextrans/` | MIT（Copyright (c) 2025 NiuTrans Open Source） | 改编自上游 `0b49799`；改动见 [`NOTICE.md`](../backend/vendor/latextrans/NOTICE.md)，许可证文本在同目录的 `LICENSE`。只用了解析和重建，没有用它的网络客户端、Agent 编排和编译器 |
| [shadcn/ui](https://ui.shadcn.com) 组件 | `frontend/src/components/ui/` | MIT | 由 shadcn CLI 复制进仓库后按需修改 |
| [Inter](https://rsms.me/inter/)、[Noto Sans SC](https://fonts.google.com/noto/specimen/Noto+Sans+SC)、[Pretendard](https://github.com/orioncactus/pretendard)、[JetBrains Mono](https://www.jetbrains.com/lp/mono/) 字体 | 经 npm 包引入，构建后随前端发布 | SIL Open Font License 1.1 | 许可证文本在 [`docs/licenses/`](licenses/)、[`frontend/public/assets/fonts/`](../frontend/public/assets/fonts/)，构建时还会复制到前端产物的 `licenses/` |
| [Lucide](https://lucide.dev) 图标 | 经 npm 包（`lucide-react`）引入 | ISC | 许可证文本在 [`frontend/public/assets/icons/LICENSE-lucide.txt`](../frontend/public/assets/icons/LICENSE-lucide.txt) |
| [claude-web](https://github.com/ypyik0669/claude-web) 的设计令牌 | `frontend/src/ui/tokens.css` | MIT（Copyright (c) 2026 ypyik0669） | 设计令牌的结构和取值改编自它的 `tokens.css`；许可证文本在 [`docs/licenses/claude-web-MIT.txt`](licenses/claude-web-MIT.txt) |

## 通过包管理器安装的依赖

不在仓库里，由 `npm`、`pip` 安装。完整、精确的版本在 `frontend/package-lock.json`、`agent-runtime/package-lock.json` 和 `backend/requirements.txt` 里。直接依赖的许可证如下。

**前端**（`frontend/package.json`）

| 许可证 | 依赖 |
| --- | --- |
| MIT | React、React DOM、Radix UI、`@shadcn/react`、Tailwind CSS（含 `@tailwindcss/vite`、`tw-animate-css`）、TipTap（含各扩展）、`motion`、KaTeX、`cmdk`、`clsx`、`tailwind-merge`、`sonner`、`react-markdown`、`react-resizable-panels`、`remark-*` / `rehype-katex` / `unified`、Vite、`@vitejs/plugin-react`、Vitest、Prettier、`shadcn` |
| Apache-2.0 | [PDF.js](https://github.com/mozilla/pdf.js)（`pdfjs-dist`）、`swagger-ui-dist`、`class-variance-authority`、Playwright、TypeScript |
| ISC | `d3-force`、`lucide-react` |
| OFL-1.1 | `@fontsource-variable/inter`、`@fontsource-variable/jetbrains-mono`、`@fontsource-variable/noto-sans-sc`、`pretendard` |

**研究助手运行时**（`agent-runtime/package.json`）：[Pi](https://github.com/earendil-works/pi) 的 `pi-agent-core`、`pi-ai`、`pi-coding-agent`（MIT），`ipaddr.js`（MIT），`undici`（MIT）。

**后端**（`backend/requirements.txt`）

| 许可证 | 依赖 |
| --- | --- |
| MIT | FastAPI、SQLAlchemy、Alembic、`argon2-cffi`、Pydantic、`pylatexenc` |
| BSD-3-Clause | Starlette、uvicorn、httpx、pypdf、pypdfium2（及它打包的 PDFium 等，各有自己的许可证） |
| Apache-2.0 | `python-multipart`、`regex` |
| MIT-CMU（HPND） | Pillow |
| Apache-2.0 OR BSD-3-Clause | `cryptography`（pypdf 读取 AES 加密的 PDF 时需要） |
| **LGPL-3.0** | psycopg（`psycopg[binary]`） |

`pytest`（MIT）只在开发和测试时使用。

**psycopg 是 LGPL-3.0。** open-paper-reader 只把它作为未经修改的库通过 `pip` 安装并导入，没有把它的代码并入 open-paper-reader。你可以按 LGPL 的要求替换它的版本（它在 `backend/requirements.txt` 里单独固定）。如果你发布包含它的 Docker 镜像，请随镜像提供它的许可证文本和获取源码的方式。

## 可选的版面翻译镜像与 AGPL-3.0

普通 PDF 的版面翻译（见 [翻译](TRANSLATION.md)）使用 [BabelDOC](https://github.com/funstory-ai/BabelDOC)，它采用 **AGPL-3.0**。open-paper-reader 这样处理它：

- BabelDOC **不在仓库里，也不是 web 环境的依赖**。它只在可选的 `deploy/translation/Dockerfile.layout` 构建出的镜像里，由 `backend/requirements-layout.txt` 固定版本，构建时才从 PyPI 下载。
- open-paper-reader 的 web 服务把它当作独立的容器进程来调用，通过标准输入输出传递 JSON，两者之间没有链接。
- 这个镜像由三部分组成：BabelDOC（AGPL-3.0）、`deploy/translation/` 里对它的几处小改动（缓存目录、字体复用、译文质量检查）、`backend/layout_translation_worker.py`（调用它的入口）。后两者是本仓库的 MIT 代码，**组合成镜像之后，镜像整体按 AGPL-3.0 的条款对待**。
- 因此：如果你**发布**构建出来的镜像，或者让别人通过网络与它交互，需要按 AGPL-3.0 提供这个镜像的完整对应源码，其中包括 BabelDOC 和本仓库里的补丁与入口脚本。只在自己的服务器上运行、不发布镜像，没有额外义务。
- 不构建这个镜像（不设置 `PDF_LAYOUT_IMAGE`），Open Paper Reader 就不包含任何 AGPL 代码。

## 构建时拉取的其他软件

`deploy/translation/Dockerfile`（TeX Live 编译环境）、`deploy/Dockerfile.agent-sandbox`（助手沙箱）和主 `deploy/Dockerfile` 在构建时从 Debian、npm、PyPI 和 GitHub 下载软件（包括 TeX Live 各宏包、`fd`、`ripgrep`、`poppler` 等），它们各有自己的许可证；仓库不分发这些内容。如果你发布这些镜像，请自行核对并附上相应的许可证与源码获取方式。

## 演示内容


