# Open Research Agent 浏览器扩展

在任何网页或 PDF 链接上，一键用 Open Research Agent 打开。适用于 Chrome、Edge 等
Chromium 内核浏览器（Manifest V3）。纯 JavaScript，无需构建，没有外部依赖。

## 安装（加载已解压的扩展程序）

1. 打开 `chrome://extensions`（Edge 为 `edge://extensions`），打开右上角「开发者模式」。
2. 点「加载已解压的扩展程序」，选择本仓库的 `extension/` 文件夹。
3. 把扩展固定到工具栏（可选）。
4. 点扩展的「详细信息」→「扩展程序选项」，选服务地址：
   - 本机版：`http://127.0.0.1:8765`（默认，`open-paper-reader` 命令的默认端口，可用 `--port` 或 `OPR_PORT` 改）
   - 在线版：`https://papers.dougao.online`
   - 或你自己部署的 `https://…` 地址

## 使用

- 点工具栏按钮：打开当前页面。
- 在页面或链接上点右键，选「在 Open Research Agent 中打开」：打开页面，或打开你点的那个链接（比如一个 PDF 链接）。

扩展会新开一个标签页 `<服务地址>/#open?url=<网址>`。应用收到后下载这篇论文、显示导入进度，
然后进入阅读器；已经在文库里的论文直接打开。还没登录在线版时，先走登录，登录后继续。

支持：arXiv / alphaxiv / ar5iv 页面、带 `citation_pdf_url` 的出版社页面、直接的 PDF 链接。
需要订阅才能下载的页面没有可用的 PDF 链接，应用会提示你下载后拖进来。

## 隐私与权限

- 只传网址，且只是打开应用时地址栏里的一部分。不发送 cookie，不读取页面内容，不访问任何其他服务器。
- 权限只有三项：`activeTab`（点击时读取当前标签页的网址）、`contextMenus`（右键菜单）、`storage`（记住服务地址）。
- 服务地址只接受 `https://`，或本机的 `http://127.0.0.1` / `http://localhost`。

## 图标

`icons/icon.svg` 是图标的源文件；PNG 由脚本生成（需要先在 `frontend/` 里装好 Playwright 的 Chromium）：

```bash
node scripts/make-extension-icons.mjs
```
