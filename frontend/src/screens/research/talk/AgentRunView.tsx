import {
  ChevronRight,
  ClipboardCheck,
  Crosshair,
  FilePen,
  FileText,
  FolderOpen,
  Globe,
  Map as MapIcon,
  Play,
  Search,
  Stamp,
  Terminal,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "../../../api";
import { useI18n } from "../../../i18n/I18nProvider";
import type { MessageKey } from "../../../i18n/i18n";
import { fadeTail, useSmoothText } from "../../../reader/stream";
import { Spinner } from "../../../ui";
import styles from "./AgentRun.module.css";

/** One step of a research run as the service keeps it (backend agent_worker.py). */
export interface RunStep {
  name: string;
  label?: string;
  status: string;
  arguments?: Record<string, unknown> | string;
  result?: { summary?: string } | string;
  error?: string;
  /** What the agent wrote just before this step: why it takes it. */
  said?: string;
}

export interface ResearchRun {
  id: string;
  status: string;
  response: string;
  error: string;
  steps: RunStep[];
  role: string;
  runtime: { phase?: string; execution_seconds?: number };
  created_at: string;
  updated_at: string;
}

export const getResearchRun = (id: string) =>
  api<ResearchRun>(`/research/runs/${id}`);

const ACTIVE = new Set(["queued", "running"]);
const POLL = 1200;

const ICONS: Record<string, LucideIcon> = {
  bash: Terminal,
  read: FileText,
  write: FilePen,
  edit: FilePen,
  grep: Search,
  find: Search,
  ls: FolderOpen,
  web_read: Globe,
  search_papers: Search,
  read_paper: FileText,
  research_map_read: MapIcon,
  focus: Crosshair,
  run_job: Play,
  job_logs: Terminal,
  job_status: Terminal,
  record_result: ClipboardCheck,
  advise: Stamp,
  propose_plan: FileText,
  finish_setup: ClipboardCheck,
};

const argsOf = (step: RunStep): Record<string, unknown> => {
  if (typeof step.arguments === "string") {
    try {
      return JSON.parse(step.arguments) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return step.arguments ?? {};
};

/** The thing a step was about, in one line: the command, the file, the query. */
export function detailOf(step: RunStep): string {
  const a = argsOf(step);
  const pick = ["command", "path", "pattern", "url", "query", "intent", "title"]
    .map((k) => a[k])
    .find((v) => typeof v === "string" && v);
  return typeof pick === "string" ? pick.split("\n")[0].slice(0, 200) : "";
}

/** What came back, as text: a tool's printed output, or the service's summary. */
export function outputOf(step: RunStep): string {
  if (step.error) return step.error;
  const raw =
    typeof step.result === "string"
      ? step.result
      : (step.result?.summary ?? "");
  try {
    const parsed = JSON.parse(raw) as {
      content?: { type?: string; text?: string }[];
    };
    if (parsed && Array.isArray(parsed.content))
      return parsed.content.map((c) => c.text ?? "").join("\n");
  } catch {
    /* plain text */
  }
  return raw;
}

function seconds(
  t: (k: MessageKey, p?: Record<string, string | number>) => string,
  value: number,
) {
  const s = Math.round(value);
  return s >= 60
    ? t("research.run.minutes", {
        minutes: Math.floor(s / 60),
        seconds: s % 60,
      })
    : t("research.run.seconds", { seconds: s });
}

/**
 * An agent's run as it happens, the way the reader's assistant shows its
 * work: what it says, word by word, and each tool it uses in between, with
 * what came back a click away.
 */
export function AgentRunView({ runId }: { runId: string }) {
  const { t } = useI18n();
  const [run, setRun] = useState<ResearchRun | null>(null);
  const [failed, setFailed] = useState("");
  const [tick, setTick] = useState(0);
  const end = useRef<HTMLDivElement>(null);
  const follow = useRef(true);

  useEffect(() => {
    let live = true;
    getResearchRun(runId).then(
      (value) => live && setRun(value),
      (error: unknown) =>
        live &&
        setFailed(error instanceof Error ? error.message : String(error)),
    );
    return () => {
      live = false;
    };
  }, [runId, tick]);

  const active = !run || ACTIVE.has(run.status);
  useEffect(() => {
    if (!active) return;
    const timer = window.setTimeout(() => setTick((n) => n + 1), POLL);
    return () => window.clearTimeout(timer);
  }, [active, tick]);

  useLayoutEffect(() => {
    if (follow.current) end.current?.scrollIntoView({ block: "end" });
  });

  if (failed) return <p className={styles.error}>{failed}</p>;
  if (!run)
    return (
      <div className={styles.waiting}>
        <Spinner size={14} />
      </div>
    );

  const steps = run.steps ?? [];
  const lastSaid = steps.map((s) => !!s.said).lastIndexOf(true);
  const elapsed = run.runtime?.execution_seconds;
  return (
    <div
      className={styles.run}
      onWheel={(event) => {
        // Scrolling up to read back stops following; reaching the end follows again.
        const box = event.currentTarget.parentElement;
        if (box)
          follow.current =
            box.scrollHeight - box.scrollTop - box.clientHeight < 60;
      }}
    >
      <p className={styles.process}>
        {active && <Spinner size={14} />}
        {[
          t(
            run.status === "queued"
              ? "research.run.queued"
              : active
                ? "research.run.working"
                : run.status === "completed"
                  ? "research.run.done"
                  : "research.run.stopped",
          ),
          elapsed ? seconds(t, elapsed) : "",
          steps.length ? t("research.run.steps", { n: steps.length }) : "",
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
      {steps.map((step, i) => (
        <div key={i} className={styles.turn}>
          {step.said && (
            <Words
              text={step.said}
              done={!active || i !== lastSaid || !!run.response}
            />
          )}
          <Step step={step} />
        </div>
      ))}
      {/* What it is writing now, unless it is what the last step already shows. */}
      {run.response &&
        run.response.trim() !== (steps[lastSaid]?.said ?? "").trim() && (
          <Words text={run.response} done={!active} answer />
        )}
      {run.status === "failed" && run.error && (
        <p className={styles.error}>{run.error}</p>
      )}
      <div ref={end} />
    </div>
  );
}

/** What the agent said, revealed at an even pace while it is being written. */
const Words = memo(function Words({
  text,
  done,
  answer = false,
}: {
  text: string;
  done: boolean;
  answer?: boolean;
}) {
  const { text: shown, flowing } = useSmoothText(text, { done });
  return (
    <div className={answer ? styles.answer : styles.said}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={flowing ? [fadeTail] : []}
        skipHtml
      >
        {shown}
      </ReactMarkdown>
    </div>
  );
});

function Step({ step }: { step: RunStep }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const Icon = ICONS[step.name] ?? Wrench;
  const detail = detailOf(step);
  const output = outputOf(step).trim();
  const status =
    step.status === "completed"
      ? "completed"
      : step.status === "failed"
        ? "failed"
        : "running";
  const label = t(`research.tool.${step.name}` as MessageKey);
  return (
    <div className={styles.stepBlock}>
      <button
        type="button"
        className={styles.step}
        aria-expanded={output ? open : undefined}
        disabled={!output}
        onClick={() => setOpen(!open)}
      >
        <Icon size={14} aria-hidden />
        <span className={styles.stepText}>
          {label.startsWith("research.tool.") ? step.label || step.name : label}
          {detail && <code className={styles.code}>{detail}</code>}
        </span>
        <span className={`${styles.status} ${styles[status]}`}>
          {status === "running" ? (
            <Spinner size={14} />
          ) : (
            t(`research.run.step.${status}` as MessageKey)
          )}
        </span>
        {output && (
          <ChevronRight size={12} className={styles.chevron} aria-hidden />
        )}
      </button>
      {open && output && <pre className={styles.output}>{output}</pre>}
    </div>
  );
}
