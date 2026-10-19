# 部署

Open Paper Reader 是一个 Python（FastAPI）服务加一个 Node.js 研究助手 worker，数据放在 PostgreSQL（本机试用也可以用 SQLite）和一个文件目录里。前端构建后由 API 服务一并提供，不需要单独的前端服务器。

| 进程 | 作用 | 必需 |
| --- | --- | --- |
| `web` | API 与已构建的前端；启动时自动执行数据库迁移 | 是 |
| `worker` | 研究助手 worker：阅读导读、测验、逐页翻译、助手对话。没有它这些任务会一直排队 | 要用助手就需要 |
| 数据库 | PostgreSQL（生产）或 SQLite（本机试用） | 是 |
| 翻译 worker、沙箱 broker | 整篇 LaTeX 翻译、普通 PDF 版面翻译、助手的代码沙箱；都要 Docker，见[可选组件](#可选组件) | 否 |

## 一、Docker Compose（推荐）

**前提**：Docker 和 Compose v2.24 或更新（`docker compose version` 查看；`docker-compose.yml` 用到了 `env_file` 的 `required` 选项）；约 2 GB 空闲内存；足够放论文的磁盘。

```bash
git clone https://github.com/Jialei-03/open-paper-reader.git
cd open-paper-reader
cp .env.example .env
# 把 POSTGRES_PASSWORD 换成一串随机的字母数字：
sed -i "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$(openssl rand -hex 24)/" .env    # macOS 用 sed -i ''
docker compose up -d --build
docker compose ps        # db、web、worker 都应该是 running，web 是 healthy
```

打开 <http://localhost:8765>，注册第一个账户，然后在「设置 → 模型」添加你的模型（OpenAI 兼容或 Anthropic 协议）。导入论文、阅读、批注和笔记不需要模型；解释、翻译、导读和助手需要。

数据在两个具名卷里：`open-paper-reader_db`（PostgreSQL）和 `open-paper-reader_data`（`/data`：论文文件、笔记图片、模型配置）。`docker compose down` 不会删除它们；`docker compose down -v` 会。

### 管理员账户（可选）

管理员只多一项能力：生成邀请码。要创建管理员，必须在**还没有任何人注册之前**运行：

```bash
docker compose exec web python -m backend.cli bootstrap --username admin
```

密码在隐藏输入里填（至少 8 个字符）。已经有用户之后这条命令会拒绝执行。

### 共享模型（可选）

想让所有账户都能直接用一个模型，把[共享模型文件](CONFIGURATION.md#共享模型文件)放进数据卷：

```bash
docker compose cp platform-model.json web:/data/platform-model.json
docker compose exec -u root web sh -c 'chown paper:paper /data/platform-model.json && chmod 600 /data/platform-model.json'
```

`web` 和 `worker` 共用这个卷，不需要重启。

### 放到公网上

不要把 8765 端口直接开放到公网。前面放一个终止 TLS 的反向代理，应用只接受来自它的连接。

1. 域名解析到这台机器。
2. 修改 `.env`：

   ```
   APP_ENV=production
   APP_ORIGIN=https://reader.example.com
   REGISTRATION=invite          # 不想让陌生人注册就保持 invite
   ```

   `APP_ENV=production` 要求 HTTPS 的 `APP_ORIGIN`，并启用 `Secure` Cookie 与 HSTS。
3. 启动反向代理。最省事的是 Caddy，它自己申请并续期证书：把 [`deploy/Caddyfile.example`](../deploy/Caddyfile.example) 的域名改成你的，`caddy run --config Caddyfile.example`。nginx 见 [`deploy/nginx.example.conf`](../deploy/nginx.example.conf)。缓存头由应用自己设置（私人数据一律不缓存，只有按内容命名的静态文件可以长期缓存），所以代理保持默认就好，**不要加共享缓存**：页面里有私人数据。
4. 反向代理在 Docker 宿主机上时，容器看到的来源是 Docker 网关，所以要让应用信任它转发的 `X-Forwarded-*` 头，否则登录限流会把所有用户算成同一个来源。端口只发布在 `127.0.0.1`（默认）时，在 `.env` 里加 `FORWARDED_ALLOW_IPS=*` 是安全的；否则写成 Docker 网关地址（`docker network inspect open-paper-reader_default`）。
5. `docker compose up -d`。

### 升级

```bash
git pull
docker compose up -d --build     # 新的迁移在 web 启动时自动执行
```

升级之前先备份（下面）。迁移是单向的：回滚需要恢复升级前的备份，不能 `alembic downgrade`。

### 备份与恢复

先停掉写入者，再备份数据库和文件，这样两者对应同一个时间点：

```bash
docker compose stop web preparation worker
# 如果另行安装了翻译 worker，也必须先停掉它。
docker compose exec db pg_dump -U paper paper > paper-$(date +%F).sql
docker run --rm -v open-paper-reader_data:/data -v "$PWD":/backup alpine tar czf /backup/paper-data-$(date +%F).tgz -C /data .
docker compose start worker preparation web
```

应用自己也有可移植的备份格式（含用户、密码哈希和全部记录，不含会话和令牌），见 [运维](OPERATIONS.md)。无论用哪种，都要放到另一台机器上保存，并且演练过恢复才算有备份。

### 排障

| 现象 | 看哪里 |
| --- | --- |
| 打不开 / 502 | `docker compose logs web`；`curl http://127.0.0.1:8765/api/v1/health` |
| 登录后马上掉线、注册提示来源不受信任 | `APP_ORIGIN` 必须和浏览器地址栏里的完全一致（协议、域名、端口） |
| 任务一直「排队中」 | `docker compose ps` 看 `worker` 在不在运行；没有可用的模型也不会开始 |
| 上传大文件失败 | 反向代理的请求体上限要不小于 `UPLOAD_LIMIT_MB`（Caddy 示例是 60 MB） |
| 「请使用支持的 HTTPS 模型地址」 | 模型服务必须是 HTTPS、443 端口、主机名在白名单里，见[配置](CONFIGURATION.md#模型) |

## 二、原生安装（systemd）

适合一台自己管理的 Linux 机器。下面的布局和 [`deploy/systemd/`](../deploy/systemd/) 里的单元一致，路径可以改，单元里也要跟着改。

```
/srv/paper-platform/app      仓库（含构建好的 frontend/dist）
/srv/paper-platform/venv     Python 虚拟环境
/etc/paper-platform/app.env  环境文件（权限 0600，属主 root）
/var/lib/paper-platform      STORAGE_DIR 和私有配置（属主 paper-platform）
```

```bash
# 系统账户与目录
useradd --system --home-dir /var/lib/paper-platform --shell /usr/sbin/nologin paper-platform
install -d -o paper-platform -g paper-platform -m 0750 /var/lib/paper-platform/files
install -d -m 0755 /srv/paper-platform /etc/paper-platform

# 代码与依赖（Python 3.13，Node.js 22）
git clone https://github.com/Jialei-03/open-paper-reader.git /srv/paper-platform/app
cd /srv/paper-platform/app
python3 -m venv /srv/paper-platform/venv
/srv/paper-platform/venv/bin/pip install -r backend/requirements.txt
npm --prefix frontend ci --ignore-scripts && npm --prefix frontend run build
npm --prefix agent-runtime ci --omit=dev --ignore-scripts
AGENT_NODE=$(command -v node) sh scripts/check-agent-runtime.sh      # 确认助手运行时能加载

# 配置（参考 .env.example；生产需要 PostgreSQL 与 HTTPS）
install -m 0600 -o root .env.example /etc/paper-platform/app.env
$EDITOR /etc/paper-platform/app.env
#   APP_ENV=production
#   APP_ORIGIN=https://reader.example.com
#   DATABASE_URL=postgresql+psycopg://paper:...@127.0.0.1:5432/paper
#   STORAGE_DIR=/var/lib/paper-platform/files

# 服务
cp deploy/systemd/paper-platform.service deploy/systemd/paper-agent-worker.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now paper-platform paper-agent-worker
curl -fsS http://127.0.0.1:8765/api/v1/health
```

`paper-platform.service` 在每次启动前执行 `alembic upgrade head`。反向代理见上面的 Caddy 或 nginx 示例。**只运行一个 web 进程**（`--workers 1`）：登录限流在进程内；需要多进程时，先在边缘加共享限流。

升级：`git pull`、重新安装依赖与构建前端、`systemctl restart paper-platform paper-agent-worker`。

### 定时备份

`deploy/backup_production.py` 是一个一致性离线备份：停掉网页、自动准备、助手和翻译工作进程，备份后恢复之前在运行的服务。即使备份被杀掉，`ExecStopPost` 也会根据持久恢复记录把服务拉起来；本来没有运行的可选进程不会被意外启动。升级备份脚本时也要更新 `/srv/paper-platform/ops/backup.py`，不能只更新应用目录里的副本。

```bash
install -d -m 0700 /srv/paper-platform/ops
install -m 0700 deploy/backup_production.py /srv/paper-platform/ops/backup.py
cp deploy/systemd/paper-platform-backup.service deploy/systemd/paper-platform-backup.timer /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now paper-platform-backup.timer
```

备份写到 `/var/backups/paper-platform/`（`paper-时间.zip`），在本机只保留最新的一份（`PAPER_BACKUP_KEEP` 可以改成保留更多份；新备份写好后才删旧的）；设置 `PAPER_BACKUP_RECIPIENT_FILE` 还会生成用 age 加密的恢复包。**本机备份抵御不了整机丢失**，请定期把它们复制到别处，并演练恢复，见 [运维恢复](OPERATIONS-RECOVERY.md)。

## 可选组件

### 发布内容校验

提交号不能识别部署后手动修改的源码。使用发布清单同时校验源码、运行时脚本与实际构建的前端，在测试结束、打包前生成：

```bash
python scripts/release_manifest.py --include-build --write release-manifest.json
```

把清单和同一份构建一起上传到新的发布目录，切换服务之前验证：

```bash
python scripts/release_manifest.py --verify release-manifest.json
```

输出的内容摘要标识这份候选版本，包括尚未提交的改动。新增、丢失或修改文件都会使校验失败。清单不包含环境密钥、用户数据和依赖安装目录。不要在正在提供服务的发布目录里直接修改应用源码；保留前一发布目录以便回滚。

这些功能都需要 Docker，并且彼此独立；不装也不影响其他功能。

### 助手的代码沙箱

让助手在一次性容器里运行 Python、Shell 与文件工具（容器无网络、只读根目录、非 root、有资源上限）。没有它时这些工具会明确报告不可用，**不会**退回到宿主机执行。

```bash
docker build -t paper-agent-sandbox:1 -f deploy/Dockerfile.agent-sandbox .
cp deploy/systemd/paper-sandbox-broker.service /etc/systemd/system/
systemctl enable --now paper-sandbox-broker     # 监听 /run/paper-sandbox/broker.sock
```

worker 需要能访问这个套接字（`AGENT_SANDBOX_SOCKET`）。broker 只接受固定参数的请求，不要把 Docker socket 直接交给 worker 或网页。Docker Compose 的默认配置没有包含它。

### 整篇论文翻译（arXiv 的 LaTeX 源码）

下载论文的 LaTeX 源码，翻译正文并保留公式与排版，在一次性 TeX 容器里重新编译成中文 PDF。

```bash
docker build -t paper-tex:2026-09 -f deploy/translation/Dockerfile deploy/translation
# 网络慢时可以换更近的软件源：--build-arg APT_MIRROR=mirrors.example.com
cp deploy/systemd/paper-translation-worker.service /etc/systemd/system/
systemctl enable --now paper-translation-worker
```

镜像名由 `TRANSLATION_TEX_IMAGE` 指定。翻译 worker 要管理 Docker，因此以 root 运行；容器无网络、只读根目录、非 root、有内存/CPU/进程/时间限制。只有提供 LaTeX 源码的 arXiv 论文才能用这条路径。

### 普通 PDF 的版面翻译

对没有源码的 PDF，用 [BabelDOC](https://github.com/funstory-ai/BabelDOC)（AGPL-3.0）识别版面、保护公式并重新排版。它在独立镜像里运行，镜像构建时下载版面模型和字体，任务运行时无网络。

```bash
docker build -t paper-layout -f deploy/translation/Dockerfile.layout .
# .env：PDF_LAYOUT_IMAGE=paper-layout
```

需要上面的翻译 worker。BabelDOC 及其依赖有各自的许可证，见 [NOTICE.md](../NOTICE.md)。

### 图表与公式识别

阅读器「图表」面板的「识别当前页」用 `docling_core` 解析模型给出的版面。它需要一个单独的 Python 环境，避免把 PyTorch 之类的大依赖装进 web 环境：

```bash
python3 -m venv /opt/open-paper-reader-parser
/opt/open-paper-reader-parser/bin/pip install "docling-slim==2.130.0" "docling-core==2.99.0"
# .env：PDF_STRUCTURE_PYTHON=/opt/open-paper-reader-parser/bin/python
```

没有它时这个接口返回 503「图表识别服务暂不可用」，其余功能不受影响。

## 生产检查清单

- [ ] `APP_ENV=production`、HTTPS 的 `APP_ORIGIN`、PostgreSQL；`POSTGRES_PASSWORD` 是随机长串
- [ ] 8765 端口没有对公网开放；前面有终止 TLS 的反向代理；代理上没有共享缓存
- [ ] 不想让陌生人注册：`REGISTRATION=invite`
- [ ] `.env`、`platform-model.json`、模型配置目录的权限是 0600/0700，没有进版本库
- [ ] 只有一个 web 进程；`worker` 在运行
- [ ] 备份已经定时、复制到了别的机器、恢复演练过一次
- [ ] 磁盘有监控（`STORAGE_MIN_FREE_MB` 只是最后一道保险）
- [ ] 反向代理的请求体上限不小于 `UPLOAD_LIMIT_MB`
