import { Choice } from "../components/Choice";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
} from "../components/ui/field";
import { ToggleGroup, ToggleGroupItem } from "../components/ui/toggle-group";
import type { InferenceModel } from "./ModelOptions";
import { QuickModelPicker } from "./QuickModelPicker";
import { useEffect, useState, useRef } from "react";
import { api, send, type SourceFile } from "../api";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Languages, Link2, Download } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "../components/ui/dropdown-menu";
import { Alert, AlertDescription } from "../components/ui/alert";
export type TranslationJob = {
  engine?: "latex" | "pdf";
  id: string;
  status: string;
  stage: string;
  completed: number;
  total: number;
  error: string;
  source_file: string;
  translated_file: string;
  alignment: {
    id: string;
    source_text: string;
    translated_text: string;
    source: { page: number; quote: string } | null;
    translated: { page: number; quote: string } | null;
  }[];
};
/**
 * Layout translation and the translated-file jobs behind it. It stays mounted
 * with the reader (jobs keep polling and feed the side-by-side view) and draws
 * its controls into `host`, the body of the 翻译 panel, whenever that is open.
 */
export function TranslationControls({
  id,
  versionId,
  arxivId,
  selectedFile,
  mode,
  onMode,
  onJobs,
  run,
  go,
  onAlign,
  host,
  parallelOpen,
  onParallel,
  onParallelClose,
}: {
  host: HTMLElement | null;
  parallelOpen: boolean;
  onParallel?: () => void;
  onParallelClose: () => void;
  id: string;
  versionId: string;
  arxivId: string;
  selectedFile?: string;
  mode: string;
  onMode: (mode: string, job: TranslationJob) => void;
  onJobs: (jobs: TranslationJob[], files: SourceFile[]) => void;
  run: any;
  go: any;
  onAlign: (
    unit: TranslationJob["alignment"][number],
    job: TranslationJob,
  ) => void;
}) {
  const hasArxiv = /(?:\d{4}\.\d{4,5}|[a-z-]+\/\d{7})v\d+$/i.test(
    arxivId || "",
  );
  const [engine, setEngine] = useState<"latex" | "pdf">(
    hasArxiv ? "latex" : "pdf",
  );
  const [pdfEnabled, setPdfEnabled] = useState(false);
  const [source, setSource] = useState("");
  const [sourceFiles, setSourceFiles] = useState<SourceFile[]>([]);
  const [models, setModels] = useState<InferenceModel[]>([]);
  const [model, setModel] = useState("");
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [jobs, setJobs] = useState<TranslationJob[]>([]);
  const [busy, setBusy] = useState(false);
  const [showPairs, setShowPairs] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  async function exportCombined(
    job: TranslationJob,
    order: "original-first" | "translation-first",
  ) {
    if (exporting) return;
    setExporting(true);
    setExportError("");
    try {
      const response = await fetch(
        `/api/v1/papers/${id}/merged-pdf?translation_job_id=${encodeURIComponent(job.id)}&order=${order}`,
      );
      if (!response.ok) {
        const detail = await response.json().catch(() => null);
        throw new Error(
          typeof detail?.detail === "string"
            ? detail.detail
            : `合并下载失败（${response.status}）`,
        );
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download =
        order === "original-first"
          ? "论文-原文与译文.pdf"
          : "论文-译文与原文.pdf";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setExportError((error as Error).message);
    } finally {
      setExporting(false);
    }
  }
  const scope = `${id}:${versionId}`;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  useEffect(() => {
    setEngine(hasArxiv ? "latex" : "pdf");
    setSource("");
    setJobs([]);
    setSourceFiles([]);
    setShowPairs(false);
    setExportError("");
  }, [id, versionId]);
  const callback = useRef(onJobs);
  callback.current = onJobs;
  const load = async (signal?: AbortSignal) => {
    const [rows, files] = await Promise.all([
      api<TranslationJob[]>(`/papers/${id}/translations`, { signal }),
      api<SourceFile[]>(`/papers/${id}/files`, { signal }),
    ]);
    if (signal?.aborted || scopeRef.current !== scope) return;
    setJobs(rows);
    const pending = rows.find(
      (row) => row.status === "queued" || row.status === "running",
    );
    if (pending?.engine) setEngine(pending.engine);
    const translated = new Set(rows.map((row) => row.translated_file));
    const originals = files.filter(
      (file) =>
        file.version_id === versionId &&
        file.mime === "application/pdf" &&
        !translated.has(file.id),
    );
    setSourceFiles(originals);
    setSource((old) =>
      pending?.source_file &&
      originals.some((file) => file.id === pending.source_file)
        ? pending.source_file
        : originals.some((file) => file.id === old)
          ? old
          : originals.find((file) => file.id === selectedFile)?.id ||
            originals[0]?.id ||
            "",
    );
    callback.current(rows, files);
  };
  const hasActiveJob = jobs.some((row) =>
    ["queued", "running"].includes(row.status),
  );
  useEffect(() => {
    let disposed = false;
    let inFlight = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    const poll = async () => {
      if (disposed || document.hidden || inFlight) return;
      clearTimeout(timer);
      inFlight = true;
      try {
        await load(controller.signal);
      } catch {
      } finally {
        inFlight = false;
        if (!disposed && !document.hidden)
          timer = setTimeout(poll, hasActiveJob ? 1500 : 15000);
      }
    };
    const visibilityChanged = () => {
      clearTimeout(timer);
      if (!document.hidden) void poll();
    };
    document.addEventListener("visibilitychange", visibilityChanged);
    void poll();
    return () => {
      disposed = true;
      controller.abort();
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", visibilityChanged);
    };
  }, [id, versionId, hasActiveJob]);
  const visible = !!host;
  useEffect(() => {
    if (!visible) return;
    api<{
      models: InferenceModel[];
      active_id: string;
      pdf_layout_enabled?: boolean;
    }>("/translation-settings")
      .then((cfg) => {
        setPdfEnabled(!!cfg.pdf_layout_enabled);
        setModels(cfg.models);
        setModel((old) =>
          cfg.models.some((row) => row.id === old) ? old : cfg.active_id,
        );
      })
      .catch((e) => run(() => Promise.reject(e)));
  }, [visible]);
  const active = jobs.find(
    (j) => j.status === "queued" || j.status === "running",
  );
  const ready = jobs.find((j) => j.status === "completed");
  const failed = jobs[0]?.status === "failed" ? jobs[0] : null;
  if (!host) return null;
  return createPortal(
    <div className="reader-translation-panel">
      <section className="translation-section" aria-label="对照翻译">
        <div className="translation-section-head">
          <div>
            <h3>对照翻译</h3>
            <p>
              逐页翻译，和原文并排阅读；从当前页开始，随时可以补译其余页面。
            </p>
          </div>
          <Button
            size="sm"
            variant={parallelOpen ? "secondary" : "default"}
            disabled={!parallelOpen && !onParallel}
            aria-pressed={parallelOpen}
            onClick={() => (parallelOpen ? onParallelClose() : onParallel?.())}
          >
            {parallelOpen ? "关闭对照" : "打开对照"}
          </Button>
        </div>
      </section>
      <section className="translation-section" aria-label="布局翻译">
        <div className="translation-section-head">
          <div>
            <h3>布局翻译</h3>
            <p>把整篇论文翻译成排版完整的中文 PDF，需要几分钟。</p>
          </div>
        </div>
        <FieldGroup>
          <Field>
            {/* A choice of one is not a choice: explain it instead of asking. */}
            {hasArxiv && pdfEnabled ? (
              <>
                <FieldLabel>翻译方式</FieldLabel>
                <ToggleGroup
                  type="single"
                  variant="outline"
                  value={engine}
                  onValueChange={(value) => {
                    if (value) setEngine(value as "latex" | "pdf");
                  }}
                  disabled={!!active || busy}
                  aria-label="翻译方式"
                >
                  <ToggleGroupItem value="latex">arXiv 源码</ToggleGroupItem>
                  <ToggleGroupItem value="pdf">PDF 版面</ToggleGroupItem>
                </ToggleGroup>
              </>
            ) : null}
            <FieldDescription>
              {engine === "pdf"
                ? pdfEnabled
                  ? "保留页面图表和公式，翻译 PDF 中的正文。"
                  : "这篇论文没有 arXiv 源码，暂时不能整篇翻译；可以先用对照翻译。"
                : "使用 arXiv 源码翻译并重新排版，公式和图表最完整。"}
            </FieldDescription>
          </Field>
          {/* One source PDF is chosen automatically; only ask when there is a real choice. */}
          {engine === "pdf" && pdfEnabled && sourceFiles.length !== 1 && (
            <Field>
              <FieldLabel>原始 PDF</FieldLabel>
              <Choice
                aria-label="原始 PDF"
                value={source}
                onValueChange={setSource}
                disabled={!!active || busy}
              >
                {sourceFiles.map((file) => (
                  <option key={file.id} value={file.id}>
                    {file.name}
                  </option>
                ))}
              </Choice>
              {!sourceFiles.length && (
                <FieldDescription>
                  请先上传当前版本的原始 PDF。
                </FieldDescription>
              )}
            </Field>
          )}
        </FieldGroup>
        <QuickModelPicker
          models={models}
          value={model}
          onChange={setModel}
          onModels={setModels}
          onBusy={setSettingsSaving}
          disabled={busy}
          label="翻译"
          fixed
          onAdd={() => go("settings")}
        />
        <div className="translation-controls">
          {ready ? (
            <Tabs
              value={mode}
              onValueChange={(v) => {
                onMode(v, ready);
              }}
            >
              <TabsList>
                <TabsTrigger value="original">原文</TabsTrigger>
                <TabsTrigger value="translated">仅看译文</TabsTrigger>
                <TabsTrigger value="dual">并排查看</TabsTrigger>
              </TabsList>
            </Tabs>
          ) : (
            <span className="text-sm text-muted-foreground">
              还没有译文版本。
            </span>
          )}
          <div className="flex items-center gap-2">
            {ready && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="ghost" disabled={exporting}>
                    <Download />
                    {exporting ? "正在合并…" : "合并下载"}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem
                    onSelect={() =>
                      void exportCombined(ready, "original-first")
                    }
                  >
                    原文在前，译文在后
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() =>
                      void exportCombined(ready, "translation-first")
                    }
                  >
                    译文在前，原文在后
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {ready && ready.alignment.length > 0 && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setShowPairs(!showPairs)}
              >
                <Link2 />
                段落对照
              </Button>
            )}
            {active ? (
              <>
                <span className="text-xs text-muted-foreground" role="status">
                  {active.stage}
                  {active.total
                    ? active.engine === "pdf"
                      ? ` ${Math.min(100, Math.round((active.completed / active.total) * 100))}%`
                      : ` ${active.completed}/${active.total}`
                    : ""}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    run(async () => {
                      await send(`/translations/${active.id}/cancel`, {});
                      await load();
                    })
                  }
                >
                  取消翻译
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                variant={ready ? "outline" : "default"}
                disabled={
                  busy ||
                  settingsSaving ||
                  !model ||
                  (engine === "pdf" ? !pdfEnabled || !source : !hasArxiv)
                }
                onClick={async () => {
                  setBusy(true);
                  try {
                    await run(async () => {
                      await send(`/papers/${id}/translations`, {
                        model_config_id: model,
                        engine,
                        ...(engine === "pdf" ? { source_file_id: source } : {}),
                      });
                      await load();
                    });
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <Languages />
                {ready ? "重新翻译" : "翻译成中文"}
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => go("settings")}>
              模型设置
            </Button>
          </div>
        </div>
        {exportError && (
          <Alert variant="destructive">
            <AlertDescription>{exportError}</AlertDescription>
          </Alert>
        )}
        {failed && (
          <p role="status" className="translation-error">
            {failed.error}
          </p>
        )}
        {showPairs && ready && (
          <div className="translation-pairs" aria-label="原译文段落对照">
            {ready.alignment.map((u) => (
              <div key={u.id}>
                <p>{u.source_text}</p>
                <p>{u.translated_text}</p>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!u.source || !u.translated}
                  onClick={() => {
                    setShowPairs(false);
                    onAlign(u, ready);
                  }}
                >
                  {u.source && u.translated ? "定位两侧原文" : "位置未可靠匹配"}
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>,
    host,
  );
}

export function quoteAlignment(
  job: TranslationJob | null,
  file: string,
  quote: string,
  page?: number,
) {
  if (!job || quote.replace(/\s/g, "").length < 8) return null;
  const side =
    file === job.source_file
      ? "source_text"
      : file === job.translated_file
        ? "translated_text"
        : null;
  if (!side) return null;
  const wanted = quote.replace(/\s/g, "");
  const position = side === "source_text" ? "source" : "translated";
  const matches = job.alignment.filter(
    (u) =>
      (!page || u[position]?.page === page) &&
      u[side].replace(/\s/g, "").includes(wanted),
  );
  return matches.length === 1 ? matches[0] : null;
}
