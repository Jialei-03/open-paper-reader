import {
  Check,
  ChevronRight,
  Cpu,
  Database,
  FileText,
  Gauge,
  X,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useI18n } from "../../../i18n/I18nProvider";
import type { MessageKey } from "../../../i18n/i18n";
import { Button, Spinner } from "../../../ui";
import { describeStep } from "../describe";
import type {
  Compute,
  ResearchJob,
  ResearchPlan,
  ResearchProject,
} from "../research-api";
import type { Agent } from "../scene/frames";
import { Mascot } from "../scene/Mascot";
import type { ResearchRun } from "../process/model";
import { RunTurn } from "../process/Process";
import type { ThreadItem } from "./thread";
import styles from "./Talk.module.css";

const ROLE_AGENT: Record<string, Agent> = {
  executor: "executor",
  advisor: "advisor",
  scoping: "advisor",
  distiller: "distiller",
  system: "system",
};

export function Prose({ text }: { text: string }) {
  return (
    <div className={styles.prose}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  );
}

function Speaker({
  role,
  note,
  action,
}: {
  role: string;
  note?: string;
  action?: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <div className={styles.speaker}>
      <Mascot agent={ROLE_AGENT[role] ?? "advisor"} size={20} />
      {t(
        `research.role.${role === "scoping" ? "advisor" : role}` as MessageKey,
      )}
      {note && <span className={styles.speakerNote}>{note}</span>}
      {action}
    </div>
  );
}

export interface ThreadActions {
  approvePlan(version: number): void;
  decide(id: string, approve: boolean, note: string): void;
  openLog(jobId: string): void;
  openRun(jobId: string): void;
  moveCompute(computeId: string): void;
  busy: boolean;
}

export function ThreadView({
  items,
  project,
  computes,
  actions,
  runs,
}: {
  items: ThreadItem[];
  project: ResearchProject;
  computes: Compute[];
  actions: ThreadActions;
  /** Each round's run, by sprint: what it said and did, step by step. */
  runs: Map<string, ResearchRun>;
}) {
  return (
    <>
      {items.map((item) => {
        switch (item.kind) {
          case "message":
            return (
              <MessageItem key={item.id} who={item.who} text={item.text} />
            );
          case "plan":
            return (
              <PlanCard
                key={item.id}
                plan={item.plan}
                current={item.current}
                approved={
                  project.plan?.version === item.plan.version &&
                  !!project.plan?.approved_at
                }
                computes={computes}
                actions={actions}
              />
            );
          case "stage":
            return <StageMark key={item.id} to={item.to} note={item.note} />;
          case "decision":
            return <DecisionCard key={item.id} item={item} actions={actions} />;
          case "work":
            return (
              <WorkBlock
                key={item.id}
                item={item}
                computes={computes}
                actions={actions}
                run={runs.get(item.sprint.id)}
              />
            );
          default:
            return null;
        }
      })}
    </>
  );
}

function MessageItem({ who, text }: { who: string; text: string }) {
  if (who === "human") return <div className={styles.mine}>{text}</div>;
  if (who === "system") return <p className={styles.systemLine}>{text}</p>;
  return (
    <div className={styles.theirs}>
      <Speaker role={who} />
      <Prose text={text} />
    </div>
  );
}

function StageMark({ to, note }: { to: string; note: string }) {
  const { t } = useI18n();
  return (
    <div className={styles.stageMark} role="separator">
      <span>
        <strong>{t(`research.stage.${to}` as MessageKey)}</strong>
        {note ? t("research.thread.withNote", { text: note }) : ""}
      </span>
    </div>
  );
}

