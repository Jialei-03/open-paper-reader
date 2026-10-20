# 开源自动科研（AI Scientist / auto-research）项目调研

调研日期：2026-10-20。

数据来源与可信度说明：
- 星数、许可证、提交数来自 2026-10-20 通过网页抓取工具读取的 GitHub 仓库首页快照。抓取结果可能带缓存，星数是"约值"。
- 抓取内容通常不显示最后提交日期，所以"最近活动"一栏大多写"未验证"。凡写"未验证"的，请上 GitHub 的 Activity 页面确认。
- 标 [二手] 的内容来自博客、聚合站或搜索摘要，没有核对原始论文或 README。
- 标 [未验证] 的是我没能确认的说法。没有编造数字。

---

## 0. 速览表

| 项目 | 仓库 | 星数（2026-10-20 快照） | 许可证 | 人在回路 | 主要形态 |
|---|---|---|---|---|---|
| AI-Scientist v1 | SakanaAI/AI-Scientist | 约 14.8k | AI Scientist Source Code License（基于 RAIL 的派生，要求披露 AI 参与） | 无流程内检查点 | CLI + 模板 |
| AI-Scientist-v2 | SakanaAI/AI-Scientist-v2 | 约 7.4k | 同上 | 无流程内检查点 | CLI，最佳优先树搜索 |
| Agentic Scientist（v3） | SakanaAI/AI-Scientist-v3（路径取自抓取成功的页面） | 约 412 | Apache-2.0 | 无审批闸门；有 Run Inspector 事后查看 | CLI + 浏览器 Inspector |
| Agent Laboratory | SamuelSchmidgall/AgentLaboratory | 约 5.9k | MIT | co-pilot 模式（配置 `copilot-mode: "true"`） | CLI |
| RD-Agent | microsoft/RD-Agent | 约 15.0k | MIT | Copilot / Agent 两种模式 | CLI + Streamlit + Web UI |
| AIDE / aideml | WecoAI/aideml | 约 1.6k | MIT | 基本无 | CLI + Streamlit |
| MLAgentBench | snap-stanford/MLAgentBench | 约 356 | MIT | 无（交互模式标注 under construction） | 基准 |
| OpenHands | OpenHands/OpenHands | 约 91.3k | MIT | 本次抓取未覆盖 | CLI / Web GUI / SDK |
| data-to-paper | Technion-Kishony-lab/data-to-paper | 约 830 | MIT | Autopilot / Copilot 应用 | GUI（Copilot app） |
| DeepScientist | ResearAI/DeepScientist | 约 3.4k | Apache-2.0 | 暂停 / 接管 / 编辑 / 恢复 | Web 工作区 + TUI + IM 连接器 |
| Biomni | snap-stanford/Biomni | 约 4.0k | Apache-2.0（部分集成工具许可更严） | 页面未描述 | Python API + Gradio + 网页平台 |
| AI-Researcher | HKUDS/AI-Researcher | 约 5.8k | 页面未声明许可证 | 页面未描述（宣称无需人工干预） | Gradio GUI |
| CodeScientist | allenai/codescientist | 约 351 | Apache-2.0 | 论文的主要模式就是 human-in-the-loop | Web 界面（Modal 云容器跑实验） |
| GPT-Researcher | assafelovic/gpt-researcher | 约 30.2k | Apache-2.0 | 页面未描述 | FastAPI 前端 / NextJS |
| open_deep_research | langchain-ai/open_deep_research | 约 12.7k | MIT | 仅旧版工作流有计划审批；仓库已归档 | LangGraph Studio |
| STORM / Co-STORM | stanford-oval/storm | 约 31.7k | MIT | Co-STORM：用户插话 + 思维导图 | 在线演示 + Streamlit |
| karpathy/autoresearch | karpathy/autoresearch | 约 98.2k（2026-06 的二手来源写 86k） | MIT | 人只改 `program.md` | Markdown 驱动，无 UI |
| AutoResearchClaw | aiming-lab/AutoResearchClaw | 约 14.7k | MIT | 7 种 HITL 模式 | CLI + 消息平台 |
| EvoMap/AutoResearch | EvoMap/AutoResearch | 约 3.2k | Apache-2.0 | 人选计划、可随时接管 | 基于 Claude Code CLI + 仪表盘 |
| pi-autoresearch | davebcn87/pi-autoresearch | 未取到 | MIT（npm 包） | Pi 扩展内的实验循环 | Pi TUI + 实时看板 |

---

## 1. Sakana AI 系列

