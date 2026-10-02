import { AgentReferencePicker } from "./AgentReferencePicker";
import type { Paper } from "../api";
import { createPortal } from "react-dom";
import { useAgentLayout } from "../lib/agent-layout";
import { selectPaperSession } from "../lib/reader-agent";
import type { ReaderRequest, ReaderContext } from "../lib/reader-agent";
import { Presence } from "@radix-ui/react-presence";
import type { InferenceModel } from "./ModelOptions";
import { QuickModelPicker } from "./QuickModelPicker";
import { AgentImages, type AgentImage } from "./AgentImages";
import { ChatAttachments } from "./ChatAttachments";
import { useFloatingWindow } from "../lib/use-floating-window";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Bot,
  Plus,
  Send,
  ArrowUp,
  Square,
  Settings2,
  Pencil,
  Trash2,
  X,
  Maximize,
  Minimize2,
  Expand,
  ListChecks,
  Paperclip,
  PanelRight,
  AppWindow,
} from "lucide-react";
import { api, send } from "../api";
import { Empty } from "../components/shared";
import { StreamingMarkdown } from "../components/StreamingMarkdown";
import { Choice } from "../components/Choice";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuCheckboxItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Message,
  MessageContent,
  MessageHeader,
} from "@/components/ui/message";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import {
  MessageScrollerProvider,
  MessageScroller,
  MessageScrollerViewport,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerButton,
} from "@/components/ui/message-scroller";

type ChatAttachment = {
  id: string;
  name: string;
  mime: string;
  size: number;
  pages?: number | null;
  url: string;
};
type Session = { id: string; title: string };
type Run = {
  id: string;
  prompt: string;
  response: string;
  status: string;
  model: string;
  error: string;
  writable: boolean;
  runtime?: {
    reader_context?: ReaderContext & { source_url: string; file_name: string };
    since?: string;
    resume_from?: string;
    resumed_by?: string;
    phase?: string;
    waiting_seconds?: number;
    execution_seconds?: number;
  };
  attachments?: ChatAttachment[];
  steps: {
    name: string;
    reused?: boolean;
    label: string;
    status: string;
    arguments: unknown;
    result?: unknown;
    images?: AgentImage[];
    files?: ChatAttachment[];
    receipt?: {
      entity_type: string;
      state: string;
      verification: string;
      url: string;
    };
    vision_delivered?: boolean;
    error?: string;
  }[];
};
type Model = InferenceModel & {
  id: string;
  name: string;
  model: string;
  vision?: boolean;
  shared?: boolean;
};
const running = (r: Run) => ["queued", "running"].includes(r.status);
const waiting = (r: Run) =>
  r.status === "queued" ||
  (r.status === "running" && r.runtime?.phase === "waiting_model");
