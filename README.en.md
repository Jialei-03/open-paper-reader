# Open Research Agent

<p align="center">
  <a href="https://papers.dougao.online"><img alt="Use it online at papers.dougao.online" src="https://img.shields.io/badge/Use%20it%20online-papers.dougao.online-1c1917?style=for-the-badge"></a>
</p>
<p align="center"><b>Read papers right away at <a href="https://papers.dougao.online">papers.dougao.online</a>, nothing to install; the research agent runs on your own computer.</b></p>

**An open-source research agent: it agrees on a research plan with you in conversation, runs real experiments on your computer or a remote GPU, keeps its direction round after round, knows when to back off, and backs every result with evidence you can check.** Built on the [Pi](https://github.com/earendil-works/pi) agent; you choose the model.

[简体中文](README.md) · English · [Use it online](https://papers.dougao.online) · [Local build](docs/LOCAL.md) · [All docs](docs/README.md)

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## Why

Recent work finds that automated research agents can do the **engineering** of research but not move the **research** forward:

- Given six days and thousands of dollars on two unpublished NeurIPS papers, frontier agents finished the engineering and made no substantial research progress. The failure modes include poor judgment about what is worth doing, not backing off dead ends, ignoring resources, and drifting from the goal (Kirgis, Narayanan et al., [2607.27191](https://arxiv.org/abs/2607.27191)).
- With data missing, all seven frontier models tested synthesized data instead of saying the task could not be done (SciIntegrity-Bench, [2605.10246](https://arxiv.org/abs/2605.10246)).
- Of 24 runnable automated-research systems, none has an externally validated check inside its loop ([2608.05179](https://arxiv.org/abs/2608.05179)).

Open Research Agent goes after exactly these: **research judgment**, **staying on the goal**, and, as the floor, **results that can be checked**.

## How it works

- **It starts with a conversation**: say in one sentence what you want to find out. The advisor talks it through and writes a plan card: the metric, the baseline, what comes first, and what result would sink each hypothesis (its kill condition). Experiments start when you approve it.
- **Projects, a board, and chats**: research is organized in projects, with a board showing where every research, hypothesis and experiment stands. Each project holds chats where you can ask how things are going; chats only read, so they never disturb work in progress.
- **Research map**: the direction lives in a persistent tree, not in chat history: north-star question → sub-questions → hypotheses → experiments → findings. Every change records who made it and why. Each round starts from the map and the last handoff, so work can run for many rounds over days.
- **Focus before acting**: before running code, writing files or changing the map, the executor must say which node it advances; if it does not, or that branch has been refuted, the action is refused and logged.
- **The advisor judges, you decide**: a read-only advisor reviews the map, checks numbers against the logs, and decides to continue, invest, drop or pivot, asking you when it needs to. The plan, the conclusion and any extra budget are your call.
- **Environments set up by an agent**: experiments run directly on your computer (using an Apple-silicon or NVIDIA GPU), or on a lab machine over SSH. An agent installs what is needed, and the system checks it before calling it ready.
- **Evidence**: the system collects each experiment's logs, settings and metrics instead of trusting the agent to copy them. A result can only cite real log lines or a paper's own sentences, and its numbers must appear in them verbatim. Runs can be mirrored to SwanLab or Weights & Biases.
- **Playbook (self-improvement across projects)**: when a research ends, a distiller turns what happened into judgment rules ("in this situation, do this"). A rule takes effect once two researches support it, and later researches read it. It has not been shown to help yet (see the status below).

Details are in [Research](docs/RESEARCH.md) (Chinese).

## Status

This is an early version. What actually works end to end:

- **The whole research flow**: projects and board, scoping by conversation, local / SSH environments, the advisor, evidence checks, the playbook, the research report. Run with a real model on an M1 Mac on a CIFAR-10 question, with experiments on MPS.
- **Seven evaluation rounds** on held-out tasks covering four kinds of research judgment:

  | Task | The right behavior |
  |---|---|
  | Find the best threshold | A number matching the precomputed truth |
  | Missing data | Report it honestly and stop to ask |
  | Tempting dead end | Refute it and stop |
  | Label leak | Distrust a near-perfect score and find the leaking column |

  Each round's main failures were fixed without changing the model. In the latest round 17 of 18 runs ended the right way; on a pre-registered set of new tasks never used in development, all 15 runs without the playbook ended the right way. See the [evaluation record](docs/research/2026-10-20-third-results.md).
- **The advisor's value is knowing when to stop**: without it the executor stayed honest and its numbers were right, but all 6 runs used the whole budget, at 1.3 to 2.5 times the cost.
- **The playbook has not been shown to help**: rules learned from an empty playbook cut cost by 27% on the tasks used during development, but this **did not replicate** on a pre-registered set of new tasks. See the [controlled comparison](docs/research/2026-10-20-learned-playbook.md) and the [fresh held-out set](docs/research/2026-10-20-fresh-heldout-plan.md).
- **Not yet**: event-driven scheduling (rounds are polled today) and research in the hosted version (it runs locally only).

## Reading papers

The other half of the agent is reading papers. That part also works on its own, and the [online version](https://papers.dougao.online) is exactly that:

- Import a PDF, an arXiv link or any paper URL and get a guide. Every sentence is cited, and a click takes you back to its sentence.
- Select text to explain, translate, highlight, comment or keep in notes. Box a figure or formula to ask about it.
- The assistant can see attached images and boxed regions, with a model that has vision.
- Parallel translation, layout translation and LaTeX recompilation.
- Markdown notes, a library, related papers and recommendations.

## Run it on your computer

**Desktop app (macOS)**: download the `.dmg` for your chip from [Releases](https://github.com/Jialei-03/open-research-agent/releases) (arm64 for Apple silicon, x64 for Intel), drag Open Research Agent into Applications and open it. No Python or Node.js needed. It is not signed yet: the first time, macOS says it cannot verify the developer; open it from System Settings → Privacy & Security → Open Anyway.

**Command line**, one command to install (macOS / Linux; needs Node.js 20+; [uv](https://docs.astral.sh/uv/) is installed if missing):

```bash
curl -fsSL https://raw.githubusercontent.com/Jialei-03/open-research-agent/main/install.sh | sh
```

Then run `ora`: the browser opens at http://127.0.0.1:8765, with no sign-in; Ctrl+C stops it. The package comes from this repository's [Releases](https://github.com/Jialei-03/open-research-agent/releases); to update, run the same command again.

From the source (also for development):

```bash
git clone https://github.com/Jialei-03/open-research-agent
cd open-research-agent
make start     # installs what is missing, rebuilds what changed, opens the app
```

On first open, add a model in Settings → Models (an API key or a local model), then prepare an environment in Settings → Research environments: for the default one (this computer, listed as “本机”), press “Let an agent prepare it” and an agent sets up a separate Python environment in the data folder. Data lives in `~/.open-paper-reader/` by default. See [Local build](docs/LOCAL.md) and [Research](docs/RESEARCH.md).

## Development

```bash
make help      # all commands
make test      # backend tests
```

Getting started on a new machine, the code map, how the research system runs, testing and conventions are in the [development handbook](docs/DEVELOPMENT.md) (Chinese).

## License

[MIT](LICENSE). Third-party licenses are in [NOTICE](NOTICE.md). This project is not affiliated with Anthropic or OpenAI.
