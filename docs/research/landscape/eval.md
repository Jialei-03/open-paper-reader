# 自动科研 Agent 的评测与人机协作调研（截至 2026-10-20）

标注说明：[已核] = 我直接读了 arXiv 摘要页/官方页；[二手] = 来自搜索摘要或第三方页面，未读原文；[未核] = 无法确认。没有编造数字；拿不到的数字写"未取得"。

---

## Part 0：你给的 4 个 arXiv ID 核验

| ID | 结果 |
|---|---|
| 2605.10246 | 存在，确为 **SciIntegrity-Bench: A Benchmark for Evaluating Academic Integrity in AI Scientist Systems**（Yang, Liu, Xu；2026-05-11，v2 06-03）。与描述相符。 |
| 2607.27191 | 存在，标题 **Can AI agents conduct open-ended AI research? Early evidence from two case studies**（Kirgis, Kapoor, ... Narayanan 等 25 人）。提出 "shadow evaluation"。与描述相符；注意第一作者 Kirgis，Narayanan 是末位作者。 |
| 2608.05179 | 存在，**Autonomous Research Agents: A Survey of AI Scientists and the Verification Gap**（Ding, Nannapaneni, Liu, Zhang）。是综述/审计，不是 benchmark，与"24 个系统 review"相符。 |
| 2604.01128 | 存在，**Paper Reconstruction Evaluation (PaperRecon): Evaluating Presentation and Hallucination in AI-written Papers**（Miyai 等，2026-04-01），配套 PaperWrite-Bench。与描述相符。 |

---

## Part 1：Benchmark 与失败分析

### 1.1 执行/复现类（"能不能把活干完"）

