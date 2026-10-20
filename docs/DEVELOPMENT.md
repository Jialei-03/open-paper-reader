# 开发手册

给要在这个仓库上继续开发的人：在一台新电脑上把它跑起来，弄清楚代码在哪、研究系统怎么运转、改完怎么验证。从仓库根目录运行命令，`make help` 列出常用任务。整体结构另见 [架构](ARCHITECTURE.md)，研究功能怎么用见 [研究](RESEARCH.md)，部署见 [部署](DEPLOYMENT.md)。

## 1. 在一台新电脑上开始

需要 Python 3.13（生产与 CI 是 3.11，也要能过）、Node.js 22（`.nvmrc`）和 git；研究的 Docker 环境、助手的代码沙箱、版面翻译才需要 Docker。

```bash
git clone https://github.com/Jialei-03/open-research-agent.git
cd open-research-agent
make install        # 建 .venv，装后端（含测试依赖）、前端和 Agent 运行时的依赖
make build          # 构建前端（frontend/dist），后端直接提供它
python -m backend.local --port 8765          # 本机版：免登录，浏览器打开 http://127.0.0.1:8765
```

- 本机版的数据默认在 `~/.open-paper-reader/`（Windows：`%APPDATA%\open-paper-reader`）：SQLite 数据库 `workspace.db`、上传的文件、`research/`（研究的工作区、日志、数据集缓存、`settings.json`、`playbook.json`）。启动时自动应用数据库迁移。
- 第一次打开时在「设置 → 模型」里添加模型（OpenAI 兼容接口或 Anthropic 的密钥，或本机的 Ollama / LM Studio）。密钥只存在数据目录里，不要写进仓库。
- 研究要先在「设置 → 研究环境」里准备一个环境，默认的「本机」点「让 Agent 准备」即可，见 [研究](RESEARCH.md#准备)。

### 开发时用的独立实例

开发时另起一个实例，用自己的数据目录和端口，不碰日常使用的数据：

```bash
.venv/bin/python -m backend.local.cli --port 8800 --data /tmp/ora-dev/data --no-browser
```

- 这个实例提供的是 `frontend/dist`，**而且 `index.html` 只在启动时读一次**。改了前端，要 `npm --prefix frontend run build`，再重启实例，刷新页面才看得到。改了后端同样要重启。
- 重启会中断正在进行的一轮（这一轮的预算会退还），运行中的实验会被标为丢失；重启尽量攒在一起做，或者先暂停研究。
- 要前端热更新：`cd frontend && DEV_API=http://127.0.0.1:8800 npx vite --port 5181`。注意写操作要从实例自己的地址发（跨源会被拒绝），在热更新页面上只适合看界面。

### Git 与提交

- 提交身份用仓库作者自己的（`git config user.name` / `user.email` 设在本仓库，不要用机器上别的全局身份），提交说明写清改了什么、为什么，不加自动生成的署名行。
- 目前直接在 `main` 上提交并推送；CI 工作流「Verify workspace」暂时停用（`gh workflow enable "Verify workspace"` 可恢复）。推送前在本机跑完下面「验证」里的检查。
- 不提交数据目录、`.env`、模型密钥、实验产物；`.gitignore` 已经排除了 `data/`、`.venv/`、`frontend/dist/` 等。

## 2. 进程

| 进程 | 命令 | 用途 |
| --- | --- | --- |
| 本机版（API + 前端 + 后台 worker） | `python -m backend.local` | 一个进程里带着助手 worker、研究调度和翻译；默认 8765 |
| 服务器版 API | `make run` | 多用户版，读 `.env`，见 [配置](CONFIGURATION.md) |
| 前端热更新 | `make web` | 5173，把 API 代理到 8765 |
| 助手 worker（服务器版） | `make worker` | 助手对话、导读、测验、研究的每一轮 |

Agent 的每次运行都是一个子进程：`backend/agent_worker.py` 准备好上下文和工具，交给 `agent-runtime/runner.mjs`（基于 [Pi](https://github.com/earendil-works/pi)），工具调用再回到 Python 执行。Node 不在 `PATH` 里时设 `AGENT_NODE`。`sh scripts/check-agent-runtime.sh` 检查运行时能否加载（不调用模型）。

## 3. 代码地图

### 前端（`frontend/src`）

| 路径 | 职责 |
| --- | --- |
| `main.tsx`、`styles.ts` | 入口；全部样式表按固定顺序在这里导入（见下方「样式顺序」） |
| `app/` | 登录后的外壳：`AppShell`（路由到各页、设置窗口浮在当前页上）、`AppSidebar`、`routes.ts`（`#home`、`#projects/<id>/<tab>/<对话>`、`#research/<id>`、`#read/<论文>`、`#settings/<分类>`） |
| `ui/` | 自己写的组件库（按钮、对话框、输入框……），演示页 `frontend/ui-kit.html` |
| `screens/home/`、`HomeScreen.tsx` | 首页：研究项目、继续阅读、推荐、最近导入 |
| `screens/research/projects/` | 研究项目：项目列表、项目页（看板、对话、研究、项目资料）、项目对话 |
| `screens/research/ResearchProject.tsx` | 一个研究：对话主线、实时卡片、右侧记录面板 |
| `screens/research/talk/` | 对话主线（`thread.ts` 从事件推导出对话条目）、计划卡片、决定卡片、输入框、记录面板、环境准备窗口 |
| `screens/research/files/` | 记录面板的「文件」页签：研究工作区的目录树、预览（代码、Markdown、CSV、图片、PDF）、下载、拖拽上传；「插入到输入框」发 `ora:composer-insert` 事件，`ora:open-files` 事件打开这个页签（参考 pi-web，MIT） |
| `screens/research/process/` | Agent 的工作过程：步骤、命令和输出、打字机效果（参考 claude-web 和 pi-web，MIT） |
| `screens/research/scene/` | 「现场」：像素风的办公室，角色随 Agent 的状态走动 |
| `screens/research/research-api.ts` | 研究相关的全部接口和类型 |
| `screens/settings/` | 设置窗口：通用、模型、研究环境、实验追踪、研究手册、数据、用量、访问 |
| `reader/` | 阅读器：PDF、划选菜单、助手、翻译、笔记 |
| `features/ProductSite.tsx` | 官网（未登录时的首页），截图在 `public/assets/site/` |
| `i18n/messages/{zh,en}.ts` | 全部界面文字。界面里不能写死中文（`npm run check` 会查），两种语言的键要一致 |

### 后端（`backend`）

| 文件 | 职责 |
| --- | --- |
| `main.py`、`models.py`、`migrations/versions/` | API 组装、数据模型、Alembic 迁移 |
| `local/` | 本机版的启动、数据目录和后台进程管理 |
| `cloud_link.py` | 本机版连接线上账号：登录一次换访问令牌（存在数据目录的 `cloud-link.json`，不存密码），按 PDF 的 SHA-256 双向同步论文；只在本机版注册接口 |
| `agent_worker.py`、`agent_tools.py`、`tool_spec.py` | Agent 运行的调度、给模型的工具清单、工具执行和权限 |
| `agents.py` | 阅读助手的会话与运行接口 |
| `research_routes.py` | 研究的全部 HTTP 接口 |
| `research_workspaces.py` | 研究项目、看板、想法卡片 |
| `research_chat.py` | 项目里的对话：只读地读项目里的研究、实验和日志 |
| `research_stages.py` | 阶段：定题对话、计划、批准、结论、预算、改问题 |
| `research_worker.py` | 调度：每隔几秒决定哪个研究下一轮由谁做，收尾异常的轮次，提炼 |
| `research_brief.py` | 每一轮的简报：问题、地图、交接、导师意见、环境、数据、你说的话 |
| `research_tools.py` | 研究工具的定义、按角色的权限（`gate`）和执行 |
| `research_map.py` | 研究地图（节点和事件） |
| `research_advice.py` | 导师的判断如何落到地图上 |
| `research_evidence.py` | 结果能引用什么：日志行和论文原句的核对 |
| `research_files.py` | 研究工作区的文件：列目录（标出最近一轮执行者写过的）、读和下载、上传；路径不能出工作区，也不跟随指向外面的链接；只在本机版 |
| `research_sandbox.py` | 实验：启动、收作业、日志、指标；按环境类型分派 |
| `research_host.py` | 本机直接运行的环境 |
| `research_remote.py` | SSH 机器 |
| `research_environment.py` | 由 Agent 准备环境，以及系统自己的检测 |
| `research_settings.py` | 研究环境与实验追踪的配置（`research/settings.json`） |
| `research_datasets.py` | 公开数据集的下载（后台、选最快的镜像、校验）与上传记录 |
| `research_tracker.py` | 同步到 SwanLab / W&B |
| `research_ora/` | 实验里用的 `ora` 模块、环境检测脚本、远端和本机用的文件与命令工具（只用标准库） |
| `research_playbook.py`、`research_metrics.py`、`research_report.py` | 研究手册、过程指标、研究报告 |

### Agent 运行时（`agent-runtime`）

`runner.mjs` 跑一次 Agent；`skills/` 是写给模型的说明，每个研究角色一份：`research-scoping`（定题的导师）、`research-executor`（执行者）、`research-advisor`（导师）、`research-distiller`（提炼者）、`research-envsetup`（准备环境）、`research-chat`（项目对话）。改 Agent 的行为，先看对应的 skill。

## 4. 研究系统

一个研究（`ResearchProject`）属于一个项目（`ResearchWorkspace`），有阶段 `stage`：scoping → experiments → conclusion → retrospective → done。

**一轮是怎么跑起来的**

1. `research_worker.tick` 每隔几秒运行一次：收作业结果（`research_sandbox.sweep`）、在后台启动数据集下载、同步实验追踪、收尾环境准备，然后对每个进行中的研究调用 `_plan`。
2. `_plan` 先收尾已经结束的一轮（`_settle`），有等着的作业或数据就等，然后用 `next_role` 决定下一轮是谁（定题时是导师对话；之后是执行者，按规则轮到导师），写一个 `ResearchSprint` 和一个 `AgentRun`（`runtime.research` 里写着角色、研究和这一轮）。
3. `agent_worker` 取到这个运行：系统提示是这个角色的 skill，上下文是 `research_brief` 写的简报，工具是 `research_tools(role)`。研究的每一轮**不带聊天历史**，一切从简报开始；项目对话例外，它带着这次对话前面的问答。
4. 每个工具调用先过 `research_tools.gate`：角色能不能用、执行者是否先聚焦了、项目对话只能读。文件和命令工具交给 `research_sandbox.pi_call`，按研究的环境分派到 Docker、本机（`research_host`）或 SSH（`research_remote`）。
5. 执行者用 `end_sprint` 交接；导师用 `advise` 给判断（`research_advice.apply` 落到地图上，结论和请你拍板的事变成等你决定的条目）。

**人在哪里决定**：计划（`approve_plan`）、结论（接受或要求补做）、预算用完（追加或结束）、导师的提问和请你拍板。它们都是 `decision_requested` 事件，由 `research_stages.decide` 处理，在研究页的对话里显示成卡片。

**实验**：`run_job` → `research_sandbox.start_job` 记一个 `ResearchJob`。作业在后台运行，退出码写在它的报告目录里，`sweep` 据此区分结束、超时和丢失；结束时收回日志、`ora` 报告的超参和指标，并在节点上记一个 `run_result` 事件。作业运行中，`sweep` 每次也读一遍它的 `metrics.jsonl`（SSH 机器上的每 30 秒拉回一次），研究页的曲线、`job_status` 和项目对话因此能看到进行到哪一步。

**环境**：环境的配置在 `research/settings.json` 的 `computes` 里，种类有 `host`、`docker`、`ssh`；准备的结果（用哪个 Python、检测结果、版本）在 `states` 里。本机环境的命令在研究工作区里以普通进程运行，环境变量只给最小的一组（不把服务器自己的环境、包括密钥，带进实验）。

**改 Agent 的行为时**：先想清楚是规则（代码里的 `gate`、`check_plan` 这类硬约束）还是判断（skill 里的说明）。硬约束写代码和测试；判断写进 skill，并在真实的一轮里看它的表现。

## 5. 验证

```bash
.venv/bin/python -m pytest -q            # 后端
npm --prefix agent-runtime test          # Agent 运行时（对接本地模拟的模型）
npm --prefix frontend run check          # 文案目录、类型检查、格式
npm --prefix frontend run test:unit      # 前端纯逻辑（Vitest）
npm --prefix frontend run build
```

- 按改动先跑相关的测试，比如 `.venv/bin/python -m pytest -q backend/tests/test_research_host.py`。研究相关的测试在 `backend/tests/test_research_*.py`。
- 改了界面：构建、重启开发实例，在浏览器里实际点一遍，深色和浅色、中文和英文都看一下。
- 浏览器测试：`make build` 后 `cd frontend && npx playwright test`。它们自己起一个临时数据库（`scripts/e2e_server.py`），读的是 `frontend/dist`。同一个账户同一时间只允许一个排队或运行中的助手任务，创建了任务的用例必须取消它。
- 用真实模型验证会产生费用。记录用的模型、材料、结果和限制；不要把模拟模型的测试说成真实验证。`backend/devtools/fake_model.py` 是可以注入故障的假模型。
- 官网截图要来自真实界面：在开发实例里打开一个真实的研究，用 1440×900 截浅色、深色和中英文四张，放进 `frontend/public/assets/site/`。

## 6. 约定

1. 一次改动只做一件事；数据结构变更要补迁移（`backend/migrations/versions/`，编号接着最新的）。
2. 界面用 `frontend/src/ui` 的组件和设计变量；新增的文字同时加进中英文的文案目录。不写死中文，不留没人用的组件、样式和文案。
3. 改数据走现有的接口、所有权检查和版本冲突检查。
4. Agent 说「成功」必须有真实的工具结果；实验数字以系统收回的记录为准，不以 Agent 自己的说法为准。
5. 已完成、未验证和已知失败分别如实记录。

### 样式顺序

`design-system.css` 必须是最后生效的样式表。所有全局样式表都在 `frontend/src/styles.ts` 里按固定顺序导入；新增全局样式表时加到 `styles.ts`（`design-system.css` 之前）。组件自己的样式用 CSS Modules（`*.module.css`），不受这个限制。

## 7. 现状与接下来

已经跑通（2026-10-21）：项目、看板与项目对话；对话式定题和计划卡片；本机（Apple MPS）、Docker、SSH 三种由 Agent 准备的研究环境；实验记录、指标自动入地图；导师提问；暂停会停下正在进行的一轮和实验。用真实模型在本机 MPS 上跑过 CIFAR-10 的研究。

已知的问题和下一步：

- **调度还是按轮轮询**：一轮里等作业、作业结束再开下一轮。应该改成由事件驱动（作业结束、你说话、数据就绪时才唤醒相应的角色）。
- **假设的排序**：计划卡片按导师写的顺序排，还没有按价值和代价自动排序。
- **CI 暂停中**：恢复前先在本机跑完整的浏览器测试。
- 研究功能只在本机版里提供，在线版只读论文。
