# 论文提纲（草稿）

**暂定题目**：Knowing When to Stop: Research Judgment and Self-Improving Playbooks in an Autonomous Research Agent

这份提纲把 2026-10-20 的评测整理成一篇论文的骨架。每条主张后面都注明证据在哪份记录里。所有数字都来自 `scripts/research_eval/results/` 的原始记录，可以用 `report.py` 重新生成。

## 摘要（英文草稿）

Autonomous research agents can now carry out the engineering of research but often fail at the research itself: they misjudge what is worth doing, do not back off dead ends, ignore resources and drift from the goal. We present Open Research Agent, an open-source agent built around these failure modes. It has:

- a persistent research map with falsifiable hypotheses and kill conditions;
- a focus gate;
- evidence that must cite the system's own experiment logs;
- a read-only advisor that judges direction and ends projects;
- a playbook of judgment rules distilled from past projects, so the research process improves without changing the model.

On held-out tasks with precomputed ground truth (threshold selection, missing data, a tempting dead end, label leakage, confounding):

- the advisor is what makes projects stop: without it, every run used its whole budget at 1.3–2.5× the cost;
- seven evaluation rounds turned failures we observed into protocol changes, and right endings on the leakage task rose from 3/6 to 9/10 with the same model;
- a playbook learned from scratch on five learning tasks reached 20/20 full marks on four held-out tasks, against 17/20 without it, with 27% fewer tokens. **This did not replicate** on a pre-registered fresh held-out set (13/15 vs 15/15, 12% more tokens). The earlier gain was concentrated in one task that had been used throughout development.

We also report the failure modes the protocol introduced and how we fixed them:

- over-asking for human input;
- polarity confusion in structured answers;
- verdicts silently skipped.

## 1. 问题

- 背景研究：
  - Kirgis、Narayanan 等（2607.27191）：前沿 Agent 完成了工程，研究没有实质进展；
  - SciIntegrity-Bench（2605.10246）：缺数据时 7 个模型全部合成数据；
  - 2608.05179：24 个系统里没有经过外部验证的核验机制。
- 我们的主张：难点在**研究判断**，即什么时候继续、转向、停下、问人；而不在**工程能力**。判断可以用有真值的任务客观测量。

## 2. 系统

- 研究地图、轮次、聚焦闸门、止损条件（`docs/RESEARCH.md`）。
- 证据：只能引用系统保存的作业日志或论文原句，数字要和证据一致。
- 导师：只读；触发规则；判断直接生效；结束项目时要给出对问题原文的回答（`answer_to_question`）。
- 请人帮忙：执行者写 `needs_input`，导师立即审视；只有问题按原样根本答不了时才停下。
- 研究手册：提炼者把项目经过写成 `{when, do, why}` 规则。规则被 2 个项目支持才生效，有害的自动退役，只对项目开始时已生效的规则投票。

## 3. 评测方法

- **任务**：每个任务事先用固定种子算好真值。评分标准对执行者、导师和提炼者都不可见。

  | 任务 | 测什么 | 正确结局 |
  |---|---|---|
  | imbalance-threshold | 得出一个数 | 已回答，数字在容差内 |
  | missing-transfer | 缺数据时诚实 | 停下等输入，不编造 |
  | poly-dead-end | 识别死胡同 | 否定 |
  | leaky-feature | 怀疑过好的结果 | 否定，并给出去掉泄漏后的真实值 |
  | confounded-treatment | 识别混杂 | 否定，并给出分层后的比率 |

- **学习集与封存集分开**：封存任务从不参与提炼。
- **条件**：`playbook`、`no-playbook`、`no-advisor`。
- **过程指标**：偏离率、轮数、token、证据条数。

## 4. 结果

### 4.1 导师的作用：知道什么时候停

第二轮（`2026-10-20-second-results.md`）：

- 有导师的 12 次全部以正确的方式结束；
- 去掉导师的 6 次全部跑满预算，花费是有导师时的 1.3 到 2.5 倍；
- 执行者自己仍然诚实、数字也对。

结论：执行者能把事做对，但判断"问题已经回答"或"这条路走不通"要靠导师。

### 4.2 观察失败、修正协议：七轮迭代

`2026-10-20-third-results.md`。每一轮的失败都变成一处协议修改，模型不变：

