# 加密恢复包与异机恢复

普通的备份 ZIP（见 [运维](OPERATIONS.md#备份与恢复)）不包含模型密钥和翻译检查点。`backend.ops_backup` 在它之上再做一个**只给运维人员用的加密信封**，里面有：业务 ZIP、每个账户的模型配置、共享模型文件、翻译的 `units.json` / `units.tmp` / `compile.log` 检查点，以及可选的部署环境文件。它**不包含**恢复私钥、操作系统、容器镜像、反向代理配置，也不包含已安装的运行环境——恢复时需要另外部署同一版本的应用。

加密使用外部的 [age](https://github.com/FiloSottile/age) 和一个公开的 `age1…` 接收者。需要安装 `age` 与 `age-keygen`；**私钥（identity）留在恢复用的另一台设备上，不要放在应用服务器上，不要进 Git，也不要贴进聊天。** 丢了私钥，加密的备份就无法恢复。

## 创建

停掉 web 和两个 worker，并记下它们原来是否在运行。加载你正常使用的私有环境后：

```bash
python -m backend.ops_backup create /private/path/recovery.age \
  --recipient AGE_PUBLIC_RECIPIENT \
  --deployment-env /etc/paper-platform/app.env --offline
```

命令拒绝覆盖已存在的输出。明文的中间文件放在权限 0700 的临时目录里，成功或失败都会清理；输出文件权限 0600；校验和在加密信封里面；不会打印任何密钥。进程被强行杀掉时可能留下私有的临时目录，删除前请先检查。

`deploy/backup_production.py`（systemd 定时备份，见 [部署](DEPLOYMENT.md#定时备份)）设置了 `PAPER_BACKUP_RECIPIENT_FILE` 之后，会在写入者停止期间同时生成业务 ZIP 和加密恢复包，然后在 `finally` 里启动原来在运行的服务。本机只保留最新的一份（`PAPER_BACKUP_KEEP` 可调）：新备份完整写好之后才删除旧的，所以任何时候至少有一份。

- 开始停服务之前，一份仅 root 可读的日志会记下原来在运行的服务；`ExecStopPost` 在超时或 SIGKILL 之后也会调用恢复路径，同一把排他锁防止备份和恢复同时进行。启动失败时日志保留，所有记录的服务都会再尝试启动。它不覆盖系统管理器本身故障或整机掉电；那种情况下仍然依赖已启用服务的开机策略。
- 备份先写成 `.partial` 再原子地发布，不会覆盖已完成的备份；中断留下的 `.partial` 保留给运维检查，不参与保留期清理，也不会被当作已完成的备份。
- 加密本身并不产生异地副本，请把它复制到别的机器。

## 恢复到隔离环境

```bash
python -m backend.ops_backup unpack /private/path/recovery.age /new/private/recovery-directory \
  --identity /private/path/recovery.agekey
```

目标目录必须不存在。解密、成员白名单、大小限制和校验和都会检查，失败会清除已写出的内容；已有数据绝不会被覆盖。这是**暂存**命令，不是在线恢复。

1. 部署同一版本的应用和一个空的、已迁移的数据库；演练期间关闭网络和模型调用。
2. 对 `recovery-directory/workspace.zip` 运行离线的业务恢复（`python -m backend.cli restore … --offline`），使用新的数据库和文件目录。它会让旧的登录会话和令牌失效，并把恢复时处于进行中的助手任务标为失败，而不是重放写操作。
3. 把 `model-configs` 放到新的 `TRANSLATION_CONFIG_DIR`，共享模型的 JSON 放到 `PLATFORM_MODEL_CONFIG`，检查点子目录放到新存储目录的上级目录下的 `translation-work`。私有目录保持 0700、文件 0600，属主是应用的服务账号。缺少某个可选部分，说明源环境的快照里没有配置它。
4. 私下检查 `deployment/app.env`，按新环境调整数据库地址、存储路径、`APP_ORIGIN`、反向代理和邮件设置，不要盲目覆盖目标机器上的 `/etc` 配置。重新启用备份时，从保留的私钥重新导出接收者文件。
5. 在把用户切到恢复后的服务之前，核对记录、附件的 SHA256、私有配置和检查点的字节。测试模型调用时只用明确授权的范围：它会发送数据并消耗上游额度。

## 测试

测试使用真实的 age 加解密和一次性的 identity，覆盖：密钥错误与文件损坏、路径穿越与校验和被拒、已有输出不被覆盖、私有附属文件字节一致、业务数据库的恢复。PostgreSQL 演练用一个一次性的 schema，并恢复到新的 SQLite 数据库来验证可移植性；它不是生产级的灾难演练。