const status: Record<string, string> = {
  queued: "等待执行",
  running: "执行中",
  completed: "对话结束",
  failed: "执行失败",
  cancelled: "已停止",
};
const phases: Record<string, string> = {
  preparing: "准备中",
  waiting_model: "等待模型名额",
  model: "模型生成中",
  tool: "执行工具",
};
function runLabel(r: Run) {
  return r.status === "running"
    ? phases[r.runtime?.phase || ""] || status.running
    : status[r.status];
}
function elapsed(r: Run) {
  if (
    !r.runtime?.since &&
    !r.runtime?.execution_seconds &&
    !r.runtime?.waiting_seconds
  )
    return "";
  const seconds = (n = 0) =>
    n >= 60
      ? `${Math.floor(n / 60)}分${Math.floor(n % 60)}秒`
      : `${Math.floor(n)}秒`;
  const waiting = r.runtime.waiting_seconds || 0;
  return ` · 执行 ${seconds(r.runtime.execution_seconds)}${waiting >= 1 ? ` · 等待 ${seconds(waiting)}` : ""}`;
}
export function AgentPanel({
  userId,
  route,
  refresh,
}: {
  userId: string;
  route: string;
  refresh: () => void;
}) {
  const { open, setOpen, mode, setMode, host, setIntroductionHost } =
    useAgentLayout();
  const paperId = route.match(/^paper\/([^?]+)/)?.[1] || "";
  const paperMode = !!paperId;
  const [paperSession, setPaperSession] = useState("");
  const docked = mode === "docked";
  const globalHost = useRef<HTMLDivElement>(null);
  const [surface] = useState(() => document.createElement("div"));
  useLayoutEffect(() => {
    const target = docked && host ? host : globalHost.current;
    surface.className = "agent-surface";
    target?.appendChild(surface);
    return () => {
      surface.remove();
    };
  }, [docked, host, surface]);
  const launcher = useRef<HTMLButtonElement>(null);
  const windowElement = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    if (!open && windowElement.current?.contains(document.activeElement))
      [
        ...document.querySelectorAll<HTMLButtonElement>(
          'button[aria-label="打开研究助手"], button[aria-label="研究助手"]',
        ),
      ]
        .find((button) => button.getClientRects().length)
        ?.focus();
  }, [open]);
  const floating = useFloatingWindow("agent-window:" + userId);
  const [capabilities, setCapabilities] = useState(false);
  const [catalog, setCatalog] = useState<{
    tools: {
      name: string;
      label: string;
      description: string;
      write: boolean;
    }[];
    limits: string[];
  } | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selected, setSelected] = useState(
    () => localStorage.getItem("agent-session:" + userId) || "",
  );
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [models, setModels] = useState<Model[]>([]);
  const [model, setModel] = useState("");
  const [runs, setRuns] = useState<Run[]>([]);
  const [comparisonDraft, setComparisonDraft] = useState<string | null>(null);
  const [readerRequest, setReaderRequest] = useState<ReaderRequest | null>(
    null,
  );
  useEffect(() => {
    setReaderRequest((request) =>
      request?.context.paper_id === paperId ? request : null,
    );
  }, [paperId]);
  const [referenceDrafts, setReferenceDrafts] = useState<
    Record<string, Paper[]>
  >({});
  const references = referenceDrafts[selected] || [];
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const contextualDrafts = useRef(
    new Map<
      string,
      { reader: ReaderRequest | null; comparison: string | null }
    >(),
  );
  const requestedSession = useRef<{ id: string; paperId: string } | null>(null);
  const currentPaper = useRef(paperId);
  currentPaper.current = paperId;
  const switchSession = (id: string, discard = false) => {
    requestedSession.current = null;
    if (!discard && (readerRequest || comparisonDraft !== null))
      contextualDrafts.current.set(selected, {
        reader: readerRequest,
        comparison: comparisonDraft,
      });
    else contextualDrafts.current.delete(selected);
    const saved = contextualDrafts.current.get(id);
    setReaderRequest(saved?.reader || null);
    setComparisonDraft(saved?.comparison ?? null);
    setSelected(id);
    if (paperId) {
      selectPaperSession(paperId, id);
      localStorage.setItem(`agent-paper-session:${userId}:${paperId}`, id);
    }
  };

  const [jump, setJump] = useState<{ sessionId: string; runId: string } | null>(
    null,
  );
  const switchSessionRef = useRef(switchSession);
  switchSessionRef.current = switchSession;
  const locatedRun = useRef("");
  useEffect(() => {
    if (
      !open ||
      !jump ||
      jump.sessionId !== selected ||
      !runs.some((row) => row.id === jump.runId) ||
      locatedRun.current === jump.runId
    )
      return;
    const frame = requestAnimationFrame(() => {
      const element = document.querySelector(
        `[data-agent-run="${CSS.escape(jump.runId)}"]`,
      );
      if (element) {
        element.scrollIntoView({ block: "start", behavior: "instant" });
        locatedRun.current = jump.runId;
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [open, jump, selected, runs]);
  const [error, setError] = useState("");
  const [fileDrafts, setFileDrafts] = useState<
    Record<string, ChatAttachment[]>
  >({});
  const files = fileDrafts[selected] || [];
  const setFiles = (
    update: ChatAttachment[] | ((old: ChatAttachment[]) => ChatAttachment[]),
  ) =>
    setFileDrafts((old) => ({
      ...old,
      [selected]:
        typeof update === "function" ? update(old[selected] || []) : update,
    }));
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadBusy = useRef(false);
  const [connectionError, setConnectionError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadedSession, setLoadedSession] = useState("");
  const submittedRequests = useRef(new WeakSet<ReaderRequest>());
  const [writable, setWritable] = useState(true);
  const [rename, setRename] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const generation = useRef(0);
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const activeRuns = runs.filter(running);
  const active = activeRuns[0];
  const draft =
    readerRequest?.prompt ?? comparisonDraft ?? drafts[selected] ?? "";
  const setDraft = (text: string) => {
    if (readerRequest)
      setReaderRequest((r) => (r ? { ...r, prompt: text, submit: false } : r));
    else if (comparisonDraft !== null) setComparisonDraft(text);
    else setDrafts((d) => ({ ...d, [selected]: text }));
  };
  const clearReaderContext = () => {
    if (readerRequest)
      setDrafts((d) => ({ ...d, [selected]: readerRequest.prompt }));
    setReaderRequest(null);
  };
  const fail = (e: unknown) => setError((e as Error).message);
  async function loadSessions() {
    const rows = await api<Session[]>(
      paperId ? `/agent/sessions?paper_id=${paperId}` : "/agent/sessions",
    );
    setSessions(rows);
    return rows;
  }
  useEffect(() => {
    const shortcut = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const show = (event: Event) => {
      const target = (
        event as CustomEvent<{ sessionId?: string; runId?: string }>
      ).detail;
      if (target?.sessionId && target.runId) {
        locatedRun.current = "";
        setMode("floating");
        switchSessionRef.current(target.sessionId);
        requestedSession.current = {
          id: target.sessionId,
          paperId: currentPaper.current,
        };
        setJump({ sessionId: target.sessionId, runId: target.runId });
      }
      setOpen(true);
    };
    const ask = (event: Event) => {
      requestedSession.current = null;
      setComparisonDraft(null);
      const request = (event as CustomEvent<ReaderRequest>).detail;
      setReaderRequest(request);
      if (request.submit) setMode("docked");
      setCapabilities(false);
      setOpen(true);
    };
    const compare = (event: Event) => {
      const { prompt } = (event as CustomEvent<{ prompt: string }>).detail;
      setReaderRequest(null);
      setComparisonDraft(prompt);
      setCapabilities(false);
      setOpen(true);
    };
    window.addEventListener("compare-research-papers", compare);
    window.addEventListener("ask-research-agent", ask);
    window.addEventListener("open-research-agent", show);
    window.addEventListener("keydown", shortcut);
    return () => {
      window.removeEventListener("compare-research-papers", compare);
      window.removeEventListener("ask-research-agent", ask);
      window.removeEventListener("keydown", shortcut);
      window.removeEventListener("open-research-agent", show);
    };
  }, []);
  useEffect(() => {
    if (!open) return;
    let live = true;
    setPaperSession("");
    api<typeof catalog>("/agent/capabilities")
      .then((value) => {
        if (live) setCatalog(value);
      })
      .catch(fail);
    Promise.all([
      api<Session[]>(
        paperId ? `/agent/sessions?paper_id=${paperId}` : "/agent/sessions",
      ),
      api<{ models: Model[]; active_id: string }>("/translation-settings"),
      paperMode
        ? send(`/papers/${paperId}/discussion`, {})
        : Promise.resolve(null),
    ])
      .then(([rows, cfg, discussion]) => {
        if (!live) return;
        setSessions(
          discussion
            ? [discussion, ...rows.filter((s) => s.id !== discussion.id)]
            : rows,
        );
        setModels(cfg.models);
        setModel((m) =>
          cfg.models.some((x) => x.id === m) ? m : cfg.active_id,
        );
        const requested =
          requestedSession.current?.paperId === paperId
            ? requestedSession.current.id
            : "";
        requestedSession.current = null;
        if (discussion) {
          setPaperSession(discussion.id);
          const remembered = localStorage.getItem(
            `agent-paper-session:${userId}:${paperId}`,
          );
          const id =
            requested ||
            (rows.some((s) => s.id === remembered)
              ? remembered!
              : discussion.id);
          setSelected(id);
          selectPaperSession(paperId, id);
        } else
          setSelected(
            (s) =>
              requested ||
              (rows.some((x) => x.id === s) ? s : rows[0]?.id || ""),
          );
      })
      .catch(fail);
    return () => {
      live = false;
    };
  }, [open, paperId, paperMode]);
  useEffect(() => {
    const refresh = () => {
      api<{ models: Model[] }>("/translation-settings")
        .then((cfg) => setModels(cfg.models))
        .catch(fail);
    };
    window.addEventListener("model-settings-updated", refresh);
    return () => window.removeEventListener("model-settings-updated", refresh);
  }, []);
  useEffect(() => {
    if (!open || !selected || (paperMode && !paperSession)) {
      setLoadedSession("");
      setRuns([]);
      setConnectionError("");
      return;
    }
    localStorage.setItem("agent-session:" + userId, selected);
    const version = ++generation.current;
    let cancelled = false,
      timer: ReturnType<typeof setTimeout>;
    let wasActive = false;
    let firstLoad = true;
    setLoading(true);
    setLoadedSession("");
    setRuns([]);
    setConnectionError("");
    setError("");
    setRename(null);
    setDeleting(false);
    async function poll() {
      try {
        const rows = await api<Run[]>(`/agent/sessions/${selected}/runs`);
        if (cancelled || version !== generation.current) return;
        setRuns(rows);
        setLoadedSession(selected);
        setConnectionError("");
        if (firstLoad) {
          if (rows.length) setWritable(rows[rows.length - 1].writable);
          refreshRef.current();
          firstLoad = false;
        }
        setLoading(false);
        const nowActive = rows.some(running);
        if (wasActive && !nowActive) refreshRef.current();
        wasActive = nowActive;
        timer = setTimeout(poll, nowActive ? 700 : 3000);
      } catch (e) {
        if (!cancelled) {
          setConnectionError("连接暂时中断，正在重试；已有消息和任务会保留。");
          setLoading(false);
          timer = setTimeout(poll, 5000);
        }
      }
    }
    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [selected, open, userId, paperMode, paperSession]);
  async function create() {
    setBusy(true);
    setError("");
    try {
      const s = await send(
        "/agent/sessions",
        paperId ? { paper_id: paperId } : {},
      );
      await loadSessions();
      switchSession(s.id);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  async function uploadFiles(incoming: File[]) {
    if (uploadBusy.current || !incoming.length) return;
    if (files.length + incoming.length > 5) {
      setError("每条消息最多 5 个附件");
      return;
    }
    uploadBusy.current = true;
    setUploading(true);
    setError("");
    try {
      for (const file of incoming) {
        if (file.size > 20 * 1024 * 1024) throw new Error("单个附件最多 20 MB");
        const form = new FormData();
        form.append("file", file);
        const attachment = await api<ChatAttachment>("/agent/attachments", {
          method: "POST",
          body: form,
        });
        setFiles((old) =>
          old.some((f) => f.id === attachment.id) ? old : [...old, attachment],
        );
      }
    } catch (e) {
      fail(e);
    } finally {
      uploadBusy.current = false;
      setUploading(false);
    }
  }
  // Inline selection questions are explicit sends; wait for this paper's
  // canonical conversation to load so they cannot land in a previous session.
  useEffect(() => {
    if (
      !readerRequest?.submit ||
      !open ||
      !model ||
      !paperMode ||
      !paperSession ||
      loadedSession !== selected ||
      busy ||
      loading ||
      uploading ||
      settingsSaving ||
      submittedRequests.current.has(readerRequest)
    )
      return;
    submittedRequests.current.add(readerRequest);
    void submit(readerRequest);
  }, [
    readerRequest,
    open,
    model,
    paperMode,
    selected,
    paperSession,
    loadedSession,
    busy,
    loading,
    uploading,
    settingsSaving,
  ]);
  async function submit(direct?: ReaderRequest) {
    const submittedDraft = direct?.prompt ?? draft;
    setJump(null);
    if (
      (!submittedDraft.trim() && !files.length) ||
      !model ||
      busy ||
      loading ||
      uploading ||
      settingsSaving ||
      (paperMode && !paperSession)
    )
      return;
    const referenceContext =
      !direct && references.length
        ? "\n\n参考论文（请用工具读取实际内容后引用）：\n" +
          references
            .map((p) => `${p.title.slice(0, 240)} · 论文 ID: ${p.id}`)
            .join("\n")
        : "";
    const prompt =
      (submittedDraft.trim() || "请阅读并概括这些附件。") + referenceContext;
    if (prompt.length > 12000) {
      setError("消息与参考论文合计不能超过 12000 字，请缩短消息。");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const id = selected || (await send("/agent/sessions", {})).id;
      const r = await send(`/agent/sessions/${id}/runs`, {
        prompt,
        attachment_ids: direct ? [] : files.map((f) => f.id),
        model_config_id: model,
        context: route.slice(0, 200),
        reader_context: direct?.context ?? readerRequest?.context,
        writable,
      });
      if (!direct) {
        setDrafts((d) =>
          d[selected] === draft ? { ...d, [selected]: "" } : d,
        );
        setComparisonDraft((current) =>
          current === comparisonDraft ? null : current,
        );
      }
      setReaderRequest((current) =>
        current === readerRequest ? null : current,
      );
      if (!direct) {
        setFiles([]);
        setReferenceDrafts((previous) => ({ ...previous, [selected]: [] }));
      }
      setSelected(id);
      setRuns((old) => [...old, r]);
      await loadSessions();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  async function resume(run: Run) {
    if (!model || busy || settingsSaving) return;
    setBusy(true);
    setError("");
    try {
      const next = await send(`/agent/sessions/${selected}/runs`, {
        prompt: run.prompt,
        model_config_id: model,
        writable,
        resume_run_id: run.id,
      });
      setRuns((old) => [...old.filter((r) => r.id !== next.id), next]);
      await loadSessions();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  async function changeTitle() {
    if (!rename?.trim()) return;
    try {
      await send(
        `/agent/sessions/${selected}`,
        { title: rename.trim() },
        "PATCH",
      );
      await loadSessions();
      setRename(null);
    } catch (e) {
      fail(e);
    }
  }
  async function remove() {
    try {
      await api(`/agent/sessions/${selected}`, { method: "DELETE" });
      let rows = await loadSessions();
      if (paperId && !rows.length) {
        const replacement = await send(`/papers/${paperId}/discussion`, {});
        setPaperSession(replacement.id);
        rows = await loadSessions();
      }
      switchSession(rows[0]?.id || "", true);
      setDeleting(false);
    } catch (e) {
      fail(e);
    }
  }
  return (
    <>
      <Button
        ref={launcher}
        className="agent-launcher"
        variant="secondary"
        onClick={() => setOpen(true)}
        aria-label="打开研究助手"
        title="研究助手 · ⌘/Ctrl J"
      >
        <Bot data-icon="inline-start" />
        Agent
      </Button>
      <div
        ref={globalHost}
        className={docked ? "agent-global-dock" : "agent-global-float"}
        data-open={open && !(docked && host)}
      />
      {createPortal(
        <Presence present={open}>
          <section
            ref={windowElement}
            role="dialog"
            aria-modal="false"
            aria-label="研究助手"
            className={
              docked
                ? "agent-panel agent-docked"
                : "agent-panel agent-floating-window"
            }
            data-state={open ? "open" : "closed"}
            inert={!open}
            aria-hidden={!open}
            onPointerDownCapture={(e) => {
              e.currentTarget
                .getAnimations()
                .forEach((animation) => animation.finish());
            }}
            data-compact={!docked && floating.compact}
            style={
              docked
                ? undefined
                : {
                    left: floating.rect.x,
                    top: floating.rect.y,
                    width: floating.rect.width,
                    height: floating.rect.height,
                  }
            }
            onClick={(e) => {
              if ((e.target as HTMLElement).closest('a[href^="#"]')) {
                refresh();
              }
            }}
          >
            <header
              hidden={paperMode && docked}
              className="agent-window-title"
              tabIndex={0}
              aria-label={docked ? "研究助手标题栏" : "移动研究助手窗口"}
              onPointerDown={docked ? undefined : (e) => floating.start(e)}
              onPointerMove={docked ? undefined : floating.move}
              onPointerUp={floating.end}
              onPointerCancel={floating.end}
              onKeyDown={docked ? undefined : (e) => floating.keyboard(e)}
            >
              <h2>{docked && host ? "讨论" : "研究助手"}</h2>
              <Button
                variant="ghost"
                size="icon"
                aria-label={docked ? "切换为悬浮窗" : "停靠到侧栏"}
                title={docked ? "切换为悬浮窗" : "停靠到侧栏"}
                onClick={() => setMode(docked ? "floating" : "docked")}
              >
                {docked ? <AppWindow /> : <PanelRight />}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label="能力范围"
                aria-pressed={capabilities}
                onClick={() => setCapabilities((v) => !v)}
              >
                <ListChecks />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                hidden={docked}
                aria-label={floating.compact ? "恢复常规窗口" : "紧凑窗口"}
                title={floating.compact ? "恢复常规窗口" : "紧凑窗口"}
                aria-pressed={floating.compact}
                onClick={floating.toggleCompact}
              >
                {floating.compact ? <Expand /> : <Minimize2 />}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                hidden={docked}
                aria-label="重置窗口位置和大小"
                onClick={floating.reset}
              >
                <Maximize />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label="收起研究助手"
                onClick={() => setOpen(false)}
              >
                <X />
              </Button>
            </header>
            {capabilities && (
              <div className="agent-capabilities">
                <h3>可以帮你做什么</h3>
                {[
                  ["管理论文", "导入、整理、收藏和删除论文。"],
                  ["阅读与笔记", "阅读 PDF、理解图表，整理和修改笔记。"],
                  ["搜索与翻译", "查找公开论文、下载文件，发起全文翻译。"],
                  ["分析与文件", "运行 Python、处理资料，导出结果。"],
                ].map(([title, description]) => (
                  <div key={title}>
                    <strong>{title}</strong>
                    <p>{description}</p>
                  </div>
                ))}
                <details className="mt-4">
                  <summary>查看工具详情</summary>
                  {catalog?.tools.map((t) => (
                    <p key={t.name}>{t.label}</p>
                  ))}
                </details>
              </div>
            )}
            <div className="agent-chat-body" hidden={capabilities}>
              <div className="agent-session-controls">
                <Choice
                  key={sessions.map((s) => s.id + s.title).join(":")}
                  aria-label="Agent 会话"
                  value={selected}
                  onValueChange={(id) => switchSession(id)}
                  disabled={busy}
                >
                  {!sessions.length && <option value="">新会话</option>}
                  {selected && !sessions.some((s) => s.id === selected) && (
                    <option value={selected}>历史会话</option>
                  )}
                  {sessions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.title}
                    </option>
                  ))}
                </Choice>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="新建 Agent 会话"
                  onClick={create}
                  disabled={busy}
                >
                  <Plus />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="重命名会话"
                  disabled={!selected || busy}
                  onClick={() =>
                    setRename(
                      sessions.find((s) => s.id === selected)?.title || "",
                    )
                  }
                >
                  <Pencil />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="删除会话"
                  disabled={!selected || !!active || busy}
                  onClick={() => setDeleting(true)}
                >
                  <Trash2 />
                </Button>
              </div>
              {rename !== null && (
                <form
                  className="agent-session-controls"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void changeTitle();
                  }}
                >
                  <Input
                    aria-label="会话名称"
                    value={rename}
                    maxLength={100}
                    onChange={(e) => setRename(e.target.value)}
                  />
                  <Button type="submit" size="sm">
                    保存名称
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setRename(null)}
                  >
                    取消
                  </Button>
                </form>
              )}
              {deleting && (
                <Alert>
                  <AlertDescription>
                    删除此会话的聊天记录？文库中的论文和笔记会保留。
                    <div className="flex gap-2">
                      <Button size="sm" variant="destructive" onClick={remove}>
                        确认删除会话
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setDeleting(false)}
                      >
                        取消
                      </Button>
                    </div>
                  </AlertDescription>
                </Alert>
              )}
              <div className="agent-conversation">
                <MessageScrollerProvider
                  key={selected}
                  autoScroll={
                    !(paperMode && docked) && jump?.sessionId !== selected
                  }
                >
                  <MessageScroller>
                    <MessageScrollerViewport>
                      <MessageScrollerContent className="gap-5 p-4">
                        {paperMode && (
                          <div
                            ref={setIntroductionHost}
                            className="reader-ai-introduction"
                          />
                        )}
                        {!runs.length && !paperMode && (
                          <MessageScrollerItem messageId="empty">
                            <Empty
                              text={
                                loading
                                  ? "正在读取会话…"
                                  : "告诉我你想处理哪篇论文，或从整理文库开始。"
                              }
                            />
                          </MessageScrollerItem>
                        )}
                        {runs.flatMap((r) => [
                          <MessageScrollerItem
                            key={r.id + "u"}
                            messageId={r.id + "u"}
                            scrollAnchor
                          >
                            <Message align="end">
                              <MessageContent>
                                <Bubble variant="secondary">
                                  <BubbleContent>
                                    <p className="whitespace-pre-wrap">
                                      {r.prompt}
                                    </p>
                                    {r.runtime?.reader_context && (
                                      <Button variant="link" size="sm" asChild>
                                        <a
                                          href={
                                            r.runtime.reader_context.source ===
                                            "paper"
                                              ? `#paper/${r.runtime.reader_context.paper_id}?file=${r.runtime.reader_context.file_id}`
                                              : r.runtime.reader_context
                                                  .source_url
                                          }
                                        >
                                          {r.runtime.reader_context.source ===
                                          "paper"
                                            ? "论文来源"
                                            : `阅读来源 · 第 ${r.runtime.reader_context.page} 页`}
                                        </a>
                                      </Button>
                                    )}
                                    {!!r.attachments?.length && (
                                      <div className="pt-2">
                                        <ChatAttachments
                                          files={r.attachments}
                                        />
                                      </div>
                                    )}
                                  </BubbleContent>
                                </Bubble>
                              </MessageContent>
                            </Message>
                          </MessageScrollerItem>,
                          <MessageScrollerItem
                            key={r.id}
                            messageId={r.id}
                            data-agent-run={r.id}
                          >
                            <Message>
                              <MessageContent>
                                <MessageHeader
                                  title={
                                    waiting(r)
                                      ? `等待服务响应${elapsed(r)}`
                                      : undefined
                                  }
                                >
                                  {r.model}
                                  {r.runtime?.resume_from ? " · 续接" : ""}
                                  {!waiting(r) && (
                                    <>
                                      {" "}
                                      · {runLabel(r)}
                                      {elapsed(r)}
                                    </>
                                  )}
                                </MessageHeader>
                                {r.steps.length > 0 && (
                                  <details className="agent-steps">
                                    <summary>
                                      {r.steps.length} 项操作
                                      {running(r)
                                        ? " · " + r.steps.at(-1)?.label
                                        : ""}
                                    </summary>
                                    {r.steps.map((s, i) => (
                                      <details key={i}>
                                        <summary>
                                          {s.label} ·{" "}
                                          {s.reused
                                            ? "已完成，未重复执行"
                                            : s.status === "completed"
                                              ? "完成"
                                              : s.status === "failed"
                                                ? "失败"
                                                : running(r)
                                                  ? "执行中"
                                                  : "已中断"}
                                        </summary>
                                        <pre>
                                          {JSON.stringify(s.arguments, null, 2)}
                                        </pre>
                                        {s.error && <p>{s.error}</p>}
                                      </details>
                                    ))}
                                  </details>
                                )}
                                <div className="flex flex-wrap gap-2">
                                  {r.steps
                                    .filter((step) => step.receipt)
                                    .map((step, index) => {
                                      const receipt = step.receipt!;
                                      const label =
                                        receipt.verification !== "confirmed"
                                          ? "操作已提交，结果待核验"
                                          : receipt.state === "deleted"
                                            ? "已删除并核验"
                                            : receipt.entity_type ===
                                                "translations"
                                              ? "翻译任务已提交"
                                              : receipt.entity_type === "papers"
                                                ? "论文已保存并核验"
                                                : "笔记已保存并核验";
                                      return receipt.url ? (
                                        <Button
                                          key={index}
                                          variant="outline"
                                          size="sm"
                                          asChild
                                        >
                                          <a href={receipt.url}>{label}</a>
                                        </Button>
                                      ) : (
                                        <span
                                          key={index}
                                          className="text-xs text-muted-foreground"
                                        >
                                          {label}
                                        </span>
                                      );
                                    })}
                                </div>
                                {r.steps.map((step, index) =>
                                  step.images?.length ? (
                                    <AgentImages
                                      key={index}
                                      images={step.images}
                                      delivered={step.vision_delivered}
                                    />
                                  ) : null,
                                )}
                                <div className="flex flex-wrap gap-2">
                                  {r.steps
                                    .flatMap((s) => s.files || [])
                                    .map((file) => (
                                      <Button
                                        key={file.id}
                                        variant="outline"
                                        size="sm"
                                        asChild
                                      >
                                        <a href={file.url} download={file.name}>
                                          <Paperclip />
                                          下载 {file.name}
                                        </a>
                                      </Button>
                                    ))}
                                </div>
                                <Bubble variant="ghost">
                                  <BubbleContent>
                                    {r.response ? (
                                      <StreamingMarkdown
                                        active={running(r)}
                                        body={r.steps
                                          .flatMap((s) => s.files || [])
                                          .reduce(
                                            (body, file) =>
                                              body.replaceAll(
                                                "#attachment/" + file.id,
                                                file.url,
                                              ),
                                            r.response,
                                          )}
                                      />
                                    ) : running(r) ? (
                                      <p
                                        role="status"
                                        className="streaming-status text-xs text-muted-foreground"
                                      >
                                        {waiting(r)
                                          ? "等待回复…"
                                          : `${runLabel(r)}…`}
                                      </p>
                                    ) : null}
                                  </BubbleContent>
                                </Bubble>
                                {r.error && (
                                  <Alert variant="destructive">
                                    <AlertDescription>
                                      {r.error}
                                    </AlertDescription>
                                  </Alert>
                                )}
                                {r.status === "cancelled" && (
                                  <p className="text-xs text-muted-foreground">
                                    已停止后续操作；已完成的修改保留。
                                  </p>
                                )}
                                {["failed", "cancelled"].includes(r.status) &&
                                  !r.runtime?.resumed_by && (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      disabled={
                                        busy || settingsSaving || !model
                                      }
                                      onClick={() => void resume(r)}
                                    >
                                      继续未完成任务
                                    </Button>
                                  )}
                              </MessageContent>
                            </Message>
                          </MessageScrollerItem>,
                        ])}
                      </MessageScrollerContent>
                    </MessageScrollerViewport>
                    <MessageScrollerButton />
                  </MessageScroller>
                </MessageScrollerProvider>
              </div>
              <form
                className="agent-composer"
                onSubmit={(e) => {
                  e.preventDefault();
                  void submit();
                }}
              >
                {readerRequest && (
                  <Badge
                    variant="secondary"
                    className="max-w-full gap-2"
                    title={readerRequest.context.quote || readerRequest.label}
                  >
                    <span className="truncate">{readerRequest.label}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="移除阅读上下文"
                      onClick={clearReaderContext}
                    >
                      <X />
                    </Button>
                  </Badge>
                )}
                {connectionError && (
                  <Alert>
                    <AlertDescription>{connectionError}</AlertDescription>
                  </Alert>
                )}
                {error && (
                  <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}
                <input
                  ref={fileInput}
                  type="file"
                  multiple
                  hidden
                  aria-label="聊天附件文件"
                  accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.txt,.md,.markdown,.tex,.csv,.tsv,.json,.bib"
                  onChange={(e) => {
                    void uploadFiles(Array.from(e.target.files || []));
                    e.target.value = "";
                  }}
                />
                {!!files.length && (
                  <div className="flex flex-wrap gap-2">
                    {files.map((f) => (
                      <Badge
                        key={f.id}
                        variant="secondary"
                        className="max-w-full gap-1"
                      >
                        <ChatAttachments files={[f]} compact />
                        <Button
                          type="button"
                          size="icon-sm"
                          variant="ghost"
                          aria-label={`移除附件 ${f.name}`}
                          disabled={busy || uploading}
                          onClick={() =>
                            setFiles((old) => old.filter((x) => x.id !== f.id))
                          }
                        >
                          <X />
                        </Button>
                      </Badge>
                    ))}
                  </div>
                )}
                {!!references.length && (
                  <p className="text-xs text-muted-foreground">
                    参考 {references.length} 篇论文
                  </p>
                )}
                <InputGroup>
                  <InputGroupTextarea
                    onDragOver={(e) => {
                      if (e.dataTransfer.types.includes("Files"))
                        e.preventDefault();
                    }}
                    onDrop={(e) => {
                      if (e.dataTransfer.files.length) {
                        e.preventDefault();
                        void uploadFiles(Array.from(e.dataTransfer.files));
                      }
                    }}
                    onPaste={(e) => {
                      const pasted = Array.from(e.clipboardData.files);
                      if (pasted.length) {
                        e.preventDefault();
                        void uploadFiles(pasted);
                      }
                    }}
                    aria-label="给 Agent 的消息"
                    placeholder={
                      paperMode
                        ? "有什么尽管问我。"
                        : "发消息，或让助手处理论文…"
                    }
                    value={draft}
                    maxLength={12000}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (
                        e.key === "Enter" &&
                        !e.shiftKey &&
                        !e.nativeEvent.isComposing
                      ) {
                        e.preventDefault();
                        void submit();
                      }
                    }}
                  />
                  <InputGroupAddon align="block-end" className="gap-1">
                    <AgentReferencePicker
                      showLabel={paperMode}
                      value={references}
                      onChange={(rows) =>
                        setReferenceDrafts((previous) => ({
                          ...previous,
                          [selected]: rows,
                        }))
                      }
                      disabled={busy}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={uploading ? "上传中…" : "添加附件"}
                      title="添加附件 · PDF、图片、文本，最多 20 MB"
                      disabled={uploading || busy || files.length >= 5}
                      onClick={() => fileInput.current?.click()}
                    >
                      <Paperclip />
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label="对话设置"
                          title={writable ? "对话设置" : "对话设置 · 只读"}
                        >
                          <Settings2 />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuGroup>
                          <DropdownMenuCheckboxItem
                            checked={writable}
                            onCheckedChange={setWritable}
                            disabled={busy}
                          >
                            允许修改文库
                          </DropdownMenuCheckboxItem>
                          <DropdownMenuLabel>
                            {models.find((m) => m.id === model)?.vision
                              ? "支持图片与扫描页"
                              : "当前为文字模型"}
                          </DropdownMenuLabel>
                        </DropdownMenuGroup>
                        <DropdownMenuSeparator />
                        {paperMode && (
                          <>
                            <DropdownMenuItem
                              onSelect={() => setMode("floating")}
                            >
                              切换为悬浮窗
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => setOpen(false)}>
                              收起研究助手
                            </DropdownMenuItem>
                          </>
                        )}
                        <DropdownMenuGroup>
                          <DropdownMenuItem
                            onSelect={() => {
                              location.hash = "settings";
                              setOpen(false);
                            }}
                          >
                            模型设置
                          </DropdownMenuItem>
                        </DropdownMenuGroup>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <span className="flex-1" />
                    <QuickModelPicker
                      models={models}
                      value={model}
                      onChange={setModel}
                      onModels={setModels}
                      onBusy={setSettingsSaving}
                      disabled={busy}
                      label="Agent"
                      onAdd={() => {
                        location.hash = "settings";
                        setOpen(false);
                      }}
                    />
                    {active && (
                      <Button
                        type="button"
                        variant="outline"
                        size="icon-sm"
                        aria-label={
                          activeRuns.length > 1 ? "停止全部任务" : "停止"
                        }
                        title={activeRuns.length > 1 ? "停止全部任务" : "停止"}
                        onClick={async () => {
                          try {
                            await Promise.all(
                              activeRuns.map((run) =>
                                send(`/agent/runs/${run.id}/cancel`, {}),
                              ),
                            );
                            setRuns(
                              await api(`/agent/sessions/${selected}/runs`),
                            );
                            refresh();
                          } catch (e) {
                            fail(e);
                          }
                        }}
                      >
                        <Square data-icon="inline-start" />
                      </Button>
                    )}
                    <Button
                      type="submit"
                      size="icon-sm"
                      aria-label="发送"
                      title="发送"
                      disabled={
                        !model ||
                        (paperMode && !paperSession) ||
                        (!draft.trim() && !files.length) ||
                        busy ||
                        loading ||
                        uploading ||
                        settingsSaving
                      }
                    >
                      {paperMode ? (
                        <ArrowUp />
                      ) : (
                        <Send data-icon="inline-start" />
                      )}
                    </Button>
                  </InputGroupAddon>
                </InputGroup>
              </form>
            </div>
            {!docked &&
              ["n", "s", "e", "w", "ne", "nw", "se", "sw"].map((edge) => (
                <div
                  key={edge}
                  role="button"
                  tabIndex={edge === "se" ? 0 : -1}
                  aria-label={"调整窗口大小 " + edge}
                  className={"agent-resize agent-resize-" + edge}
                  onPointerDown={(e) => floating.start(e, edge)}
                  onPointerMove={docked ? undefined : floating.move}
                  onPointerUp={floating.end}
                  onPointerCancel={floating.end}
                  onKeyDown={(e) => floating.keyboard(e, true)}
                />
              ))}
          </section>
        </Presence>,
        surface,
      )}
    </>
  );
}
