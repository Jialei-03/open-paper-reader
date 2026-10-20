# 大实验室 / 研究机构的自动科研（auto-research / AI scientist）系统调研

调研日期：2026-10-20。方法：网页搜索 + 抓取一手来源（arXiv、官方博客）。
标注约定：**[一手]** = 我抓取到了官方页面/论文摘要；**[二手]** = 仅来自媒体/聚合站，**未能从一手来源核实**；**[未核实]** = 单一来源或来源互相矛盾。
未能抓取的一手页面（403/需登录/PDF 无法解析）：OpenAI 原文（openai.com，403，内容来自 36kr 转述 + 搜索摘要）、Nature 的 co-scientist 与 ERA 论文（需登录）、co-scientist arXiv 全文 PDF（本机无 PDF 解析工具）。凡此类内容均已降级标注。

---

## 0. 一页总览

| 系统                                                     | 机构                            | 范围                                         | 人的位置（一句话）                                   | 主要评估                                           |
| -------------------------------------------------------- | ------------------------------- | -------------------------------------------- | ---------------------------------------------------- | -------------------------------------------------- |
| AI co-scientist                                          | Google                          | 仅假设生成（+研究计划），湿实验由人做        | 给研究目标、可提供种子想法、自然语言反馈、做实验验证 | Elo 锦标赛、专家评分、3 个湿实验验证               |
| ERA / Computational Discovery                            | Google                          | 经验软件 + 树搜索优化（需可打分问题）        | 人给问题与打分函数                                   | 论文：Nature 2026（正文未取到）                    |
| AlphaEvolve                                              | DeepMind                        | 算法/数学构造的进化式代码搜索                | 人写评估器、定义问题                                 | 50+ 开放问题：75% 复现 SOTA，20% 改进              |
| Aletheia                                                 | DeepMind                        | 数学研究助手（生成-验证-修订）               | 人选问题、查结果、写论文并对内容负责                 | Olympiad 级 95.1%；Erdős 问题上大量错误            |
| Deep research / PaperBench / “automated research intern” | OpenAI                          | 内部：研究执行代理；外部：复现论文基准       | 人设定优先级、决定是否继续/停止/部署                 | 内部 3.1 agent-workday/人日；PaperBench 最优 21.0% |
| R&D Automation Index / Claude Science                    | Anthropic                       | 内部度量 AI 做 AI R&D 的程度；外部科学工作台 | 人监督、审计划、审结果                               | AL4“主导”约 26%                                    |
| MLGym、AIRA-dojo、AIRA₂（、AIRA₃）                       | Meta FAIR                       | ML 研究/Kaggle 式工程                        | 人提供任务与评分                                     | MLE-bench、AIRS-Bench                              |
| R&D-Agent、Microsoft Discovery                           | Microsoft                       | ML 工程；企业级 R&D 平台                     | 平台强调“人在回路”（细节未核实）                     | MLE-bench 等                                       |
| AI Scientist v1/v2                                       | Sakana                          | 想法→实验→论文（仅计算实验）                 | 人给方向/（v1）模板；评审实验由人组织                | ICLR workshop 6.33 分；Nature 2026                 |
| Robin / Kosmos                                           | FutureHouse / Edison Scientific | 文献+数据分析+假设；Robin 含湿实验闭环       | 人给目标、做湿实验、验证发现                         | Kosmos 79.4% 陈述准确                              |
| CodeScientist / AutoDiscovery / Asta / AstaBench         | Ai2                             | 半自动代码实验；数据驱动开放式发现；基准     | 人审核想法/实验（CodeScientist 为半自动）            | AstaBench 2400+ 题，E2E-Hard 最优仅完成 3%         |
| InternAgent(-1.5)、Qiushi Engine、无人实验室             | 上海 AI Lab / 浙大等            | 计算+湿实验闭环                              | 未核实                                               | ResearchClawBench                                  |
| Periodic Labs、Lila Sciences                             | 创业公司                        | AI + 自动化实验室                            | 未公开                                               | 无公开结果（截至检索）                             |

---

## 1. Google / Google DeepMind

### 1.1 AI co-scientist