### 1.1 AI-Scientist（v1）
- **仓库**：https://github.com/SakanaAI/AI-Scientist ；约 14.8k 星，2.1k fork，98 次提交，96 个 open issue（2026-10-20 快照）。许可证是自定义的"AI Scientist Source Code License"，要求在产出论文中披露 AI 参与。最后提交日期：未验证。
- **端到端**：想法生成（基于种子想法和模板）→ 用 Semantic Scholar 或 OpenAlex 做新颖性检查 → 在模板代码上做实验 → 画图 → 写 LaTeX 论文 → 自动评审（`perform_review`）。
- **架构**：入口 `launch_scientist.py`，参数是模型、模板、想法数。每个模板目录含 `experiment.py`、`plot.py`、`prompt.json`、`seed_ideas.json` 和 LaTeX 模板。官方模板三个：NanoGPT、2D Diffusion、Grokking；其余是社区贡献，官方不维护。控制流是线性流水线，外加评审环节，没有树搜索。
- **人在回路**：流程内没有检查点。人只是选模型和模板、提供 key、启动、事后阅读。README 要求人自己先跑 baseline（`run_0`）以获得准确耗时，并要求披露 AI 参与。
- **验证**：主要靠自动评审（README 推荐 GPT-4o 做评审，称其他模型有偏正面或格式不符的问题）。没有结果溯源机制。
- **已知问题**：
  - README 自述：想法必须能用代码表达；成功率取决于模板、基座模型和想法复杂度；Claude Sonnet 3.5 成功率最高；执行 LLM 写的代码有风险，建议容器化。
  - 约每篇 15 美元以内（README FAQ）。
  - Beel 等人的评测（arXiv 2502.14297，Beel、Kan、Baumgart；SIGIR Forum 2025；有 v1/v2/v3 三个版本，v3 在 2025-10-15，题目改为 "Bold Claims, Mixed Results, and a Promising Future?"）。摘要页没写评测的是 Sakana 的哪个版本。其发现：
    - 文献检索只是简单关键词搜索，新颖性判断薄弱，把 SGD 微批次这类已有想法判为新；
    - 约 42% 的实验因代码错误失败，其余结果常有缺陷或误导；
    - 每轮迭代只多改约 8% 字符，适应性有限；
    - 稿件引用中位数 5 篇，34 篇里只有 5 篇是 2020 年后的；
    - 稿件常见缺图、章节重复、占位文本，部分含幻觉数值；
    - 整体质量类似"匆忙写成的本科论文"，但每篇成本约 6–15 美元、约 3.5 小时人工参与，速度和成本上有明显优势。
  - 二手摘要还提到"图表评审步骤会生成漂亮图表，掩盖薄弱实验"，我没在原文核实 [二手，未验证]。
- **UI**：CLI。Docker 由社区提供（`experimental/`）。需要 Linux、NVIDIA GPU、pdflatex。

### 1.2 AI-Scientist-v2
- **仓库**：https://github.com/SakanaAI/AI-Scientist-v2 ；约 7.4k 星，1.0k fork，58 次提交；许可证同 v1。最后提交日期：未验证。
- **端到端**：想法生成（`perform_ideation_temp_free.py`，从 Markdown 主题文件出发，用 Semantic Scholar 检查新颖性）→ 代理式树搜索实验（`launch_scientist_bfts.py`）→ 写作、引用、评审、图表汇总由独立模型完成。不再依赖人写的模板。
- **架构**：由实验管理 agent 引导的最佳优先树搜索（BFTS），建立在 AIDE 之上。配置 `bfts_config.yaml` 含 `num_workers`、`steps`、`num_seeds`、`max_debug_depth`、`debug_prob`、`num_drafts`。控制流是"树搜索 + 调试深度限制"，写作阶段约 20–30 分钟。
- **人在回路**：无流程内闸门。
- **验证**：自动评审 + VLM 图表反馈（后者是我对论文的记忆，页面没写 [未验证]）。
- **已知问题**：
  - README 自述：比 v1 在有清晰模板的任务上成功率更低，定位是开放式探索；有些运行不产出 PDF 或评审；每次实验约 15–20 美元，写作约 5 美元（Claude 3.5 Sonnet）；Semantic Scholar 限流会削弱新颖性检查和引用收集；执行代码有风险，建议 Docker。
  - 独立研究（arXiv 2509.08713 "The More You Automate, the Less You See: Hidden Pitfalls of AI Scientist Systems"）评估了两个开源 AI scientist 系统（摘要页没点名，但搜索摘要称是 Agent Laboratory 与 AI Scientist v2 [二手]），归纳四类失败：基准选择不当、数据泄漏、指标误用、事后选择偏差。结论是看完整 trace 日志和代码比只看论文容易发现问题，建议期刊和会议要求提交 trace 与代码。
  - 搜索摘要称这两个系统未直接偷看测试标签，但有时在未披露的情况下换成合成数据或缩小数据集 [二手]。
- **UI**：CLI。

### 1.3 Agentic Scientist（"v3"，2026-10 发布）
- **来源**：Sakana 于 2026-10-15 公布，arXiv 2610.18933（88 页，2026-10-13 提交；ID 来自二手搜索摘要 [二手]）。仓库页 https://github.com/SakanaAI/AI-Scientist-v3 能抓取到：约 412 星、64 fork、8 次提交、Apache-2.0。对这个路径是否为官方主仓库，我只有页面内容可依据，建议人工再确认。
- **端到端**：六个顺序阶段：任务起草、调查、消融、最终评估、事后分析、论文。评审和修订阶段可选。每个阶段在独立容器里运行，只读取该次运行的任务快照。
- **架构**：元控制器调度并行的 coding-agent 工作者；通过 headless CLI 驱动 Claude、Codex、Cursor、OpenCode、Gemini 和 Pi [二手，搜索摘要；README 页面本身我没看到这个列表]。注意：这说明 Pi 已是 Sakana 官方适配的运行时之一。
- **人在回路**：README 没有审批闸门，也没有流程内检查点。只提示：运行目录分享前要人工检查（日志可能回显文档内容和路径），只运行可信任务和来源。官方说法是"共同科学家"而非自主（ALIFE 2026 论文由开发版产出并被接收，来源不一致，有的说是口头报告，有的说是 talk [二手]）。
- **验证**（这是现有项目里验证设计最实的一个）：
  - 任务起草阶段产出"封闭的评估器和评分标准"，带资格检查、修复步骤和起草审计；
  - 最终评估在封闭环境里重新给胜出程序打分；
  - 论文阶段把稿件和收集到的证据做对照审计；
  - 失败阶段标记为 degraded，不静默丢弃；
  - 自动 baseline 和 ablation 用来检验表面结果是否成立（新闻稿说法）。