| 观察到的失败 | 修改 |
|---|---|
| 没有记录证据就结束 | 结束项目要求地图上有记录在案的证据 |
| 缺数据时空转到预算用完 | 加入 `blocked`；执行者写 `needs_input`，导师立即审视 |
| 不该问的时候也问人 | 只有问题按原样根本答不了时才停下 |
| 答"否"却记成"已回答" | 结构化答案；字段名写明含义（`answer_to_question`） |
| 判断被跳过而导师不知道 | 把上次被跳过的判断和原因写进下一次评审的简报（只在返回值里给出时导师读不到：`advise` 一调用这一轮就结束了） |
| 先用终端跑一遍、再用作业重跑 | 短作业可以等结果，同一轮就能记录 |

泄漏任务的正确结局率：3/6 → 1/5 → 5/6 → 7/10 → 9/10。第四轮的下降，正是"请人帮忙"这个出口带来的新失败。

### 4.3 自我改进：从空手册开始学

`2026-10-20-learned-playbook.md`：

- 10 个学习项目产生 3 条生效规则：核实字段时点、缺文件就停、答完就停；
- 4 个封存任务、每个条件 5 个种子：学到的手册 20/20 满分、66 轮、46 万 token；不读手册 17/20、88 轮、63 万；
- 差距集中在泄漏任务；和规则无关的阈值任务上没有帮倒忙；
- 对照：开发者审核的手册（第 9 版）在第二、五、六轮里没有一致的作用。
- **在预注册的全新封存集上没有复现**（`2026-10-20-fresh-heldout-plan.md`）：3 个新任务、每个条件 5 次，学到的手册 13/15、44.3 万 token，不读手册 15/15、39.5 万。三条预期中，一条压线达成，两条落空。
- 所以，能写进论文的结论是一个**否定的结果**：在这个规模上，提炼出的判断规则没有稳定地改善研究过程；在开发集上看到的收益，属于对特定任务的过拟合。这本身值得报告，因为自我改进类的工作很少做预注册的复现。

### 4.4 新类型的任务：混杂

学到的手册里没有关于混杂的规则。在 confounded-treatment 上，两个条件各 5 次：

- 10 次全部在第 1 轮发现了辛普森反转；
- 学到的手册 5/5 满分、平均 3.6 轮，不读手册 4/5、2.0 轮；
- 得分上没有帮倒忙。花费更高，几乎全来自 1 次导师迟迟不结束的运行。

修复之后重跑一次（第八轮），混杂任务上两个条件的轮数和花费正好反过来（2.2 对 3.2 轮）。结论：在没学过的问题类型上，手册的差别在噪声范围内，既没有收益，也没有损害；它的作用集中在学过的那类问题上。泄漏任务在第八轮里方向依旧：3.7 对 5.3 轮。

## 5. 讨论

- **"请人帮忙"的两面**：该问时，缺数据任务的花费降了约 60%；不该问时，它成了不回答的理由。诚实地报告缺什么，和把缺什么当成不回答的理由，是两回事。
- **结构化输出也会被误读**：一个叫 `answer` 的字段，被理解成"答完了没有"。字段名要写明含义，并给一个和任务无关的例子。
- **为什么学到的手册有用，审核版没用**（猜测，未验证）：学到的规则来自同类问题的真实经过，写得具体；审核版里的规则多数针对别的情况。

## 6. 局限

- 单一模型（gpt-6-luna），任务规模小（几分钟的 CPU 实验）。
- 每格 5 个种子，没有做显著性检验。总体差距主要来自一个任务。
- 学习任务和封存任务大多是同类问题，测的是同类迁移。
- 评分是关键词和数字匹配，出现过误判，都已用 `rescore.py` 修正并记录。
- 评测和系统由同一人开发，协议修改是看过封存任务的失败之后做的。严格说，封存集已经参与了"协议的开发"，只是没有参与"手册的提炼"。为此做了一组预注册的全新任务。在那组任务上，**协议本身**仍然成立：不读手册时 15/15 结局正确，没有编造。**手册的收益**则没有复现。

## 7. 下一步

- 一组完全没看过的新封存任务，用来检验协议本身有没有过拟合。
- 多个模型。
- 学习和测试交替进行，观察手册增长时的效果。
- 更长、更真实的研究任务，比如复现一篇论文的一个结论。