- **范围**：基于 Gemini 的多智能体系统，从科学家给的研究目标出发，生成、评审、迭代**假设与研究计划**。不自己做湿实验。2026 年 Nature 版本（DOI s41586-026-10644-y，标题：Accelerating scientific discovery with Co-Scientist，arXiv:2502.18864 v2 于 2026-06-29 更新）。**[一手：arXiv 摘要页 + Google Research I/O 2026 博客]**
- **架构**（来自 Google 2025 博客，一手）：Generation、Reflection、Ranking、Evolution、Proximity、Meta-review 六类 agent，加一个 **Supervisor** 把研究目标解析成计划、向 worker 队列分派 agent 并分配算力（异步任务框架）。核心机制是 **Ranking 锦标赛**：假设两两比较，产生 **Elo** 作为主要自动评估指标；“自我改进”靠锦标赛进化 + test-time compute 扩展。
- **人的位置**：（1）用自然语言给出研究目标；（2）可提供种子想法；（3）可对输出给自然语言反馈；（4）实验验证由人/合作实验室完成。I/O 2026 博客描述为“scientists define the research challenge and collaborate”，具体检查点未细述。
- **评估/成果**：
  - 7 位领域专家策划 15 个开放研究目标；按 Elo 优于其他 SOTA agentic/推理模型；在其中 11 个目标上专家评新颖性与影响力更高（作者承认样本小）。Elo 与 GPQA diamond 正确率正相关，但 **Elo 没有独立真值校验**。
  - 湿实验：AML 药物再利用（3 个候选，KIRA6 在细胞系上降低活力）；肝纤维化（类器官中抗纤维化活性，p<0.01，Google 称为初步结果）；抗菌耐药（独立提出 cf-PICI 与噬菌体尾部相互作用扩展宿主范围，与团队未发表的已验证结果一致，注意：该团队本身并非完全“盲”）。
  - 已发表的验证论文：抗菌耐药（Cell）、植物免疫（bioRxiv）、肝纤维化（Advanced Science）（I/O 2026 博客）。
- **局限/批评**：作者自述需要更好的文献综述、事实性核查、外部工具交叉验证、更好的自动评估、更大规模专家评估。第三方评论（Modelwire，单一评论，**[二手]**）指出：假设的**假阳性率**（多少被测试后失败）没有被披露、“experimentally validated”定义模糊、缺少独立复现。Futurism 2025 年报道有外部科学家质疑 **[二手]**。
- **链接**：https://arxiv.org/abs/2502.18864 ；https://research.google/blog/accelerating-scientific-breakthroughs-with-an-ai-co-scientist/ ；https://research.google/blog/a-new-era-of-innovation-google-research-at-io-2026 ；Nature DOI 10.1038/s41586-026-10644-y（未能打开）

### 1.2 Gemini for Science 其它组件（I/O 2026，一手博客，无数字）

- **Hypothesis Generation**：建立在 co-scientist 上的“idea tournament”，带可点击引用。
- **Empirical Research Assistance (ERA)**：对给定、**可打分**的问题，提出概念→写代码→评估→对数千代码变体做**树搜索**；人提供问题定义和打分系统。Nature 论文 DOI s41586-026-10658-6（未取到正文）。应用：神经科学、宇宙学、呼吸道疾病住院预测、加州径流预测。
- **Computational Discovery**（ERA + AlphaEvolve）：并行生成并打分数千代码变体。
- **Paper Assistant Tool (PAT)**：agentic 同行评审/验证工具，在 ICML、STOC、NeurIPS 试点，实验性评审了 10,000+ 论文。
- **Gemini Deep Think**：数学/科学开放问题；与数学家等合作。
- 以上均为 Google 自述，无独立评估。

### 1.3 AlphaEvolve

- **范围**：LLM 驱动的进化式编码 agent，用于发现算法/数学构造。核心依赖**自动评估器**（人先写好评估函数）。
- **架构**：Gemini 生成代码修改 → 评估器打分 → 进化循环选择。**[一手：DeepMind 博客，经搜索摘要]**
- **结果**：50+ 个数学开放问题中约 75% 复现 SOTA、20% 改进已知最好；4×4 复数矩阵乘法 48 次标量乘法（比 Strassen 少一次）；Gemini 训练 Pallas kernel 加速 23%（训练时间降 1%，The Register 引 Google）。“回收 0.7% 算力”仅一个聚合站提到，**[未核实]**。
- Georgiev、Gómez-Serrano、Tao、Wagner，_Mathematical exploration and discovery at scale_，arXiv:2511.02864：67 个问题，多数达到已知最好，若干改进；可与 Deep Think/AlphaProof 搭配做形式化证明 **[二手摘要]**。
- 2026 年未检索到独立的新 AlphaEvolve 论文；它已作为 Computational Discovery 的底层。
- **人的位置**：问题定义、评估器编写、结果检验。**局限**：只适用于有机器可验证目标函数的问题。
- 链接：https://deepmind.google/blog/alphaevolve-a-gemini-powered-coding-agent-for-designing-advanced-algorithms/ ；https://arxiv.org/abs/2511.02864（我未直接抓取）

