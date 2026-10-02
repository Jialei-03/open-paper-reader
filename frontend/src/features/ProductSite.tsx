import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  BookOpen,
  ChevronRight,
  Check,
  PanelLeft,
  Maximize2,
  Search,
} from "lucide-react";
import { Brand } from "@/components/Brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import "./product-site.css";
import "./landing.css";
import "./landing-sections.css";
import shotDimensions from "./showcase-dimensions.json";
import {
  details,
  duo,
  faq,
  featureGroups,
  stories,
  type Story,
} from "./landing-content";
const guides = [
  {
    id: "start",
    title: "开始使用",
    intro: "从一篇论文开始，把阅读、理解和记录留在同一个地方。",
    steps: [
      [
        "导入论文",
        "进入工作台，点击「导入论文」：直接上传 PDF（也可以把 PDF 拖进页面的任何位置，一次可放多篇），或粘贴 arXiv 链接。上传的论文会从首页自动识别标题，导入 arXiv 需要时间，请等待任务结果，不要重复提交。",
      ],
      [
        "打开阅读器",
        "在文库中点击论文标题。原生目录缺失时，可从原文生成智能目录。悬停论文链接可预览引用或章节位置。目录、PDF 和论文笔记在同一阅读器中；侧边面板可以收起，为原文留出更多空间。",
      ],
      [
        "留下第一条记录",
        "选中文字后使用悬浮菜单高亮、评论或摘录。笔记属于当前论文，默认使用一篇阅读笔记，也可以在论文内新增笔记。",
      ],
    ],
  },
  {
    id: "library",
    title: "管理论文",
    intro: "文库管理论文，笔记跟着论文走。",
    steps: [
      [
        "整理阅读进度",
        "在文库中筛选阅读状态，收藏需要反复阅读的论文。暂时不用的内容可以归档。",
      ],
      [
        "组织研究方向",
        "使用研究方向归类论文。在管理入口编辑或合并方向，避免相近名称越积越多。",
      ],
      [
        "回到笔记",
        "打开论文，在笔记面板直接编辑。Markdown、公式和图片随笔记保存；已有笔记链接保持可访问。",
      ],
    ],
  },
  {
    id: "reader",
    title: "阅读与批注",
    intro: "阅读工具就在选区旁边，不打断页面布局。",
    steps: [
      [
        "选择与右键",
        "拖动选择 PDF 文字，浮动工具条提供复制、解释、翻译、高亮、评论和摘录；选区可以跨页。右键打开相同的菜单；没有选区时右键，可以解释、翻译或提问鼠标下的那一页。用「框选」圈出图表、表格或公式，旁边会出现解释、翻译、复制为图片和摘录：翻译读取框内的文字（模型支持识图时连同图片一起看），「复制为图片」（或按 ⌘C）把框选内容作为截图放进剪贴板，可以直接粘贴到笔记或 AI 对话。",
      ],
      [
        "高亮与评论",
        "点击高亮直接保存标记，跨页的选区会在每一页各留一处。添加评论会打开输入框，高亮和评论都在侧栏的「批注」面板里修改、搜索和导出。滚动或点击空白处会收起选区工具条。",
      ],
      [
        "手写与触控",
        "使用阅读器的画笔和橡皮工具进行手写标记。触控笔绘制，手指用于移动页面。Apple Pencil 的硬件双击支持受浏览器限制，不保证所有设备都能响应。",
      ],
    ],
  },
  {
    id: "translation",
    title: "翻译与双语对照",
    intro: "保留论文版式，在原文和译文之间切换。",
    steps: [
      [
        "选择模型",
        "打开侧栏的「翻译」面板：「对照翻译」逐页翻译并与原文并排，「布局翻译」把整篇论文译成排版完整的中文 PDF。选中一段文字点「翻译」可以直接看译文，需要更准的译法时点「用 AI 精译」，结果保存在同一面板。",
      ],
      [
        "查看任务结果",
        "全文翻译会获取源码、翻译并编译 PDF。源码缺失或编译失败时不能生成译版；完成段落数不代表 PDF 已生成。失败时先查看错误，不必反复发起新任务。",
      ],
      [
        "对照阅读",
        "译版完成后选择双语模式。阅读器支持联动滚动、缩放和左右交换。有可靠段落映射的译文可定位原文；旧任务或无法匹配的段落可能没有精确对应。",
      ],
    ],
  },
  {
    id: "assistant",
    title: "使用研究助手",
    intro: "让助手带着当前论文的上下文工作。",
    steps: [
      [
        "提问与解释",
        "打开研究助手，直接提问，或先选中文本、框选图表。解释请求会带入相关上下文，在侧栏的「解释」面板里生成独立卡片，点击继续追问可回到对应会话。图片理解需要模型支持视觉输入。",
      ],
      [
        "模型与会话",
        "在输入框附近切换模型和支持的思考参数。每篇论文默认继续同一个会话，可切换历史会话，需要时手动新建；附件入口支持 PDF、图片和文本。",
      ],
      [
        "修改与核验",
        "允许修改文库后，助手可执行获授权的整理和笔记操作。展开操作记录检查结果，不能只凭一句「已完成」判断修改成功。",
      ],
    ],
  },
  {
    id: "insights",
    title: "导读、重点与测验",
    intro: "围绕当前论文理解内容，把结果与笔记分开保存。",
    steps: [
      [
        "生成论文导读",
        "打开阅读器的「导读与测验」，选择模型并生成。导读包含关键词、摘要、研究问题、方法、结果与边界，证据页可直接定位原文。",
      ],
      [
        "提炼阅读重点",
        "在阅读工具中生成重点建议，按创新、方法和结果分类。确认需要时开启原句高亮叠层；它不会覆盖你手动保存的批注。",
      ],
      [
        "检查自己的理解",
        "选择测验题数与难度，完成作答后查看分数、解析和证据。可以重新作答或重新生成；这些内容不会自动变成多篇笔记。",
      ],
    ],
  },
  {
    id: "activity",
    title: "引用与解释记录",
    intro: "回到证据，接着上一次的思考继续。",
    steps: [
      [
        "预览引用",
        "鼠标停在 PDF 的章节或引用链接上，可查看目标位置的原文裁片与文字。外部网页显示来源提供的标题与摘要；来源不提供摘要时不会猜测。",
      ],
      [
        "回看解释与批注",
        "「解释」面板保存每一次解释，可以按内容类型筛选、搜索并导出，悬停卡片会在原文标出对应位置；「批注」面板收纳高亮和评论。点击页码或「定位原文」回到出处。",
      ],
      [
        "继续追问与分享",
        "解释卡片可以继续原会话追问。引用文献面板支持查询、收藏和导入；分享入口可创建有时限的只读副本，之后也能撤销。",
      ],
    ],
  },
  {
    id: "models",
    title: "模型设置",
    intro: "在空间设置管理连接，在使用时选择模型。",
    steps: [
      [
        "添加服务",
        "打开空间设置，添加 OpenAI 兼容或 Anthropic 协议的服务。填写地址和 API Key，并查询上游模型或填写模型名称。",
      ],
      [
        "检查连接",
        "保存后测试连接。网络、额度、接口协议或模型名称不匹配都可能导致请求失败。模型支持的模态与参数以服务实际能力为准。",
      ],
      [
        "选择运行参数",
        "研究助手与翻译分别选择模型。只使用当前模型支持的参数；平台共享模型的并发额度由服务器统一控制。",
      ],
    ],
  },
];
type Dimensions = {
  width: number;
  height: number;
  pixelRatio: number;
  version: string;
};
const dimensionsOf = (file: string) =>
  (shotDimensions as Record<string, Dimensions>)[file];
