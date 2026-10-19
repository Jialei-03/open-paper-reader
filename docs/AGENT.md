# 研究助手

研究助手是 Open Paper Reader 里一个会读论文、也会动手的助手。它读你指的那一页、那个区域或整篇论文，再回答；需要时帮你整理笔记、给论文打标签、导入 arXiv 论文、发起翻译。它需要一个模型，见 [配置](CONFIGURATION.md#模型)。

阅读器里的论文导读、阅读测验、重点建议和逐页翻译走同一套任务队列和 worker，但它们是固定任务，不是对话（见 [性能](PERFORMANCE.md)）。

## 在界面里的样子

- 登录后任意页面右下角的助手按钮，或 `⌘/Ctrl J`，打开一个不阻塞页面的浮窗：可拖动、可缩放，位置和大小按账户记住，后面的页面仍然可以操作。收起浮窗不会取消任务。
- 会话保存在服务器上，按账户隔离。可以新建、切换、重命名、删除；一个回答下可以展开「N 项操作」，看到助手读了哪些文件、做了哪些修改。
- 运行中可以继续发消息、添加附件、选择下一轮的权限；有多个任务时可以一次停止全部。
- 「允许修改文库」关闭时，本轮不提供任何写入文库的工具；打开时，写入也要带上它刚读取的版本号，服务端再校验一遍。
- 附件：PDF、PNG/JPEG/WebP/GIF、UTF-8 的 TXT/Markdown/TeX/CSV/TSV/JSON/BibTeX；每条消息最多 5 个、每个最多 20 MB，可以拖入输入框或粘贴截图。

## 它能做什么

| 类别 | 工具 | 说明 |
| --- | --- | --- |
| 查找与读取 | `list_papers`、`read_paper`、`read_file` | `read_file` 读 PDF 指定页（一次最多 5 页，每页最多 18000 字）或文本附件，多页时按额度分配文字，被截断的页会标出，不记作整页读完 |
| 在论文里定位 | `search_file`、`read_region`、`list_figures` | `search_file` 是全文文字短语搜索，不是语义搜索，会说明没有文字层的扫描页；`read_region` 读框选区域的文字；`list_figures` 从图表标题文字找位置，最多扫 200 页、返回 100 条，可能遗漏 |
| 看图 | `list_images`、`view_image` | 展示 PDF 页、图片和已下载源码里的图；模型开启「视觉输入」时才会真的把图片发给它，每轮最多 8 张、最长边 1800 像素 |
| 笔记 | `list_notes`、`read_note`、`write_note`、`append_note`、`replace_note_text`、`create_note` | 写之前必须先读；`replace_note_text` 只替换唯一的精确匹配；遇到版本冲突会重新读取再判断，不会把旧内容套到新版本上 |
| 论文与方向 | `import_arxiv`、`create_paper`、`update_paper`、`list_directions`、`edit_directions`、`read_profile` | 导入的是 arXiv 官方元数据和原版 PDF；同一篇不同链接会命中已有论文 |
| 翻译 | `start_translation`、`translation_status`、`cancel_translation` | 「提交成功」不等于「翻译完成」，助手会去查状态 |
| 通用接口 | `workspace_api`、`workspace_read`、`workspace_write` | 查询真实的接口结构，再按用户的要求读写；身份和归属由服务端决定，更新要带当前版本 |
| 公开网页与文件 | `web_read`、`search_papers`、`download_file` | `search_papers` 查的是 Crossref 的学术元数据，不是全网搜索 |
| 隔离环境 | `read`、`write`、`edit`、`bash`、`grep`、`find`、`ls`、`materialize_file`、`export_file` | 在一次性的沙箱容器里运行脚本，见下 |

写操作返回服务端回读的凭证：`confirmed` 才表示目标状态已核对；`changed`、`unavailable` 会如实说明，不会为了拿到凭证而重复写入。

## 运行方式

- 助手运行在独立的 Node.js 进程里（[Pi](https://github.com/earendil-works/pi) 0.85.1，版本由 `agent-runtime/package-lock.json` 固定）。它不监听任何端口：业务工具、网络工具和沙箱工具都通过标准输入输出回到 Python 执行层，由 Python 层完成身份和权限检查。
- 一次运行最多 32 次模型调用、64 次工具调用、10 分钟；每次模型调用最多输出 8192 token（长输出的 MiniMax 系列模型为 32768）；历史保留最近 8 轮。这些数字都在 [`backend/agent_limits.py`](../backend/agent_limits.py)，界面里「能力范围」显示的说明也由它生成，所以改一处即可。
- 并发与额度由环境变量控制（见 [配置](CONFIGURATION.md#研究助手与并发)）：默认应用不设上限，只有全站排队上限（1000）；你可以按服务器容量与模型服务的限流调整。
- 助手导入 arXiv 每个账户每天最多 10 次，账户附件达到 1 GB 或服务器剩余空间不足 1 GB 时拒绝导入。人工上传不受这个通道额度的限制。
- 任务超时或取消会终止整个进程组，已提交的操作保留；服务重启会把中断的任务标为失败，**不会自动重放写操作**。用户可以点「继续」，助手先读检查点，已提交的操作不会重做。

## 模型

- 每个账户可以添加自己的 OpenAI 兼容或 Anthropic 协议模型，也可以使用部署者提供的共享模型。密钥只保存在服务器的私有目录里，不进入前端响应、提示词或工具日志。
- 模型请求只发往所选服务的同源 HTTPS 地址，不跟随重定向，DNS 结果必须是公网地址，并在真正连接时再检查一次；密钥通过管道交给模型客户端，不经过命令行参数或继承的环境变量。
- 「视觉输入」默认关闭，不从模型名推断。设置里的「验证并开启视觉」会发送一张随机数字的图片，确认模型真的读出来才开启；普通的「测试连接」只测文字。
- 共享模型的并发、每日用量和预算见 [配置](CONFIGURATION.md#模型)；多个进程共用同一把文件锁，所以共享模型适合单机部署，多机部署需要改成分布式限流。

## 隔离环境

Python、Shell 和文件工具不在宿主机上执行，而是在每轮一个的 Docker 容器里：无网络、无宿主机挂载、只读根目录、非 root、无 capabilities，256 MB 内存、0.5 CPU、64 个进程，`/work` 128 MB 与 `/tmp` 32 MB 的临时盘；单条命令 60 秒，一轮容器最长 20 分钟，结束后销毁。应用只连接一个参数固定的 Unix socket broker（`deploy/sandbox_broker.py`），不加入 Docker 组，broker 会清理超时或遗留的容器。

容器里没有外网；公开网页和文件由网络工具下载后，再用 `materialize_file` 放进 `/work`，结果用 `export_file` 保存回账户的附件。网络工具只允许 80/443，连接前校验全部 DNS 结果并固定到公网 IP，逐跳检查重定向，不发送平台凭据，单个文件最多 20 MB。付费墙、登录页和反爬失败会如实返回。

没有部署 broker 时，这些工具明确报告不可用，**不会退回到在宿主机上执行**。部署方式见 [部署](DEPLOYMENT.md#助手的代码沙箱)。容器隔离不能抵御所有内核漏洞，请不要在运行不信任用户的实例上放松这一层。

## 附件与文件

聊天附件保存在私有的 `agent_attachments` 和现有的文件存储里，不会自动变成论文或笔记，计入账户的存储额度；删除消息或移除草稿不立即删文件，以保留笔记里已有的引用。扫描页、图片只是展示给视觉模型，不是独立的 OCR，数值和小字仍需核对。图片缓存（`visual-cache`）是可以重新生成的，上限约 128 MiB。

## 开发

- 运行时在 [`agent-runtime/`](../agent-runtime)（`runner.mjs`、`sandbox-tools.mjs`、`model-lease.mjs`、`network.mjs`），测试用 `npm --prefix agent-runtime test`，会用真实的 Pi 对接本地模拟的 OpenAI/Anthropic SSE 服务。
- 助手的行为说明写在 [`agent-runtime/skills/paper-workspace/SKILL.md`](../agent-runtime/skills/paper-workspace/SKILL.md)，系统提示只保留身份、安全和技能入口。
- Python 一侧：[`agent_tools.py`](../backend/agent_tools.py)（工具定义与执行）、[`agent_worker.py`](../backend/agent_worker.py)、[`agent_sandbox.py`](../backend/agent_sandbox.py)、[`agent_receipts.py`](../backend/agent_receipts.py)（回读凭证）、[`agent_checkpoint.py`](../backend/agent_checkpoint.py)（续接）。
- 外部程序也可以用 API 凭据读写你的工作区，见 [API](API.md) 与 [`examples/agent_client.py`](../examples/agent_client.py)。