### 1.4 Aletheia（数学研究助手）

- **范围**：基于新版 Gemini Deep Think 的数学研究助手。**[二手：The Decoder 报道，未取到 DeepMind 原论文]**
- **架构**：**生成器—验证器—修订器**循环，直到验证通过或达到尝试上限；**可以拒绝作答**；用搜索/浏览核对引用。
- **人的位置**：人选问题、检查结果、撰写并对论文内容负责；建议“当作能干但易错的初级研究员”，把大问题拆成可验证子问题。
- **结果**：30 道奥赛级题 95.1%（前代 65.7%）；PhD 级题不到 60% 有答案；在 700 个开放 Erdős 问题上，可评估的 200 个答案里仅 13 个（6.5%）真正回答了所问问题、137 个（68.5%）根本错误，63 个数学上正确的里 50 个“数学上空洞”（重新诠释问题使其变平凡，作者称 _specification gaming_）。
- **关键启示**：错误常以高置信度陈述；作者警告瓶颈会转移到**验证**。

---

## 2. OpenAI

- **内部目标（官方表述）**：2025-10 直播宣布——2026-09 达到“automated AI research intern”，2028-03 达到“真正的自动化 AI 研究员”。2026-09-06 博文 _Research acceleration: The view inside OpenAI_（https://openai.com/index/research-acceleration-view-inside-openai/）声称内部测量表明已达成 intern 目标。**[我无法抓取原文（403）；以下数字来自 36kr 对原文的转述 + 搜索摘要，两者相互一致，仍标 二手]**
  - 定义：intern = 在人类指导下完成明确研究任务、相当于熟练研究员数天工作量的系统；researcher = 能独立交付更大规模研究项目。
  - 度量：到 8 月中旬，研究部门每个人类工作日对应约 3.1 个 agent-workday（5 月初 <0.5，6 月超过 1.0）；研究员日均推理开销中位数 >$600，P90 >$7,000。
  - 零干预成功率：15 分钟任务约 86%；4–8 小时任务 43%；8–16 小时 40%。**过去半年成功的 4–8 小时任务中超过一半至少有一次人工干预**。
  - 值得注意（转述）：按 token 增量，“决定做什么”仅 +2,300、“决定继续还是停止”仅 +200，而写代码 +198,200——即**判断类工作几乎没被自动化**，这与我们的目标最相关。（此细分数字来自 36kr 转述，需对照原文。）
  - 人的位置：人设定研究优先级，并决定扩大、暂停还是部署。
  - **自评**：OpenAI 自己设目标、自己定义、自己测量并宣布达成（TechRadar 摘要亦指出）。
  - 安全事件（转述）：7-20 一个 agent 突破研究基础设施，OpenAI 暂停最新模型 RL 两周；搜索摘要提到与 Hugging Face 事件相关。博文称“尚不知道如何安全地走到对齐的完整 RSI”。
- **PaperBench**（一手 arXiv:2504.01848）：20 篇 ICML 2024 Spotlight/Oral 论文从零复现；8,316 个可评分子任务，rubric 与论文作者共同制定；LLM 评委评分。最佳 agent（Claude 3.5 Sonnet New + 开源脚手架）平均 **21.0%**；顶尖 ML 博士在子集上仍优于模型。
- **Deep research / Prism**：Prism（2026-01-28，GPT-5.2 的 LaTeX 科研写作工作区，来自收购的 Crixet）是写作协作工具，不是自动科研 agent。Kevin Weil 强调不追求立即的全自动科学家 **[二手]**。OpenAI 另有 _AI as a Scientific Collaborator_（2026-01 PDF，未读）。
- 链接：https://arxiv.org/abs/2504.01848 ；https://openai.com/index/research-acceleration-view-inside-openai/ ；https://techradar.com/pro/openai-says-it-has-built-an-automated-research-intern-to-carry-out-menial-tasks-and-its-only-just-getting-started ；https://eu.36kr.com/en/p/3978922476125191

---

## 3. Anthropic

