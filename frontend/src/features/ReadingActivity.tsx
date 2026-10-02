import { useEffect, useRef, useState } from "react";
import {
  Copy,
  Download,
  MessageSquare,
  RefreshCw,
  Square,
  ArrowUpRight,
  Trash2,
} from "lucide-react";
import { api, send } from "../api";
import { selectedPaperSession, type ReaderRequest } from "../lib/reader-agent";
import type { InferenceModel } from "./ModelOptions";
import { Choice } from "../components/Choice";
import { Markdown } from "../components/shared";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Alert, AlertDescription } from "../components/ui/alert";
import { Spinner } from "../components/ui/spinner";
import { toast } from "sonner";

type Activity = {
  id: string;
  kind: "highlight" | "comment" | "explanation" | "translation";
  file_id: string;
  page: number;
  quote: string;
  category?: string;
  region?: number[];
  prefix?: string;
  rects?: { x: number; y: number; w: number; h: number }[];
  body: string;
  prompt?: string;
  error?: string;
  status: string;
  session_id: string;
  updated_at: string;
};
const names = {
  highlight: "高亮",
  comment: "评论",
  explanation: "解释",
  translation: "翻译",
};
export function ReadingActivity({
  paperId,
  request,
  consumed,
  onLocate,
  onPreview,
  kind,
}: {
  /** Explaining and translating are different requests: a panel shows one of them. */
  kind?: "explanation" | "translation";
  paperId: string;
  request: ReaderRequest | null;
  consumed: () => void;
  onLocate: (
    file: string,
    page: number,
    quote?: string,
    rects?: Activity["rects"],
    prefix?: string,
  ) => void;
  onPreview?: (
    value: {
      file: string;
      page: number;
      quote: string;
      rects?: Activity["rects"];
      prefix?: string;
    } | null,
  ) => void;
}) {
  const [rows, setRows] = useState<Activity[]>([]),
    [next, setNext] = useState<number | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false),
    [exporting, setExporting] = useState(false),
    [removing, setRemoving] = useState(false),
    [filter, setFilter] = useState(kind || "all"),
    [query, setQuery] = useState(""),
    [category, setCategory] = useState("all"),
    [models, setModels] = useState<InferenceModel[]>([]),
    [model, setModel] = useState(""),
    [retry, setRetry] = useState<ReaderRequest | null>(null);
  const seen = useRef<ReaderRequest | null>(null),
    scope = useRef(paperId);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const previewCallback = useRef(onPreview);
  previewCallback.current = onPreview;
  const preview = (row: Activity | null) => {
    clearTimeout(previewTimer.current);
    if (!row) previewCallback.current?.(null);
    else
      previewTimer.current = setTimeout(() => {
        if (row.quote || row.region?.length === 4)
          previewCallback.current?.({
            file: row.file_id,
            page: row.page,
            quote: row.quote,
            rects:
              row.region?.length === 4
                ? [
                    {
                      x: row.region[0],
                      y: row.region[1],
                      w: row.region[2],
                      h: row.region[3],
                    },
                  ]
                : Array.isArray(row.rects)
                  ? row.rects
                  : undefined,
            prefix: row.prefix,
          });
      }, 160);
  };
  useEffect(
    () => () => {
      clearTimeout(previewTimer.current);
      previewCallback.current?.(null);
    },
    [paperId],
  );
  const sequence = useRef(0);
  const searchScope = useRef("");
  const searchKey = JSON.stringify([paperId, filter, query, category]);
  searchScope.current = searchKey;
  scope.current = paperId;
  const noun = kind === "translation" ? "翻译" : "解释";
  const params = new URLSearchParams({ kind: filter, q: query, category });
  async function load(offset = 0) {
    const ticket = ++sequence.current;
    setLoading(true);
    try {
      const data = await api<{ items: Activity[]; next: number | null }>(
        `/papers/${paperId}/reading-activity?${params}&offset=${offset}&limit=10`,
      );
      if (searchScope.current !== searchKey || sequence.current !== ticket)
        return;
      setError("");
      setRows((old) =>
        offset
          ? [
              ...old,
              ...data.items.filter((r) => !old.some((x) => x.id === r.id)),
            ]
          : data.items,
      );
      setNext(data.next);
    } catch (e) {
      if (searchScope.current === searchKey && sequence.current === ticket)
        setError((e as Error).message);
    } finally {
      if (searchScope.current === searchKey && sequence.current === ticket)
        setLoading(false);
    }
  }
  useEffect(() => {
    setRows([]);
    setNext(null);
    setError("");
    setLoading(true);
    const timer = setTimeout(() => void load(), 250);
    return () => clearTimeout(timer);
  }, [searchKey]);
  useEffect(() => {
    const update = () => void load();
    window.addEventListener("reading-activity-changed", update);
    return () => window.removeEventListener("reading-activity-changed", update);
  }, [searchKey]);
  useEffect(() => {
    let live = true;
    api<{ models: InferenceModel[]; active_id: string }>(
      "/translation-settings",
    )
      .then((x) => {
        if (live) {
          setModels(x.models);
          setModel(x.active_id || x.models[0]?.id || "");
        }
      })
      .catch((e) => setError(e.message));
    return () => {
      live = false;
    };
  }, []);
  const pending = rows.some((r) => ["queued", "running"].includes(r.status));
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => void load(), 2000);
    return () => clearInterval(timer);
  }, [pending, searchKey]);
  async function launch(value: ReaderRequest) {
    setBusy(true);
    setError("");
    setRetry(null);
    try {
      if (!model) throw new Error("请先在空间设置添加可用模型");
      const canonical = await send(`/papers/${paperId}/discussion`, {});
      const sessions = await api<{ id: string }[]>(
        `/agent/sessions?paper_id=${paperId}`,
      );
      const selected = selectedPaperSession(paperId);
      const session =
        sessions.find((item) => item.id === selected) || canonical;
      await send(`/agent/sessions/${session.id}/runs`, {
        prompt: value.prompt,
        model_config_id: model,
        writable: false,
        reader_context: value.context,
        context: `paper/${paperId}`,
      });
      if (scope.current === paperId) {
        setFilter(kind || "all");
        setQuery("");
        setCategory("all");
        if (filter === (kind || "all") && !query) await load();
      }
    } catch (e) {
      if (scope.current === paperId) {
        setError((e as Error).message);
        setRetry(value);
      }
    } finally {
      if (scope.current === paperId) setBusy(false);
    }
  }
  useEffect(() => {
    if (!request || request === seen.current || !models.length) return;
    seen.current = request;
    consumed();
    void launch(request);
  }, [request, models, model]);
  async function removeHistory(row?: Activity) {
    if (
      !row &&
      !window.confirm(
        `清空当前筛选下的${noun}记录？正在生成的记录会保留，研究助手中的对话不受影响。`,
      )
    )
      return;
    setRemoving(true);
    try {
      await api(
        `/papers/${paperId}/reading-activity${row ? `/${row.id}` : `?${params}`}`,
        { method: "DELETE" },
      );
      if (scope.current !== paperId) return;
      preview(null);
      await load();
      toast.success(row ? "已从记录中移除" : "已清空筛选记录");
    } catch (e) {
      if (scope.current === paperId) toast.error((e as Error).message);
    } finally {
      if (scope.current === paperId) setRemoving(false);
    }
  }
  async function exportRows() {
    setExporting(true);
    try {
      const response = await fetch(
        `/api/v1/papers/${paperId}/reading-activity/export?${params}`,
        { credentials: "same-origin" },
      );
      if (!response.ok) {
        const result = await response.json().catch(() => null);
        throw new Error(result?.detail || "导出失败，请重试");
      }
      const url = URL.createObjectURL(await response.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = kind ? `${noun}记录.md` : "阅读活动.md";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setExporting(false);
    }
  }
  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-4"
      aria-label="阅读活动记录"
    >
      <div className="flex items-center gap-2">
        {models.length ? (
          <Choice
            aria-label={`${noun}使用模型`}
            value={model}
            onValueChange={setModel}
          >
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name || m.model}
              </option>
            ))}
          </Choice>
        ) : (
          <span className="mr-auto text-sm text-muted-foreground">
            阅读记录
          </span>
        )}
        <Button
          variant="ghost"
          size="icon"
          aria-label="刷新阅读活动"
          onClick={() => void load()}
        >
          <RefreshCw />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="导出全部筛选结果"
          title="导出全部筛选结果"
          disabled={loading || exporting || !rows.length}
          onClick={exportRows}
        >
          {exporting ? <Spinner /> : <Download />}
        </Button>
      </div>
      {kind && (
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>自动保留，便于回看；移除记录不会删除对话。</span>
          <Button
            size="xs"
            variant="ghost"
            disabled={
              loading ||
              removing ||
              !rows.some((row) => !["queued", "running"].includes(row.status))
            }
            onClick={() => void removeHistory()}
          >
            <Trash2 />
            清空筛选记录
          </Button>
        </div>
      )}
      {filter === "explanation" && (
        <Choice
          aria-label="解释内容类型"
          value={category}
          onValueChange={setCategory}
        >
          {Object.entries({
            all: "全部类型",
            text: "文本",
            image: "图片",
            table: "表格",
            formula: "数学公式",
            url: "URL",
            paper: "论文与术语",
          }).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Choice>
      )}
      <div className="flex gap-2">
        {!kind && (
          <Choice
            aria-label="阅读活动类型"
            value={filter}
            onValueChange={setFilter}
          >
            <option value="all">全部活动</option>
            {Object.entries(names).map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </Choice>
        )}
        <Input
          aria-label={kind ? `搜索${noun}记录` : "搜索全部阅读活动"}
          maxLength={200}
          placeholder={kind ? `搜索${noun}记录…` : "搜索全部阅读记录…"}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>
            {error}
            {retry && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => void launch(retry)}
              >
                重试
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}
      {request && !models.length && !busy && (
        <p className="text-sm text-muted-foreground">
          需要可用模型才能生成{noun}。<a href="#settings">打开模型设置</a>
        </p>
      )}
      {loading && !rows.length && (
        <p role="status" className="text-sm text-muted-foreground">
          正在查找记录…
        </p>
      )}
      {busy && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner />
          正在开始{noun}…
        </p>
      )}
      {!rows.length && !busy && !loading && (
        <p className="py-8 text-sm text-muted-foreground">
          {query || category !== "all" || (!kind && filter !== "all")
            ? "没有符合筛选条件的记录。"
            : kind === "translation"
              ? "划选文字，选「翻译」再点「用 AI 精译」，译文会保存在这里。"
              : kind === "explanation"
                ? "划选文字，或框选图表、公式后点「解释」，回答会保存在这里。"
                : "划选文字进行解释、翻译或高亮，记录会保存在这里。"}
        </p>
      )}
      {rows.map((row) => (
        <article
          key={row.id}
          tabIndex={row.quote ? 0 : undefined}
          onPointerEnter={(event) => {
            if (event.pointerType !== "touch") preview(row);
          }}
          onPointerLeave={() => preview(null)}
          onFocus={() => preview(row)}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget))
              preview(null);
          }}
          className="rounded-lg border bg-card p-4"
          data-testid="reading-activity-card"
        >
          <div className="mb-3 flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>{names[row.kind]}</span>
            <Button
              size="xs"
              variant="ghost"
              onClick={() =>
                onLocate(
                  row.file_id,
                  row.page,
                  row.quote,
                  row.region?.length === 4
                    ? [
                        {
                          x: row.region[0],
                          y: row.region[1],
                          w: row.region[2],
                          h: row.region[3],
                        },
                      ]
                    : row.rects,
                  row.prefix,
                )
              }
            >
              {row.quote ? "定位原文" : `第 ${row.page} 页`} <ArrowUpRight />
            </Button>
          </div>
          {row.quote && (
            <blockquote className="mb-3 max-h-32 overflow-auto border-l-2 pl-3 text-sm text-muted-foreground">
              {row.quote}
            </blockquote>
          )}
          {row.status === "queued" || row.status === "running" ? (
            <p className="flex items-center gap-2 text-sm">
              <Spinner />
              正在阅读与分析…
            </p>
          ) : row.error ? (
            <p role="alert" className="text-sm text-destructive">
              {row.error}
            </p>
          ) : row.status === "cancelled" ? (
            <p className="text-sm text-muted-foreground">已停止</p>
          ) : row.body ? (
            <Markdown body={row.body} />
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            {row.body && row.status === "completed" && (
              <Button
                size="xs"
                variant="ghost"
                onClick={() =>
                  void navigator.clipboard
                    .writeText(row.body)
                    .then(() => toast.success("已复制"))
                    .catch(() => toast.error("复制失败"))
                }
              >
                <Copy />
                复制
              </Button>
            )}
            {row.session_id && ["failed", "cancelled"].includes(row.status) && (
              <Button
                size="xs"
                variant="outline"
                disabled={busy || !model}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await send(`/agent/sessions/${row.session_id}/runs`, {
                      prompt: row.prompt || `重试${noun}`,
                      model_config_id: model,
                      writable: false,
                      resume_run_id: row.id,
                    });
                    await load();
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <RefreshCw />
                重试
              </Button>
            )}
            {row.session_id && (
              <Button
                size="xs"
                variant="outline"
                onClick={() =>
                  window.dispatchEvent(
                    new CustomEvent("open-research-agent", {
                      detail: { sessionId: row.session_id, runId: row.id },
                    }),
                  )
                }
              >
                <MessageSquare />
                继续追问
              </Button>
            )}
            {["translation", "explanation"].includes(row.kind) &&
              !["queued", "running"].includes(row.status) && (
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={removing}
                  onClick={() => void removeHistory(row)}
                >
                  <Trash2 />
                  移除记录
                </Button>
              )}
            {["queued", "running"].includes(row.status) && (
              <Button
                size="xs"
                variant="ghost"
                onClick={async () => {
                  try {
                    await send(`/agent/runs/${row.id}/cancel`, {});
                    await load();
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                <Square />
                停止
              </Button>
            )}
          </div>
        </article>
      ))}
      {next !== null && (
        <Button
          variant="outline"
          disabled={loading}
          onClick={() => void load(next)}
        >
          加载更多记录
        </Button>
      )}
    </div>
  );
}
