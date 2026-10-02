# 更新日志

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)。

## [未发布]

### 首次开源

- **许可证**：以 MIT 许可证发布，第三方许可见 [NOTICE](NOTICE.md)。
- **自托管**：`docker compose up` 即可运行（API、助手 worker、PostgreSQL）；提供 Caddy 与 nginx 的反向代理示例、systemd 单元和定时备份。文档见 [部署](docs/DEPLOYMENT.md) 与 [配置](docs/CONFIGURATION.md)。
- **注册模式**：新增 `REGISTRATION=invite`，注册需要管理员为某个用户名生成的邀请码；默认仍是 `open`。
- **共享模型标签**可在共享模型文件里用 `badge` 配置（默认「共享模型」）。**如果你之前的部署显示的是「限时免费」，请在共享模型文件里加上 `"badge": "限时免费"`。**
- **本机模型脚本**：`scripts/set-local-model.sh` 不再只面向某一家模型服务，改为交互式填写接口地址、模型和密钥。
- **前端**：侧栏当前项的滑动高亮改用自己的实现（基于 `motion`），去掉了带「禁止再分发」条款的第三方组件；移除了未使用的字体依赖。
- **容器**：Docker 镜像不再记录访问日志（访问路径里可能含分享令牌）。
- **清理**：移除了内部部署记录、开发日志、与特定主机相关的运维文档，以及未被引用的第三方材料；文档重写为面向外部读者的版本。

### 已知限制

见 [README](README.md#现状与限制)：界面仅简体中文、模型地址限制、单机部署、版面翻译为实验性。