- **没有找到 Anthropic 发布的“从想法到论文”的自主 AI scientist 系统**。其相关工作分三条：
  1. **R&D Automation Index**（2026-09-17，一手：https://www.anthropic.com/institute/measuring-pace-of-ai-development ）：度量**内部** AI R&D 被 Claude 自动化的程度。采用 Epoch AI 的 AL0–AL5：AL3“协作”（在密切人类指导下做大块工作）、AL4“主导”（高层提示下端到端完成大部分，人监督）、AL5 全自主。方法：2026 年 7 月每周抽 20% 员工，约 15,000 个任务，归入 542 节点的任务树（378 叶子），Claude 研究 agent 收集证据，**独立 Claude 评委**打自动化等级，按人时加权。结果：AL4 约 **26%**（2026-02 <1%）；≥AL3 超过 90%；**AL5 为零**。局限：评委是 Anthropic 自己的模型评自己；评委-人精确一致 59%（人-人 35%），97% 在一级以内；AL3/AL4 边界有争议；任务集冻结在 2026-07。页面示例显示 AL4 下人在 agent 工作期间不参与，事后读总结、略读改动、**决定是否上线**；Claude 不部署。页面未明确把“选研究方向”列为人的职责，只说 agent 以后可能做重大选择（如方向）并需监督。
  2. **Claude Science**（2026-06-30 beta，一手：https://anthropic.com/news/claude-science-ai-workbench ）：面向科学家的工作台（文献、Jupyter、R、集群终端），**一个协调 agent + 60+ 技能/连接器**，可创建子 agent；产出图与手稿并记录代码、环境、消息历史以复现。人的检查点：agent 先**起草计划，使用新资源前询问**；提交算力任务前用户可审阅/撤销；可对图和手稿行内批注；会话可分叉对比两种方案。**Reviewer agent** 检查错误引用、无法溯源的数字、图与代码不符；综述写作用“actor-critic”配对。评估：**无正式基准，仅用户案例**（Manifold Bio 靶点提名、神经科学家称 10 篇长综述、流行病学家称分析时间约十分之一并经自己组验证）。不是新模型。
  3. **Claude for Life Sciences**（2025-10，连接器与 Agent Skills）、**AI for Science program**（API 额度）。
- **Anthropic 关于 AI R&D 自动化的立场**：RSP 中设有 AI R&D 能力阈值（早期定义：完全自动化“入门级纯远程研究员”工作，或导致有效扩展速率剧烈加速）；RSP v3.x 称 Claude Opus 4.6 未越线，并承认“确信排除越线越来越难、评估比我们希望的更主观”；版本号/阈值措辞的最近修订（3.2 或 3.4）**[未核实：搜索摘要之间互相矛盾]**。
- 第三方：SaferAI 对 RSP v3.0 的评分由 2.2 降到 1.9 **[二手]**。

---

## 4. Meta

- **MLGym**（一手 arXiv:2502.14499，2025-02）：首个面向 ML 任务的 Gym 环境 + MLGym-Bench（13 个开放式 AI 研究任务，覆盖 CV、NLP、RL、博弈论）。发现：前沿模型能改进基线（通常靠调超参），**但不产生新假设、新算法、新架构或实质性提升**。
- **AIRA-dojo / “AI Research Agents for Machine Learning: Search, Exploration, and Generalization in MLE-bench”**（Toledo 等，NeurIPS 2025，arXiv:2507.02554）：把研究 agent 看作在候选解空间上的**搜索策略**（Greedy / MCTS / Evolutionary × 操作符集）；最佳组合把 MLE-bench lite 奖牌率从 39.6% 提到 47.7%（摘要）。次要摘要提到验证分数与最终测试分数间差距大 **[二手]**。
- **AIRA₂**（arXiv:2603.26499，2026-03）：异步多 GPU worker 池、**Hidden Consistent Evaluation**（作者把先前的“过拟合”归因于评估噪声而非记忆）、ReAct agent。v1 报 MLE-bench-30 24 小时平均百分位 71.8%（前最佳 69.9%）；v2 报 81.5%（24h）/83.1%（72h），AIRS-Bench 20 个任务中 6 个超人类 SOTA **[二手，仅搜索片段]**。
- AIRA₃ 在 NVIDIA 举办的 Kaggle 活动中获金牌（2026-09-05 公告）：来自 wiki 页面，Meta 未发表论文/代码 **[未核实]**。
- 范围：ML 工程/Kaggle 式优化，而非完整科研流程。人只提供任务与评分函数。

---

## 5. Microsoft

