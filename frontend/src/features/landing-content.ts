// Everything the public homepage says and shows. Each picture is a capture of
// the real interface in the demo workspace (scripts/showcase), so the words here
// describe what the picture actually contains.
import {
  Archive,
  Bookmark,
  Compass,
  FileDown,
  FolderTree,
  HardDrive,
  Highlighter,
  History,
  ImageDown,
  Keyboard,
  KeyRound,
  Languages,
  LayoutPanelLeft,
  ListTree,
  MessageSquare,
  MessageSquareText,
  Network,
  PenLine,
  Quote,
  ScanSearch,
  Search,
  Share2,
  Sigma,
  Sparkles,
  Table2,
  FolderOpen,
  GraduationCap,
  ListChecks,
  Bot,
  BookText,
  Images,
  Library,
  GitCompareArrows,
  ShieldCheck,
  PencilLine,
  LayoutList,
  type LucideIcon,
} from "lucide-react";

export type Story = {
  id: string;
  kicker: string;
  title: string;
  text: string;
  points: string[];
  tone: "blue" | "green" | "yellow" | "pink";
  link: [string, string];
  file?: string;
  alt?: string;
};
// One idea per row. The first four are the assistant: ask, compare, do, check.
export const stories: Story[] = [
  {
    id: "ask",
    kicker: "问",
    title: "指哪里，读哪里",
    text: "选中一句话，或框住一张图、一条公式、一个表格——助手拿到的是你指的那一块和它所在的页，回答围绕它展开，并说明依据在哪一页。",
    points: [
      "选中文字：解释、翻译、高亮、评论，或直接向 AI 提问",
      "框选图表、公式、表格：解释、转写、翻译，也能复制为截图",
      "看不清的符号和数字会直说，不猜",
    ],
    tone: "blue",
    link: ["#docs/assistant", "查看使用指南"],
    file: "region.webp",
    alt: "框住页面顶部的示意图后，选框旁出现解释图表、解释公式、翻译选区文字、向 AI 提问、复制为图片等操作",
  },
  {
    id: "compare",
    kicker: "比",
    title: "勾选几篇，让助手去读",
    text: "在文库里勾选 2–5 篇，点「比较论文」。助手逐篇读取 PDF，按研究问题、方法、数据、结果与局限整理成表格，每一项都标明出自哪一页。",
    points: [
      "读取失败或证据不足时会直说，不拿印象填空",
      "每个数值后面标出证据页码，如「p5 表 2」，回到原文核对",
      "三篇论文约一分钟，不创建笔记，除非你要求",
    ],
    tone: "green",
    link: ["#docs/library", "查看使用指南"],
    file: "story-compare.webp",
    alt: "研究助手的对比结果：MemGPT、Mem0、A-MEM 的实验数值，每一项后面都是页码链接",
  },
  {
    id: "do",
    kicker: "做",
    title: "不只回答，也能动手整理",
    text: "让助手把对比写进笔记、给论文打标签、导入 arXiv 论文、发起全文翻译。修改文库前需要你允许；写入之后，助手会回读确认，并给出可点开的凭证。",
    points: [
      "在笔记末尾追加一节，原有内容保留，历史可回看",
      "「允许修改文库」可以随时关闭，关闭后只读",
      "每次写入都核验：已保存并核验，或明确标出待核验",
    ],
    tone: "yellow",
    link: ["#docs/assistant", "查看使用指南"],
    file: "organize.webp",
    alt: "研究助手读完三篇论文后在笔记末尾追加了一节对照，并显示笔记已保存并核验",
  },
  {
    id: "check",
    kicker: "核",
    title: "做过什么，一目了然",
    text: "每个回答都能展开「N 项操作」：读了哪几份文件、做了什么修改。结论后面标着页码和「来源」链接，指向论文里的对应位置。",
    points: [
      "操作记录逐项可查，失败也如实显示",
      "来源指向论文的具体页：助手的回答不替代原文证据",
      "使用平台模型，或添加你自己的 OpenAI / Anthropic 兼容服务",
    ],
    tone: "pink",
    link: ["#docs/models", "查看使用指南"],
    file: "story-trace.webp",
    alt: "展开的 15 项操作：读取论文资料与笔记，读取三份论文附件的文本，每一项都标明已完成",
  },
  {
    id: "translate",
    kicker: "译",
    title: "整篇论文，保留版式的中文",
    text: "对照翻译逐页、逐句与原文并排；布局翻译把整篇论文译成排版完整的中文 PDF，公式与图表原样保留。",
    points: [
      "对照翻译：逐句排列，悬停联动原文",
      "布局翻译：并排查看、单看译文、合并下载",
      "选段翻译与 AI 精译，结果保存在翻译面板",
    ],
    tone: "green",
    link: ["#docs/translation", "查看使用指南"],
  },
];

