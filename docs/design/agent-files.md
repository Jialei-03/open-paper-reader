# 设计：成员就是文件

成员定义是带 YAML 头的 Markdown 文件，正文是角色说明。ORA 提供工具，用户决定成员怎么分工；成员、研究、团队、接力和规则次数默认均不限。消息与等待语义见 [研究团队](agent-team.md)。

```markdown
---
name: 文献员
description: 找论文、核对出处、总结要点
tools: [literature, files, web]
machines: [host]
channels: ["#综述"]
color: amber
---

你是这个团队的文献员。……
```

## 文件归属

- 团队定义在应用私有项目仓库的 `.ora/agents/<名字>.md`，由 `research_repo.repo_dir(settings, workspace.id)` 定位；不等同于绑定的用户源码目录。保存成员时只提交该成员的文件，改名同步重命名文件。
- 个人成员库在数据目录 `agents/`；从库加入团队会复制文件，之后各自独立。同步库修改需用户明确选择，保留团队已覆盖的字段和未知字段，频道订阅归各团队所有。
- 内置导师、执行者、文献员、评审、写手、提炼者来自 `backend/agents/*.md`，初始化时复制进项目。用户可编辑、复制或恢复内置文件。
- `AGENTS.md` 是项目共享说明，所有成员简报读取。旧 `PROJECT.md` 在没有 `AGENTS.md` 时原样改名；两者同时存在则不覆盖已有说明。
- 数据库保存成员身份、角色路由、文件路径、库引用、运行状态、消息和花费。旧 SQL 定义列是迁移档案，运行不把它们当作第二份定义。

## 字段

| 字段 | 默认与含义 |
| --- | --- |
| `name` | 必填；成员名字与文件名 |
| `description` / 正文 | 简介默认空；正文为 Markdown 角色说明 |
| `model` | 空值沿用团队模型；可写已配置模型的 ID、配置名或模型名 |
| `tools` | 省略取角色默认：`literature/files/web/project`，执行者与写手另有 `shell/experiments` |
| `machines` | 默认 `[host, local, docker]`；允许使用的机器 |
| `channels` | 默认 `[]`；频道名（如 `#综述`），兼容频道 ID |
| `color` | 默认 `blue`；支持 `blue/green/amber/red/violet/slate` |
| `readonly` / `file_readonly` | 默认 `false`；全局只读与仅文件只读分别控制 |
| `enabled` | 默认 `true`；停用不删除历史身份 |
| `budget.turns/tokens/minutes` | 缺省或 0 为不限；仅显式正数限制单次运行 |
| `budget.total_tokens` | 缺省或 0 为不限；仅显式正数限制成员累计 token |
| 其他字段 | 保留原文、注释和未知嵌套值，不授予额外能力 |

具体格式和显式预算取值校验由 `backend/agent_files.py:parse` 负责；字段合法范围不是默认执行额度。预算不出现在成员表单里，需要时在源文件填写。内置文件可以对工具和只读权限作不同配置，不会因此获得默认运行上限。

## 编辑与运行

成员编辑器的表单和 Markdown 正文共同编辑同一份文件，也可切到「源文件」编辑整份定义。读取界面、准备简报、权限校验、订阅和预算均通过 `agent_files.py` 的文件边界；外部修改在下次读取时生效，外部新增的有效文件会注册成员与私信。

YAML 往返编辑保留未知字段和注释；表单修改已知字段可能规范化排版。格式错误显示行号，保留错误源文件供修复，运行继续使用数据目录 `agent-state/<成员id>.valid.md` 的上一份有效定义；缺失文件也沿用有效快照。源文件摘要用于检测外部修改冲突，库同步基线保存在同目录的 `.base.md`。

运行前重读文件，在工具提供和执行入口检查权限、机器、启停状态和用户显式预算。运行记录中的有效预算是本次执行回执，不替代文件定义。

## 导入

可导入 Claude Code 的 Markdown agent 和 Codex 的角色 TOML。Claude 工具名映射为 ORA 工具组：`Read/Grep/Glob → files`，仅含读工具时设置 `file_readonly`；`Edit/Write → files`，`Bash → shell`，`WebFetch/WebSearch → web`。未知工具名保留但不授权。Codex 的 `description` 留在 YAML 头，`developer_instructions` 转成正文，其余字段保留。
