# API

Open Paper Reader 的前端用的就是这套接口，所以网页里能做的事，外部程序大多也能做。接口地址是你配置的 `APP_ORIGIN` 加上 `/api/v1`；OpenAPI 描述在 `/api/v1/openapi.json`，交互式文档在 `/api/v1/docs`（Swagger 资源由本服务自己提供，不访问外部 CDN）。任何 HTTP 客户端或 Agent 框架都可以使用。

## 认证

**网页会话**：`POST /auth/login`（用户名和密码）后得到 `HttpOnly` 的会话 Cookie，写请求还要把可读的 `paper_csrf` Cookie 回填到 `X-CSRF-Token`。注册是 `POST /auth/register`（用户名 3–32 个字符，密码至少 8 个；`REGISTRATION=invite` 时还要带管理员为这个用户名生成的 `invitation`）。

**Agent 凭据（令牌）**：在「设置」里创建，只属于创建它的用户，可以选 `read`、`write` 两种权限，有效期 1–365 天，随时撤销；原始值只在创建时显示一次，之后服务器只保存摘要。请求时发送 `Authorization: Bearer <token>`，**不要把令牌放进 URL**。

- `read`：读取元数据、笔记、文件、历史、阅读进度、上下文，以及导出整个工作区。
- `write`：创建论文、版本和文件，写入证据、分析、问题、专题、对比，以及未确认的阅读建议。
- 令牌**不能**：创建、修改或删除个人笔记，确认「已读」，管理令牌和邀请码，删除论文，更改收藏或归档。这些要求工作区用户本人（带会话）。
- 权限不足是 403；别人的对象 ID 是 404；过期或被撤销的凭据是 401。

你自己的程序想读写笔记，请用本人的会话，或者让令牌提出建议、由你确认。Open Paper Reader 内置的研究助手不走令牌，它以当前用户的身份调用同一套业务接口，见 [助手](AGENT.md)。

## 请求约定

- **`Idempotency-Key`**：论文、版本、文件、记录（item）、事件的创建，论文与记录的修改，以及推荐反馈都必须带。每个逻辑操作生成一个 UUID，网络重试时**原样复用**。指纹包含操作者、方法、路径和校验后的请求体（文件则是文件的哈希、名称、路径和版本）；同一个键用于不同的请求是 409。
- **`If-Match: 3`**：修改论文（PATCH）、修改记录（PUT）、删除论文或记录、创建论文新版本、更改阅读状态都必须带当前的 `revision`。先 GET 拿到 `revision`；缺少是 428，版本不对是 409，应当重新读取并合并，不要换个新版本号就盲目重发。
- 创建和修改返回 HTTP 200 和结果对象；删除返回 `{"ok":true}`；错误是 `{"detail":...}`；格式错误或多余字段是 422（请求结构是严格的）。
- 删除论文要带 `X-Confirm-Delete: <论文 id>`，并且只能用本人会话。
- JSON 请求最大 2 MiB，上传文件默认最大 50 MiB（`UPLOAD_LIMIT_MB`）。服务器不会自动替你下载任意 URL。

## 接口一览

### 论文与文件

| 能力 | 接口 |
| --- | --- |
| 搜索、筛选文库 | `GET /papers?q=&tag=&status=&favorite=false&archived=false` |
| 创建 / 修改 / 详情 / 删除论文 | `POST /papers`、`PATCH /papers/{id}`、`GET /papers/{id}`、`DELETE /papers/{id}` |
| 论文的版本 | `GET/POST /papers/{id}/versions` |
| 上传 / 列出文件 | `POST/GET /papers/{id}/files`（multipart） |
| 文件元数据 / 内容 / 下载 | `GET /files/{id}`、`/files/{id}/content`、`/files/{id}/content?download=true` |
| 从 arXiv 导入 | `POST /import/arxiv`；进度 `GET /import/arxiv/progress/{token}` |
| 给 Agent 的上下文 | `GET /papers/{id}/context` |
| 阅读进度与事件 | `GET/POST /papers/{id}/events` |
| 修改历史 | `GET /history/{论文或记录的 id}` |
| 首页数据、推荐与反馈 | `GET /dashboard`、`GET /recommendations`、`POST /recommendations/{paper_id}/feedback` |
| 导出整个工作区（ZIP） | `GET /export` |

### 笔记与记录

| 能力 | 接口 |
| --- | --- |
| 证据、分析、问题、专题、链接、笔记 | `POST /items`、`GET /items?kind=&paper_id=`、`GET/PUT/DELETE /items/{id}` |
| 笔记导出（Markdown 与引用到的图片） | `GET /items/{id}/export?revision=N` |
| 笔记里的图片 | `POST /items/{id}/images`、`GET /note-images/{id}` |
| 文库集合 | `GET/POST /library-collections`、`GET/PATCH/DELETE /library-collections/{id}` |

