# 参与 Open Paper Reader

Open Paper Reader 是采用 MIT 许可证的开源论文阅读工作台，同时提供可直接使用的线上服务。欢迎通过问题报告、文档、测试和代码一起改进项目。

## 先聊一聊

- **发现问题**：先搜一下已有的 issue。新建时写清楚：你做了什么、期望什么、实际发生了什么；部署问题请附上 `docker compose --env-file .env -f deploy/docker-compose.yml ps` 和相关日志（**先抹掉密钥、令牌和你的论文内容**）。
- **想做大的改动**：先开一个 issue 说说想法，再动手。Open Paper Reader 有明确的取向（克制的界面、阅读内容优先、助手的每一步都可以核对），提前沟通能避免白费功夫。
- **安全问题**：请不要公开提 issue，按 [SECURITY](SECURITY.md) 私下报告。

## 开发环境

```bash
make install && make db && make build && make run     # http://127.0.0.1:8765
make worker                                           # 另一个终端：助手 worker
```

目录结构、测试和约定在 [开发](../docs/DEVELOPMENT.md)；整体设计在 [架构](../docs/ARCHITECTURE.md)。

## 提交之前

在你改动的范围内，下面这些要通过（CI 会运行全部）：

```bash
make test                          # 后端测试
npm --prefix agent-runtime test    # 助手运行时（改了 agent-runtime 时）
make check                         # 前端类型与格式检查
make build && cd frontend && npx playwright test e2e/<相关的>.spec.ts   # 改了界面时
```

- 改了界面的行为，请补或更新对应的测试；改了表结构，请加 Alembic 迁移，不要修改已经存在的迁移。
- 浏览器测试读取 `frontend/dist`：改了前端先 `make build`；整套运行期间不要重新构建。
- 前端用 Prettier 格式化（`npm --prefix frontend run format`）；Python 保持和周围代码一致的风格。
- **没有跑过的测试不要说通过了。** 需要真实模型或 Docker 才能验证的改动，在 PR 里说明你怎么验证的、哪些没有验证。

## 约定

- **界面**：复用现有的 shadcn/ui 组件和语义色；阅读内容优先，状态提示不挤动阅读区域；动效要有用，并尊重「减少动态效果」。界面文案用简体中文。
- **数据**：修改数据走现有的 API、所有权检查和版本冲突检查；不要绕过权限，不要覆盖用户的笔记。
- **助手**：回答与工具过程分开展示；「成功」必须有真实的工具结果，不能只凭模型自己说成功。
- **依赖**：新增依赖要说明理由和许可证（见 [NOTICE](../docs/NOTICE.md)）；不接受带有「禁止再分发」「非商业」之类限制的代码或资源。不要引入遥测或后台的外部请求。
- **密钥**：不要提交 `.env`、模型密钥、令牌和真实的论文数据。

## Pull request

1. 从最新的 `main` 建分支：`feature/<主题>` 或 `fix/<主题>`。
2. 一次 PR 只做一件事，提交信息写清楚改了什么、为什么。
3. 说明改动的动机、你验证过什么（命令与结果），界面改动请附前后截图。
4. 评审里的意见请直接在 PR 里讨论；维护者可能会要求拆分或补测试。

提交贡献，即表示你同意你的贡献以本项目的 [MIT 许可证](../LICENSE) 发布。

## 行为准则

请友善、就事论事。批评代码而不是批评人；对新手耐心；不接受骚扰和歧视。维护者有权删除不合适的评论、关闭讨论或封禁账号。
