import { useI18n } from "../../i18n/I18nProvider";
import type { ResearchNode, ResearchSprint } from "./research-api";
import styles from "./Research.module.css";

/**
 * The sprints, newest first: what each worked on, what it handed over, and
 * whether it handed over at all.
 */
export function SprintTimeline({
  sprints,
  nodes,
}: {
  sprints: ResearchSprint[];
  nodes: ResearchNode[];
}) {
  const { t } = useI18n();
  const title = (id: string | null) =>
    (id && nodes.find((node) => node.id === id)?.title) || "";
  if (sprints.length === 0)
    return <p className={styles.hint}>{t("research.noSprints")}</p>;
  return (
    <ol className={styles.timeline}>
      {sprints.map((sprint) => (
        <li
          key={sprint.id}
          className={styles.sprint}
          data-status={sprint.status}
          data-role={sprint.role}
        >
          <div className={styles.sprintHead}>
            <span className={styles.sprintNumber}>
              {t("research.sprint", { number: sprint.number })}
              {sprint.role === "advisor" && (
                <span className={styles.role}>
                  {t("research.role.advisor")}
                </span>
              )}
            </span>
            <span className={styles.sprintState}>
              {t(
                sprint.status === "running"
                  ? "research.sprint.running"
                  : sprint.status === "abnormal"
                    ? "research.sprint.abnormal"
                    : "research.sprint.ended",
              )}
            </span>
          </div>
          {sprint.focus_node_id && (
            <p className={styles.sprintFocus}>
              {t("research.sprint.focus", {
                title: title(sprint.focus_node_id),
              })}
            </p>
          )}
          {sprint.summary && (
            <p className={styles.sprintSummary}>{sprint.summary}</p>
          )}
          {sprint.next_focus && (
            <p className={styles.sprintNext}>
              {t("research.sprint.next", { next: sprint.next_focus })}
            </p>
          )}
          {sprint.waiting_on.length > 0 && (
            <p className={styles.hint}>
              {t("research.sprint.waiting", {
                count: sprint.waiting_on.length,
              })}
            </p>
          )}
        </li>
      ))}
    </ol>
  );
}