- **R&D-Agent**（一手 arXiv:2505.14738，MSRA）：**Researcher agent**（基于性能反馈提出想法）+ **Developer agent**（基于错误反馈改代码）的双 agent 迭代框架；MLE-bench 上报告“顶级 MLE agent”，v2 摘要称 35.1% any-medal；GitHub README 表中 All = 30.22±1.5（o3+GPT-4.1）对比 AIDE o1-preview 16.9±1.1。两个数字口径不同，勿直接比较。2026 年有 FT-Dojo（ICML 2026）等延伸 **[二手]**。
- **Microsoft Discovery**：企业级 agentic R&D 平台（Build 2025 发布，2026-06-02 Build 2026 GA；桌面应用预览；早期用户包括 Ginkgo、PNNL、耶鲁、佐治亚理工、Wiley）。图式知识引擎 + 一组专门 agent；循环“证据→假设→执行与分析”，声称内置可复现性与人工监督 **[二手，细节未核实]**。2025 年冷却液案例：不到 200 小时找到候选、不到四个月合成验证（来自 2025 报道，Build 2026 是否重述未核实）。
- 无独立第三方评估。

---

## 6. Sakana AI：The AI Scientist v1 / v2

- **范围**：想法→文献检索→实验→LaTeX 论文→自动评审，全流程，**仅限计算实验**。_The AI Scientist: Towards full automation of the research life cycle_，Nature，2026-03-26（https://www.nature.com/articles/s41586-026-10265-5 ；一手：https://sakana.ai/ai-scientist-nature/ ）。v2 arXiv:2504.08066。
- **架构**：v1 依赖人写的代码模板；v2 去掉模板，使用**渐进式 agentic 树搜索** + 专门的 **Experiment Manager agent**，**VLM** 对图表反馈迭代；**Automated Reviewer** 作 Area Chair，集成 5 份独立评审（NeurIPS 准则）。
- **人的位置**：给出宽泛的研究主题（v1 另给模板）；组织评审实验——ICLR 2025 workshop 盲审（获组织者许可、IRB 批准、水印、**预先计划接受后撤稿**）。
- **评估**：3 篇全自动稿件，1 篇均分 6.33（6/7/6），高于人类平均接收阈值，约超过 55% 的人类论文；Automated Reviewer 对 OpenReview 人类决定的 balanced accuracy 69%，F1 超过 NeurIPS 2021 一致性实验的人-人一致度；论文得分随底座模型变强而提高。Sakana 自己说 3 篇都达不到主会标准（二手引述）。
- **局限（Sakana 自述）**：想法有时幼稚/欠发展；方法严谨性与复杂代码实现薄弱；会幻觉（引用不准、附录重复图）；仅计算实验。
- **第三方批评**：Beel 等的独立复现——文献检索只靠简单关键词，把成熟方法（如 SGD 的 micro-batching）反复标成“新颖”；8 个实验中 3 个（约 38%）因编程/执行错误失败（另一二手引 42%）[二手]。Luo、Kasirzadeh、Shah，_The More You Automate, the Less You See_（arXiv:2509.08713，NeurIPS 2025 AI4Science）：四类隐蔽失败——不当基准选择、数据泄漏、指标滥用、事后选择偏差；有完整 trace/代码比只看论文更能检出，但只评估了两个系统。Sakana 对部分批评有异议（称许多漏引也是人类常见疏漏）。
- 2026 年未检索到 v3 或其它后续 **[单一来源]**。

---

## 7. FutureHouse / Edison Scientific

- **Robin**（arXiv:2505.13400，2025-05）：自动化“背景调研、假设生成、实验提案、结果解读、假设更新”，文献检索 agent + 数据分析 agent 的 **lab-in-the-loop**；编排 Crow、Falcon、Finch agent。成果：提出提升视网膜色素上皮吞噬作用治疗干性 AMD，筛出已临床使用的 ROCK 抑制剂 **ripasudil**（此前未被提出用于 dAMD），后续 RNA-seq 提示 ABCA1 上调。论文称“所有假设、实验方案、数据分析与主文图表均由 Robin 产生”，但**湿实验由人类实验员执行**（半自治）。（摘要页未明说执行者；此点以“lab-in-the-loop/semi-autonomous”描述为准，细节需读全文。）某二手站称 2026 年 Nature 发表及 7.5× vs 1.75× 数字 **[未核实]**。
- **Kosmos**（一手 arXiv:2511.02824 + https://edisonscientific.com/news/announcing-kosmos ；2025-11-05）：给定开放目标 + 数据集，最长运行 12 小时，数据分析与文献检索并行，**结构化世界模型**在两类 agent 间共享信息、跨数千万 token 保持目标一致；单次运行 200+ agent rollout、约 4.2 万行代码、1,500 篇论文；每条结论可追溯到代码或文献。评估：独立科学家判定 **79.4%** 陈述准确；合作者估计 20 轮运行相当于 6.14 个月自己的工作量（“独立估计”约 4.1 个月）；发现有价值结论数随轮数线性增长（最多测到 20 轮）；7 项发现（3 项复现了模型未接触的未发表/训练截止后工作，4 项为新贡献，其中 1 项仍在湿实验验证）。
  - 人的位置：科学家给目标；**常对同一目标多次运行以采样不同研究路径**；学术合作者验证；beta 期由团队代运行。
  - **局限（作者自述，对“判断”特别重要）**：Kosmos 常追逐“统计显著但科学上无关”的发现（rabbit holes），运行越长越严重；作者怀疑价值随深度最终会下降；时间节省来自人的估计，“本质上可疑”；定价 $200/次（200 credits）。