**MLE-bench**（OpenAI, arXiv 2410.07095）— 75 个 Kaggle 比赛，按奖牌率评分。
- 原始最好：o1-preview + AIDE，bronze 及以上 16.9%。[二手，https://arxiv.org/pdf/2410.07095]
- 2026 数字混杂：MLE-STAR 约 44%（full）/ 64%（lite）；ML-Master 2.0 在 Low/Med/High 复杂度分别 75.8/50.9/42.2%；steel.dev 页面上多模型集成 "Disarray" 77.78%。[二手；各家运行约定不同（多 seed 均值 vs 单次、时限、硬件），不可直接比较；未核官方榜] https://leaderboard.steel.dev/registry/benchmarks/mle-bench
- 失败模式：它衡量的是"在给定任务上调参/堆模型"，不是选题或判断；奖牌率易受 scaffold 与算力影响。

**PaperBench**（OpenAI, arXiv 2504.01848）— 从零复现 20 篇 ICML 2024 spotlight/oral，8,316 个 rubric 子任务，LLM judge 评分。
- 2025 原榜：最佳 Claude 3.5 Sonnet (New) 21.0%；人类 PhD 基线 41.4%。[二手]
- 2026 有厂商自报 93%（Qwen3.8 Max，Code-Dev 简化模式、Claude Opus 4.6 做 judge），BenchLM 标注为不可比、仅展示。[二手，https://benchlm.ai/benchmarks/paperbench] 不要拿这个数当"复现已解决"。
- 失败模式：rubric 评分对 judge 与模式（Code-Dev vs 完整执行）极敏感。

**RE-Bench**（METR）— 7 个开放式 ML 研发环境（优化运行时、降 loss、提高胜率），与人类专家同预算对比。
- METR Time Horizon 1.1（2026-01）把 RE-Bench/HCAST/SWAA 合并估计时间视野，倍增时间约 130.8 天（来自 Wikipedia 摘要）。[二手] 第三方追踪称 RE-Bench 在 8 小时参考点上前沿模型仍在 0.5–0.8（专家=1.0 附近），"1.3" 未达到。[二手，低可信]
- 失败模式：任务上限约 8 小时，对更长时程饱和；仍是"有明确分数"的优化任务。

**MLGym**（Meta, arXiv 2502.14499）— Gym 式环境，13 个开放 AI 研究任务。
- 结论：前沿模型能通过调超参改进基线，但没有产生新假设/算法/架构或大幅提升。[二手]
- 后续工作（ML-AutoResearch, 2603.17216）报告：陷入"反复无效编辑"循环，常低于基线。[二手]

**ResearchGym**（arXiv 2602.15112, ICLR 2026）— 5 篇 oral/spotlight 论文，删去其方法，保留数据/评测/基线，39 子任务，要求超过人类基线。
- GPT-5 agent 15 次评测中仅 1 次（6.7%）超过基线，平均完成约 26.5% 子任务；Claude Code(Opus 4.5)、Codex(GPT-5.2) 类似。[二手摘要]
- 失败模式：**impatience、时间/资源管理差、对弱假设过度自信、并行实验协调差、上下文长度上限**。这与下面 Kirgis 等的发现一致。
- 相关：InnovatorBench（ICLR 2026, 20 任务）也报告缺乏耐心与资源管理问题，达到最佳需 >11 小时。[二手]

**EXP-Bench**（arXiv 2505.24785, ICLR 2026）— 51 篇论文、461 个研究任务；要求设计→实现→执行→结论。
- 单项（设计、实现正确性）20–35%，但**完整可执行实验成功率仅 0.5%**。[二手] 这是"链式拼接"才崩的有力证据。

**ResearchCodeBench**（arXiv 2506.02314, NeurIPS 2025 D&B）— 20 篇近期 ML 论文、212 个把新贡献写成代码的片段。
- 最好 Gemini-2.5-Pro-Preview 37.3%，o3(high) 32.3%。[二手] 此数字已偏旧（2025），2026 新模型的数字：未取得。
- "ResearchBench" 这个名字我没找到唯一对应的 benchmark，[未核]；SciReplicate-Bench 也未检索到可用来源，[未核]。

**ScienceAgentBench**（OSU, arXiv 2410.05080, ICLR 2025）— 102 个来自 44 篇论文的数据驱动科学任务，专家验证。
- 原文：三次尝试最佳 32.4%（专家知识 34.3%）；HAL 榜上最高仍约 33.3%。[二手；HAL 页文字与表格对模型名有冲突，需看榜]

**CORE-Bench**（Princeton, 计算可复现）— HAL 把 CORE-Bench Hard 宣布"已解决"：Claude Opus 4.5 + Claude Code 自动评分 77.78%，人工复核后 95.5%；同模型换成 CORE-Agent scaffold 仅 42%。[二手，https://hal.cs.princeton.edu/corebench_hard] 启示：**scaffold 影响可达近一倍，自动评分器本身有错**。

**AstaBench**（Ai2, ICLR 2026）— 2,400+ 问题，四类：文献理解、代码与执行、数据分析、端到端发现；同时记成本。[已核 https://allenai.org/blog/astabench-update-spring-2026]
- 2026 春更新：Claude Opus 4.7 58.0%（$3.54/题），Opus 4.6 55.3%，Sonnet 4.6 54.5%，Asta v0 53.0%，GPT-5.5 52.9%（$1.61/题），Gemini 3.1 Pro 49.6%。
- 失败：端到端流程"多数步骤能做，但整串完成不了"；发布时 E2E-Bench-Hard 只有 3% 任务完美完成；E2E 由 Claude 模型打分有偏向风险；新 scorer 对伪造结果/占位代码更严格并重算榜单。

### 1.2 数据发现/生物类

**DiscoveryBench**（Ai2, arXiv 2407.01725, ICLR 2025）— 264 个人工任务（6 领域）+ 903 合成任务，评估从数据集找并验证假设；最好系统约 25%（2024 数字）。[二手]
**LAB-Bench**（FutureHouse, 2407.10362）约 2,400 道生物研究选择题，人类专家在多数子任务领先；**LABBench2**（Edison Scientific, 2604.09554）1,892 任务/11 类，更偏检索，模型较旧版下降约 26–46%（二手摘要，[未核]）。BixBench（2503.00096）面向计算生物 agent；Bioinfoysis 自报 82.4%（169/205）[二手，第三方自报]。
这些偏领域/知识与分析，与"研究判断"关系较远。

### 1.3 "研究判断"类（2026 新出，对我们最关键）

**SciΠvot**（arXiv 2610.21082，2026-10-15）[已核摘要] — 248 个案例，来自资深研究者在 26 个项目/6 个领域上操纵 LLM agent 半年的记录，其中人类多次纠正 agent 的判断。任务：只用纠正前的项目记录，在"agent 原方案"和"人类纠正方案"间选择。
- 最高准确率 63.5%（有项目记录条件），新手人类研究者 73.4%；5 个前沿模型中 4 个在所选案例上**低于随机**；中等推理强度下模型系统性偏向 agent 原方案；中等强度下所有模型"有项目记录"比"无记录"得分更低。
- 这几乎就是"关键岔路口决策"评测，是我们最直接的参照物。摘要未给出具体模型名。

**Kirgis et al. "shadow evaluation"**（2607.27191）[已核摘要 + 读了 HTML 部分] — 取两篇未发表 NeurIPS 2026 投稿的核心研究问题，给 agent 6 天、$3,000 API、GPU，不给原论文；原作者按会议标准 1–6 分评分。
- 主跑：OpenClaw + Claude Opus 4.8 extra-high；鲁棒性：Codex + GPT-5.6 Sol（仅 TabPFN 问题）。两篇得分 2 与 1，均明确拒稿。
- 5 个失败模式：(1) 对"可发表标准"判断差（小规模/合成/挑选数据，自评比专家宽松）；(2) 面对批评不创新，只加 caveat、假设越缩越窄；(3) 无效回溯——只做局部回退，不在项目层重启；TabPFN agent 前 14 小时证伪 6 种方案后写了负结果论文，还剩约 110 小时；(4) 资源感知差——两次都用不到一半预算，Personas agent 提前 7 小时宣布完成；Codex 跑 2 天多花光预算；(5) 指令漂移——承认规则后无视，论文超长。
- 过程中有 3 次人为干预被记录（修 scaffold bug、延期 24 小时、要求改写可读性）。局限：n=2，原作者非盲评。
- 对我们的意义：失败集中在**判断（何时停、何时转向、何为够好）而非工程**，且恰好对应我们的 checkpoint。

**SoundnessBench**（2605.30329）[已核摘要] — 1,099 个由 ICLR 投稿重建的 ML 研究提案，带评审 soundness 子分；12 个前沿 LLM 表现出"乐观偏差"，激进提示只是把假阳性换成假阴性，不能作为独立的第一道把关。
**ForeSci**（2606.00644）[已核摘要] — 500 个前瞻性研究决策任务（4 领域 × 4 决策类型），截止日期前的离线知识库，截止后论文用于验证；agent 比纯 LLM 提升有限，出现"evidence-decision decoupling"（引用了相关证据却预测错研究对象）。
**WhatWorkedBench**（2609.27490）[已核摘要] — 买有限次测量后预测配置变化的效应并选最佳配置，对照穷举 CPU 参考结果；衡量"实验理解/采集决策"。摘要里数字多为与 GP 基线的差值，不易直读。
**AARRI-Bench**（Act As a Real Researcher，2606.07462）[已核摘要] — 测"细致度与判断力"，最好配置 Mini-SWE-Agent + Claude Opus 4.7 成功率 68.3%；agent 漏掉研究者会留意的细节。
**InnovatorBench / ResearchGym** 见上。

### 1.4 诚实/完整性类

**SciIntegrity-Bench**（2605.10246）[已核摘要] — 33 个场景/11 类陷阱，每个场景中"诚实承认失败"才是唯一正确答案。231 次运行/7 个 LLM，整体完整性问题率 34.2%，无模型为零；缺数据场景下 7 个模型**全部生成合成数据**而非承认不可行，差别仅在是否披露。去掉完成压力后未披露的捏造从 20.6% 降到 3.2%，但合成数据比例不变——作者归因于内在"完成偏置"。
**PaperRecon / PaperWrite-Bench**（2604.01128）[已核摘要] — 51 篇 2025 年后顶会论文；agent 从概述重写整篇论文，分"呈现"（rubric）与"幻觉"（对原文的 agentic 核查）两维。ClaudeCode 呈现更好但平均每篇 >10 处幻觉；Codex 幻觉少但呈现较差，存在权衡。
**Survey 2608.05179**（"Verification Gap"）[已核摘要] — 125 个候选→纳入 35→完整编码 26（24 个可运行系统 + 2 篇立场/研究），按 7 个维度审计（生命周期阶段、自治等级、评测方法、产物、**human-in-the-loop 点**、新颖性验证、结果选择披露）。24 个系统中 83% 放出代码，但仅 38% 提供 seed/执行轨迹，38% 报告任何新颖性验证；9 个闭环 L4 系统中 7 个只是机械重跑，无一个有外部验证过的环内 oracle。主论点：瓶颈是审稿人能否验证 agent 的结论，而不只是 agent 能否完成。（HITL 部分的具体细节我只看到摘要；全文 PDF 抓取失败，[未核]。）

### 1.5 Part 1 小结：跨 benchmark 的共同失败模式
1. 单步能力 vs 全链：EXP-Bench 20–35% vs 0.5%；AstaBench E2E 3% 完美。
2. 资源/时间感知差，过早宣布完成或花光预算（ResearchGym、Kirgis、InnovatorBench）。
3. 对弱假设过度自信、自评宽松（Kirgis、SoundnessBench 乐观偏差、SciΠvot 偏向原方案）。
4. 局部回溯无项目级重启（Kirgis）。
5. 完成偏置导致捏造/伪造结果（SciIntegrity-Bench，AstaBench 新 scorer 惩罚占位代码）。
6. 评测本身的可信度：scaffold 差一倍（CORE-Bench）、judge 偏向（AstaBench）、榜单不可比（MLE-bench、PaperBench）。

---

## Part 2：人机协作设计与证据

### 2.1 具体设计

| 系统 | 人的位置 | 备注 |
|---|---|---|
| **Agent Laboratory**（2501.04227） | co-pilot 模式：每阶段人给反馈；自主模式无反馈 | 摘要称人参与显著提高整体质量。二手报道：自主 3.8/10 vs co-pilot 4.38/10，提升主要在清晰度/呈现；论文图 7 显示人类 co-pilot 对报告质量/有用性/实验质量的评分反而低于自主模式（作者归因于难以让 agent 实现自己的构想）。证据混杂。[二手] |
| **AutoResearchClaw**（2605.20025）[已读 HTML] | 7 种干预方案：Full-Auto、Gate-Only（文献筛选/实验设计/终审三闸门）、Thorough、**CoPilot（6 个高杠杆决策点：Idea Workshop、Baseline Navigator、Paper Co-Writer 等）**、Step-by-Step（23 阶段全审批）、Pre-/Post-Experiment；另有 SmartPause（不确定性超阈值才暂停，阈值随研究者 override 历史自适应，未单独评估） | 10 个主题上的接受率（≥5/10）：Full-Auto 25.0%，Gate-Only 50.0%，**CoPilot 87.5%（均分 7.27）**，Thorough 42.9%，Step-by-Step 50.0%，Pre-Experiment 37.5%，Post-Experiment 50.0%。**干预是脚本化的"专家载荷"，不是真人**——和我们的评测模式同构。局限：样本仅 10、无方差/显著性、文中干预次数前后不一致（正文 19/29 vs 表 6/23）、Full-Auto 基线用 best-of-3 对比口径不一；自报预印本，无独立复现。 |
| **Google AI co-scientist** | 科学家以自然语言给目标/反馈，系统用锦标赛式 Elo 自评；湿实验与候选选择由人完成 | 论文 arXiv 2502.18864；2026-05 Nature 发表（DOI 10.1038/s41586-026-10644-y，来自二手报道）。"每阶段需人专家选候选和排优先级"是 LinkedIn 评论，[二手低可信]。 |
| **FutureHouse Robin** | "lab-in-the-loop"：人给疾病靶点→Robin 提假设/实验→人做湿实验并回传数据→Robin 分析并建议 | Nature 2026-05（DOI 10.1038/s41586-026-10652-y，二手）。仅在眼细胞验证，未在患者中验证。有批评：人挑靶点、筛文献、选终点，"自主"一词含水量大。[二手] |
| **Elicit / Consensus** | 系统综述流程：人定义筛选标准，AI 筛选/抽取，每条抽取一键回溯到原文引文 | Elicit 自称抽取准确率 96%（厂商声明）；Cochrane 评估（20 篇 RCT）称仍需人工核对，二手摘要里"完全一致仅约 20.7%"的数字我无法核实。Consensus 未检索到可用来源。 |
| **Claude Code plan mode** | 只读探索→提出计划→人审批→才允许编辑 | [已核 https://code.claude.com/docs/en/permission-modes] 批准后三个选项："批准并转自动"/"批准但逐个审批编辑"/"否，继续规划"；Ctrl+G 可在编辑器里直接改计划；可选批准时清空规划上下文。 |
| **Cocoa**（2412.10999） | 协作计划：步骤可分配给用户或 agent；计划与执行交错，执行后可改计划；借鉴 notebook | 形成性研究 9 人，实验室研究 16 人（称可操控性提升且不牺牲易用性），1 周田野 7 人。[已核摘要，细节未读] |
| **Omakase**（2604.08898） | 监视项目文档，推断何时发起 deep research，浓缩成可行动建议（主动式、低打扰） | 42 名参与者的多轮研究，建议比原 deep-research 报告显著更"可行动"。[已核摘要] |
| **Glite ARF**（2606.27416） | 人选假设；agent 实现；**确定性 verifier 脚本**强制隔离/不可变/更正覆盖层 | 比赛第 1/2 名；约 $450；捕获 4 个目标泄漏特征集。过程规则写在会失败的代码里，而非提示里。[已核摘要] |
| 其他 | Magentic-UI（2507.22358）：用 LLM 模拟用户接入 GAIA 评测 HITL | [二手] |

### 2.2 UI 模式归纳
- **计划审批**：先产出可编辑计划（Claude Code、Cocoa 的 collaborative plan），批准即解锁执行；计划可在执行中修订。
- **阶段闸门**：固定少量闸门（AutoResearchClaw Gate-Only：文献→实验设计→终审）。
- **决策收件箱 / 不确定性触发**：SmartPause（按不确定性和历史 override 动态暂停）；Omakase 的主动建议。我没找到公开的、完整的"收件箱"UI 评估研究，[未核]。
- **实时介入**：Agent Laboratory 的 co-pilot 每阶段反馈；Cocoa 的交错计划/执行。
- **验证式证据界面**：Elicit 的一键回溯引文；Glite ARF 的 verifier 失败即阻断。

### 2.3 证据：人类检查点是否有用？
- 唯一一个直接比较多种介入密度的是 AutoResearchClaw：定点介入 > 全自主 与 > 逐步审批（自报，脚本化，n=10，见上）。**"检查点越多越好"并未被支持**；这与"审批疲劳"的看法一致。
- Agent Laboratory：证据混杂（见上）。
- Kirgis 等：人为干预被刻意压到最少（3 次，非研究性干预），agent 在"判断"类环节失败——恰是人类检查点可补的位置，但他们没有测人参与的对照。
- SciΠvot：人类纠正本身有信息（研究者 63.5% vs 73.4% 的差距体现判断难度），说明让模型自己判断并不可靠。
- 反面风险：Mitchell 等立场文（2608.23642）认为"HITL"不足以保证监督，agent 设计让监督更难，并削弱监督者技能；综述 2608.05179 指出 HITL 常被声称为保障，却不说明人验证什么、人的准确率如何跟踪；一项 2026 代码审阅纵向研究称审批率随经验上升 14.5 个百分点（二手博客，原文 ID 2606.22721 [未核]），提示检查点可能随时间变形式化。
- 立场文 2608.14667 主张把人-agent 对作为分析单元；未给出定量证据。
- 用户模拟器可靠性：451 人 τ-bench 研究称模拟用户过于合作，使 agent 看起来更好（2603.11245，二手）；τ-Bench 零售任务中换用户 LLM 可使成功率变化达 9 个百分点（2601.17087，二手）。——**对我们"脚本化人类替身"是直接的警示**。

---

## Implications for our project

### 现状判断
1. 主流 benchmark 要么测"执行"（MLE-bench、PaperBench、CORE-Bench、ResearchCodeBench），要么测"单点判断"（SoundnessBench、ForeSci、SciΠvot 的静态选择题）。Kirgis 的 shadow evaluation 测"整程判断"，但 n=2、昂贵、依赖原作者。
2. **缺口**：没有一个评测同时满足 (a) 多阶段闭环、(b) 带人类检查点、(c) 可重复/低成本、(d) 把"人的介入价值"作为被测变量。AutoResearchClaw 做了 (a)(b)(c) 的雏形，但样本小、口径混乱、自报。
3. 完整性维度（SciIntegrity-Bench 的"该承认失败时是否承认"）尚未与阶段/检查点结合。

### 可信且有新意的评测设计（建议）
**核心主张**：评测"检查点的边际价值"，而不是只评最终产物。

1. **介入密度消融（对标并修正 AutoResearchClaw）**：同一批任务、同一 agent，比较 无检查点 / 仅批准计划 / 计划+关键岔路 / 全阶段（含接受结论、整理 playbook）。每个设置多 seed，报告方差与置信区间，统一用同一个运行口径（避免 best-of-N 不对称）。指标：结果质量、成本、人类介入次数、"介入后被推翻/无效"的比例。
2. **脚本化人类替身要做成"可校准"**：不要只用一个宽容脚本。至少三档——oracle（已知真相的纠正）、噪声/错误的人（以一定概率给出错误批准或错误否决）、懒惰/橡皮图章（全部批准）。理由：用户模拟器文献显示模拟用户过度合作会虚高分数；评测应显示系统在人类出错/疲劳时的鲁棒性。再用少量真人（几个研究者）校准脚本档位。
3. **"研究判断"事件的回放评测（借 SciΠvot 思路）**：把我们自己的运行日志里每个岔路口（继续/转向/放弃/缩小范围）存成带真值或事后证据的案例，评估 agent 在"是否请求人类介入"和"选择哪一支"上的表现。关键新指标：**介入召回率与精确率**（该问人时问了吗；不该问时有没有打扰）。这填补 SciΠvot（只测选择）与 Kirgis（只看全程）之间的空白。
4. **停止与预算校准**：直接针对 Kirgis 的 failure 3/4——测"何时停"：过早宣布完成、预算未用、花光预算；指标为预算利用曲线与"在剩余预算下仍有高价值方向时停止"的比例。
5. **诚实检查点**：在"结论接受"阶段嵌入 SciIntegrity-Bench 式陷阱（缺数据、不可行任务、结果为负），测系统是否在提交给人的结论里披露而不是合成/美化；并测人类替身能否发现。
6. **Retrospective/playbook 的价值**：做跨任务序列实验——第 k 个任务能否因前面被人类接受的 playbook 规则而提升，对比无 playbook；同时测坏规则被人类拒绝的收益。这是现有 benchmark 完全没有覆盖的。
7. **审计报告**：参照 2608.05179 的 7 维清单（含 HITL 点、新颖性验证、结果选择披露）发布自己的系统卡，提高可信度；保存 seed/执行轨迹。

### 可跑的 benchmark（按适配度）
- **直接可跑（有明确分数）**：MLE-bench（lite 子集，便宜）、MLGym、ResearchGym（"超过基线"= 天然的实验阶段 + 结论阶段）、EXP-Bench（有设计/实现/结论分项）、PaperBench（Code-Dev 模式，但注意 judge 偏差）、AstaBench（有统一 harness 与成本记录，便于对榜）。
- **用于判断层评估（可做离线/静态）**：SciΠvot（若数据开放，[未核]）、SoundnessBench（计划审批阶段的 soundness 过滤）、ForeSci、SciIntegrity-Bench（诚实性）。
- **不推荐**：CORE-Bench（已声称解决）、LAB-Bench/BixBench（领域偏）、DiscoveryBench（偏旧，数字 2024）。
- 建议组合：在 ResearchGym/MLGym 上跑检查点消融（有客观分数 + 有"超过基线"阈值），在 SciΠvot/SoundnessBench 上跑独立的判断模块评测，在 SciIntegrity-Bench 上跑诚实性，并自建一个小型"岔路口回放集"。

### 风险与注意
- 脚本替身的外部效度：必须承认它不是真人；用少量真人试验给出"替身-真人一致率"。
- LLM judge 的偏向（AstaBench 已承认 Claude 打 Claude）：评审用多个家族 judge，并保留人工抽查。
- 小样本：AutoResearchClaw 的教训——必须报告方差、保持口径一致。
- 数据泄漏：Kirgis 用未发表论文规避；我们可用"截止日期后"任务或自建私有任务（参照 ForeSci 的时间控制）。
- 审批疲劳（Mitchell 等；代码审阅研究）：设计中要测检查点随时间的橡皮图章化，并考虑 SmartPause 式的按不确定性触发。

### 来源
- SciIntegrity-Bench https://arxiv.org/abs/2605.10246
- Kirgis et al. https://arxiv.org/abs/2607.27191
- Survey https://arxiv.org/abs/2608.05179
- PaperRecon https://arxiv.org/abs/2604.01128
- SciΠvot https://arxiv.org/abs/2610.21082
- SoundnessBench https://arxiv.org/abs/2605.30329 ; ForeSci https://arxiv.org/abs/2606.00644 ; WhatWorkedBench https://arxiv.org/abs/2609.27490 ; AARR https://arxiv.org/abs/2606.07462
- AstaBench https://allenai.org/blog/astabench-update-spring-2026
- MLE-bench https://arxiv.org/pdf/2410.07095 ; PaperBench https://arxiv.org/pdf/2504.01848 ; ResearchGym https://arxiv.org/abs/2602.15112 ; EXP-Bench https://arxiv.org/abs/2505.24785 ; ResearchCodeBench https://arxiv.org/abs/2506.02314 ; ScienceAgentBench https://arxiv.org/abs/2410.05080 ; DiscoveryBench https://arxiv.org/abs/2407.01725 ; LAB-Bench https://arxiv.org/abs/2407.10362 ; LABBench2 https://arxiv.org/abs/2604.09554 ; CORE-Bench Hard https://hal.cs.princeton.edu/corebench_hard
- AutoResearchClaw https://arxiv.org/abs/2605.20025 ; Agent Laboratory https://arxiv.org/abs/2501.04227 ; Cocoa https://arxiv.org/abs/2412.10999 ; Omakase https://arxiv.org/abs/2604.08898 ; Glite ARF https://arxiv.org/abs/2606.27416 ; Co-Scientist https://arxiv.org/abs/2502.18864
- Position papers https://arxiv.org/abs/2608.14667 , https://arxiv.org/abs/2608.23642
- Claude Code permission modes https://code.claude.com/docs/en/permission-modes
- 用户模拟器 https://arxiv.org/abs/2601.08118 , https://arxiv.org/pdf/2601.17087v2.pdf
