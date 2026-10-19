import { useI18n } from "../../i18n/I18nProvider";
import type { ProjectMetrics } from "./research-api";
import styles from "./Research.module.css";

const percent = (value: number | null) =>
  value === null ? "—" : `${Math.round(value * 100)}%`;

/**
 * How the research is going as a process: how often the agent strayed, how
 * fast it let go of dead ends, how often it handed over properly, how much
 * evidence stands behind the map.
 */
export function MetricsStrip({ metrics }: { metrics: ProjectMetrics }) {
  const { t } = useI18n();
  const cells: [string, string, string][] = [
    [
      t("research.metric.sprints"),
      `${metrics.sprints.executor} + ${metrics.sprints.advisor}`,
      t("research.metric.sprints.hint"),
    ],
    [
      t("research.metric.drift"),
      percent(metrics.soft_drift_rate),
      t("research.metric.drift.hint", { blocked: metrics.hard_drift_blocks }),
    ],
    [
      t("research.metric.backtrack"),
      metrics.backtrack_latency === null
        ? "—"
        : String(metrics.backtrack_latency),
      t("research.metric.backtrack.hint"),
    ],
    [
      t("research.metric.handoff"),
      metrics.abnormal_rate === null ? "—" : percent(1 - metrics.abnormal_rate),
      t("research.metric.handoff.hint"),
    ],
    [
      t("research.metric.evidence"),
      String(metrics.evidence_count),
      t("research.metric.evidence.hint"),
    ],
  ];
  return (
    <dl className={styles.metrics}>
      {cells.map(([label, value, hint]) => (
        <div key={label} className={styles.metric} title={hint}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
