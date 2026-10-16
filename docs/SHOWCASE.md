# 首页与产品截图

公开首页（[`frontend/src/features/ProductSite.tsx`](../frontend/src/features/ProductSite.tsx)）靠真实界面的截图说明产品：不画示意图，不修图。文案和截图的清单在 `landing-content.ts`，样式在 `landing.css` 与 `landing-sections.css`，图片的尺寸与缓存版本在 `showcase-dimensions.json`。README 里用的截图也来自同一批文件（`frontend/public/assets/showcase/`）。

## 突出什么

纸间是论文阅读与研究积累的工作台，**研究助手全程参与**是它的亮点：助手实际读取原文，回答带着页码，能跨论文比较、能动手整理，做过什么可以核对。

首页的取舍：

- 第一版把翻译、批注、文库并列，没有突出助手；第二版首屏只讲助手，被看成又一个聊天助手，反而**局限了功能**；第三版首屏加了「读、译、批、记」和六个整窗口标签，又和后面的功能浏览器重复。
- 现在没有单独的首屏：打开页面第一眼就是功能浏览器——一行产品标签、标题「开源的论文阅读工作台，助手全程参与。」、说明、两个按钮，然后是 7 类 33 项功能的浏览器，每项一张真实截图和「怎么用」，「助手」分类排第一、默认选中。
- 助手这个亮点放在紧接着的「研究助手」专区（问／比／做／核四段）里讲深。
- 判断标准是「一个只会对着 PDF 聊天的工具做不到什么」：多篇论文的实际读取与对比、写入笔记并回读核验、权限开关、可展开的操作记录。

## 页面结构

| 区块 | 内容 | 图片 |
| --- | --- | --- |
| 阅读工具（第一屏） | 小标签 + h1 + 说明 + 开始阅读 / 了解如何使用 + 一行引导；下面是七个分类、33 个功能，每项一张聚焦截图和「怎么用」一行；窄图并排、宽图上下排；被面板截断的图底部渐隐；当前分类的图在空闲时预取 | `chat.webp` 等，默认第一张 `fetchpriority=high` |
| 研究助手 | 标题「助手读过原文，你来做判断。」，四段左文右图交替：指哪里读哪里；勾选几篇让助手去读；不只回答也能整理（写入笔记并核验）；做过什么一目了然（可展开的操作记录） | `region`、`story-compare`、`organize`、`story-trace` |
| 译 | 可拖动的原文/译文对比，用真实 PDF 的同一页（公式页、图表页） | `compare-*.webp` |
| 围绕助手的工作台 | 「记」（高亮、评论、手写、笔记）与「积」（文库、知识图谱）两张卡片 | `story-note`、`story-library` |
| 还有这些细节 | 会话、快捷键、复制为图片、笔记历史、发现论文、集合、归档、面板停靠、存储、密钥、分享、Agent 凭据、深色模式 | `dark.webp` |
| 一个简单的开始 / FAQ / 结尾 | 放进来、问下去、留下来；五条常见问题 | 复用功能图 |

页脚注明：截图取自演示空间；公开 arXiv 论文的版权归原作者；解释、翻译、导读、测验以及助手的回答与操作记录是模型的真实输出。

**文案只写界面真的做到的事**：例如笔记里的「来源」链接需要按住 ⌘/Ctrl 点击才会跳转，对比表里的「p5 表 2」只是标明证据页码，不是可点击的页内跳转。

## 截图怎么来的

演示空间与真实内容都由脚本生成，界面改了之后可以重做。需要本机的后端（8791 端口）和 Vite（5174 端口，`APP_ORIGIN` 指向它），以及 Playwright 的 Chromium。

```bash
# 1. 真实的模型输出（在有模型密钥的机器上；见 scripts/bench_model.py 和 docs/PERFORMANCE.md）。
#    explain figure chat formula translate table 是阅读器里的问答；
#    compare 让助手读三篇论文做对比（与文库「比较论文」按钮同一个提示词）；
#    organize 让助手读三篇论文，把差异追加到 A-MEM 阅读笔记并链接另外两篇（写入有回读凭证）。
python scripts/showcase/real_content.py showcase-content.json [explain figure chat formula translate table compare organize]

# 2. 重建演示空间：一个演示账户、8 篇公开 arXiv 论文、阅读笔记、知识图谱素材、已完成的版面翻译；并保存快照
scripts/showcase/build_demo.sh showcase-content.json amem-zh.pdf

# 3. 在真实界面里逐场景操作并截图（先 reset：标注、写入类场景会改变工作区）
scripts/showcase/reset_demo.sh
node scripts/showcase/capture.mjs <out> showcase-content.json [scene ...]

# 4. 裁剪、转 WebP、写入尺寸与内容哈希
python scripts/showcase/export.py <out> amem.pdf amem-zh.pdf
```

- 演示空间的目录和账户密码由 `build_demo.sh` 生成，放在 `DEMO_DIR`（默认 `/tmp/zhijian-demo`），`DEMO_PASSWORD` 可以覆盖。
- 场景里的解释、框选、对话、比较、整理由界面真实发起；`fill_ai.py patch` 在界面提交请求的那一刻补上模型当时的真实回答与操作记录，并把回答里的论文/文件/笔记 id 换成演示空间里的，不调用模型。
- `organize` 的写入效果也在演示空间里重放：助手追加的那段文字原样加到演示的 A-MEM 阅读笔记末尾，版本号加一，所以随后打开笔记看到的就是助手写的内容。
- 对话类场景要在 reset 之后第一个拍，否则会话里有前面场景的消息。
- 版面翻译的演示任务没有段落对应数据，截图脚本只隐藏工具栏里「此版本暂无可靠段落对应」这一句；产品生成的任务有对应数据。
- 登录会话缓存在 `/tmp/zhijian-demo.session.json`，避免每个场景都登录而触发限流；重建演示空间后要删掉它。
- 图片 URL 带内容哈希（`?v=`），固定文件名的资源缓存一天也不会陈旧。整套约 6 MB，首屏只下载一张（约 120 KB）。

## 测试

`frontend/e2e/product-site.spec.ts`：第一屏（标题、两个按钮、功能分类与默认图片都在视口内）、放大窗口、对比滑块（键盘与指针）、33 个功能的图片全部加载并带「怎么用」、功能入口、文档搜索、390 / 768 宽度无横向溢出。`entry-split.spec.ts` 守住公开入口的脚本总量（< 500 KB）。