const sourceOf = (file: string) =>
  `/assets/showcase/${file}?v=${dimensionsOf(file).version}`;

function Screenshot({
  file,
  title,
  alt,
  className = "",
  priority = false,
  fade = false,
}: {
  file: string;
  title: string;
  alt?: string;
  className?: string;
  priority?: boolean;
  fade?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const dimensions = dimensionsOf(file);
  const description = alt || `纸间实际界面：${title}`;
  return (
    <>
      <button
        type="button"
        className={`product-screenshot ${className}`}
        data-fade={fade ? "" : undefined}
        aria-label={`放大截图：${title}`}
        onClick={() => setOpen(true)}
      >
        <img
          src={sourceOf(file)}
          alt={description}
          width={dimensions.width}
          height={dimensions.height}
          style={{ width: dimensions.width, maxWidth: "100%", height: "auto" }}
          loading={priority ? "eager" : "lazy"}
          fetchPriority={priority ? "high" : undefined}
          decoding="async"
        />
        <span className="screenshot-expand">
          <Maximize2 size={15} /> 放大查看
        </span>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="screenshot-dialog w-[96vw] max-w-[1400px] sm:max-w-[96vw]">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>
              纸间实际界面 · 公开论文演示空间
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[82dvh] overflow-auto">
            <img
              src={sourceOf(file)}
              alt={description}
              width={dimensions.width}
              height={dimensions.height}
              style={{
                width: dimensions.width * 1.5,
                maxWidth: "100%",
                height: "auto",
              }}
              className="mx-auto max-w-full h-auto"
            />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

const comparePages = [
  {
    id: "formula",
    label: "公式页",
    en: "compare-en-formula.webp",
    zh: "compare-zh-formula.webp",
    alt: "同一页论文：左半是英文原文，右半是布局翻译后的中文，公式位置与样式不变",
  },
  {
    id: "figure",
    label: "图表页",
    en: "compare-en-figure.webp",
    zh: "compare-zh-figure.webp",
    alt: "同一页论文：左半是英文原文，右半是布局翻译后的中文，图中文字与版式保持一致",
  },
];

// A real page of the paper before and after layout translation: drag to compare.
function LayoutCompare() {
  const [page, setPage] = useState(comparePages[0].id);
  const [position, setPosition] = useState(50);
  const root = useRef<HTMLDivElement>(null);
  const touched = useRef(false);
  const current = comparePages.find((p) => p.id === page)!;
  const size = dimensionsOf(current.en);
  const place = (event: React.PointerEvent<HTMLElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    setPosition(
      Math.max(
        0,
        Math.min(100, ((event.clientX - box.left) / box.width) * 100),
      ),
    );
  };
  useEffect(() => {
    const el = root.current;
    if (
      !el ||
      typeof IntersectionObserver === "undefined" ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    let frame = 0;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        io.disconnect();
        // Once, as the page arrives: sweep from the original towards the middle.
        const start = performance.now();
        const step = (now: number) => {
          if (touched.current) return;
          const t = Math.min(1, (now - start) / 1100);
          setPosition(96 - 46 * (1 - Math.pow(1 - t, 3)));
          if (t < 1) frame = requestAnimationFrame(step);
        };
        frame = requestAnimationFrame(step);
      },
      { threshold: 0.55 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(frame);
    };
  }, []);
  return (
    <div className="lp-compare-wrap">
      <div className="lp-compare-bar">
        <Tabs value={page} onValueChange={setPage}>
          <TabsList aria-label="对比的页面">
            {comparePages.map((p) => (
              <TabsTrigger value={p.id} key={p.id}>
                {p.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <span>拖动对比原文与译文</span>
      </div>
      <div
        className="lp-compare"
        ref={root}
        style={
          {
            "--pos": `${position}%`,
            aspectRatio: `${size.width} / ${size.height}`,
            maxWidth: size.width,
          } as React.CSSProperties
        }
        onPointerDown={(event) => {
          touched.current = true;
          event.currentTarget.setPointerCapture(event.pointerId);
          place(event);
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            place(event);
        }}
      >
        <img
          className="lp-compare-after"
          src={sourceOf(current.zh)}
          alt={current.alt}
          width={size.width}
          height={size.height}
          loading="lazy"
          decoding="async"
        />
        <img
          className="lp-compare-before"
          src={sourceOf(current.en)}
          alt=""
          aria-hidden="true"
          width={size.width}
          height={size.height}
          loading="lazy"
          decoding="async"
        />
        <span className="lp-compare-tag" data-side="before">
          原文
        </span>
        <span className="lp-compare-tag" data-side="after">
          译文
        </span>
        <span className="lp-compare-handle" aria-hidden="true">
          <i />
        </span>
        <input
          type="range"
          min={0}
          max={100}
          step={0.5}
          value={position}
          aria-label="拖动对比原文与译文"
          onChange={(event) => {
            touched.current = true;
            setPosition(Number(event.target.value));
          }}
        />
      </div>
    </div>
  );
}

function StoryRow({ story, index }: { story: Story; index: number }) {
  return (
    <section
      className="lp-story"
      data-reveal
      data-flip={index % 2 === 1 ? "" : undefined}
      aria-labelledby={`story-${story.id}`}
    >
      <div className="lp-story-copy">
        <p className="lp-kicker">{story.kicker}</p>
        <h2 id={`story-${story.id}`}>{story.title}</h2>
        <p className="lp-story-text">{story.text}</p>
        <ul>
          {story.points.map((point) => (
            <li key={point}>
              <Check size={16} aria-hidden="true" />
              {point}
            </li>
          ))}
        </ul>
        <a className="lp-story-link" href={story.link[0]}>
          {story.link[1]} <ArrowRight size={15} />
        </a>
      </div>
      <div className="lp-story-media" data-tone={story.tone}>
        {story.file ? (
          <Screenshot file={story.file} title={story.title} alt={story.alt} />
        ) : (
          <LayoutCompare />
        )}
      </div>
    </section>
  );
}

function DuoCard({ story }: { story: Story }) {
  return (
    <article className="lp-duo-card" data-tone={story.tone}>
      <div className="lp-duo-copy">
        <p className="lp-kicker">{story.kicker}</p>
        <h3>{story.title}</h3>
        <p>{story.text}</p>
        <a className="lp-story-link" href={story.link[0]}>
          {story.link[1]} <ArrowRight size={15} />
        </a>
      </div>
      {story.file && (
        <Screenshot file={story.file} title={story.title} alt={story.alt} />
      )}
    </article>
  );
}

function FeatureExplorer() {
  const [group, setGroup] = useState(featureGroups[0].id);
  const [idx, setIdx] = useState(0);
  const current = featureGroups.find((g) => g.id === group)!;
  const item = current.items[Math.min(idx, current.items.length - 1)];
  // A narrow picture sits beside its description; a wide one goes below it.
  const wide = dimensionsOf(item.shot).width >= 620;
  useEffect(() => {
    // Choosing another tool of this category should never wait for a download.
    const id = window.setTimeout(() => {
      for (const f of current.items) new Image().src = sourceOf(f.shot);
    }, 800);
    return () => window.clearTimeout(id);
  }, [current]);
  return (
    <div className="lp-explorer">
      <Tabs
        value={group}
        onValueChange={(value) => {
          setGroup(value);
          setIdx(0);
        }}
      >
        <TabsList className="lp-explorer-tabs" aria-label="功能分类">
          {featureGroups.map((g) => (
            <TabsTrigger key={g.id} value={g.id}>
              {g.name}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <div className="lp-explorer-body">
        <ul className="lp-feature-list" aria-label={`${current.name}功能`}>
          {current.items.map((f, i) => (
            <li key={f.label}>
              <button
                type="button"
                aria-pressed={i === idx}
                aria-controls="feature-detail"
                onClick={() => setIdx(i)}
              >
                <span className="lp-feature-icon">
                  <f.icon size={20} />
                </span>
                <span className="lp-feature-copy">
                  <strong>{f.label}</strong>
                </span>
                <ChevronRight size={16} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
        <section
          id="feature-detail"
          className="lp-stage"
          data-group={group}
          data-layout={wide ? "stacked" : "split"}
          key={group + item.label}
          aria-label={item.label}
        >
          <div className="lp-detail-copy">
            <h3>{item.title}</h3>
            <p>{item.text}</p>
          </div>
          <Screenshot
            file={item.shot}
            title={item.title}
            alt={item.alt}
            fade={item.fade}
            priority
          />
          <p className="lp-detail-how">
            <span>怎么用</span>
            {item.how}
          </p>
        </section>
      </div>
    </div>
  );
}
function useReveal(ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const root = ref.current;
    if (
      !root ||
      typeof IntersectionObserver === "undefined" ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    const targets = root.querySelectorAll<HTMLElement>("[data-reveal]");
    const io = new IntersectionObserver(
      (entries) =>
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.setAttribute("data-shown", "");
            io.unobserve(e.target);
          }
        }),
      { root, threshold: 0.08 },
    );
    targets.forEach((t) => {
      if (t.hasAttribute("data-shown")) return;
      t.setAttribute("data-armed", "");
      io.observe(t);
    });
    return () => io.disconnect();
  });
}
const steps = [
  ["01", "放进来", "把 PDF 拖进来，或导入 arXiv 链接。", "import.webp"],
  ["02", "问下去", "选中、框选、提问；让助手读、比、整理。", "chat.webp"],
  ["03", "留下来", "结论与来源写进笔记，随时回来继续。", "notes.webp"],
] as const;
export function ProductSite({ path }: { path: string }) {
  const container = useRef<HTMLDivElement>(null);
  const isDocs = path.startsWith("docs"),
    id = path.split("/")[1] || "start";
  const current = guides.find((g) => g.id === id) || guides[0];
  const [query, setQuery] = useState("");
  useReveal(container);
  useEffect(() => {
    document.title = isDocs
      ? `${current.title} · 纸间文档`
      : "纸间 · 开源的论文阅读工作台";
    container.current?.scrollTo({
      top:
        path === "features"
          ? (container.current.querySelector<HTMLElement>(".product-features")
              ?.offsetTop || 0) - 112
          : 0,
    });
    return () => {
      document.title = "纸间";
    };
  }, [path, isDocs, current.title]);
  return (
    <div className="product-site is-landing" ref={container}>
      <header className="product-header">
        <a href="#home" aria-label="纸间首页">
          <Brand />
        </a>
        <nav aria-label="产品导航">
          <a
            href="#features"
            aria-current={path === "features" ? "page" : undefined}
          >
            功能
          </a>
          <a href="#docs/start" aria-current={isDocs ? "page" : undefined}>
            文档
          </a>
          <Button asChild size="sm">
            <a href="#dashboard">
              进入工作台 <ArrowRight size={14} />
            </a>
          </Button>
        </nav>
      </header>
      {isDocs ? (
        <main className="product-docs">
          <aside aria-label="文档导航">
            <p className="product-eyebrow">使用文档</p>
            <div className="docs-search">
              <Search size={16} />
              <Input
                aria-label="搜索文档"
                placeholder="搜索操作指南…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <nav>
              {guides
                .filter((g) =>
                  (g.title + g.intro + g.steps.flat().join("")).includes(query),
                )
                .map((g) => (
                  <a
                    key={g.id}
                    href={`#docs/${g.id}`}
                    aria-current={current.id === g.id ? "page" : undefined}
                  >
                    {g.title}
                    <ChevronRight size={14} />
                  </a>
                ))}
            </nav>
            {query &&
              !guides.some((g) =>
                (g.title + g.intro + g.steps.flat().join("")).includes(query),
              ) && <p>没有匹配的指南</p>}
            <Button variant="outline" asChild>
              <a href="#dashboard">
                <PanelLeft size={16} />
                打开工作台
              </a>
            </Button>
          </aside>
          <article className="docs-article">
            <p className="product-eyebrow">纸间 / 使用文档</p>
            <h1>{current.title}</h1>
            <p className="docs-lead">{current.intro}</p>
            {current.steps.map(([title, text], i) => (
              <section key={title}>
                <span className="docs-step">0{i + 1}</span>
                <h2>{title}</h2>
                <p>{text}</p>
              </section>
            ))}
            <div className="docs-next">
              <span>继续阅读</span>
              {guides
                .filter((g) => g.id !== current.id)
                .slice(0, 3)
                .map((g) => (
                  <a key={g.id} href={`#docs/${g.id}`}>
                    {g.title}
                    <ArrowRight size={16} />
                  </a>
                ))}
            </div>
          </article>
        </main>
      ) : (
        <main>
          <section
            className="product-features lp-features lp-first"
            data-reveal
          >
            <div className="product-section-heading">
              <p className="lp-kicker">纸间 · 让论文成为你的知识</p>
              <h1>
                开源的论文阅读工作台，
                <br />
                <span>助手全程参与。</span>
              </h1>
              <p>
                在同一个窗口里读论文、读译文、做批注与笔记。研究助手实际读取原文来解释、比较和整理，结论带着页码，做过什么都有记录。代码开源。
              </p>
              <div className="product-cta lp-cta">
                <Button size="lg" asChild>
                  <a href="#dashboard">
                    开始阅读 <ArrowRight size={18} />
                  </a>
                </Button>
                <Button size="lg" variant="ghost" asChild>
                  <a href="#docs/start">
                    了解如何使用 <ChevronRight size={18} />
                  </a>
                </Button>
              </div>
            </div>
            <p className="lp-explorer-hint">
              选一个工具，看看它在哪里、能做什么、怎么开始。
            </p>
            <FeatureExplorer />
          </section>
          <section className="lp-agent-head" data-reveal>
            <div className="product-section-heading">
              <p className="lp-kicker">研究助手</p>
              <h2>
                助手读过原文，
                <br />
                <span>你来做判断。</span>
              </h2>
              <p>
                它实际读取原文，回答带着页码；能比较几篇论文，也能动手整理——做过什么，都看得见。
              </p>
            </div>
          </section>
          {stories.map((story, index) => (
            <StoryRow story={story} index={index} key={story.id} />
          ))}
          <section className="lp-duo" data-reveal aria-label="阅读工作台">
            <div className="product-section-heading">
              <p className="lp-kicker">围绕助手的工作台</p>
              <h2>
                读、记、积，
                <br />
                <span>都在同一个地方。</span>
              </h2>
            </div>
            <div className="lp-duo-grid">
              {duo.map((story) => (
                <DuoCard story={story} key={story.id} />
              ))}
            </div>
          </section>
          <section className="lp-details" data-reveal>
            <div className="product-section-heading">
              <p className="lp-kicker">还有这些细节</p>
              <h2>
                小地方，
                <br />
                <span>也认真做了。</span>
              </h2>
            </div>
            <div className="lp-detail-grid">
              {details.map((d) => (
                <article key={d.title}>
                  <span className="lp-detail-icon">
                    <d.icon size={20} />
                  </span>
                  <h3>{d.title}</h3>
                  <p>{d.text}</p>
                </article>
              ))}
              <article className="lp-detail-dark">
                <div>
                  <h3>深色模式</h3>
                  <p>跟随系统，或在设置里固定为浅色或深色。</p>
                </div>
                <img
                  src={sourceOf("dark.webp")}
                  alt="深色模式下的阅读器：论文页面与 AI 导读面板"
                  width={dimensionsOf("dark.webp").width}
                  height={dimensionsOf("dark.webp").height}
                  loading="lazy"
                  decoding="async"
                />
              </article>
            </div>
          </section>
          <section className="product-workflow lp-workflow" data-reveal>
            <p className="lp-kicker">一个简单的开始</p>
            <h2>不需要先搭一套知识系统。</h2>
            <div>
              {steps.map(([n, t, d, file]) => (
                <article key={n}>
                  <span>{n}</span>
                  <h3>{t}</h3>
                  <p>{d}</p>
                  <img
                    src={sourceOf(file)}
                    alt=""
                    aria-hidden="true"
                    width={dimensionsOf(file).width}
                    height={dimensionsOf(file).height}
                    loading="lazy"
                    decoding="async"
                  />
                </article>
              ))}
            </div>
          </section>
          <section className="product-faq lp-faq" data-reveal>
            <h2>开始之前，你可能想知道</h2>
            {faq.map(([q, a]) => (
              <details key={q}>
                <summary>
                  {q}
                  <ChevronRight size={18} />
                </summary>
                <p>{a}</p>
              </details>
            ))}
          </section>
          <section className="product-ending lp-ending" data-reveal>
            <BookOpen size={30} />
            <h2>下一篇论文，从这里开始。</h2>
            <Button size="lg" asChild>
              <a href="#dashboard">
                打开我的工作台 <ArrowRight size={18} />
              </a>
            </Button>
            <p>
              <Check size={14} /> 阅读 · 思考 · 积累
            </p>
          </section>
        </main>
      )}
      <footer className="product-footer">
        <Brand />
        <span>让论文成为你的知识。</span>
        <a href="#docs/start">使用文档</a>
        <a href="#home">产品首页</a>
        {!isDocs && (
          <p className="lp-footnote">
            截图均取自纸间的演示空间：公开 arXiv 论文（如 A-MEM，
            arXiv:2502.12110）版权归原作者所有；解释、翻译、导读与测验为模型的真实输出。
          </p>
        )}
      </footer>
    </div>
  );
}