// The workspace around the assistant: two cards side by side.
export const duo: Story[] = [
  {
    id: "note",
    kicker: "记",
    title: "想法留在发生的地方",
    text: "高亮、评论、手写，把值得记住的内容摘录进当前论文的笔记。笔记支持 Markdown、公式和图片，也能互相链接。",
    points: [],
    tone: "yellow",
    link: ["#docs/reader", "查看使用指南"],
    file: "story-note.webp",
    alt: "论文页面上的黄色与蓝色高亮、评论和手写圈画",
  },
  {
    id: "library",
    kicker: "积",
    title: "论文多了，也有条理",
    text: "阅读状态、收藏、标签和研究方向；批量整理、全局搜索；笔记里的链接连成知识图谱，沿着主题、证据与问题继续读。",
    points: [],
    tone: "pink",
    link: ["#docs/library", "查看使用指南"],
    file: "story-library.webp",
    alt: "知识图谱以 A-MEM 论文为中心，连接相关论文、主题、笔记、问题与证据",
  },
];

export type Feature = {
  icon: LucideIcon;
  label: string;
  title: string;
  text: string;
  how: string;
  shot: string;
  alt?: string;
  // The picture is cut at the bottom of a panel that goes on: fade it out.
  fade?: boolean;
};
export type FeatureGroup = { id: string; name: string; items: Feature[] };
export const featureGroups: FeatureGroup[] = [
  {
    id: "assistant",
    name: "助手",
    items: [
      {
        icon: MessageSquareText,
        label: "论文对话",
        title: "同一篇论文，接着聊",
        text: "研究助手带着当前论文回答：先读取相关页面，再作答，并附来源页码。每篇论文默认继续同一个会话，新问题也可以另建会话。",
        how: "打开 AI → 输入问题；会话名称旁可切换或新建。",
        shot: "chat.webp",
        fade: true,
        alt: "向 AI 询问两种记忆方法的区别：回答上方是可展开的「2 项操作」，随后是带小标题的回答",
      },
      {
        icon: GitCompareArrows,
        label: "比较论文",
        title: "勾选几篇，一起读、一起比",
        text: "选 2–5 篇论文，助手逐篇读取全文，按研究问题、方法、数据与结果、局限整理成表格；每项结论链接到具体的页，证据不足时会直说。",
        how: "文库 → 批量管理 → 勾选论文 → 比较论文。",
        shot: "story-compare.webp",
        alt: "三篇论文的对比结果表：MemGPT、Mem0、A-MEM 的实验数值，每项后面是来源页码链接",
      },
      {
        icon: PencilLine,
        label: "写入笔记",
        title: "把结论写进笔记，并核验写入",
        text: "让助手把整理结果追加到论文的笔记末尾：原有内容保留，写入后回读确认，给出「已保存并核验」的凭证，点开直达笔记。",
        how: "对助手说明要写什么、写到哪篇笔记 → 点开凭证查看。",
        shot: "organize.webp",
        alt: "助手读取三篇论文后写入笔记，界面显示笔记已保存并核验，并概述新增的小节",
      },
      {
        icon: Quote,
        label: "来源可回查",
        title: "笔记里的每个来源，都能回到原文",
        text: "助手写下的结论后面是「来源」链接，指向论文的具体页；按住 ⌘（Windows 为 Ctrl）点击，阅读器就翻到那一页，不必自己找。",
        how: "按住 ⌘ 点击笔记里的「来源」；助手回答里的来源直接点击。",
        shot: "notes-sources.webp",
        fade: true,
        alt: "助手写入的笔记：每一条论断后面都有来源链接",
      },
      {
        icon: ShieldCheck,
        label: "修改权限",
        title: "助手改文库之前，先问你",
        text: "「允许修改文库」是一个开关：关闭时助手只读，打开后才能整理笔记、标签和论文；需要时随时关掉。",
        how: "AI 输入框旁的「对话设置」→ 允许修改文库。",
        shot: "permission.webp",
        alt: "对话设置菜单：允许修改文库已勾选，另有支持图片与扫描页、切换为悬浮窗等",
      },
      {
        icon: LayoutList,
        label: "能力范围",
        title: "助手能做什么，一屏看清",
        text: "管理论文、阅读与笔记、搜索与翻译、分析与文件——能力列表来自真实的工具，不夸大。展开「查看工具详情」可以看到每一个。",
        how: "打开研究助手 → 标题栏的「能力范围」。",
        shot: "capabilities.webp",
        alt: "研究助手的能力范围：管理论文、阅读与笔记、搜索与翻译、分析与文件",
      },
    ],
  },
  {
    id: "understand",
    name: "读懂",
    items: [
      {
        icon: Sparkles,
        label: "解释",
        title: "围绕一句原文，讲清一个问题",
        text: "解释卡片同时保存原句和回答：说明概念、论证与局限，并给出原文依据。读完可以继续追问，也能定位回原文。",
        how: "选中文字 → 解释（E）→ 继续追问。",
        shot: "explain.webp",
        fade: true,
        alt: "解释卡片：上方是被选中的英文原句，下方是中文解释与原文依据",
      },
      {
        icon: ScanSearch,
        label: "框选图表",
        title: "把问题框在图表里",
        text: "拖出选框，用四角调整范围；在选框旁解释图表、识别公式、翻译文字、复制截图或送入对话。",
        how: "选择框选工具 → 圈出区域 → 选择操作。",
        shot: "region.webp",
        alt: "页面顶部的示意图被框选，选框旁出现解释、翻译与复制为图片等操作",
      },
      {
        icon: Sigma,
        label: "公式",
        title: "框住公式，转写并讲清符号",
        text: "识别公式并转写为 LaTeX，说明每个符号的含义、成立的前提和它在上下文中的用途；看不清的符号会明确指出，不猜测。",
        how: "框选公式 → 解释公式。",
        shot: "formula.webp",
        fade: true,
        alt: "框选论文中的相似度公式后，右侧给出公式转写与符号定义",
      },
      {
        icon: Table2,
        label: "表格",
        title: "框住表格，译成可读的表格",
        text: "框内文字连同行列结构一起翻译，结果保留为表格；模型支持识图时，会连同图片一起阅读。",
        how: "框选表格 → 翻译选区文字。",
        shot: "table.webp",
        alt: "框选英文表格后，翻译面板里出现行列对齐的中文表格",
      },
    ],
  },
  {
    id: "translate",
    name: "翻译",
    items: [
      {
        icon: Languages,
        label: "逐句对照",
        title: "逐句读译文，随时回看原句",
        text: "逐页翻译并与原文并排；悬停译文时，原文里对应的句子亮起。宽屏左右对照，窄屏上下排列。",
        how: "打开翻译 → 打开对照 → 悬停或聚焦想看的句子。",
        shot: "translate.webp",
        alt: "左侧英文原文，右侧中文译文，悬停的一句译文对应的原句在左侧亮起",
      },
      {
        icon: LayoutPanelLeft,
        label: "布局翻译",
        title: "整篇论文，译成排版完整的中文 PDF",
        text: "使用 arXiv 源码翻译并重新排版，公式、图表与版式原样保留。完成后可单看译文、并排查看，或合并下载。",
        how: "翻译面板 → 布局翻译 → 并排查看。",
        shot: "layout.webp",
        alt: "原文 PDF 与布局翻译后的中文 PDF 左右并排，版式一致",
      },
      {
        icon: BookText,
        label: "选段翻译",
        title: "选一段就译，要更准时用 AI 精译",
        text: "选中文字点「翻译」即时出译文；需要更准的译法，用 AI 精译，结果连同原文保存在翻译面板，可以搜索与导出。",
        how: "选中文字 → 翻译 → 用 AI 精译。",
        shot: "translate-selection.webp",
        alt: "翻译面板中保存的选段翻译记录：英文原句与中文译文",
      },
    ],
  },
  {
    id: "guide",
    name: "导读与自测",
    items: [
      {
        icon: Bot,
        label: "论文导读",
        title: "先看全貌，再读细节",
        text: "关键词词典、三行摘要，以及研究问题、方法、结果与边界；每一条都标出证据页，点击即可定位原文。",
        how: "打开 AI → 论文导读 → 生成。",
        shot: "guide.webp",
        alt: "论文导读：关键词词典、三行摘要与研究问题",
      },
      {
        icon: GraduationCap,
        label: "阅读测验",
        title: "读完问问自己",
        text: "选择题数与难度，作答后查看分数、解析与证据页；可以重新作答，也可以重新生成。",
        how: "测验 → 选择题数与难度 → 提交并查看解析。",
        shot: "quiz.webp",
        fade: true,
        alt: "阅读测验：作答后显示得分、正确答案与解析",
      },
      {
        icon: Highlighter,
        label: "重点建议",
        title: "按创新、方法、结果标出重点",
        text: "AI 从原文里挑出值得细读的句子，按创新、方法与结果分类；可以叠加显示在论文上，不会覆盖你手动保存的批注。",
        how: "批注 → AI 重点建议 → 在论文上显示重点。",
        shot: "ai-highlights.webp",
        fade: true,
        alt: "AI 重点建议列表，论文页面上对应的句子被标出",
      },
      {
        icon: Images,
        label: "图表目录",
        title: "全文的图和表，一页看完",
        text: "列出全文的图表标题与页码，一键定位原文或直接解释；也可以让模型识别当前页的图表与公式。",
        how: "打开图表面板 → 定位原文 / 解释。",
        shot: "figures.webp",
        fade: true,
        alt: "图表面板列出全文的图与表，每项可定位原文或解释",
      },
    ],
  },
  {
    id: "navigate",
    name: "定位与引用",
    items: [
      {
        icon: ListTree,
        label: "章节目录",
        title: "直接回到想读的章节",
        text: "目录展示章节层级，点击跳转正文；原 PDF 缺少目录时，可以从正文生成。缩略图在同一个侧栏里。",
        how: "点击阅读器左上角的论文目录。",
        shot: "outline.webp",
        fade: true,
        alt: "左侧章节目录展开，中间是论文首页",
      },
      {
        icon: Search,
        label: "全文查找",
        title: "在论文里找到每一处",
        text: "输入关键词，命中处在页面上高亮，并显示第几处、共几处；上下切换逐处查看。",
        how: "点击放大镜 → 输入 → Enter。",
        shot: "search.webp",
        alt: "全文查找栏显示 1/11，页面上对应的词被高亮",
      },
      {
        icon: Quote,
        label: "引用预览",
        title: "悬停引用，直接看原文",
        text: "鼠标停在章节或引用标记上，弹出目标位置的原文裁片和文字，不必翻到文末；外部链接显示来源提供的标题与摘要。",
        how: "把鼠标停在 [15] 这样的引用标记上。",
        shot: "cite.webp",
        alt: "悬停引用标记后弹出参考文献页的裁片与完整引用",
      },
      {
        icon: Library,
        label: "引用文献",
        title: "查参考文献，也看谁引用了它",
        text: "列出参考文献与被引用的论文，可以收藏、复制或导入文库；只向 Semantic Scholar 发送论文公开的 DOI 或 arXiv 标识。",
        how: "打开引用文献 → 参考文献 / 被引用。",
        shot: "citations.webp",
        fade: true,
        alt: "引用文献面板：参考文献列表，每项可保存、复制或导入论文",
      },
    ],
  },
  {
    id: "mark",
    name: "批注与笔记",
    items: [
      {
        icon: Highlighter,
        label: "五色高亮",
        title: "用颜色区分你的阅读重点",
        text: "选区旁展开颜色菜单，选一种颜色即保存高亮；保存的高亮可以在批注面板回看和管理。",
        how: "选中文字 → 展开高亮颜色 → 选择一种颜色。",
        shot: "palette.webp",
        alt: "选区菜单展开五种高亮颜色",
      },
      {
        icon: MessageSquare,
        label: "原文评论",
        title: "把疑问留在对应的句子旁",
        text: "评论窗口保留选中的原句。写下问题或判断，之后从批注记录回到出处。",
        how: "选中文字 → 评论 → 保存。",
        shot: "comment.webp",
        alt: "添加评论窗口：上方是选中的原句，下方是评论输入框",
      },
      {
        icon: PenLine,
        label: "手写笔",
        title: "在页面上直接圈画",
        text: "画笔与橡皮直接作用于页面，可调颜色和粗细、撤销与重做。触控笔书写，手指仍用来滚动。",
        how: "选择手写笔 → 在页面上书写 → 手写设置调整颜色与粗细。",
        shot: "ink.webp",
        fade: true,
        alt: "论文页面上的手写圈画与下划线，以及手写设置面板",
      },
      {
        icon: BookText,
        label: "论文笔记",
        title: "把零散想法写成阅读笔记",
        text: "笔记跟随当前论文保存，支持标题、列表、公式、图片和链接；边读边编辑，保存状态随时可见，历史可回看，也能导出。",
        how: "打开笔记 → 在当前论文的笔记中编辑。",
        shot: "notes.webp",
        fade: true,
        alt: "论文笔记：标题、编号列表与引用原文，已保存状态",
      },
    ],
  },
  {
    id: "library",
    name: "文库与分享",
    items: [
      {
        icon: FolderOpen,
        label: "导入论文",
        title: "一个入口，放入 PDF 或 arXiv 链接",
        text: "上传或拖入 PDF（一次可选多篇），也可以粘贴 arXiv 的 abs、html 或 pdf 链接获取论文。",
        how: "点击导入论文 → 上传文件或填入链接。",
        shot: "import.webp",
        alt: "导入论文窗口：上传 PDF 区域与 arXiv 链接输入框",
      },
      {
        icon: Bookmark,
        label: "阅读进度",
        title: "每篇论文读到哪里，一眼可见",
        text: "在文库直接修改未读、阅读中和已读状态，用标签与研究方向整理主题，笔记数量也一起展示。",
        how: "在文库的标签和状态列直接操作。",
        shot: "library.webp",
        fade: true,
        alt: "文库详细列表：标题、作者、摘要、笔记数、标签与阅读状态",
      },
      {
        icon: ListChecks,
        label: "批量整理",
        title: "选几篇，一起处理",
        text: "批量收藏、归档、打标签、加入集合，导出所选论文的 BibTeX；选 2–5 篇还能让助手实际读取并比较。",
        how: "批量管理 → 勾选论文 → 选择操作。",
        shot: "batch.webp",
        alt: "已选 3 篇论文，出现比较、收藏、归档、添加标签与导出 BibTeX 等操作",
      },
      {
        icon: Search,
        label: "全局搜索",
        title: "论文和笔记，一起搜",
        text: "按 ⌘K（Windows 为 Ctrl+K）打开搜索，同时检索论文与笔记，回车直达。",
        how: "按 ⌘K → 输入 → 回车。",
        shot: "quicksearch.webp",
        alt: "全局搜索结果分为论文与笔记两组",
      },
      {
        icon: Network,
        label: "知识图谱",
        title: "笔记之间的链接，连成一张图",
        text: "笔记与论文之间的链接自动形成图谱；点开一篇论文，沿着主题、证据、问题和相关论文继续读。",
        how: "知识图谱 → 点击节点 → 沿着线索继续阅读。",
        shot: "graph.webp",
        alt: "知识图谱：论文、主题、笔记、问题与证据之间的连接",
      },
      {
        icon: Share2,
        label: "只读分享",
        title: "把论文分享出去，设置有效期",
        text: "生成只读链接，选择有效期，并决定是否包含当前笔记；已建链接可以随时撤销。",
        how: "阅读器顶部 → 分享论文 → 创建分享链接。",
        shot: "share.webp",
        alt: "分享论文窗口：有效期选择、是否包含笔记与创建分享链接",
      },
      {
        icon: FileDown,
        label: "下载与导出",
        title: "把原文和自己的批注一起带走",
        text: "下载原文件、导出带批注的 PDF，或打开原文件打印；设置里还能把整个工作区打包导出。",
        how: "阅读器顶部 → 下载 PDF → 选择导出方式。",
        shot: "export.webp",
        alt: "下载菜单：下载原文件、下载带批注 PDF、打开原文件以打印",
      },
      {
        icon: KeyRound,
        label: "自带模型",
        title: "用你自己的模型服务",
        text: "添加 OpenAI 或 Anthropic 兼容服务，密钥仅保存在服务器；翻译与研究助手分别选择模型，并按模型支持的参数调整思考强度。",
        how: "空间设置 → 模型 → 添加模型。",
        shot: "models.webp",
        alt: "添加模型窗口：接口协议、服务地址、API Key 与模型名称",
      },
    ],
  },
];

