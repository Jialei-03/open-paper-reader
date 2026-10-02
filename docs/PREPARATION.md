# 自动准备论文

导入原文 PDF 后，独立的 `backend.preparation_worker` 定期检查新论文和旧文库中缺少的结果。浏览器不必保持打开；打开论文只提高处理优先级。设置 → 模型中可以关闭自动准备，阅读器的准备状态中可以暂停、继续或重试本篇。

## 模块与结果

- `paper_preparation.py`：按所有者、原文文件及版本去重，管理准备状态。
- `preparation_worker.py`：发现导入、补齐导读和逐句译文，安排布局 PDF；后台任务不创建聊天会话。
- `translation_memory.py`：按所有者、原文校验和、上游、模型、语言及原句保存共用译文。相同句子的并行请求通过跨进程锁合并；完整校验后才保存。
- `translation_worker.py`：生成布局 PDF 或编译 arXiv LaTeX。排版失败保留正文译文；重试仅处理缺失内容。
- `translation_resources.py`：CPU 排版按实际可用内存及在途预留等待资源，与模型请求并发独立。

对照视图和 PDF 布局适配器读取同一份句子记忆。只有源句及翻译配置对应时才复用；公式占位符或抽取边界不同的片段必须独立校验，不能把不匹配的旧译文机械套入。旧 LaTeX 检查点继续保留，满进度的编译恢复无需重新调用模型。已有不同模型生成的完整阅读产物仍可显示；用户显式重新生成会生成新版本，避免旧缓存覆盖选择。

导读读取核验过的完整原文，独立于正文翻译与 PDF 生成。状态分别表示导读、正文已完成页数和布局结果。某个阶段失败不会清空其他阶段，也不会误报全部完成。

## 部署

升级数据库到 `0023`，运行：

```sh
python -m backend.preparation_worker
python -m backend.translation_worker
```

可使用 `deploy/systemd/paper-preparation-worker.service`，与 HTTP 服务加载相同配置。设置 `PDF_LAYOUT_IMAGE` 启用布局生成，`TRANSLATION_TEX_IMAGE` 指向包含完整字体和宏包的 TeX 镜像。没有可用模型时任务等待，不反复调用模型；没有文字层的扫描页会明确提示需要 OCR，不发布空译文。

模型请求和翻译批次没有固定的 3/6 并发上限。上游限流会退避，已成功的句子可继续复用。PDF 排版与 LaTeX 编译保留容器隔离、磁盘及内存保护。
