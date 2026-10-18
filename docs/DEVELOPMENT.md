# 开发

从仓库根目录运行命令。`make help` 列出常用任务。部署见 [部署](DEPLOYMENT.md)，整体结构见 [架构](ARCHITECTURE.md)。

## 1. 安装与启动

需要 Python 3.13 和 Node.js 22（`.nvmrc`）；CI 和 Docker 镜像用的就是这两个版本，其他版本没有验证过。

```bash
git clone https://github.com/Jialei-03/zhijian.git
cd zhijian
make install        # 建 .venv，安装后端（含测试依赖）、前端和助手运行时的依赖
make env            # 没有 .env 时从 .env.example 复制
make db             # 应用数据库迁移（本机默认 SQLite：data/platform.db）
make build          # 构建前端，由 API 一并提供
make run            # http://127.0.0.1:8765
```

不想用注册页创建第一个账户，可以在还没有任何用户的时候运行（密码在隐藏输入里填，至少 8 个字符）：

```bash
set -a; source .env; set +a
.venv/bin/python -m backend.cli bootstrap --username admin
```

`make run`（`scripts/run.sh`）会自动加载 `.env`；命令行、迁移和 worker 需要所在终端先加载同一个 `.env`（`make db`、`make worker` 已经替你做了）。

## 2. 日常开发进程

| 进程 | 命令 | 用途 |
| --- | --- | --- |
| API + 已构建的前端 | `make run` | `127.0.0.1:8765` |
| 前端热更新 | `make web` | `127.0.0.1:5173`，把 API 代理到 8765 |
| 助手 worker | `make worker` | 处理助手对话、导读、测验、逐页翻译 |
| 翻译 worker | `.venv/bin/python -m backend.translation_worker` | 整篇翻译（需要 Docker 镜像） |

