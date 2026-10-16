import { Checkbox } from "../components/ui/checkbox";
import type { SuggestedHighlight } from "./PdfSuggestedHighlights";
import { useEffect, useRef, useState } from "react";
import { Copy, Download } from "lucide-react";
import { api, send, type SourceFile } from "../api";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Alert, AlertDescription } from "../components/ui/alert";
import { QuickModelPicker } from "./QuickModelPicker";
import type { InferenceModel } from "./ModelOptions";
import "./paper-reading-tools.css";

type Kind = "highlights";
type Highlight = {
  page: number;
  quote: string;
  category: "novelty" | "method" | "results";
};
type Highlights = { highlights: Highlight[] };
type Artifact = {
  id: string;
  file_id: string;
  kind: Kind;
  status: string;
  run_id: string;
  model_config_id: string;
  result: Highlights | null;
  preview?: Partial<Highlights>;
  error: string;
  parameters: { page?: number; language?: string };
  evidence_pages?: number[];
};
const labels = { novelty: "创新", method: "方法", results: "结果" };

export function PaperReadingTools({
  paperId,
  file,
  page,
  onLocate,
  onHighlights,
  highlightsEnabled = false,
}: {
  onHighlights?: (
    value: { fileId: string; highlights: SuggestedHighlight[] } | null,
  ) => void;
  highlightsEnabled?: boolean;
  paperId: string;
  file: SourceFile;
  page: number;
  onLocate: (page: number, quote?: string) => void;
}) {
  const kind = "highlights";
  const [models, setModels] = useState<InferenceModel[]>([]);
  const [model, setModel] = useState("");
  const [rows, setRows] = useState<Artifact[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [reload, setReload] = useState(0);
  const scope = `${file.id}:${model}:${kind}`;
  const current = useRef(scope);
  current.current = scope;
  const active = rows.find(
    (row) =>
      row.file_id === file.id &&
      row.kind === kind &&
      row.model_config_id === model,
  );
  const running = !!active && ["queued", "running"].includes(active.status);
  useEffect(() => {
    setError("");
    setStatus("");
  }, [scope]);
  useEffect(() => {
    let live = true;
    const loadModels = () =>
      api<{ models: InferenceModel[]; active_id: string }>(
        "/translation-settings",
      )
        .then((config) => {
          if (!live) return;
          setModels(config.models);
          setModel((previous) =>
            config.models.some((row) => row.id === previous)
              ? previous
              : config.active_id || config.models[0]?.id || "",
          );
        })
        .catch((e) => {
          if (live) setError(e.message);
        });
    void loadModels();
    window.addEventListener("model-settings-updated", loadModels);
    return () => {
      live = false;
      window.removeEventListener("model-settings-updated", loadModels);
    };
  }, [paperId, file.id, reload]);
  useEffect(() => {
    let live = true;
    setLoading(true);
    api<Artifact[]>(`/papers/${paperId}/reading-artifacts`)
      .then((data) => {
        if (live) setRows(data);
      })
      .catch((e) => {
        if (live) setError(e.message);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [paperId, file.id, page, reload]);
  useEffect(() => {
    if (!active || !running) return;
    let live = true;
    let timer: number;
    const poll = async () => {
      try {
        const row = await api<Artifact>(`/reading-artifacts/${active.id}`);
        if (!live) return;
        setError("");
        setRows((previous) =>
          previous.map((entry) => (entry.id === row.id ? row : entry)),
        );
        if (["queued", "running"].includes(row.status))
          timer = window.setTimeout(poll, 700);
      } catch (e) {
        if (live) {
          setError((e as Error).message);
          timer = window.setTimeout(poll, 5000);
        }
      }
    };
    timer = window.setTimeout(poll, 700);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [active?.id, active?.run_id, running]);
  async function generate() {
    if (!model || sending || running || loading || settingsBusy) return;
    const requestedScope = scope;
    setSending(true);
    setError("");
    setStatus("");
    try {
      const row = await send(`/papers/${paperId}/reading-artifacts`, {
        file_id: file.id,
        model_config_id: model,
        kind,
        ...(active?.status === "completed" ? { regenerate: true } : {}),
      });
      setRows((previous) => [
        row,
        ...previous.filter((entry) => entry.id !== row.id),
      ]);
    } catch (e) {
      if (current.current === requestedScope) setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }
  const result = active?.status === "completed" ? active.result : null;
  const highlights =
    result ||
    (running && active?.preview?.highlights?.length
      ? { highlights: active.preview.highlights }
      : null);
  const highlightCallback = useRef(onHighlights);
  highlightCallback.current = onHighlights;
  useEffect(() => {
    if (highlightsEnabled && result) {
      highlightCallback.current?.({
        fileId: file.id,
        highlights: result.highlights,
      });
    }
  }, [result, highlightsEnabled, file.id]);
  function markdown() {
    if (highlights)
      return (
        "# 阅读重点建议\n\n" +
        highlights.highlights
          .map(
            (h) =>
              `## ${labels[h.category]} · 第 ${h.page} 页\n\n> ${h.quote}\n`,
          )
          .join("\n") +
        `\n已核验页码：${active?.evidence_pages?.join("、") || "未提供"}。建议不代表覆盖全文。\n`
      );
    return "";
  }
  return (
    <section className="paper-reading-tools" aria-label="重点建议">
      <div className="paper-tools-config">
        <QuickModelPicker
          models={models}
          value={model}
          onChange={setModel}
          onModels={setModels}
          onBusy={setSettingsBusy}
          disabled={sending || running}
          label="阅读工具"
          fixed
          onAdd={() => {
            location.hash = "settings";
          }}
        />
      </div>
      {(error || active?.error) && (
        <Alert variant="destructive">
          <AlertDescription>
            {error || active?.error}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setError("");
                setReload((value) => value + 1);
              }}
            >
              重新加载
            </Button>
          </AlertDescription>
        </Alert>
      )}
      <div className="paper-tools-actions">
        {running ? (
          <>
            <span
              role="status"
              className="paper-tools-working streaming-status"
            >
              {highlights
                ? `正在生成 · 已显示 ${highlights.highlights.length} 条重点`
                : "正在阅读论文…"}
            </span>
            <Button
              size="sm"
              variant="ghost"
              disabled={sending}
              onClick={async () => {
                setSending(true);
                try {
                  await send(`/agent/runs/${active.run_id}/cancel`, {});
                  const row = await api<Artifact>(
                    `/reading-artifacts/${active.id}`,
                  );
                  setRows((previous) =>
                    previous.map((entry) =>
                      entry.id === row.id ? row : entry,
                    ),
                  );
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setSending(false);
                }
              }}
            >
              停止生成
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            disabled={!model || sending || loading || settingsBusy}
            onClick={() => void generate()}
          >
            {sending
              ? "正在提交…"
              : active?.status === "completed"
                ? "重新生成"
                : active?.status === "failed" || active?.status === "cancelled"
                  ? "重试生成"
                  : "生成重点建议"}
          </Button>
        )}
        {result && (
          <span className="paper-tools-export">
            <Badge variant="secondary">已保存结果</Badge>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="复制阅读结果"
              title="复制"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(markdown());
                  setStatus("已复制");
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              <Copy />
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="导出阅读结果"
              title="导出 Markdown"
              onClick={() => {
                const url = URL.createObjectURL(
                  new Blob([markdown()], {
                    type: "text/markdown;charset=utf-8",
                  }),
                );
                const link = document.createElement("a");
                link.href = url;
                link.download = "reading-highlights.md";
                link.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
              }}
            >
              <Download />
            </Button>
          </span>
        )}
      </div>
      {status && (
        <p role="status" className="paper-tools-caption">
          {status}
        </p>
      )}
      {loading && !result && (
        <p role="status" className="paper-tools-caption">
          正在读取已有结果…
        </p>
      )}
      {highlights && (
        <div className="paper-highlights">
          {onHighlights && result && (
            <label className="paper-tools-overlay-toggle">
              <Checkbox
                checked={highlightsEnabled}
                onCheckedChange={(checked) =>
                  onHighlights(
                    checked
                      ? { fileId: file.id, highlights: highlights.highlights }
                      : null,
                  )
                }
              />
              在论文上显示重点
            </label>
          )}
          <p className="paper-tools-caption">
            AI 重点建议 · 已核验 {active?.evidence_pages?.length || 0} /{" "}
            {file.pages || "未知"} 页，不代表覆盖全文。点击原句可返回论文核验。
          </p>
          {!highlights.highlights.length && (
            <p className="paper-tools-caption">已读范围内暂未生成重点建议。</p>
          )}
          {highlights.highlights.map((highlight, index) => (
            <button
              key={index}
              type="button"
              className={`paper-highlight-suggestion category-${highlight.category}${running ? " streaming-item" : ""}`}
              onClick={() => onLocate(highlight.page, highlight.quote)}
            >
              <span>
                <Badge variant="outline">{labels[highlight.category]}</Badge>
                <span>第 {highlight.page} 页</span>
              </span>
              <blockquote>{highlight.quote}</blockquote>
            </button>
          ))}
        </div>
      )}
      {!result && !running && !loading && (
        <p className="paper-tools-caption">
          从实际读取的论文页面提出创新、方法和结果重点。不会自动写入笔记或批注。
        </p>
      )}
    </section>
  );
}
