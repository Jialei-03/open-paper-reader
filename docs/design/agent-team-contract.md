# 研究团队 · 并行开发的接口约定

第 1 步（成员、频道、消息、投递）正在另一个分支实现。下面这些格式让第 3–5 步可以同时开工，合并时由负责人把它们接到第 1 步的模型上。字段名就用这里的，不要改。

## 成员和频道的引用
- 成员：`{ "id": str, "name": str, "kind": "human" | "agent", "role": str }`。内置 agent 的 role：`advisor`（导师）、`executor`（执行者）、`librarian`（文献员）、`reviewer`（评审）、`writer`（写手）、`distiller`（提炼者）。我（研究者）的 role 是 `owner`。
- 频道：`{ "id": str, "name": str, "kind": "channel" | "dm" }`。

## 规则（Rule）
```json
{
  "id": "r-…",
  "enabled": true,
  "when": {
    "event": "message" | "mention" | "job_finished" | "plan_approved" | "conclusion_proposed" | "review_failed" | "schedule",
    "channel": "频道 id，可省略表示任意",
    "from_role": "可省略",
    "from_member": "可省略",
    "kind": "消息类型，可省略：text | result | plan | conclusion | draft | review",
    "cron": "仅 schedule：分 时 日 月 周",
    "timezone": "仅 schedule"
  },
  "then": {
    "action": "wake" | "review" | "wait_for_owner" | "post",
    "member": "成员 id（wake / review）",
    "role": "或者按角色找成员",
    "instruction": "给被叫醒成员的一句话",
    "on_fail": "review 不通过时交给谁（成员 id 或 role）",
    "max_rounds": 3,
    "channel": "post 发到哪",
    "text": "post 的内容"
  },
  "limit": { "per_thread": 10 },
  "position": { "x": 0, "y": 0 }
}
```

## 事件（Event）——规则引擎的输入
```json
{ "type": "message" | "mention" | "job_finished" | "plan_approved" | "conclusion_proposed" | "review_failed" | "schedule",
  "team": "团队 id", "channel": "频道 id", "thread": "线程根消息 id 或 null",
  "author": { "id", "kind", "role" }, "kind": "消息类型", "mentions": ["成员 id"], "at": "ISO 时间" }
```

## 动作（Action）——规则引擎的输出
```json
{ "rule": "规则 id", "action": "wake" | "review" | "wait_for_owner" | "post",
  "member": "成员 id", "instruction": "…", "channel": "…", "thread": "…", "text": "…" }
```

## 工作流（Workflow）
```json
{ "id": "…", "name": "…", "builtin": true | false, "version": 1,
  "rules": [Rule], "layout": { "members": { "成员 id": {"x","y"} }, "channels": { "频道 id": {"x","y"} } } }
```

## 运行状态（给画布叠加显示）
```json
{ "members": { "成员 id": "idle" | "working" | "waiting" }, "fired": [{ "rule": "规则 id", "at": "ISO" }] }
```

## 比较（Comparison）
```json
{ "threads": [{ "id", "title", "workflow": "名称", "status", "conclusion": "一句话",
  "numbers": [{"name", "value"}], "tokens": int, "job_seconds": int, "elapsed_seconds": int,
  "rounds": int, "members": [{"id", "name", "messages": int, "tokens": int}] }] }
```
