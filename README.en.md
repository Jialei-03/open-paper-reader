<p align="center"><img src="docs/brand/banner.svg" alt="Zhijian: an open-source paper-reading workspace, online and self-hosted" width="100%"></p>

<h1 align="center">Zhijian (纸间)</h1>

<p align="center"><strong>An open-source paper-reading workspace, with a research assistant alongside you.</strong></p>

<p align="center">
Read, translate, annotate and take notes in one window. The assistant actually reads the paper: answers cite the page, it can compare several papers and organize your library, and you can check everything it did.<br>
MIT licensed. Use the maintainer's hosted service directly, or deploy your own instance. Contributions to the reading experience, model integrations and research workflows are welcome.
</p>

<p align="center"><a href="https://papers.dougao.online">Use online</a> · <a href="docs/DEPLOYMENT.md">Self-host</a> · <a href="CONTRIBUTING.md">Contribute</a></p>

<p align="center">
  <a href="https://github.com/Jialei-03/zhijian/actions/workflows/verify.yml"><img alt="CI" src="https://github.com/Jialei-03/zhijian/actions/workflows/verify.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
</p>

<p align="center">
  <a href="README.md">简体中文</a> · English · <a href="docs/DEPLOYMENT.md">Deploy</a> · <a href="docs/FEATURES.md">Features</a> · <a href="docs/README.md">All docs</a>
</p>

> **Language note.** The interface and the documentation are in Simplified Chinese; the translation target language is Simplified Chinese too. Papers and model output can be in any language. This page is a short English introduction; the detailed docs in [`docs/`](docs/) are Chinese.

| | |
| --- | --- |
| <img src="docs/brand/showcase/story-compare.jpg" alt="The assistant reads three papers and compares them, each row citing the evidence page" width="440" height="293"><br>**The assistant reads the paper, then answers.** Select a few papers and it reads each in full, then lays out the research question, method, data, results and limits in a table, every cell citing a page. | <img src="docs/brand/showcase/story-trace.jpg" alt="The assistant's action log, expanded to show which files it read" width="440" height="293"><br>**See what it did.** Every answer expands into "N actions": which files it read and what it changed. Writes are read back and verified, with a receipt you can open. |
| <img src="docs/brand/showcase/translate.jpg" alt="Original and translation side by side; hovering a translated sentence lights up the matching source sentence" width="440" height="293"><br>**Sentence-aligned translation.** The translation is checked against the paper's own text layer; hover a sentence and the matching original lights up. | <img src="docs/brand/showcase/region.jpg" alt="The menu after box-selecting a figure: explain, translate, ask AI, copy as image" width="440" height="293"><br>**Point, then ask.** Select text or box a figure, formula or table; explain, translate, ask and clip are one key away. |

## What it is

Reading papers usually means juggling a PDF reader, a translator, annotations, notes, a reference manager and a chat window. Zhijian puts them in one workspace and lets the assistant stand on the page you are reading, instead of chatting over a summary with no source.

- **Research assistant** – reads the page, region or whole paper you point at, and cites pages; when something is unreadable it says so. It can compare papers, write to notes, tag, import arXiv papers and start translations. Changing your library requires your permission.
- **Read and translate** – continuous or paged reader with outline, thumbnails and full-text search; select to explain, translate, highlight, comment or ask; sentence-aligned translation of whole papers, and for arXiv papers with LaTeX source, a fully typeset Chinese PDF.
- **Annotations and notes** – five highlight colors, comments, pen input; Markdown notes with math, images and tables, with history; links between notes and papers form a knowledge graph.
- **Library** – status, tags, research directions, collections, batch actions, global search (`⌘K`), paper discovery by research direction, read-only share links, one-click export.
- **Self-hosted** – one `docker compose up` brings up the API, the assistant worker and PostgreSQL. Every account has its own space; model keys stay on the server; there is no background crawling and no telemetry.
- **Works without a model** – importing, reading, annotating, notes and the library need none; only explain, translate, guides, quizzes and the assistant do.

## Quick start

You need Docker with Compose v2.24 or newer (check with `docker compose version`) and about 2 GB of free memory.

```bash
git clone https://github.com/Jialei-03/zhijian.git
cd zhijian
cp .env.example .env
# set POSTGRES_PASSWORD to a random alphanumeric string:
sed -i "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$(openssl rand -hex 24)/" .env    # macOS: sed -i ''
docker compose up -d --build
```

Open <http://localhost:8765>, register the first account, then add your model under *Settings → Models* (OpenAI-compatible or Anthropic protocol).

- To keep strangers out, set `REGISTRATION=invite` in `.env` and create an administrator *before* anyone registers: `docker compose exec web python -m backend.cli bootstrap --username admin`.
- To expose it publicly, put a TLS-terminating reverse proxy in front (Caddy and nginx examples are in `deploy/`), and set `APP_ENV=production` with an HTTPS `APP_ORIGIN`. See [Deployment](docs/DEPLOYMENT.md) (Chinese) for the steps, upgrades, backups and troubleshooting.
- A native install on a Linux machine with systemd units is described there too.

**Models.** For safety the server only calls services that are reachable over **HTTPS on port 443, at a public address, with a hostname on the allow-list** (OpenAI, Anthropic, DeepSeek, OpenRouter, Google AI Studio, SiliconFlow, MiniMax); add other compatible hosts with `TRANSLATION_ALLOWED_HOSTS`. Plain-http and private-network endpoints (for example a local Ollama) are **not supported** yet.

## Development

```bash
make install   # .venv + backend, frontend and assistant-runtime dependencies
make db        # migrations (SQLite by default locally)
make build     # build the frontend
make run       # http://127.0.0.1:8765
make worker    # in another terminal: the assistant worker (needs Node.js 22)
make help      # everything else: test, check, e2e, web (hot reload) ...
```

Python 3.13 and Node.js 22 are the tested versions. See [Development](docs/DEVELOPMENT.md) and [Architecture](docs/ARCHITECTURE.md).

## Status and limits

Zhijian is usable day to day but young:

- **Simplified Chinese only** for the interface and the translation target.
- **Model output needs your review.** The server checks that quoted passages occur in the paper; that does not make claims or translations correct.
- **Single machine.** Login rate limiting is in-process and the shared-model concurrency limit uses a local file lock, so run one web process. Multi-machine setups need a shared rate limiter at the edge first.
- **Layout translation of plain PDFs is experimental**; scanned pages and formula-dense pages are not validated. Whole-paper translation needs arXiv LaTeX source.
- **The assistant's code tools** need a separately deployed sandbox broker; without it they report "unavailable" and never fall back to running on the host.
- Database migrations are one-way: back up before upgrading.

## Privacy

Your data stays on your server and is never sent to the authors. The server contacts outside services only when needed: the model service you configure (it receives the paper content a task needs), quick translation of a selection (sends the selected text to `translate.googleapis.com`; block it at your firewall if that is unacceptable, AI translation is unaffected), arXiv, Semantic Scholar (public DOI/arXiv ids only), Crossref, and your SMTP server. See [Architecture](docs/ARCHITECTURE.md#对外的网络访问).

## Contributing

Issues and pull requests are welcome; see [CONTRIBUTING](CONTRIBUTING.md). Please report security problems privately as described in [SECURITY](SECURITY.md).

## License

[MIT](LICENSE). Third-party components keep their own licenses; see [NOTICE](NOTICE.md). Notably, BabelDOC (AGPL-3.0), used for layout translation, only lives in an optional, separately built image.