function PlanCard({
  plan,
  current,
  approved,
  computes,
  actions,
}: {
  plan: ResearchPlan;
  current: boolean;
  approved: boolean;
  computes: Compute[];
  actions: ThreadActions;
}) {
  const { t } = useI18n();
  const compute = computes.find((c) => c.id === plan.compute_id);
  return (
    <article
      className={styles.card}
      data-faded={(!current && !approved) || undefined}
      aria-label={t("research.plan.title")}
    >
      <header className={styles.cardHead}>
        <FileText size={15} aria-hidden />
        <strong>{t("research.plan.title")}</strong>
        <span>{t("research.plan.version", { n: plan.version })}</span>
        {approved ? (
          <span className={styles.tag} data-tone="good">
            <Check size={12} aria-hidden />
            {t("research.plan.approved")}
          </span>
        ) : !current ? (
          <span className={styles.tag}>{t("research.plan.superseded")}</span>
        ) : (
          <span />
        )}
      </header>
      {(current || approved) && (
        <div className={styles.cardBody}>
          {plan.question && (
            <h3 className={styles.planQuestion}>{plan.question}</h3>
          )}
          {plan.summary && <Prose text={plan.summary} />}
          <dl className={styles.facts}>
            {plan.metric && (
              <>
                <dt>{t("research.plan.metric")}</dt>
                <dd>{plan.metric}</dd>
              </>
            )}
            {plan.baseline && (
              <>
                <dt>{t("research.plan.baseline")}</dt>
                <dd>{plan.baseline}</dd>
              </>
            )}
            {plan.goal && (
              <>
                <dt>{t("research.plan.goal")}</dt>
                <dd>{plan.goal}</dd>
              </>
            )}
          </dl>
          <ol className={styles.hyps}>
            {plan.hypotheses.map((h) => (
              <li key={h.title} className={styles.hyp}>
                <span className={styles.hypTitle}>{h.title}</span>
                <span className={styles.hypKill}>
                  {t("research.plan.killIf", { text: h.kill_if })}
                </span>
              </li>
            ))}
          </ol>
          <div className={styles.tags}>
            {plan.datasets.map((name) => (
              <span key={name} className={styles.tag}>
                <Database size={12} aria-hidden />
                {name}
              </span>
            ))}
            <span className={styles.tag}>
              <Cpu size={12} aria-hidden />
              {compute?.name ?? plan.compute_id}
            </span>
            <span className={styles.tag}>
              <Gauge size={12} aria-hidden />
              {t("research.plan.budget", {
                sprints: plan.budget.max_sprints,
                hours: plan.budget.max_job_hours,
              })}
            </span>
          </div>
        </div>
      )}
      {current && !approved && (
        <footer className={styles.cardFoot}>
          <p>{t("research.plan.hint")}</p>
          <Button
            variant="primary"
            size="sm"
            loading={actions.busy}
            onClick={() => actions.approvePlan(plan.version)}
          >
            {t("research.plan.start")}
          </Button>
        </footer>
      )}
    </article>
  );
}

function DecisionCard({
  item,
  actions,
}: {
  item: Extract<ThreadItem, { kind: "decision" }>;
  actions: ThreadActions;
}) {
  const { t } = useI18n();
  const [note, setNote] = useState("");
  const d = item.event.detail as Record<string, string>;
  const conclusion = d.kind === "conclusion";
  return (
    <article
      className={`${styles.card} ${item.open ? styles.ask : ""}`}
      aria-label={t("research.ask.title")}
    >
      <header className={styles.cardHead}>
        <Mascot
          agent={item.event.actor === "system" ? "system" : "advisor"}
          size={18}
        />
        <strong>
          {conclusion ? t("research.ask.conclusion") : t("research.ask.title")}
        </strong>
        {conclusion ? (
          <span
            className={styles.tag}
            data-tone={d.status === "refuted" ? "warn" : "good"}
          >
            {t(`research.end.${d.status || "concluded"}` as MessageKey)}
          </span>
        ) : d.proposal ? (
          <span className={styles.tag}>
            {t(`research.talk.verdict.${d.proposal}` as MessageKey)}
          </span>
        ) : (
          <span />
        )}
      </header>
      <div className={styles.cardBody}>
        <Prose text={d.reason || ""} />
        {item.open && (
          <textarea
            className={styles.note}
            rows={2}
            value={note}
            placeholder={t(
              conclusion
                ? "research.ask.notePlaceholderMore"
                : "research.ask.notePlaceholder",
            )}
            aria-label={t("research.ask.note")}
            onChange={(event) => setNote(event.target.value)}
          />
        )}
      </div>
      <footer className={styles.cardFoot}>
        {item.open ? (
          <>
            <p>
              {t(
                conclusion
                  ? "research.ask.conclusionHint"
                  : "research.ask.hint",
              )}
            </p>
            <Button
              size="sm"
              variant="secondary"
              disabled={actions.busy}
              onClick={() => actions.decide(item.id, false, note)}
            >
              {t(conclusion ? "research.ask.more" : "research.ask.no")}
            </Button>
            <Button
              size="sm"
              variant="primary"
              loading={actions.busy}
              onClick={() => actions.decide(item.id, true, note)}
            >
              {t(conclusion ? "research.ask.accept" : "research.ask.yes")}
            </Button>
          </>
        ) : (
          <span className={styles.answered}>{t("research.ask.answered")}</span>
        )}
      </footer>
    </article>
  );
}

