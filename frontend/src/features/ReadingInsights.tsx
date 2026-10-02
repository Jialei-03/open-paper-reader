import { useEffect, useRef, useState } from "react";
import { api, send, type SourceFile } from "../api";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { ChevronDown, Copy, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Markdown } from "../components/shared";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "../components/ui/collapsible";
import type { ReactNode } from "react";

// Models often write the letter into the option ("A. 先检索…"); the quiz adds its own.
const plainOption = (option: string) =>
  option.replace(/^\s*[A-Da-d][.．、:：)）]\s*/, "");
function GuideCard({
  title,
  text,
  children,
  regenerate,
  disabled,
}: {
  title: string;
  text: string;
  children: ReactNode;
  regenerate: () => void;
  disabled: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [clipped, setClipped] = useState(false);
  const content = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = content.current;
    if (!element) return;
    const measure = () => setClipped(element.scrollHeight > 136);
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, [text]);
  return (
    <Collapsible defaultOpen className="guide-card">
      <div className="guide-card-heading">
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm">
            <ChevronDown />
            {title}
          </Button>
        </CollapsibleTrigger>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`复制${title}`}
          disabled={disabled}
          onClick={() =>
            navigator.clipboard
              .writeText(text)
              .then(() => toast.success("已复制"))
              .catch(() => toast.error("无法复制"))
          }
        >
          <Copy />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`重新生成${title}`}
          title="重新生成完整导读，保持各部分一致"
          disabled={disabled}
          onClick={regenerate}
        >
          <RefreshCw />
        </Button>
      </div>
      <CollapsibleContent>
        <div
          ref={content}
          className="guide-card-content"
          data-expanded={expanded}
          data-clipped={clipped}
        >
          {children}
        </div>
        {clipped && (
          <Button
            variant="ghost"
            size="sm"
            className="guide-card-expand"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? "收起" : "查看全部"}
          </Button>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
import { Choice } from "@/components/Choice";
import { QuickModelPicker } from "./QuickModelPicker";
import type { InferenceModel } from "./ModelOptions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import "./reading-insights.css";
type Guide = {
  keywords: string[];
  summary: string[];
  sections: { title: string; body: string; pages: number[] }[];
};
type Question = {
  question: string;
  options: string[];
  answer: number;
  explanation: string;
  pages: number[];
};
type Quiz = { questions: Question[] };
type Artifact = {
  id: string;
  file_id: string;
  kind: "guide" | "quiz";
  status: string;
  run_id: string;
  session_id: string;
  result: Guide | Quiz | null;
  preview?: Partial<Guide & Quiz>;
  error: string;
  model_config_id: string;
  parameters?: { question_count?: number; difficulty?: string };
  updated_at?: string;
};
export function ReadingInsights({
  paperId,
  file,
  onLocate,
  view,
  onKeyword,
}: {
  view?: "guide" | "quiz";
  onKeyword?: (keyword: string) => void;
  paperId: string;
  file: SourceFile;
  onLocate: (page: number) => void;
}) {
  const [kind, setKind] = useState<"guide" | "quiz">("guide"),
    [rows, setRows] = useState<Artifact[]>([]),
    [models, setModels] = useState<InferenceModel[]>([]),
    [model, setModel] = useState("");
  const [count, setCount] = useState("5"),
    [difficulty, setDifficulty] = useState("easy"),
    [sending, setSending] = useState(false),
    [settingsBusy, setSettingsBusy] = useState(false),
    [error, setError] = useState("");
  const [answers, setAnswers] = useState<Record<number, number>>({}),
    [submitted, setSubmitted] = useState(false);
  const current = useRef(file.id);
  current.current = file.id;
  const active = rows.find(
    (row) =>
      row.file_id === file.id &&
      row.kind === kind &&
      row.model_config_id === model &&
      (kind === "guide" ||
        (row.parameters?.question_count === Number(count) &&
          row.parameters?.difficulty === difficulty)),
  );
  useEffect(() => {
    if (view) setKind(view);
  }, [view]);
  const running = active && ["queued", "running"].includes(active.status);
  useEffect(() => {
    let live = true;
    setRows([]);
    setError("");
    Promise.all([
      api<Artifact[]>(`/papers/${paperId}/reading-artifacts`),
      api<{ models: InferenceModel[]; active_id: string }>(
        "/translation-settings",
      ),
    ])
      .then(([data, config]) => {
        if (live) {
          setRows(data);
          setModels(config.models);
          setModel(config.active_id || config.models[0]?.id || "");
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [paperId, file.id]);
  useEffect(() => {
    const reload = () =>
      void api<{ models: InferenceModel[] }>("/translation-settings")
        .then((config) => setModels(config.models))
        .catch(() => {});
    window.addEventListener("model-settings-updated", reload);
    return () => window.removeEventListener("model-settings-updated", reload);
  }, []);
  useEffect(() => {
    setAnswers({});
    setSubmitted(false);
  }, [active?.id, active?.run_id]);
  useEffect(() => {
    if (!active || !running) return;
    let live = true;
    let timer: number;
    const poll = async () => {
      try {
        const row = await api<Artifact>(`/reading-artifacts/${active.id}`);
        if (live) {
          setRows((rows) =>
            rows.map((item) => (item.id === row.id ? row : item)),
          );
          if (["queued", "running"].includes(row.status))
            timer = window.setTimeout(poll, 700);
        }
      } catch (e) {
        if (live) {
          setError(e instanceof Error ? e.message : "读取进度失败");
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
  async function generate(regenerate = false) {
    if (!model || sending) return;
    const source = file.id;
    setSending(true);
    setError("");
    try {
      const row = await send(`/papers/${paperId}/reading-artifacts`, {
        file_id: file.id,
        model_config_id: model,
        kind,
        question_count: Number(count),
        difficulty,
        ...(regenerate ? { regenerate: true } : {}),
      });
      if (current.current === source)
        setRows((rows) => [row, ...rows.filter((item) => item.id !== row.id)]);
    } catch (e) {
      if (current.current === source)
        setError(e instanceof Error ? e.message : "生成失败");
    } finally {
      setSending(false);
    }
  }
  function pages(values: number[]) {
    return (
      <span className="insights-evidence">
        {values.map((value) => (
          <Button
            key={value}
            variant="link"
            size="sm"
            onClick={() => onLocate(value)}
          >
            第 {value} 页
          </Button>
        ))}
      </span>
    );
  }
  const guide =
    active?.status === "completed" && kind === "guide"
      ? (active.result as Guide)
      : running && kind === "guide" && active.preview
        ? {
            keywords: active.preview.keywords || [],
            summary: active.preview.summary || [],
            sections: active.preview.sections || [],
          }
        : null;
  const quiz =
    active?.status === "completed" && kind === "quiz"
      ? (active.result as Quiz)
      : running && kind === "quiz" && active.preview?.questions
        ? { questions: active.preview.questions }
        : null;
  const previewCount =
    kind === "guide"
      ? (guide?.summary.length || 0) + (guide?.sections.length || 0)
      : quiz?.questions.length || 0;
  return (
    <div className="reading-insights">
      <Tabs
        value={kind}
        onValueChange={(value) => setKind(value as "guide" | "quiz")}
      >
        {!view && (
          <TabsList aria-label="阅读辅助">
            <TabsTrigger value="guide">论文导读</TabsTrigger>
            <TabsTrigger value="quiz">阅读测验</TabsTrigger>
          </TabsList>
        )}
        <div className="insights-config" hidden={kind === "guide" && !!guide}>
          <QuickModelPicker
            models={models}
            value={model}
            onChange={setModel}
            onModels={setModels}
            onBusy={setSettingsBusy}
            disabled={sending || !!running}
            label="阅读辅助"
            onAdd={() => {
              location.hash = "settings";
            }}
          />
          {kind === "quiz" && (
            <div className="insights-quiz-options">
              <Choice
                aria-label="测验题数"
                value={count}
                onValueChange={setCount}
              >
                <option value="5">5 题</option>
                <option value="10">10 题</option>
                <option value="15">15 题</option>
              </Choice>
              <Choice
                aria-label="测验难度"
                value={difficulty}
                onValueChange={setDifficulty}
              >
                <option value="easy">简单</option>
                <option value="hard">困难</option>
              </Choice>
            </div>
          )}
        </div>
        {(error || active?.error) && (
          <Alert variant="destructive">
            <AlertDescription>{error || active?.error}</AlertDescription>
          </Alert>
        )}
        {running ? (
          <div className="insights-status" role="status">
            <span className="streaming-status">
              {previewCount
                ? `正在生成 · 已显示 ${previewCount} ${kind === "guide" ? "段内容" : "道题"}`
                : `正在阅读论文并生成${kind === "guide" ? "导读" : "测验"}…`}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                try {
                  await send(`/agent/runs/${active.run_id}/cancel`, {});
                  const row = await api<Artifact>(
                    `/reading-artifacts/${active.id}`,
                  );
                  setRows((rows) =>
                    rows.map((item) => (item.id === row.id ? row : item)),
                  );
                } catch (e) {
                  setError(e instanceof Error ? e.message : "停止失败");
                }
              }}
            >
              停止
            </Button>
          </div>
        ) : (
          <div
            className="insights-generate"
            hidden={kind === "guide" && !!guide}
          >
            <Button
              size="sm"
              disabled={!model || sending || settingsBusy}
              onClick={() => void generate(active?.status === "completed")}
            >
              {sending
                ? "正在提交…"
                : active?.status === "completed"
                  ? "重新生成"
                  : kind === "guide"
                    ? "生成导读"
                    : "生成测验"}
            </Button>
            {active?.status === "cancelled" && <span>已停止</span>}
          </div>
        )}
        <TabsContent value="guide">
          {guide ? (
            <>
              {!!guide.keywords.length && (
                <GuideCard
                  title="关键词词典"
                  text={guide.keywords.join("、")}
                  regenerate={() => void generate(true)}
                  disabled={sending || !!running}
                >
                  <div className="insights-keywords">
                    {guide.keywords.map((word) => (
                      <Button
                        key={word}
                        variant="secondary"
                        size="sm"
                        onClick={() => onKeyword?.(word)}
                        disabled={!onKeyword}
                      >
                        {word}
                      </Button>
                    ))}
                  </div>
                </GuideCard>
              )}
              {!!guide.summary.length && (
                <GuideCard
                  title="三行摘要"
                  text={guide.summary.join("\n")}
                  regenerate={() => void generate(true)}
                  disabled={sending || !!running}
                >
                  <ol>
                    {guide.summary.map((line, i) => (
                      <li
                        key={i}
                        className={running ? "streaming-item" : undefined}
                      >
                        <Markdown body={line} />
                      </li>
                    ))}
                  </ol>
                </GuideCard>
              )}
              {!!guide.sections.length && (
                <GuideCard
                  title="摘要"
                  text={guide.sections
                    .map((s) => `## ${s.title}\n\n${s.body}`)
                    .join("\n\n")}
                  regenerate={() => void generate(true)}
                  disabled={sending || !!running}
                >
                  {guide.sections.map((section) => (
                    <section
                      key={section.title}
                      className={running ? "streaming-item" : undefined}
                    >
                      <h3>{section.title}</h3>
                      <Markdown body={section.body} />
                      {pages(section.pages)}
                    </section>
                  ))}
                </GuideCard>
              )}
            </>
          ) : (
            !running && (
              <p className="insights-empty">
                从原文生成概要、研究方法、主要结果和适用边界，并保留页码依据。
              </p>
            )
          )}
        </TabsContent>
        <TabsContent value="quiz">
          {quiz ? (
            <>
              <div className="insights-quiz-header">
                {submitted ? (
                  <strong>
                    得分{" "}
                    {
                      quiz.questions.filter(
                        (question, i) => answers[i] === question.answer,
                      ).length
                    }{" "}
                    / {quiz.questions.length}
                  </strong>
                ) : (
                  <span>
                    已作答 {Object.keys(answers).length} /{" "}
                    {quiz.questions.length}
                  </span>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setAnswers({});
                    setSubmitted(false);
                  }}
                >
                  重新作答
                </Button>
              </div>
              {quiz.questions.map((question, index) => (
                <section
                  key={index}
                  className={`insights-question${running ? " streaming-item" : ""}`}
                >
                  <h3>
                    {index + 1}. {question.question}
                  </h3>
                  <div role="group" aria-label={`第 ${index + 1} 题选项`}>
                    {question.options.map((option, n) => (
                      <Button
                        key={n}
                        variant="outline"
                        disabled={submitted || !!running}
                        aria-pressed={answers[index] === n}
                        className={
                          submitted
                            ? n === question.answer
                              ? "answer-correct"
                              : answers[index] === n
                                ? "answer-wrong"
                                : ""
                            : ""
                        }
                        onClick={() =>
                          setAnswers((answers) => ({ ...answers, [index]: n }))
                        }
                      >
                        {String.fromCharCode(65 + n)}. {plainOption(option)}
                      </Button>
                    ))}
                  </div>
                  {submitted && (
                    <div className="insights-answer">
                      <strong>
                        正确答案：{String.fromCharCode(65 + question.answer)}
                      </strong>
                      <p>{question.explanation}</p>
                      {pages(question.pages)}
                    </div>
                  )}
                </section>
              ))}
              {!submitted && (
                <Button
                  disabled={
                    !!running ||
                    Object.keys(answers).length !== quiz.questions.length
                  }
                  onClick={() => setSubmitted(true)}
                >
                  提交并查看解析
                </Button>
              )}
            </>
          ) : (
            !running && (
              <p className="insights-empty">
                选择题数和难度，作答后查看解析与原文依据。
              </p>
            )
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
