import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Languages,
  Settings2,
  Type,
  Minus,
  Plus,
  RotateCcw,
  X,
  Copy,
  Download,
  Square,
} from "lucide-react";
import { ApiError, api, send, type SourceFile } from "../api";
import { Button } from "../components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../components/ui/popover";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
} from "../components/ui/field";
import { ToggleGroup, ToggleGroupItem } from "../components/ui/toggle-group";
import { Slider } from "../components/ui/slider";
import { Switch } from "../components/ui/switch";
import { Choice } from "../components/Choice";
import { Markdown } from "../components/shared";
import { QuickModelPicker } from "./QuickModelPicker";
import type { InferenceModel } from "./ModelOptions";
import "./parallel-translation.css";
import { useSentenceHover } from "./useSentenceHover";

const languages = {
  zh: "简体中文",
  "zh-TW": "繁體中文",
  en: "English",
  ja: "日本語",
  ko: "한국어",
  fr: "Français",
  de: "Deutsch",
  es: "Español",
  pt: "Português",
  ru: "Русский",
  ar: "العربية",
  hi: "हिन्दी",
};
type Paragraph = {
  original: string;
  translation: string;
  kind?: "text" | "heading" | "caption" | "figure_text" | "page_number";
};
type Artifact = {
  id: string;
  file_id: string;
  kind: string;
  model_config_id: string;
  status: string;
  run_id: string;
  error: string;
  parameters: { page?: number; language?: string };
  result?: { paragraphs?: Paragraph[] };
  preview?: { paragraphs?: Paragraph[] };
};
export type TranslationPreview = {
  file: string;
  page: number;
  quote: string;
  prefix?: string;
  emphasis?: "fill";
};
const pending = (row?: Artifact) =>
  !!row && ["running", "queued"].includes(row.status);
function saved<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) || "null") ?? fallback;
  } catch {
    return fallback;
  }
}

