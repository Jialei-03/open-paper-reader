import clsx from "clsx";
import {
  ChevronRight,
  FileText,
  Image as ImageIcon,
  RotateCcw,
  Scan,
  Search,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import {
  memo,
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { useI18n, type I18n } from "../../i18n/I18nProvider";
import { Button, Spinner } from "../../ui";
import { followLink, readerHash, type ReaderRoute } from "../route";
import { serviceWords } from "../service-error";
import {
  citedRoute,
  conversation,
  describeStep,
  isActive,
  summarize,
  type AgentRun,
  type AgentStep,
} from "./runs";
import type { Assistant } from "./useAssistant";
import styles from "./AssistantThread.module.css";

/** How close to the end the reading must be (in pixels) for the thread to keep following new text. */
const FOLLOW_SLACK = 48;
/** Formulas in answers: no trust in what the model writes, and no runaway macros. */
const MATH = {
  trust: false,
  throwOnError: false,
  maxExpand: 1000,
  maxSize: 20,
};

export interface AssistantThreadProps {
  assistant: Assistant;
  /** A citation in an answer was followed: the reader goes there. */
  onCite(route: ReaderRoute): void;
}

/**
 * The conversation about the paper, in the side panel's 助手 view (spec 6.3):
 * each question as a bubble (with the sentence it was about), the steps taken
 * folded into one line, and the answer as it is written, its citations as
 * small page labels that lead to the sentence in the paper.
 */
export function AssistantThread({ assistant, onCite }: AssistantThreadProps) {
  const { t } = useI18n();
  const runs = conversation(assistant.runs);
  const thread = useRef<HTMLDivElement>(null);
  useFollow(thread, runs.length);
  // The answers are drawn once per text, whoever passes a new function.
  const citeNow = useRef(onCite);
  citeNow.current = onCite;
  const cite = useCallback((route: ReaderRoute) => citeNow.current(route), []);
  const retry = assistant.retry;

  if (!runs.length && assistant.loading)
    return (
      <div
        className={styles.state}
        role="status"
        aria-label={t("common.loading")}
      >
        <Spinner />
      </div>
    );
  if (!runs.length)
    return (
      <p className={styles.empty} role={assistant.error ? "alert" : undefined}>
        {assistant.error || t("reader.assistant.empty")}
      </p>
    );
  return (
    <div
      ref={thread}
      className={styles.thread}
      role="log"
      aria-label={t("reader.assistant.thread")}
    >
      {runs.map((run) => (
        <Turn key={run.id} run={run} onCite={cite} onRetry={retry} />
      ))}
    </div>
  );
}

/** The nearest ancestor that scrolls: the side panel's body. */
function scrollerOf(element: HTMLElement): HTMLElement | null {
  for (let at = element.parentElement; at; at = at.parentElement) {
    const { overflowY } = getComputedStyle(at);
    if (overflowY === "auto" || overflowY === "scroll") return at;
  }
  return null;
}

/**
 * Keeps the newest message in view while it is written, unless the reader has
 * scrolled up to read something earlier; a new question brings the view back
 * down. The panel's views share one scroller, so a thread that is hidden
 * neither moves it nor listens to it.
 */
function useFollow(content: RefObject<HTMLElement | null>, count: number) {
  const following = useRef(true);
  const shown = count > 0;
  useLayoutEffect(() => {
    const element = content.current;
    const scroller = element && scrollerOf(element);
    if (!element || !scroller) return;
    const visible = () => element.getClientRects().length > 0;
    const follow = () => {
      if (following.current && visible())
        scroller.scrollTop = scroller.scrollHeight;
    };
    const onScroll = () => {
      if (!visible()) return;
      following.current =
        scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <
        FOLLOW_SLACK;
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    const observer = new ResizeObserver(follow);
    observer.observe(element);
    follow();
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      observer.disconnect();
    };
  }, [content, shown]);
  const before = useRef(count);
  useLayoutEffect(() => {
    if (count > before.current) following.current = true;
    before.current = count;
  }, [count]);
}

/** One question and its answer. */
const Turn = memo(function Turn({
  run,
  onCite,
  onRetry,
}: {
  run: AgentRun;
  onCite(route: ReaderRoute): void;
  onRetry(runId: string): void;
}) {
  const i18n = useI18n();
  const { t } = i18n;
  const context = run.runtime?.reader_context;
  const quote = context?.source === "selection" ? (context.quote ?? "") : "";
  const active = isActive(run);
  return (
    <div className={styles.turn} aria-busy={active || undefined}>
      <div className={styles.ask}>
        {quote ? (
          <blockquote className={styles.quote}>{quote}</blockquote>
        ) : (
          context &&
          context.source !== "paper" && (
            <span className={styles.where}>
              {t(
                context.source === "region"
                  ? "reader.assistant.context.region"
                  : "reader.assistant.context.page",
                { page: context.page },
              )}
            </span>
          )
        )}
        <p className={styles.prompt}>{run.prompt}</p>
      </div>
      <Process run={run} />
      {run.response ? (
        <Answer body={run.response} onCite={onCite} />
      ) : (
        active && (
          <p className={styles.thinking}>
            {t(
              run.status === "queued"
                ? "reader.assistant.queued"
                : "reader.assistant.thinking",
            )}
          </p>
        )
      )}
      {run.status === "failed" && (
        <div className={styles.failure}>
          <p className={styles.failureText}>
            {serviceWords(run.error, i18n) || t("reader.assistant.failed")}
          </p>
          <Button
            size="sm"
            variant="ghost"
            icon={RotateCcw}
            onClick={() => onRetry(run.id)}
          >
            {t("common.retry")}
          </Button>
        </div>
      )}
      {run.status === "cancelled" && (
        <p className={styles.stopped}>{t("reader.assistant.stopped")}</p>
      )}
    </div>
  );
});

/** A whole number of seconds, as the process line says it. */
function duration(t: I18n["t"], seconds: number) {
  return seconds >= 60
    ? t("reader.assistant.duration.minutes", {
        minutes: Math.floor(seconds / 60),
        seconds: seconds % 60,
      })
    : t("reader.assistant.duration.seconds", { seconds });
}

/** What the assistant did, in one line ("已处理 9 秒 · 读了 3 页 · 搜索 1 次"), and step by step when opened. */
function Process({ run }: { run: AgentRun }) {
  const { t, tn } = useI18n();
  const [open, setOpen] = useState(false);
  const id = useId();
  const summary = summarize(run);
  const active = isActive(run);
  const steps = run.steps ?? [];
  const parts: string[] = [];
  if (summary.seconds !== null)
    parts.push(
      t(
        active
          ? "reader.assistant.process.running"
          : "reader.assistant.process.done",
        {
          duration: duration(t, summary.seconds),
        },
      ),
    );
  else if (active && steps.length)
    parts.push(t("reader.assistant.process.working"));
  if (summary.pages)
    parts.push(tn("reader.assistant.process.pages", summary.pages));
  if (summary.searches)
    parts.push(tn("reader.assistant.process.searches", summary.searches));
  if (summary.others)
    parts.push(tn("reader.assistant.process.others", summary.others));
  // Waiting its turn, or answered at once without a tool: nothing to tell yet.
  if (!parts.length || (!steps.length && active)) return null;
  const line = parts.join(" · ");
  if (!steps.length) return <p className={styles.process}>{line}</p>;
  return (
    <div className={styles.processBlock}>
      <button
        type="button"
        className={clsx(styles.process, styles.toggle)}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
      >
        <ChevronRight className={styles.chevron} size={12} aria-hidden="true" />
        {line}
      </button>
      <ol id={id} className={styles.steps} hidden={!open}>
        {steps.map((step, index) => (
          <Step key={index} step={step} />
        ))}
      </ol>
    </div>
  );
}

const STEP_ICONS: Record<ReturnType<typeof describeStep>["kind"], LucideIcon> =
  {
    read: FileText,
    region: Scan,
    image: ImageIcon,
    search: Search,
    tool: Wrench,
  };

/** One step: what it did, on what, what came of it, and whether it is done. */
function Step({ step }: { step: AgentStep }) {
  const i18n = useI18n();
  const { t, tn } = i18n;
  const described = describeStep(step);
  const Icon = STEP_ICONS[described.kind];
  let label: string;
  let detail = "";
  let result = "";
  switch (described.kind) {
    case "read":
      label = t("reader.assistant.step.read");
      if (described.first !== null && described.last !== null)
        detail =
          described.first === described.last
            ? t("reader.assistant.step.page", { page: described.first })
            : t("reader.assistant.step.pages", {
                first: described.first,
                last: described.last,
              });
      break;
    case "region":
    case "image":
      label = t(
        described.kind === "region"
          ? "reader.assistant.step.region"
          : "reader.assistant.step.image",
      );
      if (described.page !== null)
        detail = t("reader.assistant.step.page", { page: described.page });
      break;
    case "search":
      label = t("reader.assistant.step.search");
      detail = described.query;
      if (described.found !== null && step.status === "completed")
        result = tn("reader.assistant.step.found", described.found);
      break;
    default:
      label = t("reader.assistant.step.tool");
      detail = described.name;
  }
  // Why it failed, in the service's words (where they may be shown; the status says it failed).
  if (step.status === "failed" && step.error)
    result = serviceWords(step.error, i18n);
  const status =
    step.status === "completed"
      ? "completed"
      : step.status === "failed"
        ? "failed"
        : "running";
  return (
    <li className={styles.step}>
      <Icon size={14} aria-hidden="true" />
      <span className={styles.stepText}>
        {label}
        {detail && <code className={styles.code}>{detail}</code>}
        {result && <span className={styles.result}>{result}</span>}
      </span>
      <span className={clsx(styles.status, styles[status])}>
        {t(`reader.assistant.step.${status}`)}
      </span>
    </li>
  );
}

/** A citation of the paper in an answer: "第 3 页", leading to the sentence it cites. */
function Citation({
  route,
  onCite,
  children,
}: {
  route: ReaderRoute;
  onCite(route: ReaderRoute): void;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const hash = readerHash(route);
  // The address the reader is already at changes nothing: the sentence is sought and marked again.
  const go = () => {
    const again = window.location.hash === hash;
    onCite(route);
    if (again) window.dispatchEvent(new Event("reference-navigate"));
  };
  if (route.page === undefined)
    return (
      <a
        className={styles.link}
        href={hash}
        onClick={followLink(go, hash.slice(1))}
      >
        {children}
      </a>
    );
  return (
    <a
      className={styles.cite}
      href={hash}
      aria-label={t("reader.assistant.cite.goto", { page: route.page })}
      onClick={followLink(go, hash.slice(1))}
    >
      {t("reader.assistant.cite.page", { page: route.page })}
    </a>
  );
}

/** A web address that is one in full: the only kind of link out of an answer, and it opens in a new tab. */
const WEB = /^https?:\/\/[^/\\]/i;

/** An answer in Markdown, drawn again only when its text changes (it grows as it is written). */
const Answer = memo(function Answer({
  body,
  onCite,
}: {
  body: string;
  onCite(route: ReaderRoute): void;
}) {
  const components: Components = {
    a: ({ href, children }) => {
      const route = citedRoute(href);
      if (route)
        return (
          <Citation route={route} onCite={onCite}>
            {children}
          </Citation>
        );
      // Anything else the model wrote as a link leads nowhere from here: an address relative to the
      // app (`//host` and `/\host` are other sites), a script, a scheme. It stays as its words.
      if (!href || !WEB.test(href)) return <span>{children}</span>;
      return (
        <a
          className={styles.link}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
        >
          {children}
        </a>
      );
    },
    // Pictures from elsewhere are not fetched: an answer is not a way to call out of the page.
    img: ({ alt }) => (alt ? <span>{alt}</span> : null),
  };
  return (
    <div className={styles.answer}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, MATH]]}
        skipHtml
        components={components}
      >
        {body}
      </ReactMarkdown>
    </div>
  );
});
