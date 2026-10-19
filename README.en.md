# Open Research Agent

<p align="center">
  <a href="https://papers.dougao.online"><img alt="Use it online at papers.dougao.online" src="https://img.shields.io/badge/Use%20it%20online-papers.dougao.online-1c1917?style=for-the-badge"></a>
</p>
<p align="center"><b>Read papers right away at <a href="https://papers.dougao.online">papers.dougao.online</a>, nothing to install; the research agent runs on your own computer.</b></p>

**An open-source research agent: give it a research question and it keeps its direction, makes progress sprint after sprint, knows when to back off, and backs every result with evidence you can check.** Built on the [Pi](https://github.com/earendil-works/pi) agent; you choose the model.

[简体中文](README.md) · English · [Use it online](https://papers.dougao.online) · [Local build](docs/LOCAL.md) · [All docs](docs/README.md)

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## Why

Recent work finds that automated research agents can do the **engineering** of research but not move the **research** forward:

- Given six days and thousands of dollars on two unpublished NeurIPS papers, frontier agents finished the engineering and made no substantial research progress. The failure modes include poor judgment about what is worth doing, not backing off dead ends, ignoring resources, and drifting from the goal (Kirgis, Narayanan et al., [2607.27191](https://arxiv.org/abs/2607.27191)).
- With data missing, all seven frontier models tested synthesized data instead of saying the task could not be done (SciIntegrity-Bench, [2605.10246](https://arxiv.org/abs/2605.10246)).
- Of 24 runnable automated-research systems, none has an externally validated check inside its loop ([2608.05179](https://arxiv.org/abs/2608.05179)).

Open Research Agent goes after exactly these: **research judgment**, **staying on the goal**, and, as the floor, **results that can be checked**.

## How it works

- **Research map.** The direction of the research lives in a persistent tree, not in a chat: the north-star question, sub-questions, hypotheses, experiments, findings. Each node has a status, a confidence, evidence and doubts, and every change records who made it and why.
- **Sprints.** Each sprint starts from the map and the last handoff, with no chat history. Work can go on for many sprints, across days, and picks up from the map after any interruption.
- **Focus before acting.** Before running code, writing files or changing the map, the agent must say which node of the map it is advancing. Without that, or on a branch already refuted, the action is refused and logged. That both prevents drift and measures it.
- **Kill conditions.** Every hypothesis states up front what result would show it is a dead end. When a result meets the condition, the hypothesis is refuted.
- **Advisor.** A read-only advisor reviews the map every 3 sprints, after a stop signal or a finding, at half and four-fifths of the budget, and when two sprints in a row moved nothing. For each node it says continue, invest, drop, pivot, or ask a person, and the verdict takes effect.
- **Evidence.** Experiments run in an isolated Docker sandbox on your computer (no network, only the project's own directory mounted), and the system keeps their logs. A result is recorded only with real log lines or sentences from a paper, and every number in it must appear in that evidence.
- **Playbook: improving across projects.** When a project ends, a distiller turns how it went (the advisor's calls, the kill decisions, the drift) into "in this situation, do this" judgment rules. A rule takes effect once two projects support it, and harmful rules are retired. Later projects read the playbook: the research process improves while the model stays the same.
- **Process metrics.** Drift, backtrack delay, handoff rate, evidence count and cost per supported finding are computed from the record, so different setups can be compared.

## Status

This is an early version. What has actually run:

- **The full research loop**, end to end with a real model (gpt-6-luna): local Docker experiments, the research map, the advisor, evidence checks, the playbook and the research report.
- **Seven evaluation rounds** on held-out tasks covering four kinds of research judgment:

  | Task | The right move |
  |---|---|
  | Find a threshold | Numbers that match the truth |
  | Missing data | Say so and stop to ask |
  | A tempting dead end | Refute it and stop |
  | Label leakage | Doubt a near-perfect score and find the leaking column |

  The main failures each round found were fixed; the model never changed. In the latest round, 17 of 18 runs ended the right way. On the leakage task, right endings went from 3 of 6 in round 3 to 9 of 10 in round 7. See the [evaluation record](docs/research/2026-10-20-third-results.md) (in Chinese).
- **The advisor's job is knowing when to stop.** Without it, the executor stays honest and gets the numbers right, but all 6 runs used the whole budget, at 1.3 to 2.5 times the cost.
- **The playbook (self-improvement)** was tested from an empty playbook. It learned rules on 5 learning tasks, then ran held-out tasks it had never seen:
  - with the learned playbook: 9 of 9 runs scored full marks, in 22 sprints and 160k tokens;
  - without a playbook: 6 of 9, in 40 sprints and 263k tokens.

  That is 3 seeds per condition. See the [controlled run](docs/research/2026-10-20-learned-playbook.md). The developer-reviewed playbook used earlier showed no such effect.
- **Not there yet**: more seeds and tasks of other kinds, research in the hosted version (it runs locally for now), and GPU experiments.

## Reading papers

The other half of the agent is reading papers. That part also works on its own, and the [online version](https://papers.dougao.online) is exactly that:

- Import a PDF, an arXiv link or any paper URL and get a guide. Every sentence is cited, and a click takes you back to its sentence.
- Select text to explain, translate, highlight, comment or keep in notes. Box a figure or formula to ask about it.
- The assistant can see attached images and boxed regions, with a model that has vision.
- Parallel translation, layout translation and LaTeX recompilation.
- Markdown notes, a library, related papers and recommendations.

## Run it on your computer

```bash
git clone https://github.com/Jialei-03/open-research-agent
cd open-research-agent
make install   # .venv plus backend, frontend and agent runtime dependencies
make build     # build the frontend
python -m backend.local --port 8765   # local edition, no sign-in, open http://127.0.0.1:8765
```

Research needs Docker and a one-time sandbox build:

```bash
make research-image
```

With colima on macOS, Docker sees only your home directory by default. The data directory is `~/.open-paper-reader/`, so nothing needs changing. Add a model in Settings the first time (an API key or a local model). See [Local build](docs/LOCAL.md).

## Development

```bash
make help      # every command
make test      # backend tests
```

Layout, tests and conventions are in [Development](docs/DEVELOPMENT.md). The research design and plans are in [`docs/superpowers/`](docs/superpowers/).

## License

[MIT](LICENSE). Third-party licenses are in [NOTICE](NOTICE.md). Not affiliated with Anthropic or OpenAI.