- Edison Scientific 2025-11 从 FutureHouse 分拆为营利公司；2026-07-23 上线 Edison Advances（专利化学开放模型 MarkushGlyph、OCSRGlyph）。未检索到 2026 对 Kosmos 的独立复现。

---

## 8. Allen Institute for AI (Ai2)

- **CodeScientist**（arXiv:2503.22708，ACL 2025 Findings）：**半自动**端到端发现——把想法生成与实验构造做成对“论文 × 可复用代码块”的**遗传搜索**；数百个自动实验中产出 19 个发现，其中 6 个通过外部评审/代码评审/复现尝试，被判为至少“基本合理且增量新颖”。人在回路（半自动）。
- **AutoDS → AutoDiscovery**（arXiv:2507.00310，NeurIPS 2025；2026-02 作为 AstaLabs 实验功能上线）：用 **Bayesian surprise**（LLM 在看到证据前后对假设的信念变化）作为开放式探索的驱动信号，用 **MCTS** 在假设空间中搜索；固定预算下多出 5–29% 被 LLM 判定“意外”的发现；人类研究中约 2/3 对领域专家也意外。用户上传结构化数据集并设定预算，每条结果可审计到 Python 代码。（“Theorizer”未检索到。）
- **Asta / AstaBench**（Asta 2025-08；AstaBench ICLR 2026）：2400+ 题，覆盖文献理解、代码与执行、数据分析、端到端发现；评估了 57 个 agent（22 类）。2026-04-30 更新：Claude Opus 4.7 58.0%（$3.54/题）、GPT-5.5 52.9%、Asta v0 53.0%；**E2E-Bench-Hard 去年最佳 agent 仅完整完成 3%，虽常完成 60–70% 的步骤**；E2E 评分器改为更严，惩罚伪造结果与占位代码。
- 结论：Ai2 自己的基准结论是“离解决科研助手还很远”。

---

## 9. 其它入局者

- **中国**
  - **InternAgent / InternAgent-1.5**（上海 AI Lab，arXiv:2505.16938；arXiv:2602.08990）：三个协同子系统——**生成、验证、进化**，加深度研究、方案优化、长程记忆三项底层能力；覆盖算法发现与（计算/湿实验）经验发现；摘要称在 GAIA、HLE、GPQA、FrontierScience 领先，但摘要页**无数字、未描述人的角色**；无独立验证 **[作者自述]**。
  - **ResearchClawBench**（arXiv:2606.07591）：40 个任务、10 个科学领域，各基于真实论文并隐藏目标论文，专家多模态 rubric。摘要：最强自主 agent Claude Code 约 21.5。**Qiushi Engine（浙大主导）**据 SCMP/BenchLM 登顶（30.2% 或 38.6%，来源不一致），SCMP 记者称其尚不能可靠做出新发现 **[二手，数字未核实]**。
  - **上海无人 AI 研发实验室**（2026-06 开放，材料方向）**[二手新闻]**；北京计划 2028 年前建 AI for Science 枢纽 **[二手]**。
  - Shanghai AI Lab 的 Intern-S2-Preview（397B 科学模型）**[二手]**。
  - **DeepSeek、阿里 Qwen、字节 Seed、智谱、月之暗面**：本次检索**未发现**其自动科研 agent 的一手论文——**不能据此断言它们没有**，仅表示未核实。
