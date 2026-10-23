# 运维

安装与启动见 [部署](DEPLOYMENT.md)，所有环境变量见 [配置](CONFIGURATION.md)。这里是运行之后要知道的事：数据库、迁移、备份与恢复、安全边界。加密恢复包与异机恢复见 [运维恢复](OPERATIONS-RECOVERY.md)。

## SQLite 与 PostgreSQL

- **SQLite** 是本机试用的默认：单个数据库文件、WAL 模式、开启外键、10 秒的忙等待。适合一个人或很小的私有实例、单个 web 进程。
- **PostgreSQL** 用同一套 SQLAlchemy 模型、同一份 Alembic 迁移，驱动是 psycopg。多人使用、需要并发事务和服务端备份时用它。

两者的对象归属检查和乐观版本号（revision）要求完全一样。`APP_ENV=production` 要求 `https://` 的 `APP_ORIGIN` 和 `postgresql+psycopg://…`，不满足时启动即失败。这些检查不会替你配置 TLS，也不会验证反向代理：代理必须终止有效的 TLS，并且只转发到应用的端口。论文和笔记图片放在前端目录之外，反向代理不要直接用静态别名暴露存储目录。

## 迁移

应用启动前执行 `alembic -c pyproject.toml upgrade head`（Docker 镜像与 systemd 单元已经自动做了）；应用本身不会悄悄建表。迁移文件是写死的显式建表语句，不是动态导入当前模型。

- 之后要改表结构：新增一个经过审阅的 Alembic 版本，先在恢复出来的副本上演练，做一份验证过的备份，停掉写入者，再迁移。不要修改已经应用过的迁移。
- `alembic -c pyproject.toml current` 查看当前版本，`alembic -c pyproject.toml check` 对比模型和数据库。
- 迁移是单向的：回滚应用需要恢复升级前的备份。`alembic -c pyproject.toml downgrade base` 会删除所有表，只用于一次性的测试库。
- 备份格式的 `schema_version` 和论文的版本、内容的 revision 是三件不同的事。表结构变化时必须同时提供兼容的备份转换。

## 备份与恢复

有两种不同的可移植格式：

1. **用户导出**（登录后 `/api/v1/export`，设置里的「导出工作区」）：`workspace.json`、`files/<uuid>` 下所有不可变文件、`notes/<uuid>.md` 下的笔记正文。不含用户、密码哈希、会话、邀请码和令牌。具有读权限的 Agent 凭据也能导出同样的数据。它用于迁移和外部处理，**不是**服务器的恢复格式。
2. **服务器备份**（离线命令行）：`backup.json` 和文件，含所有用户（Argon2 密码哈希）以及他们的记录和历史；不含会话、邀请码、令牌和幂等缓存。它是敏感文件：创建时独占写入、权限 0600，不会覆盖已存在的文件。

备份前必须**停掉所有写入者**（包括 web 进程）。`--offline` 表示你确认了这一点，命令行不会替你停服务；不可变文件和数据库引用必须对应同一个时间点。备份放到加密的存储上，另外在别的机器上保留一份，并定期演练恢复。

```bash
# 在仓库根目录；先加载你要用的环境
set -a; source .env; set +a
# 先停掉 paper-platform（和 worker）
.venv/bin/python -m backend.cli backup /secure/location/paper-backup.zip --offline

# 恢复到一个全新、已迁移、空的数据库和空的存储目录
export APP_ENV=development            # 这个演练用 SQLite；真实恢复请保持 production + PostgreSQL
export DATABASE_URL=sqlite:////absolute/path/to/restored.db
export STORAGE_DIR=/absolute/path/to/restored-files
.venv/bin/alembic -c pyproject.toml upgrade head
.venv/bin/python -m backend.cli restore /secure/location/paper-backup.zip --offline
# 启动前把 APP_ORIGIN 等设置指向目标环境
```

恢复会拒绝：任何非空的应用表、已存在的目标文件、重复或意料之外的压缩包成员、路径穿越、符号链接成员、校验和不符、不支持的 schema。压缩包不会被解压，条目被直接读取；限制未压缩总量 10 GiB、100000 个条目、每个成员有大小上限，成员集合必须和预期完全一致。恢复失败会回滚数据库写入，并只删除这次新写入的文件。新库里 Alembic 的版本表应该已经有内容（它不在备份里）。

恢复后用户可以用原来的密码登录；旧的会话、令牌和邀请码不能再用，需要重新创建 Agent 凭据，恢复时处于进行中的助手任务会被标为失败，不会被重放。删除一篇论文会让它的文件 id 失效、清除它的有效记录和历史；更早的离线备份自然还保留着旧数据。

**不在备份里的东西**：模型密钥（每个账户的 `TRANSLATION_CONFIG_DIR` 和共享模型文件）、翻译检查点、`.env`、反向代理配置。需要它们时用 [加密恢复包](OPERATIONS-RECOVERY.md)，或自己另行保管。

### 一致性与故障演练

```bash
.venv/bin/python scripts/verify_lifecycle.py
```

它在临时目录里建库、迁移、创建账户、启动一个本机服务、上传一篇 PDF、重启进程、用命令行备份、迁移新库、恢复、再次启动，并核对字节完全一致、阅读状态和令牌失效。结果写入 `test-results/lifecycle.json`。这是真正的子进程测试，不是对持久化的模拟断言。CI 里每次都会运行它。

## 安全边界

- **Cookie 与来源**：会话 Cookie 是 `HttpOnly`、`SameSite=Strict`，生产环境带 `Secure`；每个写请求校验 CSRF 令牌和 `Origin`。所以 `APP_ORIGIN` 必须和浏览器地址栏一致。
- **响应头**：`Content-Security-Policy`、`X-Frame-Options: DENY`、`X-Content-Type-Options: nosniff`，所有接口 `Cache-Control: no-store`，生产环境加 `Strict-Transport-Security`。**不要在反向代理或 CDN 上加共享缓存**，页面里是私人数据。
- **登录限流**在进程内，所以只运行一个 web 进程（`--workers 1`）。需要多进程时，先在边缘加共享限流。转发头只信任可信的本机反向代理（`FORWARDED_ALLOW_IPS`），不要写成通配。
- **文件**：论文文件在应用的存储目录里，只通过带身份检查的接口读取，不要把它挂进静态目录；日志里不要出现请求正文、令牌和密码（默认不记录访问日志）。
- **模型请求**：只允许 HTTPS、443、白名单主机名、公网地址，不跟随重定向，见 [配置](CONFIGURATION.md#模型)。
- **助手的代码执行**只在沙箱容器里，没有 broker 时明确不可用，见 [助手](AGENT.md#隔离环境)。
- **镜像**使用维护中的版本标签，不是固定摘要；在正式环境里验证后请固定你审阅过的镜像摘要。

## 上线之后

- 磁盘：`STORAGE_MIN_FREE_MB` 只是最后一道保险，请监控磁盘；数据库与文件卷一起备份。
- 健康检查：`GET /api/v1/health`。任务一直排队时先看 `worker` 进程。
- 升级之前做一次备份，升级之后确认 `alembic -c pyproject.toml current` 与新版本一致。
- 更多检查项见 [部署的检查清单](DEPLOYMENT.md#生产检查清单)；对公网实例，还建议在真实域名上走一遍：两个账户互相看不到对方的数据、上传与下载、注册（或邀请）、登录退出、导出、重启服务后数据还在，以及一次恢复演练。