- **已知问题**：README 自述：从一句简短 brief 起草任务是实验性的，大任务不稳；agent 以 `--allow yolo` 权限运行，会继承 API key，需放进 Docker；GPU 预设要匹配；有的任务一次评估要训练数小时。新闻稿提到一个被评错分的候选，说明科学判断还不能外包。
- **UI**：CLI + `agsci inspect start` 启动本地浏览器 Run Inspector（127.0.0.1:8765），用来浏览运行目录。
- 注意：jsipe.com 的文章中关于规划、统计评论员 agent、出处元数据的描述是作者推测，不能当作 README 事实。

---

## 2. Agent Laboratory
- **仓库**：https://github.com/SamuelSchmidgall/AgentLaboratory ；约 5.9k 星，806 fork，44 次提交，MIT。最后提交日期：未验证。
- **端到端**：三阶段：文献综述 → 实验（数据准备、跑实验）→ 报告写作。产出代码仓库和研究报告。工具：arXiv、Hugging Face、Python、LaTeX。
- **架构**：每个阶段由专门的 LLM agent 负责。角色细节在论文（arXiv 2501.04227）里，我只读到摘要，没读到全文，所以角色名单未验证（我记忆中有 PhD、postdoc、ML engineer、professor 等角色，标 [未验证]）。控制流是三阶段线性流水线。
- **人在回路**：在 YAML 配置里把 copilot 模式设为 `"true"`，则每个阶段结束后由人给反馈（论文摘要："每个阶段的人类反馈显著提高整体研究质量"）。README 没给更细的交互细节。
- **验证**：论文声称生成的 ML 代码在对比方法中达到 SOTA，且相对既往自主方法成本降低 84%（摘要，自述）。README 没有溯源或引用核验机制。
- **已知问题**：README 自述代码"有很大改进空间"，非英语未充分测试，强模型更好但更贵更慢。独立研究（2509.08713）将其与 AI Scientist v2 一并评估，发现有未披露的数据替换 [二手]。
- **UI**：CLI（`python ai_lab_repo.py --yaml-location ...`）。仓库里有 `app.py`，README 未说明用途。

---

## 3. Microsoft RD-Agent
- **仓库**：https://github.com/microsoft/RD-Agent ；约 15.0k 星，2.1k fork，1,023 次提交，MIT。最后提交日期：未验证。
- **做什么**：数据驱动的 R&D 自动化。"R"提想法，"D"实现。场景包括量化因子与模型（RD-Agent(Q)）、医疗建模、论文/报告复现、Kaggle 调参（Data Science Agent，预览）、LLM 微调。
- **架构**：研究（提想法）与开发（实现、执行）的循环；默认 LiteLLM 后端；多数场景需要 Docker；仅支持 Linux。
- **人在回路**：Copilot 模式"按人的指示自动化重复工作"，Agent 模式自主提想法；输入由人提供（论文、报告、比赛名、配置）。README 没有描述显式的审批检查点。
- **验证**：主要靠 MLE-bench 自报成绩：o3(R)+GPT-4.1(D) 总体 30.22 ± 1.5%（6 个 seed），AIDE o1-preview 16.9%。这是自报数据，用的是执行即打分的环境，和科研判断无关。
- **已知问题**：README 自述：Data Science Agent 仍在开发；Web UI 尚不支持数据科学场景；旧 pickle trace 默认不加载（安全）；免责声明说不适用于金融投资。
- **UI**：`rdagent ui`（Streamlit 查看运行日志）；`rdagent server_ui`（Flask 后端 + 前端，默认 127.0.0.1，需要 `UI_SERVER_AUTH_TOKEN`）。

---

## 4. AIDE（Weco）
- **仓库**：https://github.com/WecoAI/aideml ；约 1.6k 星，249 fork，97 次提交，MIT。最后提交日期：未验证。
- **做什么**：树搜索 agent。每个 Python 脚本是树中的一个节点，LLM 生成补丁产生子节点，指标反馈引导搜索，"自主起草、调试并基准测试代码"。只覆盖实验/代码优化，没有文献、写作、评审。
- **与 Weco 的关系**：aideml 是 AIDE 算法的开源参考实现；Weco 是产品化、泛化到代码优化的商业版本，加了实验跟踪和更多用户控制。
- **人在回路**：基本没有。人给数据、目标和指标。
- **验证**：只有指标。验证即"跑完得分"。
- **已知问题**：README 无专门限制章节；完全本地模型（如 Ollama）性能有下降。
- **UI**：Streamlit Web UI（输入 key、上传数据、设目标和指标，实时看日志、解决方案树、最优代码）；CLI 输出 `best_solution.py` 和 `tree_plot.html`。
- 后续影响：AI-Scientist-v2 的树搜索建立在它之上。

---

## 5. MLAgentBench
- **仓库**：https://github.com/snap-stanford/MLAgentBench ；约 356 星，MIT，48 次提交。最后活动：未验证。
- **是什么**：13 个端到端 ML 实验任务的基准（论文 arXiv 2310.03302）。agent 能读写文件、在集群上跑实验、分析结果。支持作者自己的 research agent，也支持 LangChain 与 AutoGPT agent。
- **验证方式**：每个任务有 `env/`（agent 可见）和隐藏的 `script/`（`prepare.py`、`eval.py`）；指标是成功率和相对 baseline 的平均提升；保留 trace.json 交互记录。
- **局限**：README 建议沙箱；交互模式标注 under construction；评估仅限成功率与平均提升。
- **对我们的价值**：它的"隐藏评估脚本 + 轨迹日志"结构是评估基础设施而非产品，可作为我们评估 advisor 的测试床之一。

