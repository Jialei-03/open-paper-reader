import { useI18n } from "../../i18n/I18nProvider";
import { ModelsSection } from "../settings/ModelsSection";
import { PlaybookPanel } from "../research/PlaybookPanel";
import styles from "./CustomizeScreen.module.css";

export type CustomizeSection = "models" | "playbook";

/** Full-page access to the configuration ORA already saves and uses. */
export function CustomizeScreen({
  section = "playbook",
}: {
  section?: CustomizeSection;
}) {
  const { t } = useI18n();
  return (
    <section className={styles.page} aria-label={t("customize.title")}>
      <div className={styles.content}>
        {section === "models" ? (
          <div className={styles.models}>
            <ModelsSection page />
          </div>
        ) : (
          <>
            <header className={styles.header}>
              <h1 id="customize-title">{t("customize.playbook")}</h1>
            </header>
            <div className={styles.body}>
              <PlaybookPanel />
            </div>
          </>
        )}
      </div>
    </section>
  );
}