助手 worker 需要 Node.js >= 22 和 `agent-runtime` 的依赖；`sh scripts/check-agent-runtime.sh` 检查实际入口能否加载（不调用模型）。Node 不在 `PATH` 里时设置 `AGENT_NODE` 为绝对路径。模型可以在网站的「设置 → 模型」里添加，或者用 `scripts/set-local-model.sh` 写一个共享模型文件（见 [配置](CONFIGURATION.md#共享模型文件)）。

普通的文库、PDF 和笔记开发不需要 Docker。要用到助手的沙箱工具、LaTeX 编译或版面翻译时，才需要对应的镜像，见 [部署](DEPLOYMENT.md#可选组件)。不要把宿主机终端或 Docker socket 直接交给网页里的助手。

API 文档：`/api/v1/docs`（需要构建过前端）；OpenAPI：`/api/v1/openapi.json`；说明见 [API](API.md)。

## 3. 代码地图

| 路径 | 职责 |
| --- | --- |
| `frontend/src/main.tsx` | 入口：官网、登录、找回密码；工作区和分享页按需加载 |
| `frontend/src/Workspace.tsx` | 登录后的工作区（路由、数据、导航），由入口懒加载 |
| `frontend/src/styles.ts` | 全部样式表及其顺序（见下方「样式顺序」） |
| `frontend/src/features/Reader.tsx` | 阅读器：组合、侧栏面板（助手/解释/翻译/批注/笔记/图表/引用文献/测验）与顶栏 |
| `frontend/src/features/PdfView.tsx` | PDF.js 渲染、滚动、缩放；整个阅读区统一读取选区（含跨页） |
| `frontend/src/features/PdfSelectionMenu.tsx` | 文字、框选区域、整页三种菜单（拖选与右键） |
| `frontend/src/features/ParallelTranslation.tsx` | 原译文对照、生成状态与选项 |
| `frontend/src/features/ReadingActivity.tsx` | 解释与翻译两种记录（每个面板只显示一种） |
| `frontend/src/features/AgentPanel.tsx` | 助手会话与输入 |
| `frontend/src/features/ProductSite.tsx`、`landing-content.ts` | 官网首页及其内容（截图见 [SHOWCASE](SHOWCASE.md)） |
| `frontend/src/components/ui/` | 仓库内可以直接修改的 shadcn/ui 组件 |
| `backend/main.py`、`models.py` | API 组装、持久化模型 |
| `backend/agent_worker.py`、`agent_tools.py` | 助手调度、工具执行和权限 |
| `backend/direct_runs.py`、`reading_artifacts.py` | 固定任务（翻译、导读、测验…）与阅读产物的原文校验 |
| `backend/translation_worker.py` | 整篇翻译 worker |
| `agent-runtime/` | 助手的 Node 运行时，`skills/` 是写给模型的操作说明 |
| `backend/migrations/versions/` | Alembic 迁移 |
| `backend/tests/`、`frontend/e2e/` | 后端与浏览器测试 |
| `deploy/`、`scripts/` | 部署文件，以及验证、基准和官网截图工具 |

### 脚本

| 脚本 | 作用 |
| --- | --- |
| `scripts/run.sh` | 加载 `.env`、迁移、启动 API（`make run`） |
| `scripts/set-local-model.sh` | 交互式写一个共享模型文件 `data/platform-model.json`，本机试用模型 |
| `scripts/check-agent-runtime.sh` | 检查助手运行时能否加载（不调用模型） |
| `scripts/e2e_server.py` | 浏览器测试用的临时服务（独立的数据库、账户和存储） |
| `scripts/verify_lifecycle.py` | 重启、备份、恢复的真实演练，见 [运维](OPERATIONS.md#一致性与故障演练) |
| `scripts/bench_model.py` | 用真实模型测量各功能的速度，见 [性能](PERFORMANCE.md) |
| `scripts/rebuild_translation_alignment.py` | 从保留的翻译检查点重建缺失的译文对应位置（默认只演练；运维用） |
| `scripts/showcase/` | 官网演示空间与截图的生成，见 [首页与截图](SHOWCASE.md) |

### 样式顺序

`design-system.css` 必须是最后生效的样式表：它统一覆盖各处的圆角、阴影、字号和阅读器外观。所有样式表都在 `frontend/src/styles.ts` 里按固定顺序导入，并且只从入口加载；被懒加载的模块自己导入的样式表会排在 `design-system.css` 之后，悄悄覆盖它。**新增样式表时，把它加到 `styles.ts`（`design-system.css` 之前）**，组件里的 `import "./x.css"` 可以保留。

包体：官网和登录页只下载入口（脚本合计不到 500 KB，测试里有预算）；登录后才加载工作区。已登录过的设备在检查会话的同时预取工作区；停在登录页的人在触碰页面或 3 秒后预取。`frontend/e2e/entry-split.spec.ts` 守着这个预算。

## 4. 验证

```bash
make test                         # 后端测试（pytest）
npm --prefix agent-runtime test   # 助手运行时（用真实 Pi 对接本地模拟的模型）
make check                        # 前端类型检查与格式检查
npm --prefix frontend run test:unit   # 前端纯逻辑（Vitest）
npm --prefix frontend run test:ui     # 新界面组件演示页（Playwright，自带开发服务器）
make build
cd frontend && npx playwright install chromium --only-shell && npx playwright test
```

- 浏览器测试自己启动一个独立的临时数据库和账户（`scripts/e2e_server.py`）。它读取 `frontend/dist`，所以改了源码要先 `make build`，整套运行期间不要重新构建。
- 同一个账户同一时间只允许一个排队或运行中的助手任务。创建了任务的用例必须取消它（`e2e/helpers.ts` 里的 `cancelActiveRuns`），否则后面需要创建任务的用例会连锁失败。
- 有 4 条浏览器用例需要本机的参考材料，没有时会被**跳过**（跳过不等于通过）：`PDF_LAYOUT_IMAGE`（版面翻译的控制面）、`REALMEM_FIXTURE_DIR`（一篇真实论文的原始文件）、`data/paper-study/mem0/mem0.pdf`，以及 `READER_ORIGINAL_PDF` 与 `READER_TRANSLATED_PDF`（双语阅读的视觉验收）。
- PostgreSQL 专项测试需要独立的 `TEST_POSTGRES_URL`；没有配置时这些测试被**跳过**，跳过不等于通过。CI（`.github/workflows/verify.yml`）使用一个临时的 PostgreSQL 服务，并构建 Docker 镜像。
- `scripts/verify_lifecycle.py` 是一次真实的重启、备份、恢复演练，见 [运维](OPERATIONS.md#一致性与故障演练)。
- 按改动先跑相关测试：

  ```bash
  .venv/bin/python -m pytest backend/tests/test_agents.py -k pi_worker_tool_loop_and_followup -q
  cd frontend && npx playwright test e2e/parallel-translation.spec.ts e2e/selection-menu.spec.ts
  ```

- 用真实模型验证会调用上游服务并产生费用。记录用的模型、材料、结果和限制；不要把合成夹具的测试说成真实模型或真实论文的验收。`scripts/bench_model.py` 见 [性能](PERFORMANCE.md)。
- 新界面的组件在 `frontend/src/ui/`，在仅供开发的演示页 `frontend/ui-kit.html` 里展示：运行 `npm --prefix frontend run dev`，再打开 `/ui-kit.html`；它不属于生产构建。组件的测试在 `frontend/e2e-ui/`。
- 新阅读器在 `#read/<论文 id>`（第 2 阶段结束前旧界面不链接它），浏览器测试在 `frontend/e2e/reader/`。多个检出并行跑浏览器测试时，用 `E2E_PORT`（默认 8766）和 `UI_KIT_PORT`（默认 5174）给各自的测试服务器换端口。
- 生产环境是 Python 3.11，CI 也用 3.11；本机是更新的版本时，上线前用 `uv venv --python 3.11` 建一个环境跑一遍 `pytest -q`。
- `backend/devtools/fake_model.py` 是一个兼容 OpenAI 接口的假模型，按模型名注入故障（超时、回答中途断开、返回内容无法识别、429/5xx 等），`backend/tests/test_model_faults.py` 用它。想亲眼看界面怎么处理失败，可以手动启动：`python -m backend.devtools.fake_model --port 8899`（8899 被占用时换一个端口）。

## 5. 约定

1. 从最新的 `main` 建 `feature/<主题>` 或 `fix/<主题>` 分支，一次改动只做一件事。
2. 页面复用现有的 shadcn/ui 和语义色；阅读内容优先。状态提示不挤动阅读区域，悬停高亮不抢滚动。
3. 修改数据使用现有的 API、所有权检查和版本冲突检查；不要跳过权限，不要覆盖用户的笔记。
4. 助手的最终回答与工具过程分别处理；「成功」必须有真实的工具结果，不能只凭模型自己说成功。
5. 数据结构变更要补迁移；迁移不能被代码回滚替代。
6. 改了界面的行为要补或更新对应的测试；已完成、未验证和已知失败分别如实记录。
7. 提交信息写清楚改了什么、为什么。贡献流程见 [CONTRIBUTING](../CONTRIBUTING.md)。