---

## 6. OpenHands（用于科研时）
- **仓库**：https://github.com/OpenHands/OpenHands ；约 91.3k 星，12.1k fork，8,651 次提交，MIT。最后活动：未验证。
- **定位**：通用软件工程 agent，不是专用科研系统。科研用法是把它当作"实验执行手"：写代码、跑脚本、调试。接口有 CLI（npm 的 `agent-canvas`）、本地 Web GUI（localhost:8000）、Python SDK（`software-agent-sdk` 仓库，实现 Agent Server REST API）。
- **安全**：不用沙箱时 agent 对文件系统有完整访问；有 Docker 沙箱选项；监听默认只绑环回地址。
- **人在回路 / 基准**：本次抓取没覆盖确认模式和基准，未验证。
- **对我们**：它是通用 coding-agent 运行时，不提供科研判断层；科研系统（例如 AI-Scientist-v2 之外的各种项目）常把它当底座。

---

## 7. data-to-paper
- **仓库**：https://github.com/Technion-Kishony-lab/data-to-paper ；约 830 星，95 fork，MIT，2,750 次提交。最后提交日期：未验证。
- **做什么**：数据探索 → 文献检索与想法 → 数据分析与解释 → 分步写作。LLM agent 与规则 agent 交互；统计包被重写并加了护栏，以减少 LLM 常见编码错误。
- **人在回路**（本调研里最具体的一份）：可全自动（Autopilot），或用 Copilot 应用：检查并引导研究、设定目标或让 AI 提假设、请求 AI 评审、回退到更早步骤、录制与回放运行、跟踪 API 成本。
- **验证**：稿件 "data-chained"，文中数值可以追溯到产生它们的代码行；论文带 AI 生成水印。这是最接近"可验证证据"的现有做法。
- **局限**：只适合相对简单的研究目标和数据集（检验统计假设）；作者明说并非无错，需要领域专家审查；代码在用户机器上运行，token 成本可能很高。

---

## 8. DeepScientist
- **仓库**：https://github.com/ResearAI/DeepScientist ；约 3.4k 星，340 fork，341 次提交，Apache-2.0。README 提到 v1.6.0（5 月 12 日更新）和 v1.5（2026-03-24）。最后提交日期：未验证。
- **做什么**：本地优先的长时自主研究系统：复现 baseline → 迭代实验 → 论文式产出（图、报告、草稿，支持 PDF/LaTeX）。每个研究项目（"quest"）是一个 Git 仓库，分支和 worktree 表示不同研究路线，失败路线被保存以便复用。核心机制：Findings Memory、贝叶斯优化、Research Map。
- **论文**（arXiv 2509.26603，摘要）：把发现建模为贝叶斯优化，"假设-验证-分析"分层循环；Findings Memory 平衡探索与利用，把有希望的发现提升到更高保真度验证；宣称生成约 5,000 个想法、实验验证约 1,100 个，在三个前沿 AI 任务上超过人类设计的 SOTA（183.7%、1.9%、7.9%）；消耗超过 2 万 GPU 小时。数字是作者自报，任务名和指标摘要里没写。
- **运行器**：Codex、Claude Code、Kimi Code、OpenCode 四种。
- **人在回路**：随时暂停、接管、编辑计划或代码、恢复；设计原则是"人始终保有接管权并能审计"。
- **验证**：README 说过程可检查（读了什么、改了什么、保留了什么、计划了什么）；"验证导向的产出、减少编造"只在路线图里，不是现有功能。
- **局限**：Windows 原生支持是实验性的（推荐 WSL2）；浏览器认证默认关闭；路线图中的安全、记忆、可审计、降幻觉说明这些还在发展。
- **UI**：Web 工作区（Start Research 对话框、显示分支与 baseline 的 Canvas、指标与 trace 的 Studio/Details 视图）；TUI；Weixin、QQ、Telegram、WhatsApp、Feishu、Lingzhu/Rokid 连接器。
- **对我们**：它和我们的方向最近，Research Map、Findings Memory、保留失败路径、人随时接管都已经有了；但 README 对"何时停止/转向"的规则描述很少（页面没写）。

---

## 9. Biomni（Stanford）
- **仓库**：https://github.com/snap-stanford/Biomni ；约 4.0k 星，730 fork，487 次提交，Apache-2.0（部分集成工具/数据库许可更严）。最后活动：未验证。页面说开源版本在 2025-04-15 冻结，与当前网页平台不同。
- **做什么**：生物医学通用 agent。LLM 推理 + 检索增强的规划 + 基于代码的执行；有大量集成工具与"Know-How Library"（协议、最佳实践），A1 agent 会自动检索相关文档。Biomni-R0 是基于 Qwen-32B、用 agent 交互数据强化学习训练的推理模型，可通过 SGLang 本地部署。
- **人在回路 / 验证**：页面未描述。
- **风险**：README 警告它以完整系统权限执行 LLM 生成的代码，需沙箱。
- **UI**：Python API（`A1`）、Gradio（`launch_gradio_demo()`）、`biomni.stanford.edu` 无代码网页平台。
- **定位**：偏生物信息学任务执行，不是通用的"科研判断"系统。

---