### 阅读

| 能力 | 接口 |
| --- | --- |
| 高亮与评论 | `GET /files/{id}/annotations`、`PUT/PATCH/DELETE /files/{id}/annotations/{annotation_id}` |
| 手写笔画 | `GET /files/{id}/ink`、`PUT/DELETE /files/{id}/ink/{stroke_id}` |
| 带批注的 PDF | `GET /files/{id}/annotated-pdf` |
| 原文与译文合并 | `GET /papers/{id}/merged-pdf?translation_job_id=&order=original-first\|translation-first` |
| 图表标题、图表识别 | `GET /files/{id}/figure-captions`、`GET/POST /files/{id}/structure` |
| 选段快译 | `POST /files/{id}/quick-translation` |
| 阅读产物：导读、测验、重点、目录、逐页翻译 | `GET/POST /papers/{id}/reading-artifacts`、`GET/DELETE /reading-artifacts/{id}` |
| 阅读记录（高亮、评论、解释与翻译） | `GET /papers/{id}/reading-activity`（`DELETE`、`/export` 也可用） |
| 参考文献与被引用 | `GET/POST /papers/{id}/citations`、`DELETE /papers/{id}/citations/{citation_id}` |
| 链接悬停卡片 | `GET /papers/{id}/link-preview?url=` |
| 整篇翻译（LaTeX 源码 / 版面） | `GET/POST /papers/{id}/translations`、`POST /translations/{id}/cancel` |
| 只读分享 | `GET/POST /papers/{id}/shares`、`DELETE /papers/{id}/shares/{share_id}`；公开：`GET /shared/{token}`、`/shared/{token}/pdf`、`/shared/{token}/images/{id}` |

### 助手

| 能力 | 接口 |
| --- | --- |
| 能力说明 | `GET /agent/capabilities` |
| 会话 | `GET/POST /agent/sessions`、`PATCH/DELETE /agent/sessions/{id}` |
| 发起与查看运行 | `GET/POST /agent/sessions/{id}/runs`、`POST /agent/runs/{id}/cancel` |
| 附件 | `POST /agent/attachments`、`GET /agent/attachments/{id}/content` |

### 账户、模型与存储

| 能力 | 接口 |
| --- | --- |
| 登录、注册、退出、当前用户 | `POST /auth/login`、`/auth/register`、`/auth/logout`、`GET /auth/me`、`GET /auth/options` |
| 找回账号 | `POST /auth/email/request`、`/auth/email/confirm`、`/auth/password-reset/request`、`/auth/password-reset/complete` |
| 令牌（仅本人会话） | `GET/POST /tokens`、`DELETE /tokens/{id}` |
| 邀请码（仅管理员） | `POST /invitations`（请求体 `{"username": "..."}`） |
| 研究方向与偏好 | `GET/POST /research-directions`、`GET/PUT /research-profile` |
| 发现论文 | `GET /discovery`、`POST /discovery/refresh`、`POST /discovery/{id}/feedback` |
| 模型设置 | `GET/PUT /translation-settings`，以及 `/translation-settings/configs/...`（添加、选择、测试、思考强度）和 `/translation-settings/models` |
| 模型用量与预算 | `GET /model-usage` |
| 存储用量与清理 | `GET /storage-usage`、`GET /storage-files`、`DELETE /storage-files/{kind}/{id}` |
| 健康检查 | `GET /health` |

## curl 示例

把地址和令牌放在你自己的 shell 环境里，不要把真实令牌写进共享的脚本或报告。

```bash
export PAPER_BASE=http://127.0.0.1:8765/api/v1
read -rs -p 'Agent token: ' PAPER_TOKEN; echo
export PAPER_TOKEN

curl --fail-with-body "$PAPER_BASE/papers" -H "Authorization: Bearer $PAPER_TOKEN"

curl --fail-with-body "$PAPER_BASE/papers" \
  -H "Authorization: Bearer $PAPER_TOKEN" -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"title":"A paper","external_id":"arxiv:2601.06966","version_label":"v1","provenance":"locally supplied","tags":["memory"]}'

# 从上一步的响应里取出：
export PAPER_ID='<paper id>'
export VERSION_ID='<current_version>'
curl --fail-with-body "$PAPER_BASE/papers/$PAPER_ID/files" \
  -H "Authorization: Bearer $PAPER_TOKEN" -H "Idempotency-Key: $(uuidgen)" \
  -F "version_id=$VERSION_ID" -F 'source_path=sec/method.tex' -F 'file=@/path/to/method.tex'

curl --fail-with-body "$PAPER_BASE/papers/$PAPER_ID/context" \
  -H "Authorization: Bearer $PAPER_TOKEN" -o paper-context.json
```

