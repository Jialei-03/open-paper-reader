# 配置

Open Paper Reader 全部通过环境变量配置。`docker compose --env-file .env -f deploy/docker-compose.yml` 读取项目根目录的 `.env`；`scripts/run.sh`（`make run`）会 `source .env`；原生安装用 systemd 的 `EnvironmentFile`。可以从 [`.env.example`](../deploy/.env.example) 开始。

`.env` 已在 `.gitignore` 里。里面会有数据库密码、邮件密码等，不要提交，也不要贴进 issue。

## 基本

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `APP_ENV` | `development` | `production` 要求 HTTPS 的 `APP_ORIGIN` 和 PostgreSQL，Cookie 带 `Secure`，并加上 HSTS；不满足时启动即失败。`development` 允许 http 与 SQLite，只用于本机试用 |
| `APP_ORIGIN` | `http://127.0.0.1:8765` | 用户在浏览器里访问的完整地址（含协议，不带末尾斜杠）。Cookie、CSRF 的来源检查、邮件里的链接都依赖它。换了域名要同步修改 |
| `DATABASE_URL` | `sqlite:///./data/platform.db` | SQLite 用于本机；生产用 `postgresql+psycopg://用户:密码@主机:5432/库`。密码里的特殊字符要做 URL 编码 |
| `STORAGE_DIR` | `./data/files` | 论文文件、笔记图片、聊天附件、手写批注的存放目录。必须在前端静态目录之外，不能是符号链接，只给服务账号写权限 |
| `REGISTRATION` | `open` | `open`：任何人可以注册。`invite`：注册需要邀请码。管理员在「设置 → 邀请新用户」里为某个用户名生成，邀请码只对这个用户名有效、只能用一次、48 小时过期 |
| `APP_PORT` | `8765` | `scripts/run.sh` 与容器内进程监听的端口 |
| `UPLOAD_LIMIT_MB` | `50` | 单个上传文件的上限（MB） |

## 存储

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `USER_STORAGE_LIMIT_MB` | `1024` | 每个账户可保存的文件总量，论文、笔记图片、聊天附件共用 |
| `STORAGE_MIN_FREE_MB` | `1024` | 磁盘剩余空间低于此值时拒绝新的持久文件 |

## 邮件（可选，用于找回用户名和密码）

不配置时，设置页会明确提示，发信接口返回 503；不会假装已发送，也不会把验证码或重置链接写进日志。需要 STARTTLS。

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `SMTP_HOST` | 空 | 邮件服务器 |
| `SMTP_PORT` | `587` | 端口 |
| `SMTP_FROM` | 空 | 发件人地址 |
| `SMTP_USERNAME`、`SMTP_PASSWORD` | 空 | 服务器要求认证时填写 |

## 模型

每个账户在「设置 → 模型」里添加自己的服务（OpenAI 兼容或 Anthropic 协议），密钥保存在服务器私有目录（见下），不回传前端，也不会发给别的服务。部署者还可以提供一个所有账户共享的模型。

**地址限制。** 服务端只向满足以下全部条件的地址发模型请求：HTTPS、443 端口、主机名在名单里、解析出的地址是公网地址，并且不跟随重定向。内置名单：`api.openai.com`、`api.anthropic.com`、`api.deepseek.com`、`openrouter.ai`、`generativelanguage.googleapis.com`、`api.siliconflow.cn`、`api.minimax.cn`、`api.minimaxi.com`、`api.minimax.io`。这是为了防止把服务器变成内网探测工具。因此**暂不支持 http 地址或内网地址**（例如本机的 Ollama）；自建网关请放在 HTTPS 域名后面，再把主机名加进 `TRANSLATION_ALLOWED_HOSTS`。

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `TRANSLATION_ALLOWED_HOSTS` | 空 | 额外允许的模型服务主机名，逗号分隔，例如 `llm.example.com,gateway.example.org` |
| `TRANSLATION_CONFIG_DIR` | `STORAGE_DIR` 的上级目录下的 `translation-credentials` | 每个账户的模型配置（含密钥）；目录权限 0700、文件 0600。这是私有文件，不是 KMS 加密存储，请像保护数据库一样保护它并纳入备份 |
| `PLATFORM_MODEL_CONFIG` | `STORAGE_DIR` 的上级目录下的 `platform-model.json` | 共享模型的 JSON 文件，格式见下。文件不存在或 `enabled` 为 `false` 时不提供共享模型 |
| `PLATFORM_MODEL_CONCURRENCY` | 文件里的 `concurrency_limit`，否则 `0` | 共享模型同时运行的请求数；`0` 不限。多个进程共用同一把文件锁 |
| `SHARED_MODEL_DAILY_TOKENS` | `0` | 每个账户每个 UTC 日使用共享模型的预算；`0` 不限 |
| `PRIVATE_MODEL_DAILY_TOKENS` | `0` | 同上，用于账户自己的模型 |
| `MODEL_REQUEST_RESERVE_TOKENS` | `131072` | 每次请求先预留的额度。保守估计，不是实际用量，也不是计费依据；中断的请求保留到当天结束 |

### 共享模型文件

```json
{
  "enabled": true,
  "name": "共享模型",
  "badge": "共享模型",
  "base_url": "https://api.openai.com/v1",
  "protocol": "openai",
  "model": "gpt-4.1-mini",
  "api_key": "sk-...",
  "vision": false,
  "concurrency_limit": 3,
  "models": [
    { "id": "platform-large", "name": "大模型", "model": "gpt-4.1", "vision": true, "context_length": 1000000 }
  ]
}
```