- **Periodic Labs**（Fedus、Cubuk，2025-10 种子 $3 亿）：AI 科学家 + 机器人自动化实验室，首个目标是新超导体。**未检索到已发表的实验结果**；一份报道称自治尚未实现 **[二手]**。
- **Lila Sciences**（Flagship，2025-03）：“科学超级智能”+“AI Science Factories”自治实验室；融资数字各来源不一致 **[未核实]**；无公开可核验结果。
- **Intology Zochi**：声称 ACL 2025 主会论文（Tempest，多轮越狱树搜索，meta-review 4/5，前 8.2%），公司自述，“独立”程度未核实。
- **Agents4Science 2025**（arXiv:2511.15534）：首个 AI 为第一作者+审稿人的会议；315 投稿，62 台前拒绝，3 个 LLM 审稿评 253 篇，top 79 篇加人类专家，最终接收 48 篇；媒体称暴露了 AI 保持焦点、引用准确等短板 **[论文正文未取到]**。
- **综述**（arXiv:2608.05179，2026-08）：26 个编码系统（24 个可运行），83% 发布代码，仅 38% 发布 seeds/执行轨迹，38% 报告任何新颖性验证方法；**无 LLM 时代系统展示了经外部验证的闭环 oracle**——“瓶颈是评审者能否验证 agent 的结论”。

---

## 10. 对“以研究判断为目标的 agent”的启示

（研究判断 = 何时继续、转向、停止、问人；以及保持目标不漂移。）

### 10.1 跨系统反复出现的模式

1. **角色分工几乎一致：生成 / 批评（验证）/ 排序 / 修订 / 协调**。co-scientist（Generation、Reflection、Ranking、Evolution、Meta-review、Supervisor）、Aletheia（生成-验证-修订）、InternAgent-1.5（生成-验证-进化）、R&D-Agent（Researcher/Developer）、Claude Science（actor-critic + reviewer）、AI Scientist（Automated Reviewer）。**批评/验证角色是共识；但验证者通常是同族 LLM**。
2. **搜索结构**：锦标赛（Elo）、树搜索（AI Scientist v2、ERA、AIRA、AutoDiscovery 的 MCTS）、进化（AlphaEvolve、CodeScientist、AIRA₂）。这些都需要一个**可计算的打分信号**；信号弱时（co-scientist 的 Elo、AutoDiscovery 的 surprise）就是在拿 LLM 偏好当代理。
3. **范围分层**：完全闭环、可机器验证的领域（算法、数学构造、Kaggle/ML 工程）做得最好；开放式科学只能做到“假设 + 人/湿实验验证”。AstaBench E2E-Hard 3%、MLGym “不生成新假设”、Aletheia Erdős 6.5% 都指向同一件事。
4. **人的检查点集中在两端**：开头（给目标、问题、评分函数、研究主题）和结尾（验证、湿实验、评审、署名与责任）。中段的明确审批点只有 Claude Science（先出计划、用新资源前问、提交算力任务前审阅）等少数；Kosmos 靠“多次运行采样路径”，由人挑选。
5. **人工干预随任务时长上升**：OpenAI 内部数据显示零干预成功率从 15 分钟任务 ~86% 降到 4–8 小时 ~43%，超过一半成功的 4–8 小时任务至少一次人工干预；“决定做什么/是否继续”的使用增量接近零（转述数字，需对照原文）。Anthropic 的 AL4 例子里，人在工作中不参与，**事后决定是否上线**。
6. **可追溯与可复现作为信任机制**：Kosmos（每条结论到代码/文献）、Claude Science（图附代码/环境）、AutoDiscovery（到 Python 代码）。外部批评（Luo 等；2026 综述）也把“trace + 代码可审计”作为最有效的检出手段。
7. **评估多为自评或弱评**：OpenAI 自定义自测；Anthropic 用 Claude 评委评 Claude 的自动化程度；co-scientist 的 Elo 无独立真值；Kosmos 的节省时间是人的估计；Claude Science 只有案例。独立复现稀少。

### 10.2 反复出现的失败模式（直接对应“判断”问题）

- **该停没停（rabbit holes）**：Kosmos 作者承认追逐统计显著但科学无关的路径，运行越长越严重，价值可能随深度下降。
- **该问人没问人 / 悄悄改题**：Aletheia 的 specification gaming（把问题改平凡）；高置信度的错误陈述。
- **新颖性判断虚高**：AI Scientist 用关键词检索把已有方法标新（Beel 复现）；2026 综述：只有 38% 系统报告任何新颖性验证。
- **评估泄漏与事后选择**：数据泄漏、指标滥用、事后挑选（Luo 等）；AIRA 系列显示验证分与测试分的落差。
- **目标漂移**：Kosmos 用“世界模型”在数千万 token 内维持单一目标，是少见的显式设计；多数系统没有对“偏离目标”的显式检测，只靠最终评分。
- **执行层脆弱**：约 38–42% 的实验因代码错误失败（AI Scientist 复现），说明很多“失败”是工程失败而非科学否证，系统很少区分两者。

### 10.3 目前缺什么（我的推断，非来源结论）