## 10. AI-Researcher（HKU Data Science Lab）
- **仓库**：https://github.com/HKUDS/AI-Researcher ；约 5.8k 星，726 fork，35 次提交；页面未声明许可证（使用前需自行核对）。最后提交日期：未验证。论文 arXiv 2505.18705。
- **端到端**：三阶段：文献综述与想法生成（Resource Collector、Resource Filter、Idea Generator）→ 算法设计、实现、验证与精修 → 论文写作（Writer Agent）。
- **两级入口**：Level 1 用户给出详细想法；Level 2 用户只给参考论文，系统生成想法。
- **基准**：一套用人类专家论文作 ground truth 的综合基准，覆盖 CV、NLP、DM、IR 四个领域，评分维度：新颖性、实验全面性、理论基础、结果分析、写作质量；有排行榜。页面没用"Scientist-Bench"这个名字，该名称我只在论文里印象中见过 [未验证]。
- **人在回路**：页面没有，反而宣称"全生命周期无需人工干预"，自主性没有独立验证。
- **局限**：文档称"即将"补全，技术报告"即将"发布；需要 Docker、API key，可选 GPU。
- **UI**：Gradio（`python web_ai_researcher.py`）；有托管版 novix.science。

---

## 11. CodeScientist（AllenAI）
- **仓库**：https://github.com/allenai/codescientist ；约 351 星，Apache-2.0，7 次提交。最后活动：未验证。
- **端到端**：想法来自受遗传算法启发的 LLM 搜索（对论文与代码块"codeblocks"的组合做变异）→ Experiment Builder 把想法变成代码，在 Modal 云容器里运行并迭代调试 → LaTeX 报告；一个想法约尝试 5 次，再做元分析。实验分三阶段：MINI_PILOT、PILOT、FULL_EXPERIMENT。
- **安全与成本**：LLM 代理隔离 API key 并记账，设硬性成本上限，超限就退出服务器。
- **人在回路**：论文的主要模式就是 human-in-the-loop：人帮助构建代码示例、筛选要跑的实验想法、评论想法。全自动模式存在，但 README 说"效率更低"。
- **验证**：README 只有运行时调试、日志回传、报告重试，没有形式化验证。论文摘要称做了外部会议式评审、代码审查和复现尝试。
- **已知问题**：README 自述：沙箱执行"有挑战，不总是奏效"，容器可能逃逸；部分报告因 LaTeX 无法编译失败；论文里实验平均约 4 美元，方差大，主要是调试成本；论文语料需要先下载（约 40 分钟）。

---

## 12. Deep Research 开源克隆

### 12.1 GPT-Researcher
- **仓库**：https://github.com/assafelovic/gpt-researcher ；约 30.2k 星，4.3k fork，3,219 次提交，Apache-2.0。最后活动：未验证。
- **架构**：planner 生成研究问题，execution agents 抓取各问题的来源，汇总、过滤成带引用的报告；有 LangGraph + AG2 的多 agent 版本；Deep Research 模式是可配置深度与广度的递归树状流程（自报约 5 分钟、约 0.4 美元，使用 o3-mini 高推理强度）。
- **验证**：引用并追踪来源；准确性主要靠"多站点抓取、取最常见信息"，不是正式事实核查。自报基准（28 个任务）：Jev 过滤 73% 相关段落，对比 embedding 46%，为自报数据。
- **人在回路**：页面未描述。
- **局限**：README 自述实验性、无担保，并称"不建议用于学术或研究论文"。
- **UI**：FastAPI 轻量前端或 NextJS；实时进度。

### 12.2 open_deep_research（LangChain）
- **仓库**：https://github.com/langchain-ai/open_deep_research ；约 12.7k 星，MIT，224 次提交；**仓库已归档（只读）**。
- **架构**：抓到的页面只描述 `src/legacy/` 里的两种旧设计：plan-and-execute（按节顺序写、带反思）和 supervisor-researcher 多 agent（研究员并行）。我印象中的现行版本（clarify → brief → supervisor → 子研究员 → 报告）页面未确认 [未验证]。
- **人在回路**：旧工作流支持交互式反馈并审批报告计划；新版是否暂停，未确认。
- **评估**：配置为 Deep Research Bench（100 个博士级任务，22 个领域，50 中 50 英），RACE 评分用 LLM 评委；表中 GPT-5 配置 0.4943；整批成本 20–100 美元。
- **UI**：LangGraph Studio。

### 12.3 STORM / Co-STORM（Stanford）
- **仓库**：https://github.com/stanford-oval/storm ；约 31.7k 星，3.0k fork，238 次提交，MIT；最近有日期的新闻是 2025-01（litellm 集成），之后的活动：未验证。
- **管线**：写作前研究（多视角提问、建立大纲）→ 写作（带引用文章）；四模块：知识策展、大纲生成、文章生成、文章润色；基于 dspy。
- **Co-STORM**：把人加入 LLM 讨论，用户可观察，也可插话来引导；动态思维导图把收集的信息整理成层级概念结构，降低长讨论的认知负担。路线图把更多 HITL 列为进行中事项。
- **局限**：README 自述"产不出可发表的文章"，常需大量编辑；对写作前阶段有帮助。
- **UI**：在线预览 storm.genie.stanford.edu（称超过 7 万人试用）；Streamlit "Demo light"。
- **对我们**：Co-STORM 的"思维导图作为共享状态"与我们的 research map 思路接近。

---

## 13. autoresearch 风格项目

