# open-paper-reader on your own computer

Read papers with an AI assistant: import a PDF or an arXiv link, get a guide,
select a sentence to have it explained or translated, ask the assistant, and
follow its citations back to the sentence they came from. The local build is
the same app as the hosted site, for one person, with everything on this
computer.

```bash
uvx open-paper-reader          # run it without installing
# or
pipx install open-paper-reader
open-paper-reader              # short name: opr
```

The browser opens at <http://127.0.0.1:8765>. There is no account and no
password. Stop it with Ctrl+C.

## What you need

- **Python 3.11 or newer** (uv or pipx bring their own if needed).
- **Node.js 20 or newer** for the assistant, guides and translations
  (`brew install node`, `winget install OpenJS.NodeJS.LTS`, or
  <https://nodejs.org>). Without it you can still import, read, highlight and
  take notes; the command says what is missing when it starts. On the first
  start the assistant runtime installs its npm packages once (about a minute).
- **A model.** On first open the app asks for one: an API key for an
  OpenAI-compatible service or Anthropic, or a model server on this computer —
  Ollama (`http://127.0.0.1:11434/v1`) or LM Studio (`http://127.0.0.1:1234/v1`).
  Only the local build accepts `http://127.0.0.1` / `localhost` model addresses,
  and a local model needs no key.

Optional:

- **Layout translation** (a translated PDF with the original layout) uses
  BabelDOC. It is not bundled: in the translated view, or in Settings, press
  **Install layout translation**. It goes into its own environment in the data
  folder (`babeldoc-venv`), downloads about 1 GB, shows its progress and can be
  cancelled. Installing uses [uv](https://docs.astral.sh/uv/) when it is
  available, otherwise the Python running the app (3.10–3.13).
- **LaTeX translation.** For an arXiv paper, the translated view translates
  the paper's LaTeX source and compiles it into a new PDF (other papers use
  layout translation). Compiling needs a TeX engine: press **Install the LaTeX
  compiler** in the translated view, or in Settings → Data. It downloads the
  single [Tectonic](https://tectonic-typesetting.github.io) program from its
  official GitHub release for your system into `tools/tectonic/` in the data
  folder, shows its progress and can be cancelled, then compiles a small
  Chinese test page once so the LaTeX packages and the Chinese fonts (ctex's
  Fandol set, the same as the hosted site) are fetched. Papers fetch any further
  packages they need the first time they compile, so the first translation
  needs a network connection. Compiling runs `tectonic -X compile --untrusted`
  (XeTeX, no shell escape). If a font is missing, the translation fails and
  says which one. When arXiv has no LaTeX source for a version, the translated
  view offers layout translation instead.
- **Docker** is only used by the assistant's code sandbox (running code,
  terminal tools). Without it those tools say they are unavailable; everything
  else works.

## Where your data is

| System | Folder |
| --- | --- |
| macOS, Linux | `~/.open-paper-reader/` |
| Windows | `%APPDATA%\open-paper-reader\` |

Inside: `workspace.db` (SQLite), `files/` (your PDFs and attachments),
`translation-credentials/` (model keys, readable only by you), and once
installed `agent-runtime/`, `babeldoc-venv/` and `tools/tectonic/` (with its
package cache in `tools/tectonic-cache/`). Back it up by copying the
folder while the app is stopped. Settings → Data also exports the whole
workspace. Use another folder with `--data PATH` (or `OPR_HOME`).

On start the app creates the folder, applies database migrations, creates the
one reader account (`reader`) if there is none, and starts the background
workers (assistant, paper preparation, translation) next to the web server.
Stopping the command stops them too.

## Options

```
open-paper-reader [--port 8765] [--data PATH] [--no-browser] [--version]
```

If it is already running on that port, the command just opens the browser.

## Safety

The local build signs you in without a password, so it is locked to this
computer: it only listens on `127.0.0.1`, refuses to start with another address
(`--host 0.0.0.0` is an error, and so is `APP_MODE=local` with a non-loopback
`APP_HOST` or in production), and signs in only requests that come from this
machine, name `127.0.0.1` or `localhost` as their host (which stops other
websites reaching it through DNS rebinding) and did not pass through a proxy.
Writes still need the session's CSRF token. Do not put it behind a reverse
proxy or share the port; use the hosted setup (README, Docker) for a server.

## Opening papers from the browser

Paste any paper address into the home box: arXiv, alphaxiv and ar5iv pages, a
publisher's page that names its PDF (`citation_pdf_url`), or a direct PDF link.
The browser extension in [`extension/`](../extension/README.md) (Chrome or Edge,
"Load unpacked") does the same from the toolbar or the right-click menu: it opens
`http://127.0.0.1:8765/#open?url=<address>` and sends nothing but that address.
A page that needs a subscription has no PDF to fetch; download it and drag it in.

## Building the package

```bash
scripts/build-local.sh         # builds frontend/dist, then the wheel and sdist into dist/
uvx --from dist/open_paper_reader-*.whl open-paper-reader
```

The wheel carries the built web app and the assistant runtime's sources under
`backend/_bundle/`; `node_modules`, BabelDOC and Tectonic are installed on demand. From a
source checkout, `python -m backend.local` runs the same command against the
checkout (build the frontend first).

## 中文说明

本机版：`uvx open-paper-reader`（或 `pipx install open-paper-reader`，命令别名
`opr`）一条命令启动，浏览器自动打开 <http://127.0.0.1:8765>，免登录。数据在
`~/.open-paper-reader/`（Windows 为 `%APPDATA%\open-paper-reader\`），默认 SQLite。
需要 Node.js 20+（助手、导读和翻译用；缺了启动时会说明怎么装）。模型可以填 API
密钥，也可以用本机的 Ollama / LM Studio（只有本机版允许 `http://127.0.0.1` 地址，
不需要密钥）。版面翻译按需安装：译文模式或设置里点「安装版面翻译」，装在数据目录
的 `babeldoc-venv`，可看进度、可取消。arXiv 论文的译文从 LaTeX 源码翻译再编译：译文模式或设置里点「安装 LaTeX 编译器」，从 Tectonic 官方 GitHub 发布页下载到数据目录的 `tools/tectonic`，装完会先编译一页中文小样，取回宏包和 Fandol 中文字体；没有源码的版本可以改用版面翻译。没有 Docker 时，代码沙箱类工具明确提示不可用。
任意论文网址（出版社页面、PDF 直链、alphaxiv 等）可以直接粘贴到首页的导入框；浏览器扩展见 [`extension/`](../extension/README.md)，点工具栏按钮或右键菜单即在本机版里打开，只发送网址。
免登录只在本机模式、只监听 127.0.0.1、请求来自本机且 Host 是本机时生效，其他情况一律按
正常登录处理。