export function ParallelTranslation({
  paperId,
  file,
  page,
  onPreview,
  onClose,
  only,
  onOnly,
}: {
  paperId: string;
  file: SourceFile;
  page: number;
  onPage: (page: number) => void;
  onPreview: (value: TranslationPreview | null) => void;
  onClose: () => void;
  only: boolean;
  onOnly: (value: boolean) => void;
}) {
  const [language, setLanguage] = useState<string>(() => {
    const v = saved("paper-translation-language", "zh");
    return v in languages ? v : "zh";
  });
  const [font, setFont] = useState(() =>
    Math.min(
      24,
      Math.max(12, Number(saved("paper-translation-font", 15)) || 15),
    ),
  );
  const [independentFont, setIndependentFont] = useState(() =>
    saved("paper-translation-independent-font", true),
  );
  const [link, setLink] = useState(() =>
    saved("paper-translation-hover", true),
  );
  const [models, setModels] = useState<InferenceModel[]>([]);
  const [model, setModel] = useState("");
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [rows, setRows] = useState<Artifact[]>([]);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [range, setRange] = useState("all");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const epoch = useRef(0);
  const mounted = useRef(true);
  const jobs = useRef(new Map<string, string>());
  const scope = `${file.id}:${model}:${language}`;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const scoped = rows.filter(
    (r) =>
      r.file_id === file.id &&
      r.kind === "page_translation" &&
      r.model_config_id === model &&
      r.parameters.language === language,
  );
  const completed = new Set(
    scoped
      .filter((r) => r.status === "completed")
      .map((r) => r.parameters.page),
  ).size;
  const working = busy || scoped.some((r) => pending(r));
  const pages = file.pages || 1;
  const merge = (row: Artifact) =>
    setRows((previous) => [row, ...previous.filter((r) => r.id !== row.id)]);
  useEffect(() => {
    mounted.current = true;
    let live = true;
    Promise.all([
      api<{ models: InferenceModel[]; active_id: string }>(
        "/translation-settings",
      ),
      api<Artifact[]>(`/papers/${paperId}/reading-artifacts`),
    ])
      .then(([config, data]) => {
        if (!live) return;
        setModels(config.models);
        setModel(config.active_id || config.models[0]?.id || "");
        setRows(data);
      })
      .catch((e) => {
        if (live) setError(e.message);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
      mounted.current = false;
      epoch.current++;
    };
  }, [paperId, file.id]);
  useEffect(() => {
    localStorage.setItem(
      "paper-translation-language",
      JSON.stringify(language),
    );
    localStorage.setItem("paper-translation-font", JSON.stringify(font));
    localStorage.setItem(
      "paper-translation-independent-font",
      JSON.stringify(independentFont),
    );
    localStorage.setItem("paper-translation-hover", JSON.stringify(link));
  }, [language, font, independentFont, link]);
  useEffect(() => {
    setError("");
    setMessage("");
  }, [scope, link, only]);
  // Reopening a panel follows already running server jobs without creating duplicates.
  const runningIds = rows
    .filter((r) => r.file_id === file.id && pending(r))
    .map((r) => r.id)
    .sort()
    .join(",");
  useEffect(() => {
    if (!runningIds || busy) return;
    let live = true;
    let polling = false;
    const timer = setInterval(() => {
      if (polling) return;
      polling = true;
      void Promise.all(
        runningIds.split(",").map(async (id) => {
          try {
            const row = await api<Artifact>(`/reading-artifacts/${id}`);
            if (live) merge(row);
          } catch (e) {
            if (live) setError((e as Error).message);
          }
        }),
      ).finally(() => {
        polling = false;
      });
    }, 700);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [runningIds, busy, file.id]);

  async function generate(targetPage: number, regenerate = false) {
    if (!model || busy || settingsBusy || loading) return;
    const requestScope = scope;
    const token = ++epoch.current;
    const live = () =>
      mounted.current &&
      token === epoch.current &&
      scopeRef.current === requestScope;
    setBusy(true);
    setError("");
    setMessage("");
    // Start where the reader is, so the page in front of them is done first.
    const targets =
      range === "all" && !regenerate
        ? Array.from(
            { length: pages },
            (_, i) => ((targetPage - 1 + i) % pages) + 1,
          )
        : [targetPage];
    let cursor = 0,
      done = 0;
    const failures: number[] = [];
    const reasons = new Set<string>();
    // Respect any server-side task limit; a page that is turned away waits
    // for a slot while already accepted pages continue.
    const submit = async (target: number): Promise<Artifact> => {
      for (;;) {
        try {
          return await send(`/papers/${paperId}/reading-artifacts`, {
            file_id: file.id,
            kind: "page_translation",
            model_config_id: model,
            page: target,
            language,
            regenerate,
          });
        } catch (e) {
          const busy = e instanceof ApiError && e.status === 409;
          if (!busy || !/同时翻译/.test((e as Error).message) || !live())
            throw e;
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      }
    };
    const worker = async () => {
      while (live() && cursor < targets.length) {
        const target = targets[cursor++];
        try {
          let row = rowsRef.current.find(
            (r) =>
              r.file_id === file.id &&
              r.kind === "page_translation" &&
              r.model_config_id === model &&
              r.parameters.language === language &&
              r.parameters.page === target,
          );
          if (
            !row ||
            (!pending(row) && (row.status !== "completed" || regenerate))
          ) {
            row = await submit(target);
          }
          // A stop during submission must also cancel the run returned afterwards.
          if (!live()) {
            if (pending(row))
              await send(`/agent/runs/${row!.run_id}/cancel`, {});
            return;
          }
          merge(row!);
          if (pending(row)) jobs.current.set(row!.id, row!.run_id);
          while (live() && pending(row)) {
            await new Promise((resolve) => setTimeout(resolve, 700));
            if (!live()) return;
            row = await api<Artifact>(`/reading-artifacts/${row!.id}`);
            if (live()) merge(row);
          }
          jobs.current.delete(row!.id);
          if (row!.status !== "completed") {
            failures.push(target);
            if (row!.error) reasons.add(row!.error);
          }
        } catch (e) {
          failures.push(target);
          reasons.add((e as Error).message);
        }
        done++;
        if (live())
          setMessage(
            targets.length > 1 ? `已处理 ${done} / ${targets.length} 页` : "",
          );
      }
    };
    // Keep six pages moving while leaving capacity for interactive AI tasks.
    await Promise.all(
      Array.from({ length: Math.min(6, targets.length) }, worker),
    );
    if (live()) {
      setBusy(false);
      setMessage("");
      if (failures.length)
        setError(
          `第 ${failures.join("、")} 页未完成：${[...reasons].join("；") || "请重试"}。已完成的译文会保留。`,
        );
    }
  }
  async function stop() {
    epoch.current++;
    setBusy(false);
    const runs = new Set([
      ...jobs.current.values(),
      ...scoped.filter(pending).map((r) => r.run_id),
    ]);
    jobs.current.clear();
    try {
      await Promise.all(
        [...runs].map((id) => send(`/agent/runs/${id}/cancel`, {})),
      );
      if (mounted.current) {
        setRows(await api<Artifact[]>(`/papers/${paperId}/reading-artifacts`));
        setMessage("已停止，完成的译文已保留");
      }
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    }
  }
  const [toolbar, setToolbar] = useState<HTMLElement | null>(null);
  const [slots, setSlots] = useState<HTMLElement[]>([]);
  const anchor = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const root = anchor.current?.closest(".parallel-reader-workspace");
    if (!root) return;
    let pdf: HTMLElement | undefined;
    const discover = () => {
      pdf = [
        ...root.querySelectorAll<HTMLElement>(".pdf-view[data-source-file]"),
      ].find((element) => element.dataset.sourceFile === file.id);
      setToolbar(
        pdf?.querySelector<HTMLElement>(".pdf-translation-controls") || null,
      );
      if (pdf) {
        pdf.dataset.pairedTranslation = only ? "only" : "parallel";
        if (!pdf.dataset.translationSplit)
          pdf.dataset.translationSplit = String(
            saved("paper-translation-split", 0.56),
          );
      }
      const found = [
        ...(pdf?.querySelectorAll<HTMLElement>(".pdf-translation-slot") || []),
      ];
      setSlots((previous) =>
        previous.length === found.length &&
        previous.every((node, i) => node === found[i])
          ? previous
          : found,
      );
    };
    discover();
    const observer = new MutationObserver(discover);
    observer.observe(root, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      if (pdf) delete pdf.dataset.pairedTranslation;
    };
  }, [file.id, only]);
  const controller = {
    language,
    setLanguage,
    font,
    setFont,
    independentFont,
    setIndependentFont,
    link,
    setLink,
    models,
    model,
    setModel,
    setModels,
    settingsBusy,
    setSettingsBusy,
    scoped,
    completed,
    working,
    pages,
    loading,
    busy,
    range,
    setRange,
    message,
    setMessage,
    error,
    setError,
    generate,
    stop,
    onPreview,
    onClose,
    only,
    onOnly,
    file,
  };
  return (
    <>
      <span ref={anchor} hidden />
      {toolbar &&
        createPortal(
          <TranslationPage page={page} controller={controller} controlsOnly />,
          toolbar,
        )}
      {slots.map((slot) =>
        createPortal(
          <TranslationPage
            key={slot.dataset.translationPage}
            page={Number(slot.dataset.translationPage)}
            controller={controller}
          />,
          slot,
        ),
      )}
    </>
  );
}

type TranslationController = {
  language: string;
  setLanguage: (v: string) => void;
  font: number;
  setFont: (v: number) => void;
  independentFont: boolean;
  setIndependentFont: (v: boolean) => void;
  link: boolean;
  setLink: (v: boolean) => void;
  models: InferenceModel[];
  model: string;
  setModel: (v: string) => void;
  setModels: (v: InferenceModel[]) => void;
  settingsBusy: boolean;
  setSettingsBusy: (v: boolean) => void;
  scoped: Artifact[];
  completed: number;
  working: boolean;
  pages: number;
  loading: boolean;
  busy: boolean;
  range: string;
  setRange: (v: string) => void;
  message: string;
  setMessage: (v: string) => void;
  error: string;
  setError: (v: string) => void;
  generate: (page: number, regenerate?: boolean) => Promise<void>;
  stop: () => Promise<void>;
  onPreview: (v: TranslationPreview | null) => void;
  onClose: () => void;
  only: boolean;
  onOnly: (v: boolean) => void;
  file: SourceFile;
};
function TranslationPage({
  page,
  controller,
  controlsOnly = false,
}: {
  page: number;
  controlsOnly?: boolean;
  controller: TranslationController;
}) {
  const {
    language,
    setLanguage,
    font,
    setFont,
    independentFont,
    setIndependentFont,
    link,
    setLink,
    models,
    model,
    setModel,
    setModels,
    settingsBusy,
    setSettingsBusy,
    scoped,
    completed,
    working,
    pages,
    loading,
    busy,
    range,
    setRange,
    message,
    setMessage,
    error,
    setError,
    generate,
    stop,
    onPreview,
    onClose,
    only,
    onOnly,
    file,
  } = controller;
  const active = scoped.find((r) => r.parameters.page === page);
  const result =
    active?.status === "completed" ? active.result?.paragraphs : undefined;
  const visible =
    result || (pending(active) ? active?.preview?.paragraphs : undefined);
  const { body, hovered, highlight, leave } = useSentenceHover({
    file: file.id,
    page,
    pairs: visible,
    enabled: link && !only && !controlsOnly,
    onPreview,
  });
  const groups = (visible || []).reduce<
    { figure: boolean; items: { p: Paragraph; index: number }[] }[]
  >((all, p, index) => {
    const figure = p.kind === "figure_text";
    const last = all.at(-1);
    if (figure && last?.figure) last.items.push({ p, index });
    else all.push({ figure, items: [{ p, index }] });
    return all;
  }, []);
  const passage = (p: Paragraph, index: number) => (
    <div
      key={index}
      tabIndex={0}
      data-testid="translation-passage"
      className={`translation-passage${pending(active) ? " streaming-item" : ""}`}
      data-kind={p.kind || "text"}
      data-passage-index={index}
      data-active={hovered === index}
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse" && !event.buttons) highlight(index);
      }}
      onFocus={() => highlight(index)}
      onBlur={leave}
    >
      <Markdown body={p.translation} />
    </div>
  );
  const markdown = () => (result || []).map((p) => p.translation).join("\n\n");
  if (controlsOnly)
    return (
      <div className="parallel-translation-heading">
        <div className="parallel-translation-start">
          <Choice
            aria-label="翻译范围"
            value={range}
            onValueChange={setRange}
            disabled={busy}
          >
            <option value="page">本页</option>
            <option value="all">全文</option>
          </Choice>
          {working ? (
            <Button size="sm" variant="ghost" onClick={() => void stop()}>
              <Square />
              停止
            </Button>
          ) : (
            <Button
              size="sm"
              disabled={
                !model ||
                loading ||
                settingsBusy ||
                (range === "page" && !!result) ||
                (range === "all" && completed === pages)
              }
              onClick={() => void generate(page)}
            >
              {range === "all"
                ? completed === pages
                  ? "全文已翻译"
                  : completed
                    ? "翻译剩余页面"
                    : "翻译全文"
                : result
                  ? "本页已翻译"
                  : "翻译本页"}
            </Button>
          )}
        </div>
        <span className="parallel-page-number">
          {page} / {pages}
        </span>
        <div className="parallel-translation-actions">
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="重新翻译本页"
            title="重新翻译本页"
            disabled={working || loading || !model}
            onClick={() => void generate(page, true)}
          >
            <RotateCcw />
          </Button>
          {independentFont && (
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="译文字号"
                  title="译文字号"
                >
                  <Type />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-60">
                <div className="flex items-center gap-2">
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="缩小译文字号"
                    disabled={font <= 12}
                    onClick={() => setFont(font - 1)}
                  >
                    <Minus />
                  </Button>
                  <span>{font}px</span>
                  <Slider
                    aria-label="译文字号"
                    min={12}
                    max={24}
                    step={1}
                    value={[font]}
                    onValueChange={(v) => setFont(v[0])}
                  />
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="放大译文字号"
                    disabled={font >= 24}
                    onClick={() => setFont(font + 1)}
                  >
                    <Plus />
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
          )}
          <Popover>
            <PopoverTrigger asChild>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="翻译设置"
                title="翻译设置"
              >
                <Settings2 />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80">
              <FieldGroup>
                <Field>
                  <FieldLabel>翻译语言</FieldLabel>
                  <Choice
                    aria-label="翻译语言"
                    value={language}
                    disabled={working}
                    onValueChange={setLanguage}
                  >
                    {Object.entries(languages).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </Choice>
                </Field>
                <Field>
                  <FieldLabel>翻译模型</FieldLabel>
                  <QuickModelPicker
                    models={models}
                    value={model}
                    onChange={setModel}
                    onModels={setModels}
                    onBusy={setSettingsBusy}
                    label="翻译"
                    fixed
                    disabled={working}
                    onAdd={() => {
                      location.hash = "settings";
                    }}
                  />
                </Field>
                <Field>
                  <FieldLabel>显示方式</FieldLabel>
                  <ToggleGroup
                    type="single"
                    value={only ? "only" : "parallel"}
                    onValueChange={(v) => v && onOnly(v === "only")}
                    variant="outline"
                  >
                    <ToggleGroupItem value="parallel">并排查看</ToggleGroupItem>
                    <ToggleGroupItem value="only">仅看译文</ToggleGroupItem>
                  </ToggleGroup>
                </Field>
                <Field orientation="horizontal">
                  <FieldLabel htmlFor="translation-hover">
                    悬停对照原文
                  </FieldLabel>
                  <Switch
                    id="translation-hover"
                    checked={link}
                    onCheckedChange={setLink}
                  />
                </Field>
                <Field orientation="horizontal">
                  <FieldLabel htmlFor="translation-font">
                    单独设置译文字号
                  </FieldLabel>
                  <Switch
                    id="translation-font"
                    checked={independentFont}
                    onCheckedChange={setIndependentFont}
                  />
                </Field>
                <FieldDescription>
                  翻译结果自动保存。切换语言或模型后独立生成。
                </FieldDescription>
              </FieldGroup>
            </PopoverContent>
          </Popover>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="关闭对照翻译"
            title={
              busy
                ? "关闭后已提交的页面继续处理，其余页面可下次继续"
                : "关闭对照翻译"
            }
            onClick={onClose}
          >
            <X />
          </Button>
        </div>
      </div>
    );
  return (
    <aside
      className="parallel-translation"
      aria-label={`第 ${page} 页对照翻译`}
      data-translation-page={page}
    >
      {!only && (
        <div
          className="translation-splitter"
          role="separator"
          aria-label="调整原文和译文宽度"
          aria-orientation="vertical"
          tabIndex={0}
          onKeyDown={(event) => {
            if (!["ArrowLeft", "ArrowRight", "Home"].includes(event.key))
              return;
            event.preventDefault();
            const root = event.currentTarget.closest<HTMLElement>(".pdf-view");
            if (!root) return;
            const value =
              event.key === "Home"
                ? 0.56
                : Math.max(
                    0.25,
                    Math.min(
                      0.75,
                      (Number(root.dataset.translationSplit) || 0.56) +
                        (event.key === "ArrowLeft" ? -0.03 : 0.03),
                    ),
                  );
            root.dataset.translationSplit = String(value);
            localStorage.setItem(
              "paper-translation-split",
              JSON.stringify(value),
            );
          }}
          onPointerDown={(event) => {
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
            const root = event.currentTarget.closest<HTMLElement>(".pdf-view");
            const sheet = root?.querySelector(".pdf-sheet");
            if (!root || !sheet) return;
            const bounds = sheet.getBoundingClientRect();
            root.dataset.translationSplit = String(
              Math.max(
                0.25,
                Math.min(
                  0.75,
                  (event.clientX - bounds.left - 20) / (bounds.width - 60),
                ),
              ),
            );
          }}
          onPointerUp={(event) => {
            event.currentTarget.releasePointerCapture(event.pointerId);
            const root = event.currentTarget.closest<HTMLElement>(".pdf-view");
            localStorage.setItem(
              "paper-translation-split",
              JSON.stringify(Number(root?.dataset.translationSplit) || 0.56),
            );
          }}
        />
      )}
      <div
        ref={body}
        className="parallel-translation-body"
        style={{ fontSize: independentFont ? font : undefined }}
        onMouseLeave={leave}
      >
        {(error || active?.error) && (
          <p role="alert" className="text-destructive">
            {error || active?.error}
          </p>
        )}
        {pending(active) && (
          <p role="status" className="text-muted-foreground streaming-status">
            {visible?.length
              ? `正在翻译 · 已显示 ${visible.length} 句`
              : "正在翻译本页…"}
          </p>
        )}
        {loading && <p role="status">正在读取译文…</p>}
        {!loading && !result && !pending(active) && (
          <div className="parallel-translation-empty">
            <Languages />
            <p>第 {page} 页尚未翻译</p>
            <p>点击顶部“翻译剩余页面”，继续处理未完成的页面。</p>
          </div>
        )}
        {groups.map((group) =>
          group.figure ? (
            <details
              className="translation-figure-text"
              key={group.items[0].index}
            >
              <summary>图中文字 · 展开查看</summary>
              {group.items.map(({ p, index }) => passage(p, index))}
            </details>
          ) : (
            group.items.map(({ p, index }) =>
              p.kind === "page_number" ? null : passage(p, index),
            )
          ),
        )}
      </div>
      <footer className="parallel-translation-footer">
        <span role="status">
          {busy
            ? message || "正在翻译…"
            : message ||
              (completed
                ? `已翻译 ${completed} / ${pages} 页`
                : languages[language as keyof typeof languages])}
        </span>
        <span className="ml-auto" />
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="复制本页译文"
          disabled={!result}
          onClick={() =>
            void navigator.clipboard
              .writeText(markdown())
              .then(() => setMessage("已复制"))
              .catch((e) => setError(e.message))
          }
        >
          <Copy />
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="下载本页译文"
          disabled={!result}
          onClick={() => {
            const url = URL.createObjectURL(
              new Blob([markdown()], { type: "text/markdown;charset=utf-8" }),
            );
            const a = document.createElement("a");
            a.href = url;
            a.download = `page-${page}-${language}.md`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          }}
        >
          <Download />
        </Button>
      </footer>
    </aside>
  );
}