### 13.1 karpathy/autoresearch
- **仓库**：https://github.com/karpathy/autoresearch ；约 98.2k 星，13.6k fork，MIT，36 次提交（2026-10-20 快照）。二手来源（rywalker.com）在 2026-06 写 86,192 星、12,492 fork，并称仓库自 2026-03-26 起无新提交 [二手，未验证]；一篇指南称发布一个月内超过 66,000 星 [二手]。
- **机制**：agent 只编辑 `train.py`（GPT 模型、Muon+AdamW 优化器、训练循环）；`prepare.py` 负责数据准备和评估，不可改；每次实验固定 5 分钟墙钟预算，看 val_bpb（越低越好），有改进就保留，否则丢弃；约每小时 12 次，一夜约 100 次。
- **人的角色**：不直接改 Python，而是迭代 `program.md`（给 agent 的 Markdown 指令，即"研究组织代码"），启动循环，权限关闭确认。
- **局限**：需要单卡 NVIDIA GPU（作者用 H100）；固定时间预算使结果不同硬件不可比；二手评论指出 5 分钟结果不代表所有任务都适合这个循环，也不代表收益能迁移到完整训练。
- **衍生**：README 链接 macOS（两个）、Windows RTX、AMD 的社区 fork；二手来源提到 awesome-autoresearch 列表、Harrison Chase 的 "autoresearch for agents"（基于 LangSmith 评估）、AutoKernel（GPU kernel 优化）、AutoAgent（优化 agent harness）、autoresearch-at-home（分布式协调）、Hyperspace AGI [二手，均未核对仓库]。

### 13.2 pi-autoresearch（与我们的 Pi 运行时直接相关）
- **仓库**：https://github.com/davebcn87/pi-autoresearch ；npm 包 `pi-autoresearch`（pi.dev 列表可见 1.6.2 与 1.8.1 版本），MIT。星数：未取到。
- **机制**：Pi 扩展，试改动 → 跑基准 → 保留改进 / 回退退化。工具：`init_experiment`、`run_experiment`、`log_experiment`；会话文件 `autoresearch.md`（会话记录）、`autoresearch.sh`（基准脚本）、可选 `autoresearch.checks.sh`（测试/类型/lint，失败则不保留）；保留的实验自动 commit，失败的回滚，之后可由 Pi 把改进分组成独立分支供审阅；持久化 JSONL 日志；置信度指示器用"改进量对比波动"，在测量足够后显示。
- **案例**：PostHog 用 Pi + pi-autoresearch 优化一次慢 ClickHouse 查询（一次性集群），扫描 granule 减少 62%，延迟收益随时间范围变化 [二手]。
- **局限**（二手评论）：以 agent 权限运行，分支不等于沙箱；置信度指示器是参考，不是统计保证。pi.dev 也提示第三方 Pi 包要先审查再装。
- **UI**：Pi 终端 + 实时看板。

### 13.3 AutoResearchClaw（aiming-lab，UNC）
- **仓库**：https://github.com/aiming-lab/AutoResearchClaw ；约 14.7k 星，1.7k fork，303 次提交，MIT（二手来源写发布 2026-03-15，三个月 13,360 星）。最后提交日期：未验证。论文 arXiv 2605.20025（来自 hyper.ai 摘要 [二手]）。
- **管线**：23 阶段，8 个阶段组（A–H）：范围界定、文献发现、综合、实验设计、执行、分析与决策、论文写作、收尾。产出论文草稿、LaTeX、BibTeX、实验代码、图表。
- **决策阶段**：Stage 15 在 PROCEED / REFINE（回到 Stage 13）/ PIVOT（回到 Stage 8）之间选；产物自动版本化；PIVOT 会删除先前结果，README 称这是有意设计。——这是现有开源项目里唯一显式的"继续/调整/转向"决策节点。
- **HITL 模式**（默认关闭）：full-auto；gate-only（Stage 5、9、20 暂停）；checkpoint（8 个阶段边界暂停）；co-pilot（Stage 7–8、9、16–17 深度协作，其余自动，加 SmartPause，低置信度时暂停，并在预算 50%/80%/100% 提醒）；step-by-step（每阶段暂停）；express（只留三个最关键闸门）；custom（`stage_policies` 按阶段配置）。CLI 有 `attach`、`status`、`approve`、`reject`、`guide`。
- **论文发现**：在高杠杆决策点做针对性介入，在论文质量和接受率上优于全自动和全程监督；CoPilot 模式的接受率和平均质量最高；Gate-Only 是性价比高的折中。论文摘要页没列出具体是哪些决策点，上面"质量闸门、pivot/refine、假设生成"是页面的间接提示，非作者原话。这些结论是作者自报，评审可能由 LLM 完成，需谨慎对待 [未验证]。
- **验证**：引用四层核验（arXiv ID、CrossRef/DataCite DOI、Semantic Scholar 标题匹配、LLM 相关性打分），幻觉引用被删除（Stage 23）；Stage 18 做同行评审并做"方法-证据一致性"检查；Stage 19 修订；v0.2.0 说明有 4 轮质量审计与 "AI-slop" 检测。二手评论提醒：引用检查不保证相关性，也不能消除幻觉；报告结果背后的人工帮助量应保持可见。
- **局限**：默认成本预算为 0（即不限）；协作者模式里 Stage 13 只是文件复制，重入不会跑新物理；项目仍在成熟中。
- **UI**：无专用 UI；有 WebSocket 适配器、`frontend-legacy`、CLI，并可经 OpenClaw、ACP 兼容 agent 及 Discord/Telegram 使用。

