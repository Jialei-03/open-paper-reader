import { useI18n } from "../../i18n/I18nProvider";
import type { MessageKey } from "../../i18n/i18n";
import type { Step, Turn } from "./conversation";
import styles from "./Research.module.css";

const ROLE_KEY: Record<string, MessageKey> = {
  executor: "research.role.executor",
  advisor: "research.role.advisor",
  distiller: "research.role.distiller",
  system: "research.role.system",
};

const text = (value: unknown) => (typeof value === "string" ? value : "");

/**
 * The project as an exchange between its agents: the executor's sprints on the
 * left, the advisor's on the right, the system's checks in between, each step
 * naming the node on the map it is about.
 */
export function ResearchConversation({
  turns,
  onLog,
}: {
  turns: Turn[];
  onLog(jobId: string): void;
}) {
  const { t } = useI18n();
  if (turns.length === 0)
    return <p className={styles.hint}>{t("research.talk.empty")}</p>;
  return (
    <>
      <p className={styles.hint}>{t("research.talk.lead")}</p>
      <ol className={styles.talk}>
        {turns.map((turn) => (
          <li key={turn.key} className={styles.turn} data-role={turn.role}>
            {turn.role !== "system" && (
              <div className={styles.turnHead}>
                <span className={styles.turnRole}>
                  {t(ROLE_KEY[turn.role] ?? "research.role.system")}
                </span>
                {turn.number !== null && (
                  <span className={styles.turnNumber}>
                    {t("research.sprint", { number: turn.number })}
                  </span>
                )}
              </div>
            )}
            <ul className={styles.steps}>
              {turn.steps.map((step) => (
                <StepLine key={step.id} step={step} onLog={onLog} />
              ))}
            </ul>
            {turn.role !== "system" && turn.handoff && (
              <div className={styles.handoff}>
                <span className={styles.stepLabel}>
                  {t(
                    turn.role === "advisor"
                      ? "research.talk.assessment"
                      : "research.talk.handoff",
                  )}
                </span>
                <p>{turn.handoff}</p>
                {turn.nextFocus && (
                  <p className={styles.stepNote}>
                    {t("research.talk.next", { text: turn.nextFocus })}
                  </p>
                )}
              </div>
            )}
          </li>
        ))}
      </ol>
    </>
  );
}

function StepLine({ step, onLog }: { step: Step; onLog(jobId: string): void }) {
  const { t } = useI18n();
  const d = step.detail;
  const node = step.node ? (
    <span className={styles.nodeChip}>{step.node}</span>
  ) : null;
  const line = (
    label: string,
    body?: string,
    extra?: React.ReactNode,
    tone?: string,
  ) => (
    <li className={styles.step} data-actor={step.actor} data-tone={tone}>
      <span className={styles.stepLabel}>{label}</span>
      {node}
      {extra}
      {body && <p className={styles.stepNote}>{body}</p>}
    </li>
  );
  switch (step.action) {
    case "focus":
      return line(t("research.talk.focus"), text(d.intent));
    case "add_node":
      return line(
        t("research.talk.add", {
          kind: t(`research.kind.${text(d.kind) || "question"}` as MessageKey),
        }),
        text(d.kill_if)
          ? t("research.talk.killIf", { text: text(d.kill_if) })
          : text(d.reason),
      );
    case "update_node": {
      const before = (d.before ?? {}) as Record<string, unknown>;
      const after = (d.after ?? {}) as Record<string, unknown>;
      const status =
        text(after.status) &&
        t("research.talk.status", {
          from: t(
            `research.node.${text(before.status) || "open"}` as MessageKey,
          ),
          to: t(`research.node.${text(after.status)}` as MessageKey),
        });
      // Confidence and doubts change on every result; the status is what reads as a decision.
      if (!status) return null;
      return line(
        t("research.talk.update"),
        text(d.reason),
        <span className={styles.stepMeta}>{status}</span>,
      );
    }
    case "run_job":
      return line(
        t("research.talk.run"),
        text(d.command).split("\n")[0].slice(0, 160),
        <button
          type="button"
          className={styles.linkButton}
          onClick={() => onLog(text(d.job_id))}
        >
          {t("research.talk.log")}
        </button>,
      );
    case "record_result":
      return line(
        t("research.talk.record"),
        text(d.summary),
        d.kill_triggered === "yes" ? (
          <span className={styles.stepMeta}>{t("research.talk.killed")}</span>
        ) : null,
        d.kill_triggered === "yes" ? "warn" : undefined,
      );
    case "end_sprint":
      return text(d.needs_input)
        ? line(
            t("research.talk.needs", { text: text(d.needs_input) }),
            undefined,
            undefined,
            "warn",
          )
        : null;
    case "advice":
      return line(
        t(`research.talk.verdict.${text(d.verdict)}` as MessageKey),
        text(d.reason),
        undefined,
        d.verdict === "kill" || d.verdict === "pivot" ? "warn" : undefined,
      );
    case "advice_skipped":
      return line(t("research.talk.skipped"), text(d.note), undefined, "warn");
    case "drift_judged":
      return line(
        t(d.on_track ? "research.talk.onTrack" : "research.talk.drifted", {
          number: Number(d.sprint_number) || 0,
        }),
        text(d.note),
        undefined,
        d.on_track ? undefined : "warn",
      );
    case "concluded":
      return line(
        t("research.talk.concluded", {
          ending: t(`research.end.${text(d.status)}` as MessageKey),
        }),
        text(d.summary),
        undefined,
        "done",
      );
    case "input_needed":
      return line(
        t("research.talk.inputNeeded"),
        text(d.summary),
        undefined,
        "warn",
      );
    case "conclude_rejected":
      return line(t("research.talk.rejected"), text(d.why), undefined, "warn");
    case "drift_blocked":
      return line(
        t("research.talk.blocked", { tool: text(d.tool) }),
        t(`research.talk.blocked.${text(d.reason)}` as MessageKey),
        undefined,
        "warn",
      );
    case "auto_decided":
      return line(t("research.talk.auto", { proposal: text(d.proposal) }));
    case "decision_requested":
      return line(t("research.talk.asked"), text(d.reason), undefined, "warn");
    case "budget_mark":
      return line(
        t("research.talk.budget", {
          percent: Math.round(Number(d.mark) * 100),
        }),
      );
    case "playbook_version":
      return line(
        t("research.talk.playbook", {
          version: Number(d.version) || 0,
          count: Array.isArray(d.active) ? d.active.length : 0,
        }),
      );
    case "finished":
      return line(
        t("research.talk.finished", {
          ending: t(`research.end.${text(d.end_reason)}` as MessageKey),
        }),
      );
    case "distilled":
      return line(
        t("research.talk.distilled", {
          added: Number(d.added) || 0,
          edited: Number(d.edited) || 0,
          merged: Number(d.merged) || 0,
          deleted: Number(d.deleted) || 0,
          voted: Number(d.voted) || 0,
        }),
      );
    default:
      return null;
  }
}