上面的元数据只是输入示例，不会自动去 arXiv 查询；要从 arXiv 导入，用 `POST /import/arxiv`（或者在网页里粘贴链接）。源码和对应的 PDF 要用同一个版本 id 上传。要创建新版本，`POST /papers/{id}/versions` 带 `{"label":"v2","provenance":"…"}` 和论文当前的 `If-Match`，再把对应的文件传到返回的版本 id 上。

可运行的 Python 示例见 [`examples/agent_client.py`](../examples/agent_client.py)：它上传一个 UTF-8 源码附件，把真实的第一行记为证据，提交一条未确认的阅读建议，再导出可移植的上下文。它**不会**编造分析，也不会把用户标成已读。

## 记录、证据与定位

`POST /items` 的 `kind` 有六种：`note`（笔记）、`evidence`（证据）、`analysis`（分析）、`question`（问题）、`topic`（专题）、`link`（对比）。

- **证据**必须带定位 `locator`：PDF 用 `{version_id, file_id, page}`，文本或 LaTeX 用 `{version_id, file_id, line_start, line_end}`，图或图片用 `{version_id, file_id, label}`；可选的 `quote` 保存引用的原文。行号和页码都从 1 开始，指向不可变的已上传字节（PDF 是物理页）。
- **分析**带 `evidence_ids`，说明它外部产生，平台不声称自己做过这项分析；**专题**用 `paper_ids`、`evidence_ids`、`tags`、`title` 和 Markdown 的 `body`；**对比**是 `kind=link`，至少两篇不同的、属于你的论文；**问题**用 `paper_id` 和 `status=open|resolved`。
- 修改记录：先 GET，保留可写字段，再用完整的 `ItemInput` 做 PUT，带 `If-Match`。不要发送 ID、归属、版本号、时间戳这类只读字段，严格校验会拒绝。`kind` 与主要的论文关联不能改。历史保留到你显式删除。
- 引用别处的证据时，被引用的证据在引用移除之前不能单独删除。

```json
{
  "kind": "analysis",
  "paper_id": "<paper-id>",
  "title": "Externally produced analysis",
  "body": "分析正文：区分论点与不确定性。",
  "evidence_ids": ["<evidence-item-id>"]
}
```

### 阅读状态与事件

令牌可以把 `agent_status` PATCH 成 `pending|processing|ready|failed`，只能 POST `kind=suggestion` 的事件，且不带 `reading_status`。用户本人更新阅读进度用 `kind=reading|correction`、`reading_status=unread|reading|read`，范围写在 `body` 里，可带稳定的定位和 `If-Match`。事件没有修改或删除接口，更正是新的事件。

## 阅读相关接口的要点

以下接口都要求当前所有者；Cookie 的写请求保留 CSRF 保护。

- **批注**（`/files/{id}/annotations`）：按行归一化的矩形、原文引文、颜色和评论。创建用 UUID；修改与删除需要当前批注的 `revision`；位置不可变、与文件版本绑定；已删除的 ID 不会因为延迟重试而复活。
- **带批注的 PDF**（`/annotated-pdf`）：包含高亮、评论和手写笔画（含旋转或裁切过的页面），不改动原文件。
- **合并 PDF**（`/merged-pdf`）：先完整的原文再完整的译文（或反过来），不交错页面；两个文件都必须属于你、这篇论文以及这个已完成的翻译任务的同一版本。每个输入最大 50 MB，合并后最大 100 MB、3000 页；解析在隔离进程里，30 秒 CPU / 45 秒墙钟，每个进程同时最多两个导出。不含工作区批注。失败时：404 找不到、409 翻译未完成、413 太大、422 PDF 不兼容、429 导出繁忙。
- **阅读产物**：用 `file_id`、`model_config_id`、`kind` 和可选的 `regenerate` 显式生成并缓存。`guide` 得到关键词、三句摘要和四个带证据的部分；`quiz` 可选 5/10/15 题与难易；`page_translation` 带页码与 zh/en；`highlights` 给出最多 30 条经过核验的原文引文（创新/方法/结果）；`outline` 返回有序的标题/页码/层级，要求读过全部页、每个标题都出现在它声称的页。它们不会创建笔记或可见的聊天会话；失败就是失败。这些检查保证引文出自原文，不保证事实或译文质量。
- **引用文献**（`/citations?relation=saved|references|citations&offset=N`）：保存的引用卡片，加上显式的 Semantic Scholar 查询。只有校验过的公开 arXiv/DOI 标识会离开服务器；未知标识和上游失败会区分开；每次最多 50 条，有限度地缓存公开响应。
- **分享**：为选定的 PDF 创建只读链接，可选附带笔记和图片的快照，有效期 1/7/30 天。不可预测的令牌只在创建时返回一次，服务器只保存它的哈希；撤销、过期、不属于你的分享都不可用。仍有效的分享会保护它引用的笔记图片不被清理；删除论文会让它的公开资源失效。公开路由上不挂载私有工作区；PDF 不暴露文档动作，Markdown 不允许原始 HTML，响应是 `private, no-store`、`no-referrer`，有字节与请求频率的限制（进程内，假设只有一个 web 进程）。
- **笔记导出**（`/items/{id}/export?revision=N`）：Markdown 和引用到的图片组成的 ZIP，图片路径改写成相对路径；`revision` 过期时失败，而不是悄悄导出旧稿。
- **阅读记录**（`/reading-activity`）：每批 50 条、新的在前，包含高亮、评论和带阅读上下文的助手运行。`kind=all|highlight|comment|explanation|translation` 过滤；阅读上下文里 `action: translate` 的运行算「翻译」，其余算「解释」。包含进行中、失败、已取消的状态，不含模型凭据和内部运行时，不含阅读产物。
- **链接卡片**（`/link-preview?url=`）：只访问公开网页；固定公网 IP，逐跳校验重定向，拦截私有地址，响应、缓存和并发都有上限。标题与描述是来源提供的元数据，不保证是完整摘要。
- **助手运行**可以带 `reader_context`（论文/文件/版本、来源、页码、引文与前后文或归一化的区域）；执行前和续跑时都会校验所有权与页码范围。引用的原文是不可信的用户内容，不当作系统指令。

