import { useI18n } from "../../i18n/I18nProvider";
import type { MessageKey } from "../../i18n/i18n";
import { describeStep } from "./describe";
import type { Step, Turn } from "./conversation";
import styles from "./Research.module.css";

const ROLE_KEY: Record<string, MessageKey> = {
  executor: "research.role.executor",
  advisor: "research.role.advisor",
  distiller: "research.role.distiller",
  system: "research.role.system",
};

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
  const said = describeStep(t, step);
  if (!said) return null;
  return (
    <li
      className={styles.step}
      data-actor={step.actor}
      data-tone={said.tone || undefined}
    >
      <span className={styles.stepLabel}>{said.label}</span>
      {step.node && <span className={styles.nodeChip}>{step.node}</span>}
      {said.meta && <span className={styles.stepMeta}>{said.meta}</span>}
      {said.jobId && (
        <button
          type="button"
          className={styles.linkButton}
          onClick={() => onLog(said.jobId)}
        >
          {t("research.talk.log")}
        </button>
      )}
      {said.note && <p className={styles.stepNote}>{said.note}</p>}
    </li>
  );
}