const number = (value: unknown) =>
  typeof value === "number"
    ? Math.abs(value) >= 1000 || Number.isInteger(value)
      ? String(value)
      : value.toPrecision(4)
    : String(value);

/** The numbers worth a glance: the final ones, not the step counter. */
export function headline(metrics: Record<string, unknown>) {
  return Object.entries(metrics)
    .filter(
      ([k, v]) =>
        k !== "step" && (typeof v === "number" || typeof v === "string"),
    )
    .slice(0, 6);
}

export function trackerLink(url: string) {
  return url.startsWith("http") ? url : "";
}

function duration(job: ResearchJob) {
  const end = job.finished_at ? new Date(job.finished_at) : new Date();
  const s = Math.max(0, Math.round((+end - +new Date(job.started_at)) / 1000));
  return s >= 3600
    ? `${Math.floor(s / 3600)}h${Math.round((s % 3600) / 60)}m`
    : s >= 60
      ? `${Math.floor(s / 60)}m${s % 60}s`
      : `${s}s`;
}

export function RunCard({
  job,
  computes,
  actions,
}: {
  job: ResearchJob;
  computes: Compute[];
  actions: ThreadActions;
}) {
  const { t } = useI18n();
  const numbers = headline(job.metrics ?? {});
  const tracker = trackerLink(job.tracker_url ?? "");
  const compute = computes.find((c) => c.id === job.compute_id);
  return (
    <div className={styles.run}>
      <div className={styles.runHead}>
        <span className={styles.status} data-status={job.status}>
          {job.status === "running" ? (
            <Spinner size={14} />
          ) : job.status === "succeeded" ? (
            <Check size={13} aria-hidden />
          ) : (
            <X size={13} aria-hidden />
          )}
          {t(`research.job.${job.status}` as MessageKey)}
        </span>
        <code className={styles.command} title={job.command}>
          {job.command.split("\n")[0]}
        </code>
        <span className={styles.workMeta}>{duration(job)}</span>
      </div>
      {numbers.length > 0 && (
        <div className={styles.numbers}>
          {numbers.map(([k, v]) => (
            <span key={k} className={styles.number}>
              <span>{k}</span>
              <strong>{number(v)}</strong>
            </span>
          ))}
        </div>
      )}
      <div className={styles.runFoot}>
        {compute && <span>{compute.name}</span>}
        <button
          type="button"
          className={styles.link}
          onClick={() => actions.openLog(job.id)}
        >
          {t("research.run.log")}
        </button>
        {job.points > 0 && (
          <button
            type="button"
            className={styles.link}
            onClick={() => actions.openRun(job.id)}
          >
            {t("research.run.curve")}
          </button>
        )}
        {tracker && (
          <a
            className={styles.link}
            href={tracker}
            target="_blank"
            rel="noreferrer"
          >
            {t("research.run.tracker")}
          </a>
        )}
      </div>
    </div>
  );
}

function WorkBlock({
  item,
  computes,
  actions,
  run,
}: {
  item: Extract<ThreadItem, { kind: "work" }>;
  computes: Compute[];
  actions: ThreadActions;
  run: ResearchRun | undefined;
}) {
  const { t } = useI18n();
  const role = item.sprint.role;
  if (item.sprint.number === 0) {
    // A note by the system between sprints: one line.
    const said = item.steps
      .map((step) => describeStep(t, step))
      .find((x) => x !== null);
    if (!said) return null;
    return (
      <p className={styles.systemLine}>
        {said.label}
        {said.note ? t("research.thread.withNote", { text: said.note }) : ""}
      </p>
    );
  }
  const title =
    role === "executor"
      ? t("research.work.executor", { n: item.sprint.number })
      : role === "advisor"
        ? t("research.work.advisor", { n: item.sprint.number })
        : role === "scoping"
          ? t("research.work.scoping")
          : t("research.work.distiller");
  return (
    <RunTurn
      run={run}
      role={role}
      title={title}
      // A scoping turn's words are the advisor's message, shown on their own.
      final={role === "scoping" ? "" : item.sprint.summary}
    >
      {item.jobs.map((job) => (
        <RunCard key={job.id} job={job} computes={computes} actions={actions} />
      ))}
    </RunTurn>
  );
}
