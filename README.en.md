# open-paper-reader

**An open-source paper reader with an AI assistant.** Import a PDF or an arXiv link, get an automatic guide, select text to explain or translate it, and ask the assistant. Citations in its answers jump back to the exact sentence in the paper.

[简体中文](README.md) · English · [Deployment](docs/DEPLOYMENT.md) · [Features](docs/FEATURES.md) · [All docs](docs/README.md)

[![CI](https://github.com/Jialei-03/zhijian/actions/workflows/verify.yml/badge.svg)](https://github.com/Jialei-03/zhijian/actions/workflows/verify.yml) [![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

![The reader: paper, guide and assistant side by side](docs/assets/reader.png)

> The project is being renamed from "Zhijian" to open-paper-reader. The interface and docs are being updated step by step; the repository URL stays for now.

## What it is

Reading a paper usually means juggling a PDF viewer, a translator, a notes app and a chat window. open-paper-reader puts them in one window:

- **Guide**: generated automatically after import, streaming in as it is written.
- **Selection**: select text to explain it, translate it, highlight it, save it to your notes, or ask the assistant about it.
- **Assistant**: reads the page you point at, or the whole paper, before answering. Every step (which pages it read, what it searched) can be expanded. Page citations in answers jump to the sentence in the paper and highlight it.
- **Reading modes**: original, side-by-side paragraph translation, and a layout-preserving translated PDF (experimental).
- **Notes**: one Markdown note per paper, with the paper's highlights and comments listed below it; click one to jump back to the text.

## Principles

- **Local first.** Meant to run on your own computer; papers and notes stay there. No background crawling, no telemetry.
- **[Pi](https://github.com/earendil-works/pi) is built in** as the assistant. Connect your own API keys (OpenAI-compatible, Anthropic and others) or a local model (Ollama, LM Studio).
- **Claude Code and Codex are not integrated yet.** The plan for v2 is to expose the reader's abilities (read pages, search full text, read and write notes) as an MCP server so the Claude Code or Codex you already run and sign in to locally can read papers with it. That is a plan only; the current version does not do it. This project is not affiliated with Anthropic or OpenAI.
- **The cloud version is optional.** The maintainer runs a hosted service ([papers.dougao.online](https://papers.dougao.online)) for people who would rather not install anything. The hosted version only accepts your own API keys; it does not offer subscription-account sign-in.

## Quick start

One command on your machine (provided from 0.2.0, not released yet; until then use Docker or run from source below):

```bash
uvx open-paper-reader        # alias: opr
```

It starts the server locally and opens your browser. On first launch, add a model (an API key or a local model); once the connection test passes you can import papers.

### Self-host with Docker (available now)

Needs Docker with Compose v2.24 or newer and about 2 GB of free memory.

```bash
git clone https://github.com/Jialei-03/zhijian.git
cd zhijian
cp .env.example .env
# Replace POSTGRES_PASSWORD with a random alphanumeric string:
sed -i "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$(openssl rand -hex 24)/" .env    # on macOS: sed -i ''
docker compose up -d --build
```

Open <http://localhost:8765>, register the first account, then add a model in Settings. Public deployment, invite-only registration, backups and upgrades are in [Deployment](docs/DEPLOYMENT.md) (currently Chinese).

For safety, a Docker or cloud deployment only calls model services that are HTTPS, public and on an allow-list (see [Configuration](docs/CONFIGURATION.md#模型)). Connecting to a local model is a feature of the local version.

### Browser extension

The home import box takes any paper address (arXiv, a publisher page, a direct PDF link). The Chrome / Edge
extension in [`extension/`](extension/README.md) ("Load unpacked") opens the current page or a PDF link in
open-paper-reader from the toolbar or the right-click menu, and sends only the address.

## Development

```bash
make install   # .venv + backend, frontend and agent-runtime dependencies
make db        # database migrations (SQLite by default locally)
make build     # build the frontend
make run       # http://127.0.0.1:8765
make worker    # in another terminal: the assistant worker (needs Node.js 22)
make help      # all commands
```

See [Development](docs/DEVELOPMENT.md) for the layout, tests and conventions, and [Architecture](docs/ARCHITECTURE.md) for the design. Most of the long-form docs are in Chinese for now.

## Status and limits

- The new interface is replacing the old one in stages. Knowledge graph, paper discovery, share links and similar features of the old interface do not appear in the new one; existing data is kept.
- **Check model output yourself.** The assistant, explanations, translations and guides are generated by models. The server verifies that quoted passages really come from the paper, which does not guarantee factual or translation quality.
- Layout translation is experimental: quality varies by paper, and scanned or formula-heavy pages are not validated.
- Code execution for the assistant needs a separately deployed sandbox; without one those tools report that they are unavailable.
- Database migrations are one-way: back up before upgrading.

## Privacy

Your data stays on your machine or server; the author does not receive it. The software contacts external services only for: the model service you configure (it receives the paper content needed for the task), arXiv, Semantic Scholar, Crossref, and quick translation of a selection (sends the selected text to `translate.googleapis.com`; you can block it at the firewall). The full list is in [Architecture](docs/ARCHITECTURE.md#对外的网络访问).

## Contributing

Issues and pull requests are welcome; see [CONTRIBUTING](CONTRIBUTING.md). Report security problems privately as described in [SECURITY](SECURITY.md).

## License

[MIT](LICENSE). Third-party licenses are in [NOTICE](NOTICE.md); BabelDOC, used for layout translation, is AGPL-3.0 and only lives in the optional, separately built image.

Built on [PDF.js](https://github.com/mozilla/pdf.js), [Pi](https://github.com/earendil-works/pi), [BabelDOC](https://github.com/funstory-ai/BabelDOC), [LaTeXTrans](https://github.com/NiuTrans/LaTeXTrans), [TipTap](https://tiptap.dev), [KaTeX](https://katex.org), [FastAPI](https://fastapi.tiangolo.com) and [SQLAlchemy](https://www.sqlalchemy.org).