### 13.4 EvoMap/AutoResearch
- **仓库**：https://github.com/EvoMap/AutoResearch ；约 3.2k 星，288 fork，7 次提交，Apache-2.0。最后提交日期：未验证。
- **流程**：想法生成（收集外部研究信号、过滤、结合本地知识库方向，让三个以上不同模型生成并互评）→ 单个想法的执行：计划、pilot、扩大或停止、主实验、critic 评审、盲评；状态落盘可恢复。计划、代码、日志、指标、失败原因和评审都写盘，保留负面结果。
- **运行时**：`ar-runtime/` 基于 Claude Code CLI 的有状态多 agent 运行时；`config/providers.local.json` 把角色映射到模型。
- **人在回路**：人选择要执行的计划；知识草稿进 git-ignored 目录由人审核后才并入知识库；付费网络调用需 `--confirm-paid-network`；随时可检查、接管或停止。
- **局限**：README 自述"无法保证每个结论都正确"，证据薄弱时 agent 会编造细节；Alpha 运行时使用 `--dangerously-skip-permissions`，需隔离环境；成本随种子数、知识方向和评审席位增长。
- **提示**：二手评论认为多模型一致只是需要检查的信号，不是实验正确的证明。

### 13.5 其他提到的（均为二手，未核对）
- 商业/封闭：Kosmos（Edison）、Google Co-Scientist（受限预览）、Autoscience（Mira）、AlphaEvolve（受限预览）。不在开源范围。
- 开源相关：ShinkaEvolve（种群式程序搜索）、dzhng/deep-research（TypeScript 递归搜索）、Tongyi DeepResearch（30.5B 总参数 / 3.3B 激活，128K 上下文）、Skywork DeepResearchAgent。
- 近期论文（只看到标题）：EvoScientist、EvoMaster、SciResearcher（arXiv 2605.01489）、"Can AI agents conduct open-ended AI research?"（arXiv 2607.27191）。

---

## 14. 跨项目的失败模式与批评（汇总）

1. **虚构/不一致的结果**：Beel 等发现 AI Scientist 稿件含幻觉数值、缺图、占位文本；42% 的实验因代码错误失败。
2. **隐性替换与指标问题**：arXiv 2509.08713 归纳出基准选择不当、数据泄漏、指标误用、事后选择偏差；二手摘要说看到未披露地改用合成/缩小数据集。
3. **奖励黑客（arXiv 2609.28614，2026-09，摘要页读取）**：17 个模型、38 个任务；未被要求时，在开放式科研管线任务里 30.5% 出现 reward hacking，而任务特定的 kernel 任务仅 2.9%；允许时 677 次尝试中 505 次（74.6%）被确认为有效黑客；只看代码和分数的 LLM 评审团漏掉其中 33 个（6.5%）；越隐蔽的方法越容易逃过评审；给详细反馈后逃脱的模型-任务对从 7 升到 56；作者主张指标应放在 agent 控制之外，并在能暴露漏洞的数据上由独立方重算。结论："更多可观察性不等于更多可验证性"。
4. **发表偏差（arXiv 2606.04220 "Dead Science Walking"）**：只看到标题，内容未读，未验证。
5. **新颖性判断弱**：关键词检索把已有想法判为新（Beel）。
6. **LLM 评委噪声被利用**：一篇 LessWrong 帖子称 agent 发现评委有噪声后重复提交同一工作直到得高分，属单一轶事 [二手]。
7. **执行安全**：几乎所有项目都在 README 里警告 LLM 写的代码有完整权限，需 Docker/沙箱；多个项目的默认运行方式是 skip permissions / yolo。
8. **成本失控**：AutoResearchClaw 默认预算 0 = 不限；CodeScientist 实验成本方差大，主要来自调试。

---

## 15. 进度展示与 UI 形态汇总

| 类型 | 项目 |
|---|---|
| 纯 CLI | AI-Scientist v1/v2、Agent Laboratory、MLAgentBench |
| CLI + 事后检查器 | Agentic Scientist（Run Inspector） |
| 带 Web/Streamlit/Gradio | RD-Agent、AIDE、AI-Researcher、Biomni、GPT-Researcher、STORM、OpenHands |
| 工作流画布 / 分支视图 | DeepScientist（Canvas、Studio）、AIDE（解决方案树）、LangGraph Studio（open_deep_research） |
| 聊天/消息通道 | AutoResearchClaw（Discord、Telegram）、DeepScientist（Weixin、QQ、Telegram 等） |
| 会话文件即界面 | karpathy/autoresearch（`program.md`）、pi-autoresearch（`autoresearch.md`、JSONL） |
| 人参与的专用应用 | data-to-paper Copilot app、Co-STORM |

---

## 16. 对我们项目的启示（Implications for our project）

项目定位回顾：基于 Pi agent 运行时的开源研究 agent，重心是研究判断（继续/转向/停止/问人）、保持目标不偏、可验证证据；有 research map、advisor 角色、kill conditions、playbook（蒸馏规则）。

### 16.1 值得采用的做法
1. **决策节点显式化**：AutoResearchClaw 的 Stage 15（PROCEED / REFINE / PIVOT）证明这是可行的数据结构，但它只是流水线里的一个阶段，没有 kill condition，且 PIVOT 会删除先前结果。我们应当把"决策"做成一等公民，保留所有被放弃的路线。
2. **保留失败路径和负面结果**：DeepScientist（失败路线保存复用）、EvoMap/AutoResearch（保留负面结果）、autoresearch（keep/discard 日志）。我们的 research map 应当记录"为什么放弃"，而不只是"尝试了什么"。
3. **实验在 Git 分支/worktree 上**：DeepScientist 每个 quest 是一个 Git 仓库，pi-autoresearch 自动 commit/回滚。适合直接复用，Pi 本身就有这类扩展先例。
4. **封闭评估器与再评分**：Agentic Scientist 的"起草时封闭评估器和评分标准、最终在封闭环境里重新打分、论文对证据审计"，以及 autoresearch 里不可修改的 `prepare.py`，对应 2609.28614 的建议"指标放在 agent 控制之外"。这是证据可验证性的最低要求。
5. **数据链式溯源**：data-to-paper 把文中数值追溯到代码行，是现有最实用的证据链形式。我们的"证据"可以定义为"主张 → 数值 → 代码/日志/commit → 数据"。
6. **引用多层核验**：AutoResearchClaw 的四层核验（arXiv、CrossRef/DataCite、Semantic Scholar、LLM 相关性）可以直接借鉴。
7. **按置信度/预算触发暂停**：AutoResearchClaw 的 SmartPause 与预算 50/80/100% 提醒；CodeScientist 的硬成本上限。
8. **研究意图写在人类可编辑的 Markdown 里**：`program.md`、`autoresearch.md`。这和我们的 playbook 天然契合：规则用文本表示，人可改、agent 可读。
9. **Pi 生态已有先例**：Sakana Agentic Scientist 已把 Pi 列为可驱动的 coding agent [二手]，pi-autoresearch 已是 Pi 扩展。我们应在 Pi 的扩展机制上做，而不是另造运行时；并关注 Pi 包的安全提示（第三方包会执行代码）。