export const details: { icon: LucideIcon; title: string; text: string }[] = [
  {
    icon: Bot,
    title: "多个会话",
    text: "每篇论文默认继续同一个会话；也可以另建、切换、重命名，收起窗口不会取消任务。",
  },
  {
    icon: Keyboard,
    title: "快捷键",
    text: "选区菜单里 E 解释、H 高亮、T 翻译、C 评论，Enter 向 AI 提问；⌘J 打开研究助手。",
  },
  {
    icon: ImageDown,
    title: "复制为图片",
    text: "框选内容按 ⌘C 作为截图进入剪贴板，直接粘贴到笔记或 AI 对话。",
  },
  {
    icon: History,
    title: "笔记历史与导出",
    text: "每次保存都留下历史；笔记可导出为带图片的 Markdown 压缩包。",
  },
  {
    icon: Compass,
    title: "发现论文",
    text: "按你的研究方向搜索 arXiv，自动排除已入库和已归档的论文。",
  },
  {
    icon: FolderTree,
    title: "方向、标签与集合",
    text: "研究方向、标签、集合三种整理方式，可重命名与合并。",
  },
  {
    icon: Archive,
    title: "归档",
    text: "暂时不读的论文先归档，不会丢，随时移回文库。",
  },
  {
    icon: LayoutPanelLeft,
    title: "阅读面板",
    text: "侧栏可以停靠在右侧或底部，也可以收起，为原文留出更多空间。",
  },
  {
    icon: HardDrive,
    title: "数据与存储",
    text: "查看用量、管理附件，一键导出整个工作区（论文、附件与笔记）。",
  },
  {
    icon: KeyRound,
    title: "密钥只在服务器",
    text: "你添加的模型密钥只保存在服务器；引用查询只发送论文公开的 DOI 或 arXiv 标识。",
  },
  {
    icon: Share2,
    title: "分享可撤销",
    text: "只读分享链接带有效期，可以随时撤销；是否附带笔记由你决定。",
  },
  {
    icon: KeyRound,
    title: "Agent 凭据",
    text: "为你自己的 Agent 创建只读或可写的 API 凭据，随时撤销。",
  },
];

export const faq: [string, string][] = [
  [
    "助手的回答可靠吗？会不会编造？",
    "助手只依据读取到的内容回答：结论后面标出来源页码，没读到、看不清的会直说。解释和比较帮助你理解，不能替代原文证据——请点开来源回到原文核对。",
  ],
  [
    "助手会擅自改动我的文库吗？",
    "不会。只有你允许修改文库后，助手才能整理笔记、标签和论文；关闭开关即只读。每次写入都会回读核验，展开操作记录可以逐项核对。",
  ],
  [
    "需要自己配置模型吗？",
    "看站点：部署者提供了共享模型时，新账号可以直接使用；也可以在空间设置添加你自己的 OpenAI 兼容或 Anthropic 协议的服务，再在翻译和研究助手中选择。",
  ],
  [
    "所有 PDF 都能生成排版翻译吗？",
    "目前全文排版翻译依赖可获取的 LaTeX 源码和成功的编译。普通 PDF 可以阅读、批注，并用对照翻译、选区翻译（含框选的图表和表格）逐页阅读。",
  ],
  [
    "笔记需要单独管理吗？",
    "不需要。每篇论文默认使用一篇阅读笔记，可以在论文内继续添加。原有笔记内容会保留。",
  ],
];
