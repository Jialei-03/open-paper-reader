import { PaperPreparation } from "./PaperPreparation";
import { createPortal } from "react-dom";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "../components/ui/popover";
import { ReaderPanels } from "../lib/reader-panels";
import { ParallelTranslation } from "./ParallelTranslation";
import { ReadingActivity } from "./ReadingActivity";
import type { ReaderRequest } from "../lib/reader-agent";
import { SidebarTrigger } from "../components/ui/sidebar";
import { useAgentLayout } from "../lib/agent-layout";
import type { SuggestedHighlight } from "./PdfSuggestedHighlights";
import { PaperReadingTools } from "./PaperReadingTools";
import { PaperFigures } from "./PaperFigures";
import { ReaderDockPicker, type ReaderDock } from "./ReaderDockPicker";
import type { GroupImperativeHandle } from "react-resizable-panels";
import { CitationCards } from "./CitationCards";
import { PaperSharing } from "./PaperSharing";
import { ReadingInsights } from "./ReadingInsights";
import { askReader, type AskReader } from "../lib/reader-agent";
import { ReaderButton } from "../components/ReaderControls";
import { PdfComparison, type PdfSlot } from "./PdfComparison";
import {
  LiveNote,
  appendToNote,
  getNoteDraft,
  saveNote,
} from "../components/LiveNote";
import {
  TranslationControls,
  quoteAlignment,
  type TranslationJob,
} from "./TranslationControls";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { owningPaper } from "../lib/organization";
import { ReadingBadge } from "../components/ContentBadge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Choice } from "@/components/Choice";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PdfView } from "./PdfView";
import { useState, useEffect, useRef } from "react";
import {
  MoreHorizontal,
  Gamepad2,
  Highlighter,
  MessageSquare,
  Image as ImageIcon,
  Share2,
  LibraryBig,
  PanelRight,
  PanelLeft,
  BookOpen,
  NotebookPen,
  ListTree,
  Bot,
  Sparkles,
  Lightbulb,
  Languages,
  GraduationCap,
  Settings,
  Info,
  Plus,
  ArrowLeft,
  FileText,
  Download,
  Upload,
  Star,
  Check,
  Quote,
  Link as LinkIcon,
  Copy,
  Archive,
  Trash2,
  History,
  Edit3,
} from "lucide-react";
import {
  api,
  send,
  date,
  statusLabel,
  kindLabel,
  Paper,
  SourceFile,
  Item,
  Version,
  Locator,
  ReadingEvent,
} from "../api";
import { Markdown, Empty } from "../components/shared";
import { Modal } from "../components/Modal";
export function Reader({
  id,
  route,
  tick,
  run,
  go,
  setModal: openModal,
  close,
  editPaper,
  editItem,
  history,
  deleteItem,
  allItems,
  nodes,
  onError,
}: any) {
  const [parallelOpen, setParallelOpen] = useState(false);
  const [translationOnly, setTranslationOnly] = useState(false);
  useEffect(() => {
    setParallelOpen(false);
    setTranslationOnly(false);
  }, [id]);
  const [activityPreview, setActivityPreview] = useState<{
    file: string;
    page: number;
    quote: string;
    prefix?: string;
    emphasis?: "fill";
    rects?: { x: number; y: number; w: number; h: number }[];
  } | null>(null);
  const [exportingNote, setExportingNote] = useState(false);
  const [translationMode, setTranslationMode] = useState("original");
  const [translation, setTranslation] = useState<TranslationJob | null>(null);
  const [translatedPage, setTranslatedPage] = useState(1);
  const [suggestedByFile, setSuggestedByFile] = useState<
    Record<string, SuggestedHighlight[]>
  >({});
  const [aligned, setAligned] = useState<
    TranslationJob["alignment"][number] | null
  >(null);
  const agentLayout = useAgentLayout();
  const [auxiliary, setAuxiliary] = useState<
    | "notes"
    | "insights"
    | "citations"
    | "agent"
    | "activity"
    | "translation"
    | "quiz"
    | "annotations"
  >("notes");
  const [annotationPanelHost, setAnnotationPanelHost] =
    useState<HTMLDivElement | null>(null);
  const [translationHost, setTranslationHost] = useState<HTMLDivElement | null>(
    null,
  );
  // Showing the suggestions on the paper opens their section; hiding them again
  // never folds it away under the reader.
  const [aiHighlightsOpen, setAiHighlightsOpen] = useState(false);
  const [highlightStyle, setHighlightStyle] = useState(() => {
    try {
      return localStorage.getItem("reader-highlight-style") || "soft";
    } catch {
      return "soft";
    }
  });
  const [explanationRequest, setExplanationRequest] =
    useState<ReaderRequest | null>(null);
  useEffect(() => {
    const open = (event: Event) => {
      const request = (event as CustomEvent<ReaderRequest>).detail;
      if (request.context.paper_id !== id) return;
      agentLayout.setOpen(false);
      // Translating is not explaining: each request opens its own panel.
      setAuxiliary(
        request.context.action === "translate" ? "translation" : "activity",
      );
      setNotesOpen(true);
      setExplanationRequest(request);
      if (request.context.source === "selection") {
        setActivityPreview({
          file: request.context.file_id,
          page: request.context.page,
          quote: request.context.quote || "",
          prefix: request.context.prefix,
          rects: request.context.rects,
        });
      }
    };
    const showExplanations = () => {
      agentLayout.setOpen(false);
      setAuxiliary("activity");
      setNotesOpen(true);
    };
    window.addEventListener("open-reader-explanations", showExplanations);
    window.addEventListener("reader-explanation", open);
    return () => {
      window.removeEventListener("reader-explanation", open);
      window.removeEventListener("open-reader-explanations", showExplanations);
    };
  }, [id]);
  const [notesOpen, setNotesOpen] = useState(() => window.innerWidth > 1100);
  const [dock, setDock] = useState<ReaderDock>(() => {
    try {
      const saved = localStorage.getItem("reader-aux-dock");
      if (saved === "right" || saved === "bottom") return saved;
    } catch {
      /* Private browsing still supports an in-memory preference. */
    }
    return window.innerWidth <= 1200 ? "bottom" : "right";
  });
  const panelGroup = useRef<GroupImperativeHandle | null>(null);
  const changeDock = (value: ReaderDock) => {
    setDock(value);
    try {
      localStorage.setItem("reader-aux-dock", value);
    } catch {
      /* Keep the current layout usable without storage. */
    }
  };
  useEffect(() => {
    if (!notesOpen) return;
    const frame = requestAnimationFrame(() =>
      panelGroup.current?.setLayout(
        dock === "bottom"
          ? { document: 65, notes: 35 }
          : { document: 65, notes: 35 },
      ),
    );
    return () => cancelAnimationFrame(frame);
  }, [dock]);

  const [outlineOpen, setOutlineOpen] = useState(false);
  const previousAuxiliary = useRef<{
    kind:
      | "notes"
      | "insights"
      | "citations"
      | "activity"
      | "translation"
      | "quiz"
      | "annotations";
    open: boolean;
  }>({ kind: "notes", open: notesOpen });
  useEffect(() => {
    if (agentLayout.open && agentLayout.mode === "docked") {
      if (auxiliary !== "agent")
        previousAuxiliary.current = { kind: auxiliary, open: notesOpen };
      setAuxiliary("agent");
      setNotesOpen(true);
    } else if (auxiliary === "agent") {
      setAuxiliary(previousAuxiliary.current.kind);
      setNotesOpen(agentLayout.open && previousAuxiliary.current.open);
    }
  }, [agentLayout.open, agentLayout.mode]);
  const [toolbarHost, setToolbarHost] = useState<HTMLDivElement | null>(null);
  const [outlineHost, setOutlineHost] = useState<HTMLDivElement | null>(null);
  const [annotationHost, setAnnotationHost] = useState<HTMLDivElement | null>(
    null,
  );
  const [detailsOpen, setDetailsOpen] = useState(false);
  useEffect(() => {
    const narrow = window.matchMedia("(max-width: 1100px)");
    const adapt = () => {
      if (narrow.matches) {
        if (!agentLayout.open || agentLayout.mode !== "docked")
          setNotesOpen(false);
        setOutlineOpen(false);
      }
    };
    adapt();
    narrow.addEventListener("change", adapt);
    return () => narrow.removeEventListener("change", adapt);
  }, [agentLayout.open, agentLayout.mode]);

  useEffect(() => {
    if (translationMode !== "dual") return;
    const constrained = window.matchMedia("(max-width: 1399px)");
    const adapt = () => {
      if (
        constrained.matches &&
        (!agentLayout.open || agentLayout.mode !== "docked")
      )
        setNotesOpen(false);
    };
    adapt();
    constrained.addEventListener("change", adapt);
    return () => constrained.removeEventListener("change", adapt);
  }, [translationMode, agentLayout.open, agentLayout.mode]);

  const setModal = (content: React.ReactNode) => {
    setDetailsOpen(false);
    openModal(content);
  };
  const noteScroll = useRef<Record<string, number>>({});
  const notePanel = useRef<HTMLDivElement>(null);
  const [paper, setPaper] = useState<Paper | null>(null),
    [files, setFiles] = useState<SourceFile[]>([]),
    [versions, setVersions] = useState<Version[]>([]),
    [events, setEvents] = useState<ReadingEvent[]>([]),
    [selected, setSelected] = useState(""),
    [page, setPage] = useState(1),
    [line, setLine] = useState(1),
    [tab, setTab] = useState("summary"),
    [versionFilter, setVersionFilter] = useState(""),
    [failed, setFailed] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (notePanel.current)
        notePanel.current.scrollTop = noteScroll.current[tab] || 0;
    });
    return () => cancelAnimationFrame(frame);
  }, [tab]);
  useEffect(() => {
    setFailed(false);
    Promise.all([
      api<Paper>("/papers/" + id),
      api<SourceFile[]>("/papers/" + id + "/files"),
      api<Version[]>("/papers/" + id + "/versions"),
      api<ReadingEvent[]>("/papers/" + id + "/events"),
    ])
      .then(([p, f, v, e]) => {
        setPaper(p);
        setFiles(f);
        setVersions(v);
        setEvents(e);
        setSelected(
          (current) =>
            current ||
            f.find((x) => x.mime === "application/pdf")?.id ||
            f[0]?.id ||
            "",
        );
      })
      .catch((e) => {
        onError(e.message);
        setFailed(true);
      });
  }, [id, tick]);
  useEffect(() => {
    const q = new URLSearchParams(route.split("?")[1] || "");
    setAligned(null);
    if (q.get("note")) {
      setTab(q.get("note")!);
      setNotesOpen(true);
    }
    if (q.get("file")) {
      setSelected(q.get("file")!);
      setTranslationMode("original");
      setVersionFilter("");
      setPage(Number(q.get("page")) || 1);
      setLine(Number(q.get("line")) || 1);
    }
  }, [route]);
  const f = files.find((x) => x.id === selected);
  const items = allItems.filter(
    (i: Item) => i.paper_id === id && i.kind === "note",
  );
  const activeNote = items.find((i: Item) => i.id === tab) || items[0];
  useEffect(() => {
    if (f && suggestedByFile[f.id]) setAiHighlightsOpen(true);
  }, [f?.id, suggestedByFile]);
  const [selectionSide, setSelectionSide] = useState<string | null>(null);
  const selectCounterpart = (
    fileId: string,
    text: string,
    selectedPage: number,
  ) => {
    if (translationMode !== "dual") return;
    const unit = quoteAlignment(translation, fileId, text, selectedPage);
    setSelectionSide(fileId);
    setAligned(unit && unit.source && unit.translated ? unit : null);
    if (!unit?.source || !unit.translated || !translation) return;
    if (fileId === translation.translated_file) setPage(unit.source.page);
    else setTranslatedPage(unit.translated.page);
  };
  const linkedUnit = translation?.alignment.find(
    (u) => u.id === new URLSearchParams(route.split("?")[1]).get("unit"),
  );
  useEffect(() => {
    if (translationMode !== "dual")
      setTranslationMode(
        selected === translation?.translated_file ? "translated" : "original",
      );
  }, [selected, translation?.id]);
  const currentLocator: Locator | undefined = f
    ? {
        file_id: f.id,
        version_id: f.version_id,
        ...(f.mime === "application/pdf"
          ? { page }
          : f.mime.startsWith("text/")
            ? { line_start: line, line_end: line }
            : { label: "图像全图" }),
      }
    : undefined;
  if (!paper)
    return (
      <div className="page">
        <Button variant="ghost" type="button" onClick={() => go("library")}>
          <ArrowLeft size={16} />
          返回文库
        </Button>
        <Empty text={failed ? "论文不存在或无权访问。" : "正在打开论文…"} />
      </div>
    );
  const patch = (values: any) =>
    run(() => send("/papers/" + id, values, "PATCH", paper.revision));
  const uploadModal = () =>
    setModal(
      <Modal title="上传版本附件" close={close}>
        <p className="muted">
          PDF、图片、Markdown 与 UTF-8
          源码可预览。Office、压缩包等仅供下载；不会解压或执行源码。
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            if (
              await run(
                () =>
                  api("/papers/" + id + "/files", {
                    method: "POST",
                    body: data,
                  }),
                "附件已上传",
              )
            )
              close();
          }}
        >
          <FieldGroup className="gap-4">
            <Field>
              <FieldLabel className="flex flex-col items-start gap-2">
                论文版本
                <Choice name="version_id" defaultValue={paper.current_version}>
                  {versions.map((v) => (
                    <option value={v.id} key={v.id}>
                      {v.label}
                    </option>
                  ))}
                </Choice>
              </FieldLabel>
            </Field>
            <Field>
              <FieldLabel className="flex flex-col items-start gap-2">
                原始相对路径（可选）
                <Input name="source_path" placeholder="例如 sec/method.tex" />
              </FieldLabel>
            </Field>
            <Field>
              <FieldLabel className="flex flex-col items-start gap-2">
                文件（单个 ≤ 50 MB）
                <Input name="file" type="file" required />
              </FieldLabel>
            </Field>
            <footer>
              <Button variant="default" type="submit" className="primary">
                <Upload size={16} />
                上传附件
              </Button>
            </footer>
          </FieldGroup>
        </form>
      </Modal>,
    );
  const versionModal = () =>
    setModal(
      <Modal title="添加论文版本" close={close}>
        <p className="muted">
          旧文件和原文定位会继续指向旧版本。将匹配的 PDF
          与源码上传至同一新版本。
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const d = new FormData(e.currentTarget);
            if (
              await run(() =>
                send(
                  "/papers/" + id + "/versions",
                  { label: d.get("label"), provenance: d.get("provenance") },
                  "POST",
                  paper.revision,
                ),
              )
            )
              close();
          }}
        >
          <FieldGroup className="gap-4">
            <Field>
              <FieldLabel className="flex flex-col items-start gap-2">
                版本名
                <Input name="label" required placeholder="v2" />
              </FieldLabel>
            </Field>
            <Field>
              <FieldLabel className="flex flex-col items-start gap-2">
                来源 / 更正说明
                <Textarea name="provenance" rows={3} required />
              </FieldLabel>
            </Field>
            <footer>
              <Button variant="default" type="submit" className="primary">
                创建版本
              </Button>
            </footer>
          </FieldGroup>
        </form>
      </Modal>,
    );
  const progressModal = () =>
    setModal(
      <Modal title="确认我的阅读进度" close={close}>
        <p className="muted">
          这条记录由你确认，并追加到阅读历史。Agent 的处理状态不会替你改变进度。
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const d = new FormData(e.currentTarget);
            if (
              await run(
                () =>
                  send(
                    "/papers/" + id + "/events",
                    {
                      kind: d.get("kind"),
                      body: d.get("body"),
                      reading_status: d.get("reading_status"),
                      locator: currentLocator || null,
                    },
                    "POST",
                    paper.revision,
                  ),
                "阅读记录已保存",
              )
            )
              close();
          }}
        >
          <FieldGroup className="gap-4">
            <div className="form-row">
              <Field>
                <FieldLabel className="flex flex-col items-start gap-2">
                  我的状态
                  <Choice
                    name="reading_status"
                    defaultValue={paper.reading_status}
                  >
                    {["unread", "reading", "read"].map((s) => (
                      <option value={s} key={s}>
                        {statusLabel[s]}
                      </option>
                    ))}
                  </Choice>
                </FieldLabel>
              </Field>
              <Field>
                <FieldLabel className="flex flex-col items-start gap-2">
                  记录类型
                  <Choice name="kind">
                    <option value="reading">阅读确认</option>
                    <option value="correction">更正此前记录</option>
                  </Choice>
                </FieldLabel>
              </Field>
            </div>
            <Field>
              <FieldLabel className="flex flex-col items-start gap-2">
                已读范围 / 进度说明
                <Textarea
                  name="body"
                  required
                  rows={4}
                  placeholder="例如：已读第 1-3 页；方法部分尚待验证。"
                />
              </FieldLabel>
            </Field>
            {f && (
              <p className="muted">
                定位：{f.source_path} ·{" "}
                {f.mime === "application/pdf"
                  ? `第 ${page} 页`
                  : f.mime.startsWith("text/")
                    ? `第 ${line} 行`
                    : "图像全图"}
              </p>
            )}
            <footer>
              <Button variant="default" type="submit" className="primary">
                确认并记录
              </Button>
            </footer>
          </FieldGroup>
        </form>
      </Modal>,
    );
  const openPanel = (kind: typeof auxiliary) => {
    // The button of the panel that is showing hides it again.
    if (notesOpen && auxiliary === kind) {
      if (kind === "agent") agentLayout.setOpen(false);
      else setNotesOpen(false);
      return;
    }
    if (kind === "agent") {
      agentLayout.setMode("docked");
      agentLayout.setOpen(true);
    } else agentLayout.setOpen(false);
    setAuxiliary(kind);
    setNotesOpen(true);
  };
  const discuss = (prompt: string, explain = false) => {
    if (!f) return;
    window.dispatchEvent(
      new CustomEvent<ReaderRequest>(
        explain ? "reader-explanation" : "ask-research-agent",
        {
          detail: {
            context: {
              paper_id: id,
              file_id: f.id,
              version_id: f.version_id,
              page,
              source: "paper",
            },
            label: paper.title,
            prompt,
          },
        },
      ),
    );
  };
  // The rail lists panels by intent: understand, mark & write, look things up.
  const railGroups: [typeof auxiliary, string, typeof Sparkles][][] = [
    [
      ["agent", "AI", Sparkles],
      ["activity", "解释", Lightbulb],
      ["translation", "翻译", Languages],
    ],
    [
      ["annotations", "批注", Highlighter],
      ["notes", "笔记", NotebookPen],
    ],
    [
      ["insights", "图表", ImageIcon],
      ["citations", "引用文献", Quote],
      ["quiz", "测验", GraduationCap],
    ],
  ];
  const recordProps = {
    paperId: paper.id,
    request: explanationRequest,
    consumed: () => setExplanationRequest(null),
    onPreview: (
      value: { file: string; page: number; quote: string } | null,
    ) => {
      if (value && files.some((file) => file.id === value.file))
        setSelected(value.file);
      setActivityPreview(value as typeof activityPreview);
    },
    onLocate: (
      fileId: string,
      page: number,
      quote?: string,
      rects?: { x: number; y: number; w: number; h: number }[],
      prefix?: string,
    ) => {
      setSelected(fileId);
      setPage(page);
      setActivityPreview({
        file: fileId,
        page,
        quote: quote || "",
        rects: Array.isArray(rects) ? rects : undefined,
        prefix,
      });
      go(
        "paper/" +
          paper.id +
          "?file=" +
          fileId +
          "&page=" +
          page +
          (quote
            ? "&quote=" +
              encodeURIComponent(quote) +
              "&prefix=" +
              encodeURIComponent(prefix || "")
            : ""),
      );
    },
  };
  return (
    <ReaderPanels.Provider
      value={{
        annotationHost: annotationPanelHost,
        fileId: f?.id || "",
      }}
    >
      <div
        className="reader-page"
        data-aux-dock={dock}
        data-outline-open={outlineOpen}
        data-highlight-style={highlightStyle}
      >
        <header className="reader-browser-toolbar">
          <SidebarTrigger aria-label="切换主导航" />
          <ReaderButton
            className="reader-mobile-back"
            variant="ghost"
            size="icon"
            aria-label="返回文库"
            onClick={() => go("library")}
          >
            <ArrowLeft />
          </ReaderButton>
          <ReaderButton
            variant={outlineOpen ? "secondary" : "ghost"}
            size="icon"
            aria-label="论文目录"
            title="论文目录"
            aria-pressed={outlineOpen}
            onClick={() => setOutlineOpen(!outlineOpen)}
          >
            <ListTree />
          </ReaderButton>
          <ReaderButton
            variant="ghost"
            size="icon"
            aria-label="论文信息"
            title={paper.title}
            onClick={() => setDetailsOpen(true)}
          >
            <Info />
          </ReaderButton>
          <h1 className="sr-only">{paper.title}</h1>
          <PaperPreparation paperId={id} versionId={paper.current_version} />
          <div ref={setToolbarHost} className="reader-header-tools" />
          {f?.mime === "application/pdf" && (
            <ReaderButton
              variant="ghost"
              size="icon"
              title="分享论文"
              aria-label="分享论文"
              onClick={() =>
                setModal(
                  <PaperSharing
                    paperId={id}
                    file={f}
                    title={paper.title}
                    note={activeNote || undefined}
                    close={close}
                  />,
                )
              }
            >
              <Share2 />
            </ReaderButton>
          )}
        </header>
        <div
          className="reader-outline-panel"
          ref={setOutlineHost}
          hidden={!outlineOpen}
        />
        <nav className="reader-action-rail" aria-label="阅读侧栏工具">
          <ReaderButton
            variant="ghost"
            size="icon"
            className="rail-toggle"
            aria-label={notesOpen ? "收起阅读侧栏" : "打开阅读侧栏"}
            onClick={() => {
              if (notesOpen && auxiliary === "agent")
                agentLayout.setOpen(false);
              else setNotesOpen(!notesOpen);
            }}
          >
            <PanelRight />
          </ReaderButton>
          {railGroups.map((group, index) => (
            <div className="rail-group" key={index} role="group">
              {group.map(([kind, label, Icon]) => (
                <ReaderButton
                  key={kind}
                  variant="ghost"
                  className="rail-tab"
                  title={label}
                  aria-label={label}
                  aria-pressed={notesOpen && auxiliary === kind}
                  onClick={() => openPanel(kind)}
                >
                  <Icon />
                  <span aria-hidden="true">{label}</span>
                </ReaderButton>
              ))}
            </div>
          ))}
          <div className="rail-divider" />
          <div ref={setAnnotationHost} className="reader-annotation-host" />
        </nav>
        <TranslationControls
          host={translationHost}
          parallelOpen={parallelOpen}
          onParallelClose={() => {
            setParallelOpen(false);
            setTranslationOnly(false);
            setActivityPreview(null);
          }}
          id={id}
          versionId={paper.current_version}
          arxivId={paper.external_id}
          selectedFile={selected}
          onParallel={
            f?.mime === "application/pdf"
              ? () => {
                  setParallelOpen(true);
                  setTranslationMode("original");
                  if (window.matchMedia("(max-width: 1100px)").matches) {
                    setNotesOpen(false);
                    setOutlineOpen(false);
                  }
                }
              : undefined
          }
          mode={translationMode}
          run={run}
          go={go}
          onJobs={(jobs, updatedFiles) => {
            setTranslation(
              jobs.find(
                (j) =>
                  j.id ===
                    new URLSearchParams(route.split("?")[1]).get(
                      "translation",
                    ) && j.status === "completed",
              ) ||
                jobs.find((j) => j.status === "completed") ||
                null,
            );
            setFiles(updatedFiles);
          }}
          onMode={(mode, job) => {
            setParallelOpen(false);
            setTranslationMode(mode);
            setAligned(null);
            setSelected(
              mode === "translated" ? job.translated_file : job.source_file,
            );
            setPage(1);
          }}
          onAlign={(unit, job) => {
            setTranslationMode("dual");
            setSelected(job.source_file);
            setPage(unit.source!.page);
            setTranslatedPage(unit.translated!.page);
            setSelectionSide(null);
            setAligned(unit);
          }}
        />
        <Sheet open={detailsOpen} onOpenChange={setDetailsOpen}>
          <SheetContent className="overflow-y-auto">
            <SheetHeader>
              <SheetTitle>论文信息</SheetTitle>
            </SheetHeader>
            <div className="reader-information">
              {/* A paper with one PDF has nothing to choose: never show a file picker for it. */}
              {files.length > 1 && (
                <Field>
                  <FieldLabel>预览文件</FieldLabel>
                  <Choice
                    aria-label="预览文件"
                    value={selected}
                    onValueChange={(value) => {
                      setSelected(value);
                      setPage(1);
                      setLine(1);
                      setDetailsOpen(false);
                    }}
                  >
                    <option value="">选择附件</option>
                    {files
                      .filter(
                        (f) => !versionFilter || f.version_id === versionFilter,
                      )
                      .map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.source_path} ·{" "}
                          {versions.find((v) => v.id === f.version_id)?.label}
                        </option>
                      ))}
                  </Choice>
                </Field>
              )}
              <div className="reader-heading">
                <div>
                  <div className="eyebrow">
                    {paper.external_id || "本地论文"}
                    {versions.length > 1 && (
                      <>
                        {" "}
                        <span>·</span>{" "}
                        {
                          versions.find((v) => v.id === paper.current_version)
                            ?.label
                        }
                      </>
                    )}
                  </div>
                  <h1>{paper.title}</h1>
                  <p>{paper.authors || "作者待补充"}</p>
                  <div className="tags">
                    {paper.tags.map((t) => (
                      <span key={t}>{t}</span>
                    ))}
                  </div>
                </div>
                <div className="reader-actions">
                  <Button
                    variant="ghost"
                    type="button"
                    size="icon"
                    className={"icon " + (paper.favorite ? "gold" : "")}
                    title="收藏论文"
                    aria-label="收藏论文"
                    onClick={() => patch({ favorite: !paper.favorite })}
                  >
                    <Star
                      fill={paper.favorite ? "currentColor" : "none"}
                      size={21}
                    />
                  </Button>
                  <Button
                    variant="ghost"
                    type="button"
                    size="icon"
                    className="icon"
                    aria-label="编辑论文"
                    onClick={() => {
                      setDetailsOpen(false);
                      editPaper(paper);
                    }}
                  >
                    <Edit3 size={19} />
                  </Button>
                  <Button
                    variant="ghost"
                    type="button"
                    size="icon"
                    className="icon"
                    aria-label="论文历史"
                    onClick={() => {
                      setDetailsOpen(false);
                      history(id);
                    }}
                  >
                    <History size={19} />
                  </Button>
                  <Button
                    variant="ghost"
                    type="button"
                    size="icon"
                    className="icon"
                    aria-label={paper.archived ? "恢复论文" : "归档论文"}
                    onClick={() => {
                      if (
                        confirm(
                          paper.archived
                            ? "恢复这篇论文到文库？"
                            : "归档这篇论文？文件与笔记会保留。",
                        )
                      )
                        patch({ archived: !paper.archived });
                    }}
                  >
                    <Archive size={19} />
                  </Button>
                  <Button
                    variant="ghost"
                    type="button"
                    size="icon"
                    className="icon danger"
                    aria-label="删除论文"
                    onClick={async () => {
                      if (
                        confirm(
                          "永久删除这篇论文、文件、笔记及历史？此操作无法撤销。",
                        )
                      )
                        if (
                          await run(
                            () =>
                              api("/papers/" + id, {
                                method: "DELETE",
                                headers: {
                                  "If-Match": String(paper.revision),
                                  "X-Confirm-Delete": id,
                                },
                              }),
                            "论文已删除",
                          )
                        )
                          go("library");
                    }}
                  >
                    <Trash2 size={18} />
                  </Button>
                </div>
              </div>
              <div className="progress-strip">
                <div>
                  <ReadingBadge status={paper.reading_status} />
                  {/* "pending" is the default for every paper and tells a reader nothing. */}
                  {paper.agent_status !== "pending" && (
                    <span className="agent-status">
                      Agent · {statusLabel[paper.agent_status]}
                    </span>
                  )}
                </div>
                <div>
                  <Button
                    variant="ghost"
                    type="button"
                    onClick={() => {
                      setDetailsOpen(false);
                      progressModal();
                    }}
                  >
                    <Check size={16} />
                    记录阅读进度
                  </Button>
                  <Button
                    variant="ghost"
                    type="button"
                    onClick={() =>
                      run(async () => {
                        const data = await api("/papers/" + id + "/context");
                        const text = JSON.stringify(data, null, 2);
                        try {
                          await navigator.clipboard.writeText(text);
                        } catch {
                          setModal(
                            <Modal title="便携 Agent 上下文" close={close} wide>
                              <Textarea
                                rows={20}
                                readOnly
                                value={text}
                                onFocus={(e) => e.currentTarget.select()}
                              />
                            </Modal>,
                          );
                        }
                      }, "上下文已准备，可交给你选择的 Agent")
                    }
                  >
                    <Copy size={15} />
                    复制 Agent 上下文
                  </Button>
                </div>
              </div>
              <details className="file-list">
                <summary>高级 · 补充材料与版本</summary>
                <div className="file-list-head">
                  <Choice
                    aria-label="文件版本筛选"
                    value={versionFilter}
                    onValueChange={(value) => {
                      setVersionFilter(value);
                      const next = files.find(
                        (f) => !value || f.version_id === value,
                      );
                      setSelected(next?.id || "");
                      setPage(1);
                      setLine(1);
                    }}
                  >
                    <option value="">所有版本</option>
                    {versions.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.label}
                      </option>
                    ))}
                  </Choice>
                  <Button
                    variant="ghost"
                    type="button"
                    onClick={() => {
                      setDetailsOpen(false);
                      uploadModal();
                    }}
                  >
                    <Upload />
                    上传附件
                  </Button>
                  <Button variant="ghost" type="button" onClick={versionModal}>
                    <Plus size={15} />
                    添加版本
                  </Button>
                </div>
                {versions
                  .filter((v) => !versionFilter || v.id === versionFilter)
                  .map((v) => (
                    <div className="version-section" key={v.id}>
                      <h4>
                        {v.label} <small>{v.provenance || "未填写来源"}</small>
                      </h4>
                      {files
                        .filter((f) => f.version_id === v.id)
                        .map((f) => (
                          <div className="file-row" key={f.id}>
                            <Button
                              variant="ghost"
                              type="button"
                              onClick={() => {
                                setSelected(f.id);
                                setDetailsOpen(false);
                                setPage(1);
                                setLine(1);
                              }}
                            >
                              <FileText size={14} />
                              {f.source_path}
                            </Button>
                            <span>{(f.size / 1024).toFixed(0)} KB</span>
                            <a
                              aria-label={"下载 " + f.name}
                              href={
                                "/api/v1/files/" +
                                f.id +
                                "/content?download=true"
                              }
                            >
                              <Download size={15} />
                            </a>
                          </div>
                        ))}
                    </div>
                  ))}
              </details>
              {paper.abstract && (
                <details className="abstract">
                  <summary>原文摘要</summary>
                  <Markdown body={paper.abstract} />
                </details>
              )}
            </div>
          </SheetContent>
        </Sheet>
        <ResizablePanelGroup
          groupRef={panelGroup}
          orientation={dock === "bottom" ? "vertical" : "horizontal"}
          className="reader-layout"
        >
          <ResizablePanel
            id="document"
            className="document-panel"
            minSize="35%"
          >
            <section
              className="reader-document"
              aria-label="文件预览"
              tabIndex={0}
            >
              {linkedUnit && translation && (
                <Button
                  size="sm"
                  variant="outline"
                  className="m-2"
                  onClick={() => {
                    const toOriginal = selected === translation.translated_file;
                    const position = toOriginal
                      ? linkedUnit.source
                      : linkedUnit.translated;
                    if (!position) return;
                    const params = new URLSearchParams({
                      file: toOriginal
                        ? translation.source_file
                        : translation.translated_file,
                      page: String(position.page),
                      quote: position.quote,
                      unit: linkedUnit.id,
                      translation: translation.id,
                    });
                    go(`paper/${id}?${params}`);
                  }}
                  disabled={
                    selected === translation.translated_file
                      ? !linkedUnit.source
                      : !linkedUnit.translated
                  }
                >
                  {selected === translation.translated_file
                    ? "查看对应原文段落"
                    : "查看对应译文段落"}
                </Button>
              )}
              <div
                className="parallel-reader-workspace"
                data-only={parallelOpen && translationOnly}
              >
                <div className="parallel-reader-document">
                  <PdfComparison
                    alignmentStatus={
                      selectionSide
                        ? aligned
                          ? "已标出对应段落"
                          : "此选区未找到可靠对应"
                        : translation?.alignment.some(
                              (u) => u.source && u.translated,
                            )
                          ? "划选文字查看对应段落"
                          : "此版本暂无可靠段落对应"
                    }
                    dual={translationMode === "dual" && !!translation}
                    externalToolbarHost={toolbarHost}
                    outlineHost={outlineOpen ? outlineHost : null}
                    annotationHost={annotationHost}
                  >
                    {f ? (
                      <FilePreview
                        paperTitle={paper.title}
                        suggestedHighlights={suggestedByFile[f.id]}
                        pairSlot="original"
                        key={f.id}
                        file={f}
                        onAsk={(selection, action) =>
                          askReader(f, paper.title, selection, action)
                        }
                        region={
                          Number(
                            new URLSearchParams(route.split("?")[1]).get(
                              "page",
                            ),
                          ) === page &&
                          new URLSearchParams(route.split("?")[1]).get(
                            "file",
                          ) === f.id
                            ? new URLSearchParams(route.split("?")[1]).get(
                                "rect",
                              ) || ""
                            : ""
                        }
                        onRegion={(rect, selectedPage) => {
                          const params = new URLSearchParams({
                            file: f.id,
                            page: String(selectedPage || page),
                            rect,
                          });
                          if (activeNote) {
                            void appendToNote(
                              activeNote,
                              `\n\n[图表区域](#paper/${id}?${params})\n`,
                            );
                            agentLayout.setOpen(false);
                            setAuxiliary("notes");
                            setNotesOpen(true);
                          } else editItem("note", paper);
                        }}
                        preview={
                          activityPreview?.file === f.id
                            ? activityPreview
                            : null
                        }
                        referencePrefix={
                          aligned
                            ? ""
                            : new URLSearchParams(route.split("?")[1]).get(
                                "prefix",
                              ) || ""
                        }
                        referenceLine={new URLSearchParams(
                          route.split("?")[1],
                        ).has("line")}
                        referencePage={
                          new URLSearchParams(route.split("?")[1]).get(
                            "file",
                          ) === f.id &&
                          Number(
                            new URLSearchParams(route.split("?")[1]).get(
                              "page",
                            ),
                          ) === page
                        }
                        referenceTargetPage={
                          selectionSide !== translation?.source_file &&
                          selected === translation?.source_file
                            ? aligned?.source?.page
                            : undefined
                        }
                        reference={
                          selectionSide !== translation?.source_file &&
                          aligned?.source &&
                          selected === translation?.source_file
                            ? aligned.source.quote
                            : new URLSearchParams(route.split("?")[1]).get(
                                  "file",
                                ) === f.id &&
                                Number(
                                  new URLSearchParams(route.split("?")[1]).get(
                                    "page",
                                  ),
                                ) === page
                              ? new URLSearchParams(route.split("?")[1]).get(
                                  "quote",
                                ) || ""
                              : ""
                        }
                        page={page}
                        setPage={setPage}
                        line={line}
                        setLine={setLine}
                        onTextSelect={(text, selectedPage) =>
                          selectCounterpart(f.id, text, selectedPage)
                        }
                        onQuote={(quote, prefix, selectedPage) => {
                          const params = new URLSearchParams({
                            file: f.id,
                            page: String(selectedPage || page),
                            quote,
                            prefix: prefix || "",
                          });
                          const unit = quoteAlignment(translation, f.id, quote);
                          if (unit && translation) {
                            params.set("translation", translation.id);
                            params.set("unit", unit.id);
                          }
                          const citation = `\n\n> ${quote.replace(/\n/g, "\n> ")}\n\n[原文](#paper/${id}?${params})\n`;
                          if (activeNote) {
                            void appendToNote(activeNote, citation);
                            agentLayout.setOpen(false);
                            setAuxiliary("notes");
                            setNotesOpen(true);
                          } else editItem("note", paper);
                        }}
                      />
                    ) : (
                      <div className="document-empty">
                        <FileText size={42} />
                        <h2>从原文开始</h2>
                        <p>
                          上传 PDF 查看论文，或优先阅读 LaTeX 源码。
                          <br />
                          同一版本的文件，会与证据定位一起保留。
                        </p>
                        <Button
                          variant="default"
                          type="button"
                          className="primary"
                          onClick={uploadModal}
                        >
                          <Upload size={16} />
                          上传第一个附件
                        </Button>
                      </div>
                    )}
                    {translationMode === "dual" &&
                      translation &&
                      files.find(
                        (x) => x.id === translation.translated_file,
                      ) && (
                        <PdfView
                          paperTitle={paper.title}
                          suggestedHighlights={
                            suggestedByFile[translation.translated_file]
                          }
                          pairSlot="translated"
                          onAsk={(selection, action) =>
                            askReader(
                              files.find(
                                (x) => x.id === translation.translated_file,
                              )!,
                              paper.title,
                              selection,
                              action,
                            )
                          }
                          file={
                            files.find(
                              (x) => x.id === translation.translated_file,
                            )!
                          }
                          page={translatedPage}
                          setPage={setTranslatedPage}
                          referenceTargetPage={
                            selectionSide !== translation?.translated_file
                              ? aligned?.translated?.page
                              : undefined
                          }
                          reference={
                            selectionSide !== translation?.translated_file &&
                            aligned?.translated
                              ? aligned.translated.quote
                              : ""
                          }
                          onTextSelect={(text, selectedPage) =>
                            selectCounterpart(
                              translation.translated_file,
                              text,
                              selectedPage,
                            )
                          }
                          onQuote={(quote, prefix, selectedPage) => {
                            const params = new URLSearchParams({
                              file: translation.translated_file,
                              page: String(selectedPage || translatedPage),
                              quote,
                              prefix: prefix || "",
                            });
                            const unit = quoteAlignment(
                              translation,
                              translation.translated_file,
                              quote,
                            );
                            if (unit) {
                              params.set("translation", translation.id);
                              params.set("unit", unit.id);
                            }
                            if (activeNote) {
                              void appendToNote(
                                activeNote,
                                `\n\n> ${quote}\n\n[译文](#paper/${id}?${params})\n`,
                              );
                              agentLayout.setOpen(false);
                              setAuxiliary("notes");
                              setNotesOpen(true);
                            } else editItem("note", paper);
                          }}
                          onRegion={(rect, selectedPage) => {
                            const params = new URLSearchParams({
                              file: translation.translated_file,
                              page: String(selectedPage || translatedPage),
                              rect,
                            });
                            if (activeNote) {
                              void appendToNote(
                                activeNote,
                                `\n\n[译文图表](#paper/${id}?${params})\n`,
                              );
                              agentLayout.setOpen(false);
                              setAuxiliary("notes");
                              setNotesOpen(true);
                            } else editItem("note", paper);
                          }}
                        />
                      )}
                  </PdfComparison>
                </div>
                {parallelOpen && f?.mime === "application/pdf" && (
                  <ParallelTranslation
                    key={f.id}
                    paperId={id}
                    file={f}
                    page={page}
                    onPage={setPage}
                    onPreview={setActivityPreview}
                    only={translationOnly}
                    onOnly={setTranslationOnly}
                    onClose={() => {
                      setParallelOpen(false);
                      setTranslationOnly(false);
                      setActivityPreview(null);
                    }}
                  />
                )}
              </div>
            </section>
          </ResizablePanel>
          {notesOpen && <ResizableHandle withHandle />}
          {notesOpen && (
            <ResizablePanel
              id="notes"
              className="notes-panel"
              defaultSize={dock === "bottom" ? "35%" : "400px"}
              minSize={dock === "bottom" ? "160px" : "22%"}
            >
              {auxiliary === "agent" ? (
                <aside
                  className="reader-ai-flow reader-aux-enter"
                  aria-label="论文 AI"
                >
                  <div className="reader-panel-heading">
                    <h2>AI</h2>
                    <ReaderDockPicker value={dock} onChange={changeDock} />
                  </div>
                  <div
                    ref={agentLayout.setHost}
                    className="reader-agent-host"
                  />
                  {agentLayout.introductionHost &&
                    createPortal(
                      <>
                        {f?.mime === "application/pdf" && (
                          <ReadingInsights
                            key={f.id}
                            paperId={id}
                            file={f}
                            view="guide"
                            onLocate={setPage}
                            onKeyword={(word) =>
                              discuss(
                                `请阅读本文并解释关键词「${word}」：定义、本文中的含义和作用，以及对应原文页码。不要根据词名猜测。`,
                                false,
                              )
                            }
                          />
                        )}
                        <h3 className="reader-discussion-heading">讨论</h3>
                        <div
                          className="reader-ai-questions"
                          aria-label="推荐问题"
                        >
                          {[
                            "这篇论文的核心是什么？",
                            "与现有研究有什么不同？",
                            "有什么局限性？",
                          ].map((prompt) => (
                            <Button
                              key={prompt}
                              variant="outline"
                              size="sm"
                              onClick={() => discuss(prompt)}
                            >
                              {prompt}
                            </Button>
                          ))}
                        </div>
                      </>,
                      agentLayout.introductionHost,
                    )}
                </aside>
              ) : auxiliary === "quiz" ? (
                <aside className="notebook reader-aux-enter" aria-label="测验">
                  <div className="reader-panel-heading">
                    <h2>测验</h2>
                    <ReaderDockPicker value={dock} onChange={changeDock} />
                  </div>
                  {f?.mime === "application/pdf" ? (
                    <ReadingInsights
                      key={f.id}
                      paperId={id}
                      file={f}
                      view="quiz"
                      onLocate={setPage}
                    />
                  ) : (
                    <Empty text="请先打开一份 PDF" />
                  )}
                </aside>
              ) : auxiliary === "annotations" ? (
                <aside className="notebook reader-aux-enter" aria-label="批注">
                  <div className="reader-panel-heading">
                    <h2>批注</h2>
                    <ReaderDockPicker value={dock} onChange={changeDock} />
                  </div>
                  <div className="reader-panel-scroll">
                    {f?.mime === "application/pdf" && (
                      <details
                        className="reader-ai-highlights"
                        open={aiHighlightsOpen}
                        onToggle={(event) =>
                          setAiHighlightsOpen(event.currentTarget.open)
                        }
                      >
                        <summary>
                          <Sparkles />
                          AI 重点建议
                        </summary>
                        <Choice
                          aria-label="重点颜色方案"
                          value={highlightStyle}
                          onValueChange={(value) => {
                            setHighlightStyle(value);
                            try {
                              localStorage.setItem(
                                "reader-highlight-style",
                                value,
                              );
                            } catch {
                              /* device-only preference */
                            }
                          }}
                        >
                          <option value="soft">柔和底色</option>
                          <option value="deep">鲜明底色</option>
                          <option value="line">彩色划线</option>
                        </Choice>
                        <PaperReadingTools
                          key={f.id}
                          paperId={id}
                          file={f}
                          page={page}
                          highlightsEnabled={!!suggestedByFile[f.id]}
                          onHighlights={(value) =>
                            setSuggestedByFile((previous) => {
                              const next = { ...previous };
                              if (value) next[value.fileId] = value.highlights;
                              else delete next[f.id];
                              return next;
                            })
                          }
                          onLocate={(target, quote) => {
                            const params = new URLSearchParams({
                              file: f.id,
                              page: String(target),
                            });
                            if (quote) params.set("quote", quote);
                            go(`paper/${id}?${params}`);
                          }}
                        />
                      </details>
                    )}
                    <div
                      ref={setAnnotationPanelHost}
                      className="reader-annotations-host"
                    />
                  </div>
                </aside>
              ) : auxiliary === "citations" ? (
                <aside
                  className="notebook reader-aux-enter"
                  aria-label="引用文献"
                >
                  <div className="reader-panel-heading">
                    <h2>引用文献</h2>
                    <ReaderDockPicker value={dock} onChange={changeDock} />
                  </div>
                  <CitationCards paper={paper} />
                </aside>
              ) : auxiliary === "activity" ? (
                <aside className="notebook reader-aux-enter" aria-label="解释">
                  <div className="reader-panel-heading">
                    <h2>解释</h2>
                    <ReaderDockPicker value={dock} onChange={changeDock} />
                  </div>
                  <ReadingActivity kind="explanation" {...recordProps} />
                </aside>
              ) : auxiliary === "translation" ? (
                <aside className="notebook reader-aux-enter" aria-label="翻译">
                  <div className="reader-panel-heading">
                    <h2>翻译</h2>
                    <ReaderDockPicker value={dock} onChange={changeDock} />
                  </div>
                  <div className="reader-panel-scroll">
                    <div
                      ref={setTranslationHost}
                      className="reader-translation-host"
                    />
                    <section
                      className="translation-records"
                      aria-label="划选翻译记录"
                    >
                      <h3>划选翻译记录</h3>
                      <ReadingActivity kind="translation" {...recordProps} />
                    </section>
                  </div>
                </aside>
              ) : auxiliary === "insights" ? (
                <aside className="notebook reader-aux-enter" aria-label="图表">
                  <div className="reader-panel-heading">
                    <h2>图表</h2>
                    <ReaderDockPicker value={dock} onChange={changeDock} />
                  </div>
                  <PaperFigures
                    paper={paper}
                    files={files}
                    currentFileId={f?.id}
                    currentPage={page}
                    onLocate={(fileId, target, quote, rect) => {
                      const params = new URLSearchParams({
                        file: fileId,
                        page: String(target),
                      });
                      if (quote) params.set("quote", quote);
                      if (rect) params.set("rect", rect.join(","));
                      go(`paper/${id}?${params}`);
                    }}
                  />
                </aside>
              ) : (
                <aside
                  className="notebook reader-aux-enter"
                  aria-label="阅读笔记"
                >
                  <div className="notebook-heading">
                    <h2>笔记</h2>
                    <div className="notebook-header-actions">
                      <ReaderDockPicker value={dock} onChange={changeDock} />
                      <ReaderButton
                        variant="ghost"
                        size="icon"
                        aria-label="添加笔记"
                        onClick={() => editItem("note", paper)}
                      >
                        <Plus />
                      </ReaderButton>
                      {activeNote && (
                        <>
                          <ReaderButton
                            variant="ghost"
                            size="icon"
                            aria-label="复制笔记"
                            onClick={() =>
                              void navigator.clipboard
                                .writeText(getNoteDraft(activeNote).body)
                                .catch(() =>
                                  onError("无法复制笔记，请检查剪贴板权限。"),
                                )
                            }
                          >
                            <Copy />
                          </ReaderButton>
                          <ReaderButton
                            variant="ghost"
                            size="icon"
                            aria-label="导出笔记与图片"
                            title="导出 Markdown 与图片"
                            disabled={exportingNote}
                            onClick={async () => {
                              setExportingNote(true);
                              try {
                                const saved = await saveNote(activeNote);
                                const response = await fetch(
                                  `/api/v1/items/${saved.id}/export?revision=${saved.revision}`,
                                );
                                if (!response.ok)
                                  throw new Error(
                                    `笔记导出失败（${response.status}），请稍后重试。`,
                                  );
                                const url = URL.createObjectURL(
                                  await response.blob(),
                                );
                                const link = document.createElement("a");
                                link.href = url;
                                link.download =
                                  (saved.title || "阅读笔记") + ".zip";
                                link.click();
                                setTimeout(
                                  () => URL.revokeObjectURL(url),
                                  1000,
                                );
                              } catch (e) {
                                onError((e as Error).message);
                              } finally {
                                setExportingNote(false);
                              }
                            }}
                          >
                            <Download />
                          </ReaderButton>
                          <ReaderButton
                            variant="ghost"
                            size="icon"
                            aria-label="笔记历史"
                            onClick={() => history(activeNote.id)}
                          >
                            <History />
                          </ReaderButton>
                          {items.length > 1 && (
                            <ReaderButton
                              variant="ghost"
                              size="icon"
                              aria-label="删除笔记"
                              onClick={() => deleteItem(activeNote)}
                            >
                              <Trash2 />
                            </ReaderButton>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                  {items.length > 1 && (
                    <div className="flex flex-wrap gap-1 border-b p-2">
                      {items.map((i: Item) => (
                        <Button
                          key={i.id}
                          size="sm"
                          variant={
                            activeNote?.id === i.id ? "secondary" : "ghost"
                          }
                          onClick={() => {
                            noteScroll.current[tab] =
                              notePanel.current?.scrollTop || 0;
                            setTab(i.id);
                          }}
                        >
                          {i.title || "未命名笔记"}
                        </Button>
                      ))}
                    </div>
                  )}
                  <div className="notebook-body" tabIndex={0} ref={notePanel}>
                    {activeNote ? (
                      <article className="paper-note" data-note={activeNote.id}>
                        <LiveNote
                          key={activeNote.id}
                          note={activeNote}
                          nodes={nodes}
                        />
                      </article>
                    ) : (
                      <Button onClick={() => editItem("note", paper)}>
                        开始写笔记
                      </Button>
                    )}
                  </div>
                </aside>
              )}
            </ResizablePanel>
          )}
        </ResizablePanelGroup>
      </div>
    </ReaderPanels.Provider>
  );
}
function FilePreview({
  paperTitle,
  preview,
  onTextSelect,
  suggestedHighlights,
  pairSlot,
  onAsk,
  region = "",
  onRegion,
  referenceLine = false,
  referencePrefix = "",
  referencePage = false,
  referenceTargetPage,
  reference = "",
  file,
  page,
  setPage,
  line,
  setLine,
  onQuote,
}: {
  paperTitle?: string;
  preview?: {
    page: number;
    quote: string;
    prefix?: string;
    emphasis?: "fill";
    rects?: { x: number; y: number; w: number; h: number }[];
  } | null;
  onTextSelect?: (text: string, page: number) => void;
  suggestedHighlights?: SuggestedHighlight[];
  pairSlot?: PdfSlot;
  onAsk?: AskReader;
  onQuote: (quote: string, prefix?: string, page?: number) => void;
  region?: string;
  onRegion?: (rect: string, page?: number) => void;
  referencePrefix?: string;
  reference?: string;
  referencePage?: boolean;
  referenceTargetPage?: number;
  referenceLine?: boolean;
  file: SourceFile;
  page: number;
  setPage: (n: number) => void;
  line: number;
  setLine: (n: number) => void;
}) {
  const [text, setText] = useState(""),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    setError("");
    setLoading(true);
    const ac = new AbortController();
    if (file.mime.startsWith("text/")) {
      fetch("/api/v1/files/" + file.id + "/content", { signal: ac.signal })
        .then(async (r) => {
          if (!r.ok) throw new Error("文件加载失败");
          return r.text();
        })
        .then(setText)
        .catch((e) => {
          if (e.name !== "AbortError") setError(e.message);
        })
        .finally(() => setLoading(false));
    } else setLoading(false);
    return () => ac.abort();
  }, [file.id]);
  if (file.mime === "application/pdf")
    return (
      <PdfView
        paperTitle={paperTitle}
        sourcePreview={preview}
        onTextSelect={onTextSelect}
        suggestedHighlights={suggestedHighlights}
        pairSlot={pairSlot}
        onAsk={onAsk}
        file={file}
        page={page}
        setPage={setPage}
        onQuote={onQuote}
        reference={reference}
        referencePage={referencePage}
        referenceTargetPage={referenceTargetPage}
        referencePrefix={referencePrefix}
        region={region}
        onRegion={onRegion}
      />
    );
  if (loading) return <Empty text="正在加载源文件…" />;
  if (error)
    return (
      <Alert variant="destructive" className="my-3">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  if (file.mime.startsWith("image/"))
    return (
      <div className="image-preview">
        <img
          alt={file.source_path}
          src={"/api/v1/files/" + file.id + "/content"}
          onError={() => setError("图片加载失败")}
        />
      </div>
    );
  if (file.mime === "text/markdown")
    return (
      <div className="markdown-preview">
        <Markdown body={text} />
        <details open={referenceLine}>
          <summary>按行查看源码与定位</summary>
          <SourceText text={text} line={line} setLine={setLine} />
        </details>
      </div>
    );
  if (file.mime === "text/plain")
    return (
      <div>
        <div className="source-toolbar">
          <span>UTF-8 源码 · 点击行号定位</span>
          <label>
            行{" "}
            <Input
              aria-label="源码行号"
              type="number"
              min={1}
              max={text.split("\n").length}
              value={line}
              onChange={(e) =>
                setLine(
                  Math.max(
                    1,
                    Math.min(
                      text.split("\n").length,
                      Number(e.target.value) || 1,
                    ),
                  ),
                )
              }
            />
          </label>
        </div>
        <SourceText text={text} line={line} setLine={setLine} />
      </div>
    );
  return (
    <div className="document-empty">
      <FileText size={36} />
      <h3>此格式暂不支持预览</h3>
      <p>
        Office、压缩包、HTML、SVG 等以原始附件保存。
        <br />
        你可以下载后使用合适的软件打开。
      </p>
      <a
        className="primary"
        href={"/api/v1/files/" + file.id + "/content?download=true"}
      >
        <Download size={16} />
        下载原文件
      </a>
    </div>
  );
}
function SourceText({
  text,
  line,
  setLine,
}: {
  text: string;
  line: number;
  setLine: (n: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current
      ?.querySelector(`[data-line="${line}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [line]);
  // Cap DOM size, while preserving real line numbers and allowing navigation to all lines.
  const lines = text.split("\n"),
    start = Math.max(0, line - 101),
    end = Math.min(lines.length, Math.max(400, line + 200));
  return (
    <div className="source-text" ref={ref}>
      {start > 0 && (
        <div className="muted">前 {start} 行已折叠，可通过行号导航。</div>
      )}
      {lines.slice(start, end).map((s, i) => (
        <div
          key={start + i}
          data-line={start + i + 1}
          className={line === start + i + 1 ? "selected-line" : ""}
        >
          <Button
            variant="ghost"
            type="button"
            size="icon"
            aria-label={"选择第 " + (start + i + 1) + " 行"}
            onClick={() => setLine(start + i + 1)}
          >
            {start + i + 1}
          </Button>
          <code>{s || " "}</code>
        </div>
      ))}
      {end < lines.length && (
        <div className="muted">
          共 {lines.length} 行，通过行号导航查看后续内容。
        </div>
      )}
    </div>
  );
}