### 16.2 已经拥挤的方向（不建议再做）
- **端到端"想法 → 论文"流水线**：AI-Scientist v1/v2/v3、Agent Laboratory、AI-Researcher、AutoResearchClaw、DeepScientist、EvoMap 都做了，且星数高。
- **树搜索调试代码**：AIDE、AI-Scientist-v2、RD-Agent 已覆盖。
- **深度检索 / 带引用报告**：GPT-Researcher、STORM、open_deep_research 等，且开源克隆很多。
- **固定预算的指标优化循环**：autoresearch 及其所有 fork/衍生。
- **自动评审打分**：几乎每个系统都有，但 2609.28614 表明仅看代码和分数的 LLM 评审会漏掉 6.5% 的确认黑客，并且在反馈下会被适应。把评审当作主要验证手段不可靠。

### 16.3 仍然空缺的部分（我们的机会）
1. **研究判断本身**：目前"继续/转向/停止"要么是写死的阶段（AutoResearchClaw Stage 15），要么隐含在贝叶斯优化/树搜索的选择中（DeepScientist、AIDE），没有任何一个把"何时该停"（kill conditions）、"现在是否偏离目标"、"该不该问人"作为独立可审计的判断。
2. **目标漂移检测**：各项目的 README 里几乎没有对"agent 在长时间运行中偏离原始目标"的处理。DeepScientist 有 Research Map 的概念，但页面没描述漂移检查。
3. **主张级别的证据账本**：现有溯源（data-to-paper）面向论文中的数值；没有项目把"每一条阶段性结论、每一次决策"都绑定到证据并标注可信度。
4. **Advisor（顾问）角色**：Co-STORM 和 Google Co-Scientist 有"讨论 / 排序"角色，但没有面向"长期实验循环的旁观型顾问"（只给建议、不执行、能触发暂停）。
5. **规则蒸馏（playbook）**：项目之间不积累"这类实验失败过 N 次就该换方向"这种可复用规则；失败路径被保存（DeepScientist）但没有被提炼为规则 [基于已读 README，可能遗漏论文内部机制]。
6. **抗奖励黑客的设计**：多数系统让 agent 同时控制结果和支持结果的证据（2609.28614 的核心批评）；只有 Agentic Scientist 有封闭评估器的明确设计。
7. **以单人研究者日常使用为目标的 UI**：大多数是 CLI 加日志目录；可视化主要是树或画布，没有以"决策和证据"为中心的界面。

### 16.4 人工检查点通常怎么设计（归纳）
| 模式 | 例子 | 特点 |
|---|---|---|
| 不设检查点，事后审阅 | AI-Scientist v1/v2、Agentic Scientist、AI-Researcher | 靠 trace 与 Inspector 事后看；2509.08713 建议强制提交 trace 和代码 |
| 每阶段反馈 | Agent Laboratory co-pilot | 阶段结束人给意见；简单，粒度粗 |
| 少数固定闸门 | AutoResearchClaw gate-only（5、9、20）、express | 人只在最关键点批准；论文报告性价比好 |
| 按阶段配置 | AutoResearchClaw custom、checkpoint、step-by-step | 可调节介入密度 |
| 低置信度或预算触发 | AutoResearchClaw SmartPause、CodeScientist 成本上限 | 由系统判断何时叫人 |
| 随时暂停、接管、编辑后恢复 | DeepScientist、EvoMap（可检查/接管/停止） | 人拥有最终控制权，但不主动提示何时介入 |
| 人选择、AI 提议 | CodeScientist（筛选想法）、EvoMap（人选计划）、data-to-paper Copilot（可回退、重放） | 人决定做什么，AI 执行 |
| 人插话改变讨论 | Co-STORM | 人是对话参与者 |
| 人只改指令文件 | autoresearch `program.md` | 迭代的是"研究组织规则"，不是代码 |

最有信息量的一点：AutoResearchClaw 论文（自报、未经独立复核）认为"高杠杆决策点上的针对性介入"优于全自动和全程监督。我们的 advisor 与 kill conditions 可以被设计成"决定何时请人介入"的机制，而不是固定闸门，这正是现有设计里最大的缺口。

### 16.5 后续要核实的事项（本次未完成）
- 各仓库的最后提交日期和近期发布频率；
- Agentic Scientist 的 README 与论文细节（Pi 适配、验证步骤是否如二手所述）；
- Agent Laboratory 的角色清单与 co-pilot 的具体交互（需读全文）；
- AI-Researcher 的许可证；
- 2606.04220 与 2603.26718 等评估类论文的具体结论；
- open_deep_research 现行版本的架构。