## 模型、用量与预算

- `GET /model-usage` 返回当前 UTC 日里你的请求数、`total_tokens`、`unknown_requests` 与各来源的汇总，覆盖内置助手的回答和翻译尝试（含重试）；连接与视觉探测、外部令牌客户端自己的模型调用不计入。未知或中断的响应记为请求，不编造用量。这是上游报告的计量，不是账单估算。流水里只有任务/模型标识和计数，不含提示词或凭据，任务或会话删除后仍保留。
- 每次请求先在所有者锁下检查：今天已知的用量加上未结算的预留，不超过 `SHARED_MODEL_DAILY_TOKENS` / `PRIVATE_MODEL_DAILY_TOKENS` 才放行（默认 0 表示不限）；完成后用上游报告的用量替换这次的预留，缺失或中断时预留保留。`MODEL_REQUEST_RESERVE_TOKENS`（默认 131072，必须为正）是一个保守的预留额度，**不是输入 token 的上限，也不是费用上限**；上游报告的更多用量也会如实计入。预算不足在联网之前就拒绝，已完成的任务操作保留；探测接口超限返回 429；删除或更换会话不会释放已计入的额度。`/model-usage` 的 `budgets` 给出 `limit_tokens`、`charged_tokens`、`remaining_tokens`、`request_reserve_tokens` 和 `over_reservation_requests`。这是每日的请求准入，不会取消已经发出的上游请求，也不是跨账户的总费用上限。
- 输出上限：助手的每次回答最多 8192 个输出 token，关闭了提供商库的自动重试（`maxRetries=0`）；翻译请求对识别出的 MiniMax-M3 系列是 32768，其他模型是 8192，使用对应协议的字段。结构校验失败后的重试是独立计量的请求。

## 存储用量与清理

- `GET /storage-usage`：当前账户持久文件的总量与分类。
- `GET /storage-files?offset=0&limit=30`：附件清单，返回 `items`、`total`、`has_more`；每项有 `kind`、`id`、`size`、`reference`、`can_delete`，每页最多 100。引用状态包括已保存的内容、历史和助手会话。当前实现是扫描你名下的记录，不是为大型文库设计的索引查询。
- `DELETE /storage-files/{kind}/{id}`：只允许本人会话（或内置助手的身份），需要 `X-Confirm-Delete: <id>`，在所有者锁下重新检查引用；论文附件不能在这里删除；有其他助手或翻译任务在运行时返回 409；没被引用的笔记图片和聊天附件可以删，成功返回 `freed_bytes`。
- 新的本地附件引用会在幂等写入之前校验：保存一个缺失或已删除的附件链接返回 422；清理与新引用的写入在 PostgreSQL 里串行。清理是显式的，不是自动垃圾回收；仍出现在笔记历史里的文件会保留。

## 备份格式的版本

服务器备份的 `schema_version` 现在是 15，可以恢复早期的版本；它和论文版本、记录的 revision 是不同的概念。表结构变化时必须提供兼容的转换，见 [运维](OPERATIONS.md#迁移)。

## 翻译的中间文件

`python -m backend.translation_cache` 报告缓存的数量、字节数和可清理性，不会把文档内容读进报告；站点运行时也可以执行，是非事务性的文件系统快照。`--clean` 需要先停掉翻译 worker（它会取得同一把排他锁）；worker 自己在启动时、以及作业之间每小时做一次维护。设置、保留规则与限制见 [翻译](TRANSLATION.md#运维要点) 和 [配置](CONFIGURATION.md#翻译)。