- `protocol` 是 `openai` 或 `anthropic`；`vision` 表示模型能识图，不会从模型名推断。
- 文件顶层描述的是主模型，它的 `id` 固定为 `platform-minimax`（沿用最初的名字，与厂商无关）。`models` 里的每一项是额外的模型，共用同一个密钥和并发池，`id` 必须以 `platform-` 开头、不超过 36 个字符。
- `badge` 是界面里显示在模型旁边的小标签，默认「共享模型」。
- 文件权限设为 0600，不要提交到版本库，也不要放进可下载的目录。备份不包含它，需要单独保管。

## 研究助手与并发

助手 worker 是单独的进程（`python -m backend.agent_worker`，Docker Compose 里的 `worker` 服务）。没有它，阅读导读、测验、逐页翻译和助手对话都会一直排队。

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `AGENT_NODE` | `node` | worker 用来运行研究助手的 Node.js（>= 22）。找不到时给绝对路径；Docker 镜像里已设置 |
| `AGENT_ACTIVE_LIMIT` | `0` | 每个账户同时排队或运行的助手任务数；`0` 不限 |
| `AGENT_DAILY_RUNS` | `0` | 每个账户每天的任务数；`0` 不限 |
| `AGENT_QUEUE_LIMIT` | `1000` | 全站排队任务上限，防止失控循环 |
| `AGENT_TRANSLATION_ACTIVE` | `0` | 每个账户同时进行的逐页翻译任务数；`0` 不限 |
| `AGENT_WORKER_CONCURRENCY` | `0` | worker 同时执行的助手任务数；`0` 不限 |
| `AGENT_TRANSLATION_WORKERS` | `0` | worker 同时执行的逐页翻译数；`0` 不限 |
| `AGENT_SANDBOX_SOCKET` | `/run/paper-sandbox/broker.sock` | 助手运行 Python、Shell 与文件工具的沙箱 broker 的 Unix 套接字。没有 broker 时这些工具会明确报告不可用，不会退回宿主机执行 |

上限为 `0` 表示应用不设上限，上游服务自己的限流仍然有效。一次助手运行最多 32 次模型调用、64 次工具调用、10 分钟；这些数字在 `backend/agent_limits.py`，不是环境变量。

## 翻译

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `ARXIV_PROXY` | 空 | 只用于下载 arXiv 的 HTTP 代理，例如 `http://127.0.0.1:7890` |
| `TRANSLATION_CACHE_DAYS` | `7` | 已完成翻译的中间文件在验证产物后多久过期；`0` 关闭。失败、取消和进行中的任务检查点不会按此清理 |
| `TRANSLATION_ORPHAN_DAYS` | `30` | 失去所属任务的中间文件保留天数；`0` 关闭 |
| `TRANSLATION_BATCH_WORKERS` | 不再使用 | 翻译批次按实际待处理任务并发执行，无固定线程上限 |
| `TRANSLATION_TEX_IMAGE` | `paper-tex:2026-09` | 编译翻译后 LaTeX 的 Docker 镜像名（见 [部署](DEPLOYMENT.md#可选组件)） |
| `PDF_LAYOUT_IMAGE` | 空 | 普通 PDF 版面翻译的 Docker 镜像名；不设置时该功能未启用 |
| `PDF_STRUCTURE_PYTHON` | 空 | 一个装有 `docling_core` 的 Python 的路径，用于「图表」面板里的图表与公式识别；不设置时该接口返回 503，其余功能不受影响 |

## 备份

| 变量 | 说明 |
| --- | --- |
| `PAPER_BACKUP_KEEP` | 本机保留最新的几份备份，默认 `1`。新备份完整写好后才删除旧的 |
| `PAPER_BACKUP_RECIPIENT_FILE` | 备份脚本可选读取的 [age](https://github.com/FiloSottile/age) 公钥文件，设置后额外生成加密的恢复包；私钥放在另一台可信设备上 |

## Docker Compose 专用

`deploy/docker-compose.yml` 会把 `.env` 里的**所有**变量传给 `web` 和 `worker` 容器，所以上面的设置在 Docker 里和不用 Docker 时写法一样（改完 `docker compose --env-file .env -f deploy/docker-compose.yml up -d` 生效）。只有这几项由 compose 固定，写在 `.env` 里也不起作用：`DATABASE_URL`（指向 compose 里的 PostgreSQL，密码取自 `POSTGRES_PASSWORD`）、`STORAGE_DIR`（`/data/files`）、容器内的监听端口（`APP_PORT` 在这里只决定发布到宿主机的端口）。共享模型文件放在数据卷里的 `/data/platform-model.json`，见 [部署](DEPLOYMENT.md#共享模型可选)。

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `POSTGRES_PASSWORD` | 必填 | PostgreSQL 密码。会被拼进 `DATABASE_URL`，请只用字母和数字（例如 `openssl rand -hex 24`） |
| `BIND_ADDRESS` | `127.0.0.1` | 发布端口的地址。放到公网前先配置 TLS 反向代理，不要直接用 `0.0.0.0` |
| `APP_PORT` | `8765` | 发布到宿主机的端口 |

## 开发与测试

| 变量 | 说明 |
| --- | --- |
| `TEST_POSTGRES_URL` | PostgreSQL 恢复测试用的独立数据库；不设置时这些测试被跳过（跳过不等于通过） |
| `REALMEM_FIXTURE_DIR` | 一个目录，含 `manifest.json` 和一篇真实论文的原始文件，用于可选的集成测试；不设置时相关用例被跳过 |
| `E2E_TEST_PASSWORD` | 浏览器测试的账户密码；`npx playwright test` 会自动生成 |
| `BENCH_DIR`、`BENCH_PASSWORD`、`PLATFORM_MODEL_CONFIG` | 真实模型基准脚本 `scripts/bench_model.py` 用，见 [性能](PERFORMANCE.md) |

自动导读、共用逐句译文与布局生成见 [自动准备论文](PREPARATION.md)。
