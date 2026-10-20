import { useI18n } from "../../i18n/I18nProvider";
import { REPOSITORY } from "../../features/ProductSite";
import styles from "./projects/Projects.module.css";

const STEPS = `git clone ${REPOSITORY}
cd open-research-agent
make install && make build
.venv/bin/python -m backend.local`;

/**
 * What the hosted site shows in place of research: experiments run on the
 * researcher's own machines, so research comes with the local edition.
 */
export function LocalOnly() {
  const { t } = useI18n();
  return (
    <div className={styles.page} data-testid="research-local-only">
      <div className={styles.inner}>
        <header className={styles.head}>
          <h1 className={styles.title}>{t("research.localOnly.title")}</h1>
        </header>
        <p className={styles.lead}>{t("research.localOnly.lead")}</p>
        <pre className={styles.steps}>
          <code>{STEPS}</code>
        </pre>
        <p className={styles.lead}>
          <a href={REPOSITORY} target="_blank" rel="noreferrer">
            {t("research.localOnly.guide")}
          </a>
        </p>
      </div>
    </div>
  );
}
