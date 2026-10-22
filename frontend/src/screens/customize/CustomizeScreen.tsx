import { useI18n } from "../../i18n/I18nProvider";
import { ModelsSection } from "../settings/ModelsSection";
import { PlaybookPanel } from "../research/PlaybookPanel";
import { MachinesSection } from "./MachinesSection";
import { RolesSection } from "./RolesSection";
import { TrackingSection } from "./TrackingSection";
import { WorkflowsSection } from "../workflows/WorkflowsSection";
import styles from "./CustomizeScreen.module.css";

export type CustomizeSection =
  | "models"
  | "playbook"
  | "roles"
  | "workflows"
  | "machines"
  | "tracking";

/** Full-page access to the configuration ORA already saves and uses. */
export function CustomizeScreen({
  section = "playbook",
}: {
  section?: CustomizeSection;
}) {
  const { t } = useI18n();
  return (
    <section className={styles.page} aria-label={t(`customize.${section}`)}>
      <div
        className={
          section === "workflows"
            ? `${styles.content} ${styles.workflowContent}`
            : styles.content
        }
      >
        {section === "models" ? (
          <div className={styles.models}>
            <ModelsSection />
          </div>
        ) : section === "roles" ? (
          <RolesSection />
        ) : section === "workflows" ? (
          <WorkflowsSection />
        ) : section === "machines" ? (
          <MachinesSection />
        ) : section === "tracking" ? (
          <TrackingSection />
        ) : (
          <PlaybookPanel />
        )}
      </div>
    </section>
  );
}