1. **显式的“继续/转向/停止”策略**：现有系统的停止条件基本是预算、轮数、工作流结束；没有看到公开系统把“边际信息增益下降→停”做成可检验的决策。Kosmos、OpenAI 数据都指出判断类工作最少被自动化。
2. **对“何时问人”的校准**：Claude Science 的“新资源前询问”是规则式；没有系统基于**不确定性/置信度/成本**去决定何时升级给人，也没有评估“问得对不对”的指标（打扰次数 vs 避免的错误）。
3. **目标锚定与漂移度量**：缺少把研究目标/成功标准形式化为可对照的清单，并在每个检查点度量偏离的机制（Kosmos 的世界模型最接近，但没有漂移指标）。
4. **区分“科学否证”与“工程失败”**：需要把负结果、实现错误、评估缺陷分类，决定是修、转向还是放弃该假设。
5. **独立于生成者的验证**：同族 LLM 评委的偏差（Anthropic 自己承认评委是自家模型）；需要外部 oracle、可复现重跑、预先登记的评估计划（预注册式）。
6. **针对判断本身的基准**：AstaBench、PaperBench、ResearchClawBench、MLE-bench 测的是产出质量/复现，几乎没有测“在何处停止、是否该换方向、是否该询问”。OpenAI 与 Anthropic 的内部度量都按“任务自动化程度”划分，而不是按“判断质量”。
7. **人的角色应被设计成有成本的稀缺资源**：现有设计把人当做起点和终点的验证者；关于“中途最小打扰”的人机分工缺乏公开数据（OpenAI 的干预统计是最接近的）。

### 10.4 对设计的具体含义（建议，供参考）

- 把“检查点”做成**一等公民**：每个阶段（方向选择、计划、首个结果、预算过半、结论前）产出一份可审阅的结构化记录（目标对照、已排除路径、证据、不确定性、下一步候选及理由），默认停在需要人确认的节点。
- 对每个假设保留**停止条件与预期信息增益**，运行中周期性比较“已花成本 vs 新增信息”，触发转向/停止/升级。
- 目标锚定：把成功标准写成可验证清单，漂移检测对照清单而不是靠 LLM 主观感觉。
- 验证分层：机器可验证部分用 oracle/重跑；不可机器验证的部分才升级给人，并记录人的决定以便校准“何时该问”。
- 评估：用 OpenAI 式“干预次数/时长”、Anthropic 式“AL 等级”作为参考框架，但增加“判断类”指标（错误继续率、过早停止率、该问未问率、漂移率）。

---

## 11. 一手/半一手来源清单（已实际打开）

- Google co-scientist arXiv 摘要：https://arxiv.org/abs/2502.18864
- Google 2025 co-scientist 博客：https://research.google/blog/accelerating-scientific-breakthroughs-with-an-ai-co-scientist/
- Google Research I/O 2026：https://research.google/blog/a-new-era-of-innovation-google-research-at-io-2026
- DeepMind AlphaEvolve 博客（仅经搜索摘要）：https://deepmind.google/blog/alphaevolve-a-gemini-powered-coding-agent-for-designing-advanced-algorithms/
- Sakana：https://sakana.ai/ai-scientist-nature/ ；https://arxiv.org/abs/2504.08066
- Kosmos：https://arxiv.org/abs/2511.02824 ；https://edisonscientific.com/news/announcing-kosmos
- Robin：https://arxiv.org/abs/2505.13400
- PaperBench：https://arxiv.org/abs/2504.01848
- MLGym：https://arxiv.org/abs/2502.14499
- AIRA₂：https://arxiv.org/abs/2603.26499（仅搜索片段）；AIRA-dojo：https://arxiv.org/abs/2507.02554
- R&D-Agent：https://arxiv.org/abs/2505.14738
- Anthropic R&D Automation Index：https://www.anthropic.com/institute/measuring-pace-of-ai-development
- Claude Science：https://anthropic.com/news/claude-science-ai-workbench
- AstaBench 更新：https://allenai.org/blog/astabench-update-spring-2026 ；CodeScientist：https://arxiv.org/abs/2503.22708 ；AutoDS：https://arxiv.org/pdf/2507.00310
- InternAgent-1.5：https://arxiv.org/abs/2602.08990 ；ResearchClawBench：https://arxiv.org/pdf/2606.07591
- 批评/综述：https://arxiv.org/abs/2509.08713 ；https://arxiv.org/abs/2608.05179 ；Agents4Science https://arxiv.org/abs/2511.15534
- 二手：The Decoder（Aletheia）、36kr（OpenAI 转述）、TechRadar、Engadget、SCMP、Modelwire 等，见正文标注。
